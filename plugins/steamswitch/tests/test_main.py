"""Backend tests for the Steam Switch plugin.

No Steam install, no registry, no PowerShell: the local Steam layout (loginusers.vdf and app
manifests) is rebuilt in a temporary folder, and the two probes that talk to Windows are
replaced. The tests cover the decision the game page depends on: is this game borrowed, and
which saved account owns it.
"""

import asyncio
import importlib.util
import sys
import tempfile
import time
import types
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

LOGIN_USERS = """\"users\"
{{
\t\"{current_id}\"
\t{{
\t\t\"AccountName\"\t\t\"{current}\"
\t\t\"PersonaName\"\t\t\"{current_persona}\"
\t\t\"RememberPassword\"\t\t\"1\"
\t\t\"WantsOfflineMode\"\t\t\"0\"
\t\t\"SkipOfflineModeWarning\"\t\t\"0\"
\t\t\"AutoLogin\"\t\t\"1\"
\t\t\"timestamp\"\t\t\"1795349947\"
\t}}
\t\"{other_id}\"
\t{{
\t\t\"AccountName\"\t\t\"{other}\"
\t\t\"PersonaName\"\t\t\"{other_persona}\"
\t\t\"RememberPassword\"\t\t\"{other_remember}\"
\t\t\"WantsOfflineMode\"\t\t\"0\"
\t\t\"SkipOfflineModeWarning\"\t\t\"0\"
\t\t\"AutoLogin\"\t\t\"0\"
\t\t\"timestamp\"\t\t\"1794743394\"
\t}}
}}
"""

MANIFEST = """\"AppState\"
{{
\t\"appid\"\t\t\"{appid}\"
\t\"name\"\t\t\"{name}\"
\t\"StateFlags\"\t\t\"{flags}\"
\t\"installdir\"\t\t\"{name}\"
\t\"LastOwner\"\t\t\"{owner}\"
}}
"""

BASE = 76561197960265728


def steam_id(digit: int) -> int:
    return 76561197960265728 + 1000000 + digit


class SteamSwitchTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.home = Path(self.temp.name)
        self.root = self.home / "Steam"
        (self.root / "config").mkdir(parents=True)
        (self.root / "steamapps").mkdir(parents=True)
        (self.root / "steamapps" / "libraryfolders.vdf").write_text(
            '"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"'
            + str(self.root).replace("\\", "\\\\")
            + '"\n\t}\n}\n',
            "utf-8",
        )

        fake = types.ModuleType("decky")
        fake.logger = None
        fake.DECKY_PLUGIN_DIR = str(ROOT)
        fake.DECKY_PLUGIN_SETTINGS_DIR = str(self.home / "settings")
        fake.DECKY_PLUGIN_RUNTIME_DIR = str(self.home / "runtime")
        (self.home / "settings").mkdir()
        (self.home / "runtime").mkdir()
        sys.modules["decky"] = fake

        spec = importlib.util.spec_from_file_location("steamswitch_main", ROOT / "main.py")
        self.main = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.main)

        # the two Windows probes: a fake Steam root and a fake signed-in account
        self.main.steam_root = lambda: self.root
        self.main.is_supported = lambda: True
        self.current_id = steam_id(1)
        self.main.active_user_id64 = lambda: self.current_id
        self.other_id = steam_id(2)

        self.write_accounts()

    def tearDown(self) -> None:
        self.temp.cleanup()

    # -- fixtures ------------------------------------------------------------ #

    def write_accounts(self, other_remember: str = "1") -> None:
        (self.root / "config" / "loginusers.vdf").write_text(
            LOGIN_USERS.format(
                current_id=self.current_id,
                current="me_account",
                current_persona="Me",
                other_id=self.other_id,
                other="other_account",
                other_persona="Other",
                other_remember=other_remember,
            ),
            "utf-8",
        )

    def write_manifest(self, appid: int, owner: int, flags: int = 4, name: str = "Borrowed") -> None:
        (self.root / "steamapps" / f"appmanifest_{appid}.acf").write_text(
            MANIFEST.format(appid=appid, name=name, flags=flags, owner=owner), "utf-8"
        )

    # -- parsing ------------------------------------------------------------- #

    def test_vdf_parser_nested_blocks(self) -> None:
        parsed = self.main.vdf_loads(
            '"root"\n{\n\t"a"\t\t"1"\n\t"child"\n\t{\n\t\t"b"\t\t"two words"\n\t}\n}\n'
        )
        self.assertEqual(parsed["root"]["a"], "1")
        self.assertEqual(parsed["root"]["child"]["b"], "two words")

    def test_read_accounts(self) -> None:
        accounts = self.main.read_accounts(self.root)
        self.assertEqual([a["account"] for a in accounts], ["me_account", "other_account"])
        other = accounts[1]
        self.assertEqual(other["id64"], str(self.other_id))
        self.assertEqual(other["id32"], self.other_id - BASE)
        self.assertEqual(other["persona"], "Other")
        self.assertTrue(other["remember"])
        mine = accounts[0]
        self.assertTrue(mine["auto"])
        self.assertFalse(other["auto"])

    def test_current_account_from_registry_value(self) -> None:
        accounts = self.main.read_accounts(self.root)
        current = self.main.current_account(self.root, accounts)
        self.assertEqual(current["account"], "me_account")

    def test_manifest_installed_flag(self) -> None:
        self.write_manifest(10, self.current_id, flags=4)
        self.assertTrue(self.main.manifest_installed(self.main.app_manifest(self.root, 10)))
        self.write_manifest(11, self.current_id, flags=2)
        self.assertFalse(self.main.manifest_installed(self.main.app_manifest(self.root, 11)))
        self.assertFalse(self.main.manifest_installed(None))

    # -- game state ---------------------------------------------------------- #

    def test_borrowed_game_can_switch_to_owner(self) -> None:
        self.write_manifest(1302240, self.other_id)
        state = self.main.game_state(1302240)
        self.assertTrue(state["ok"])
        self.assertTrue(state["installed"])
        self.assertTrue(state["can_switch"])
        self.assertEqual(state["target"]["account"], "other_account")
        self.assertEqual(state["owner"]["persona"], "Other")
        self.assertEqual(state["current"]["account"], "me_account")

    def test_owner_from_page_overrides_missing_manifest_owner(self) -> None:
        self.write_manifest(1302240, 0)
        state = self.main.game_state(1302240, self.other_id - BASE)
        self.assertTrue(state["can_switch"])
        self.assertEqual(state["target"]["account"], "other_account")

    def test_owned_game_keeps_native_button(self) -> None:
        self.write_manifest(1302240, self.current_id)
        state = self.main.game_state(1302240, self.current_id - BASE)
        self.assertFalse(state["can_switch"])
        self.assertIn("already owns", state["reason"])

    def test_not_installed_is_not_switchable(self) -> None:
        state = self.main.game_state(999999, self.other_id - BASE)
        self.assertFalse(state["installed"])
        self.assertFalse(state["can_switch"])
        self.assertIn("not installed", state["reason"])

    def test_unknown_owner_with_single_other_account(self) -> None:
        self.write_manifest(1302240, 0)
        state = self.main.game_state(1302240)
        self.assertTrue(state["can_switch"])
        self.assertEqual(state["target"]["account"], "other_account")

    def test_owner_not_saved_on_this_pc(self) -> None:
        self.write_manifest(1302240, steam_id(9))
        state = self.main.game_state(1302240)
        self.assertFalse(state["can_switch"])
        self.assertIn("not signed in", state["reason"])

    def test_account_without_remembered_password_is_refused(self) -> None:
        self.write_accounts(other_remember="0")
        self.write_manifest(1302240, self.other_id)
        state = self.main.game_state(1302240)
        self.assertFalse(state["can_switch"])
        self.assertIn("remember", state["reason"])

    # -- status file --------------------------------------------------------- #

    def test_state_file_roundtrip_and_busy_window(self) -> None:
        self.main.write_state({"state": "shutdown", "message": "closing", "time": int(time.time() * 1000)})
        state = self.main.read_state()
        self.assertEqual(state["state"], "shutdown")
        self.assertTrue(self.main.switch_in_progress())

        self.main.write_state({"state": "done", "message": "ok", "time": int(time.time() * 1000)})
        self.assertFalse(self.main.switch_in_progress())

    def test_switch_and_play_refuses_owned_game(self) -> None:
        self.main.launch_only = lambda appid: {"ok": True, "steam": appid}
        self.write_manifest(1302240, self.current_id)
        plugin = self.main.Plugin()
        reply = asyncio.run(plugin.switch_and_play(1302240, self.current_id - BASE))
        self.assertTrue(reply["ok"])
        self.assertEqual(reply["state"], "launched")


if __name__ == "__main__":
    unittest.main()
