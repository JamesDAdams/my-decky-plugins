"""Unit tests for the pure parsers in main.py.

Run with:  python -m unittest discover -s tests -v
(the plugin itself needs Decky; the parsers do not)
"""

import importlib.util
import sys
import types
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load_main():
    fake = types.ModuleType("decky")
    fake.logger = None
    fake.DECKY_PLUGIN_DIR = str(ROOT)
    fake.DECKY_PLUGIN_SETTINGS_DIR = str(ROOT)
    sys.modules.setdefault("decky", fake)
    spec = importlib.util.spec_from_file_location("scsk_main", ROOT / "main.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


main = load_main()


DETAIL = """
 Cyberpunk 2077 (steam:1091500, Steam)
 install /home/deck/.steam/steam/steamapps/common/Cyberpunk 2077
 exe /home/deck/.steam/steam/steamapps/common/Cyberpunk 2077/bin/x64/Cyberpunk2077.exe
 runs as Cyberpunk2077.exe (seen 2026-11-19 21:04)
 warms stage Cyberpunk2077.exe
 engine Unreal Engine 5.4 DirectX 12
 status Warmed: its next launch reads the cache the compile wrote
 anti-cheat None
 shaders 148213
 plan 12004 recorded + 8500 generated + 0 DirectX 11 shaders + 12 middleware, 14 root sigs, rule verified: True
 stutter known, high: lots of pipelines in the first hour (community, checked 2026-10-02)
 middleware FidelityFX Super Resolution 3 [ffx_fsr3.dll]
 estimate 2.4 GB of cache, 0:12:31
 careful - (AMD only)
 shared used, follows Settings
 warmed 2026-11-20 18:12 for driver 24.10.1 in 0:11:04, 3 skipped
 failed -
 covered 97% for DirectX 12
 cache 1.9 GB on disk, 1.9 GB in use (driver-cache files its warms or the game had open)
 keys Cyberpunk2077.exe
 recorder not installed
 recording 42 MB (the game folder's files and SCSKiller's copy), 1204 pipelines, limit 2 GB per game
 last play 0:05:00, 1204 pipelines: 1190 from the game's library, 10 cache hits, 4 compiles (worst 21.5 ms)
 1st launch 2026-11-20 18:20, after the last compile: 1190 cache hits, 4 compiles (99.7% compiled)
"""

SCAN = """GPU: AMD Radeon Graphics (RADV VANGOGH), driver 24.10.1, profile RADV
Warmed              steam:1091500            Cyberpunk 2077 [known stutter: high] [cache 1.9 GB] - its next launch reads the cache the compile wrote
Ready               steam:620                Portal 2 [cache 12.4 MB] - nothing compiled yet
Stale               steam:570                Dota 2 - a driver update cleared its cache
Unsupported         steam:220                Half-Life 2 - DirectX 9
NeedsRecording      steam:292030             The Witcher 3 - pipelines are built at run time
            middleware: FidelityFX Super Resolution 3
"""


class TestBytes(unittest.TestCase):
    def test_units(self):
        self.assertEqual(main.parse_bytes("1.2 GB"), int(1.2 * 1024 ** 3))
        self.assertEqual(main.parse_bytes("345 MB"), 345 * 1024 ** 2)
        self.assertEqual(main.parse_bytes("12 KB"), 12 * 1024)
        self.assertEqual(main.parse_bytes("900 B"), 900)

    def test_unknown(self):
        self.assertIsNone(main.parse_bytes("-"))
        self.assertIsNone(main.parse_bytes(""))


class TestHms(unittest.TestCase):
    def test_hms(self):
        self.assertEqual(main.parse_hms("0:12:31"), 751)
        self.assertEqual(main.parse_hms("1:00:00"), 3600)
        self.assertIsNone(main.parse_hms("12:31"))


class TestStatusNames(unittest.TestCase):
    def test_kinds(self):
        self.assertEqual(main.normalize_status("Warmed")["kind"], "ok")
        self.assertEqual(main.normalize_status("Ready")["kind"], "todo")
        self.assertEqual(main.normalize_status("Stale")["kind"], "stale")
        self.assertEqual(main.normalize_status("NeedsRecording")["kind"], "recording")
        self.assertEqual(main.normalize_status("NotCompatible")["kind"], "blocked")
        self.assertEqual(main.normalize_status("NeedsSteamStart")["kind"], "todo")
        self.assertEqual(main.normalize_status(None)["kind"], "unknown")

    def test_label(self):
        self.assertEqual(main.normalize_status("Warmed")["label"], "Warmed")
        self.assertEqual(main.normalize_status("NeedsRecording")["label"], "Needs a recording")


class TestDetail(unittest.TestCase):
    def setUp(self):
        self.parsed = main.parse_detail(DETAIL)
        self.fields = self.parsed["fields"]

    def test_header(self):
        self.assertEqual(self.parsed["game_id"], "steam:1091500")
        self.assertEqual(self.parsed["name"], "Cyberpunk 2077")
        self.assertEqual(self.parsed["store"], "Steam")

    def test_status(self):
        self.assertEqual(self.fields["status"], "Warmed")
        self.assertEqual(self.parsed["status"]["kind"], "ok")
        self.assertIn("next launch", self.fields["status_reason"])

    def test_warmed(self):
        self.assertEqual(self.parsed["warmed_at"], "2026-11-20 18:12")
        self.assertEqual(self.parsed["warmed_driver"], "24.10.1")
        self.assertEqual(self.parsed["warmed_seconds"], 664)

    def test_cache(self):
        self.assertEqual(self.parsed["cache_bytes"], int(1.9 * 1024 ** 3))
        self.assertEqual(self.parsed["cache_in_use_bytes"], int(1.9 * 1024 ** 3))

    def test_coverage(self):
        self.assertEqual(self.parsed["covered_pct"], 97)
        self.assertEqual(self.parsed["covered_api"], "DirectX 12")

    def test_plan_and_shaders(self):
        self.assertEqual(self.parsed["shader_count"], 148213)
        self.assertEqual(self.parsed["recorded_pipelines"], 12004)

    def test_estimate(self):
        self.assertEqual(self.parsed["estimate_bytes"], int(2.4 * 1024 ** 3))
        self.assertEqual(self.parsed["estimate_seconds"], 751)

    def test_recorder(self):
        self.assertFalse(self.parsed["recorder_installed"])

    def test_exe(self):
        self.assertTrue(self.fields["exe"].endswith("Cyberpunk2077.exe"))


class TestDetailEdgeCases(unittest.TestCase):
    def test_never_warmed(self):
        parsed = main.parse_detail("Ready game (steam:1, Steam)\n status Ready: nothing compiled yet\n warmed never\n")
        self.assertIsNone(parsed["warmed_at"])
        self.assertEqual(parsed["status"]["kind"], "todo")

    def test_empty(self):
        parsed = main.parse_detail("")
        self.assertEqual(parsed["status"]["kind"], "unknown")
        self.assertNotIn("game_id", parsed)


class TestRows(unittest.TestCase):
    def test_rows(self):
        rows = main.parse_rows(SCAN)
        ids = [r["game_id"] for r in rows]
        self.assertEqual(ids, ["steam:1091500", "steam:620", "steam:570", "steam:220", "steam:292030"])
        cyberpunk = rows[0]
        self.assertEqual(cyberpunk["name"], "Cyberpunk 2077")
        self.assertIn("next launch", cyberpunk["reason"])
        self.assertEqual(cyberpunk["status"]["kind"], "ok")
        self.assertEqual(cyberpunk["flags"]["cache_bytes"], int(1.9 * 1024 ** 3))
        self.assertEqual(cyberpunk["flags"]["known_stutter"], "high")
        self.assertTrue(rows[1]["flags"].get("cache_bytes"))

    def test_middleware_line_ignored(self):
        rows = main.parse_rows(SCAN)
        self.assertFalse(any("middleware" in r["name"] for r in rows))

    def test_names_with_spaces(self):
        rows = main.parse_rows(SCAN)
        self.assertEqual(rows[4]["name"], "The Witcher 3")

    def test_empty(self):
        self.assertEqual(main.parse_rows(""), [])


class TestProgress(unittest.TestCase):
    def test_line(self):
        info = main.parse_progress_line("21:04:12 steam:1091500 Compiling 1200/12004")
        self.assertEqual(info["game_id"], "steam:1091500")
        self.assertEqual(info["stage"], "Compiling 1200/12004")
        self.assertIsNone(info["error"])

    def test_error(self):
        info = main.parse_progress_line("21:04:12 steam:1091500 Warming - driver lost the device")
        self.assertEqual(info["error"], "driver lost the device")

    def test_plain(self):
        info = main.parse_progress_line("nothing to compile")
        self.assertEqual(info["text"], "nothing to compile")
        self.assertIsNone(info["stage"])


class TestRealLinuxOutput(unittest.TestCase):
    """The block a real Linux user got from `SCSKiller-x86_64.AppImage --cli status` (issue #295)."""

    REAL = """
Cyberpunk 2077 (steam:1091500, Steam)
 install /home/deck/.steam/steam/steamapps/common/Cyberpunk 2077
 exe /home/deck/.steam/steam/steamapps/common/Cyberpunk 2077/bin/x64/Cyberpunk2077.exe
 runs as not seen yet, warms stage Cyberpunk2077.exe
 engine REDengine 4 DXIL D3D12
 status Stale: 1,612 new upscaler pipelines. Compile again to include them
 anti-cheat None
 shaders 8423
 plan 5775 recorded + 0 generated + 0 DirectX 11 shaders + 0 middleware, 0 root sigs, rule verified: False
 estimate 135 MB of cache, 0:00:36
 warmed 2026-11-05 12:58 for driver 26.2.6 (83eda0d0) in 0:00:00, 5753 skipped (some of them)
 covered 0% for DirectX 12
 keys 1091500
 recorder installed. Played, nothing recorded. The recorder never loaded in the last launch
"""

    def setUp(self):
        self.parsed = main.parse_detail(self.REAL)

    def test_header_and_status(self):
        self.assertEqual(self.parsed["game_id"], "steam:1091500")
        self.assertEqual(self.parsed["name"], "Cyberpunk 2077")
        self.assertEqual(self.parsed["fields"]["status"], "Stale")
        self.assertEqual(self.parsed["status"]["kind"], "stale")
        self.assertIn("1,612 new upscaler pipelines", self.parsed["fields"]["status_reason"])

    def test_warmed_with_parenthesis_in_driver(self):
        self.assertEqual(self.parsed["warmed_at"], "2026-11-05 12:58")
        self.assertEqual(self.parsed["warmed_driver"], "26.2.6 (83eda0d0)")
        self.assertEqual(self.parsed["warmed_seconds"], 0)

    def test_estimate_and_coverage(self):
        self.assertEqual(self.parsed["estimate_bytes"], 135 * 1024 ** 2)
        self.assertEqual(self.parsed["estimate_seconds"], 36)
        self.assertEqual(self.parsed["covered_pct"], 0)
        self.assertEqual(self.parsed["covered_api"], "DirectX 12")

    def test_recorder_and_plan(self):
        self.assertTrue(self.parsed["recorder_installed"])
        self.assertEqual(self.parsed["recorded_pipelines"], 5775)
        self.assertEqual(self.parsed["shader_count"], 8423)

    def test_missing_cache_line_is_not_an_error(self):
        self.assertNotIn("cache_bytes", self.parsed)
        self.assertIsNotNone(self.parsed["fields"]["exe"])


class TestGameId(unittest.TestCase):
    def test_ids(self):
        plugin = main.Plugin()
        self.assertEqual(plugin._game_id(620), "steam:620")
        self.assertEqual(plugin._game_id("620"), "steam:620")
        self.assertEqual(plugin._game_id("steam:620"), "steam:620")
        self.assertEqual(plugin._game_id(""), "")


KEPT = {
    "Build": "1.4.8+abc",
    "Driver": "1002:73ff:0000:2600",
    "Games": [
        {
            "Game": {
                "Id": "steam:1091500",
                "Name": "Cyberpunk 2077",
                "InstallDir": "/games/Cyberpunk 2077",
                "ExePath": "/games/Cyberpunk 2077/bin/x64/Cyberpunk2077.exe",
            },
            "Status": "Warmed",
            "StatusReason": "its next launch reads the cache",
            "WarmedAt": "2026-11-20T22:41:07.123+01:00",
            "WarmedDriverVersion": "RADV 24.1.0",
            "Plan": {"Recorded": 444, "Generated": 23895, "MiddlewareItems": 1464, "RootSignatures": 61},
            "EstimatedCacheBytes": 2500000000,
            "CacheOnDisk": 1900000000,
            "CacheInUse": 714102115,
            "ShaderCount": 8423,
            "RecordedPipelines": 817,
            "EstimatedWarmTime": "00:03:09.4972629",
            "LastWarmTime": "00:05:05.2548763",
            "NewPipelines": 0,
            "LastWarmFailed": 0,
            "LastWarmSkipped": 0,
            "Engine": {"Family": "REDengine 3", "Version": "DX12", "GraphicsApi": "D3D12"},
            "KnownStutter": {"Severity": "Moderate", "Reason": "compiles while you play"},
            "RecorderInstalled": True,
        },
        {
            "Game": {"Id": "steam:620", "Name": "Portal 2"},
            "Status": "Ready",
            "StatusReason": "nothing compiled yet",
        },
        {
            "Game": {"Id": "steam:570", "Name": "Dota 2"},
            "Status": "Stale",
            "StatusReason": "a driver update cleared its cache",
            "KnownStutter": {"Severity": "High", "Reason": "many pipelines"},
        },
    ],
}


class TestTimespan(unittest.TestCase):
    """SCSKiller stores .NET TimeSpans: '00:03:09.4972629'."""

    def test_timespans(self):
        self.assertEqual(main.parse_timespan("00:03:09.4972629"), 189)
        self.assertEqual(main.parse_timespan("00:05:05.2548763"), 305)
        self.assertEqual(main.parse_timespan("1.02:03:04"), 93784)
        self.assertEqual(main.parse_timespan("00:00:36"), 36)

    def test_junk(self):
        self.assertIsNone(main.parse_timespan(None))
        self.assertIsNone(main.parse_timespan(""))
        self.assertIsNone(main.parse_timespan("never"))


class TestKeptList(unittest.TestCase):
    def test_map_warmed(self):
        row = main.map_kept_game(KEPT["Games"][0])
        self.assertEqual(row["game_id"], "steam:1091500")
        self.assertEqual(row["name"], "Cyberpunk 2077")
        self.assertEqual(row["status"]["kind"], "ok")
        self.assertEqual(row["recorded_pipelines"], 817)
        self.assertEqual(row["cache_bytes"], 1900000000)
        self.assertEqual(row["shader_count"], 8423)
        self.assertTrue(row["recorder_installed"])
        self.assertEqual(row["source"], "games.json")
        self.assertTrue(row["warmed_at"].startswith("2026-11-20"))
        self.assertEqual(row["fields"]["status_reason"], "its next launch reads the cache")

    def test_stats_match_scskillers_own_columns(self):
        """The app's library shows "Pipelines 25,803" for The Witcher 3: recorded +
        generated + middleware; the modal must show the same number."""
        stats = main.map_kept_game(KEPT["Games"][0])["stats"]
        self.assertEqual(stats["recorded"], 444)
        self.assertEqual(stats["generated"], 23895)
        self.assertEqual(stats["middleware"], 1464)
        self.assertEqual(stats["pipelines"], 25803)
        self.assertEqual(stats["cache_bytes"], 1900000000)
        self.assertEqual(stats["cache_in_use_bytes"], 714102115)
        self.assertEqual(stats["estimate_seconds"], 189)
        self.assertEqual(stats["last_compile_seconds"], 305)
        self.assertEqual(stats["api"], "D3D12")
        self.assertEqual(stats["engine"], "REDengine 3 DX12 D3D12")
        self.assertEqual(stats["stutter"], "Moderate")

    def test_map_stale(self):
        row = main.map_kept_game(KEPT["Games"][2])
        self.assertEqual(row["status"]["kind"], "stale")
        self.assertEqual(row["status"]["label"], "Needs rebuilding")
        self.assertEqual(row["known_stutter"], "High")

    def test_missing_plan_does_not_crash(self):
        stats = main.map_kept_game(KEPT["Games"][1])["stats"]
        self.assertIsNone(stats["pipelines"])
        self.assertIsNone(stats["shaders"])

    def test_iso_local(self):
        self.assertIsNotNone(main.iso_local("2026-11-20T22:41:07.123+01:00"))
        self.assertIsNone(main.iso_local("not a date"))
        self.assertIsNone(main.iso_local(None))

    def test_read_missing_file(self):
        self.assertIsNone(main.read_kept_list(ROOT / "does-not-exist.json"))

    def test_rank_puts_actionable_first(self):
        kinds = ["ok", "stale", "todo", "blocked"]
        ordered = sorted(kinds, key=main._kind_rank)
        self.assertEqual(ordered, ["stale", "todo", "ok", "blocked"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
