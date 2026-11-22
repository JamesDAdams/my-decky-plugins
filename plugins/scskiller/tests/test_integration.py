"""End-to-end tests of the backend with a temporary SCSKiller data folder.

No Steam Deck, no SCSKiller install: games.json is a fixture, the compile process
is faked. These tests exercise the same code paths the plugin uses on a Deck.
"""

import asyncio
import importlib.util
import json
import os
import shutil
import sys
import tempfile
import time
import types
import unittest
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _test_base() -> Path:
    """Folder holding one subfolder per test: `tests/tmp`, or the system temp dir.

    DSH's Windows sandbox can refuse writes below the plugin folder for a
    confined Python process, so fall back to the system temp dir there.
    """
    preferred = ROOT / "tests" / "tmp"
    try:
        preferred.mkdir(parents=True, exist_ok=True)
        probe = preferred / f".probe-{uuid.uuid4().hex[:8]}"
        probe.mkdir()
        probe.rmdir()
        return preferred
    except OSError:
        fallback = Path(tempfile.gettempdir()) / "scskiller-tests"
        fallback.mkdir(parents=True, exist_ok=True)
        return fallback


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
            "Plan": {"Recorded": 5775},
            "CacheOnDisk": 1900000000,
            "ShaderCount": 8423,
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
        },
    ],
}

COMPILE_LINES = [
    "21:04:12 steam:620 Indexing 120/8423",
    "21:04:20 steam:620 Warming 400/1200",
    "21:04:31 steam:620 Done",
]


class FakeStdout:
    def __init__(self, lines):
        self.lines = list(lines)
        self.index = 0

    async def readline(self):
        if self.index >= len(self.lines):
            return b""
        line = self.lines[self.index]
        self.index += 1
        return (line + "\n").encode()


class FakeProcess:
    pid = 4242

    def __init__(self, lines, code=0):
        self.stdout = FakeStdout(lines)
        self.returncode = None
        self._code = code

    async def wait(self):
        self.returncode = self._code
        return self._code


class GatedStdout:
    """Fake stdout that yields the first line, then waits for `gate`."""

    def __init__(self, lines, gate):
        self.lines = list(lines)
        self.index = 0
        self.gate = gate

    async def readline(self):
        if self.index >= len(self.lines):
            return b""
        if self.index > 0:
            await self.gate.wait()
        line = self.lines[self.index]
        self.index += 1
        return (line + "\n").encode()


class GatedProcess:
    pid = 4343

    def __init__(self, lines, gate):
        self.stdout = GatedStdout(lines, gate)
        self.returncode = None

    async def wait(self):
        self.returncode = 0
        return 0


class Integration(unittest.TestCase):
    def setUp(self):
        base = _test_base()
        base.mkdir(exist_ok=True)
        self.home = base / f"case-{uuid.uuid4().hex[:8]}"
        self.home.mkdir(parents=True)
        # SCSKiller's own data folder, independent of the host platform
        data = self.home / "SCSKiller-data"
        data.mkdir(parents=True)
        (data / "games.json").write_text(json.dumps(KEPT), "utf-8")
        (self.home / "Applications").mkdir()

        self._env_backup = {
            name: os.environ.get(name) for name in ("SCSKILLER_DATA_DIR", "LOCALAPPDATA")
        }
        os.environ["SCSKILLER_DATA_DIR"] = str(data)
        os.environ["LOCALAPPDATA"] = str(self.home / "AppData" / "Local")

        self.events = []
        fake = types.ModuleType("decky")
        fake.logger = None
        fake.DECKY_PLUGIN_DIR = str(ROOT)
        fake.DECKY_PLUGIN_SETTINGS_DIR = str(self.home / "settings")
        fake.DECKY_PLUGIN_RUNTIME_DIR = str(self.home / "runtime")
        (self.home / "settings").mkdir()
        (self.home / "runtime").mkdir()

        async def emit(name, payload):
            self.events.append((name, payload))

        fake.emit = emit
        sys.modules["decky"] = fake

        spec = importlib.util.spec_from_file_location("scsk_main_it", ROOT / "main.py")
        self.main = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.main)
        self.main._home = lambda: self.home

        self.plugin = self.main.Plugin()
        asyncio.run(self.plugin._main())

    def tearDown(self):
        for name, value in self._env_backup.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value
        shutil.rmtree(self.home, ignore_errors=True)

    def use_cli(self, name="scskiller"):
        binary = self.home / "bin" / name
        binary.parent.mkdir(exist_ok=True)
        binary.write_text("#!/bin/sh\n", "utf-8")
        binary.chmod(0o755)
        self.plugin.settings["cli_path"] = str(binary)
        return binary

    # -- reading ---------------------------------------------------------- #

    def test_library_is_sorted_with_actionable_first(self):
        library = asyncio.run(self.plugin.get_library())
        self.assertTrue(library["ok"])
        self.assertEqual(library["source"], "games.json")
        names = [game["name"] for game in library["games"]]
        self.assertEqual(names, ["Dota 2", "Portal 2", "Cyberpunk 2077"])
        dota = library["games"][0]
        self.assertEqual(dota["status"]["kind"], "stale")
        self.assertEqual(dota["reason"], "a driver update cleared its cache")
        cyberpunk = library["games"][2]
        self.assertEqual(cyberpunk["status"]["label"], "Warmed")
        self.assertEqual(cyberpunk["cache_bytes"], 1900000000)
        self.assertTrue(cyberpunk["recorder"])

    def test_library_rows_expose_per_game_stats(self):
        """The QAM table reads one wide row per game: appid + flat stats fields."""
        library = asyncio.run(self.plugin.get_library())
        cyberpunk = next(game for game in library["games"] if game["game_id"] == "steam:1091500")

        # the existing keys are unchanged
        self.assertEqual(cyberpunk["name"], "Cyberpunk 2077")
        self.assertEqual(cyberpunk["status"]["kind"], "ok")
        self.assertEqual(cyberpunk["cache_bytes"], 1900000000)
        self.assertTrue(cyberpunk["recorder"])

        # new per-game keys
        self.assertEqual(cyberpunk["appid"], 1091500)
        self.assertEqual(cyberpunk["store"], "")
        self.assertEqual(cyberpunk["stats"]["shaders"], 8423)
        self.assertEqual(cyberpunk["stats"]["pipelines"], 5775)
        self.assertEqual(cyberpunk["stats"]["recorded"], 5775)
        self.assertEqual(cyberpunk["stats"]["cache_bytes"], 1900000000)
        self.assertEqual(cyberpunk["stats"]["driver"], "RADV 24.1.0")
        self.assertEqual(cyberpunk["warmed_at"], self.main.iso_local("2026-11-20T22:41:07.123+01:00"))
        self.assertEqual(cyberpunk["driver"], "RADV 24.1.0")
        # no LastWarmTime / EstimatedWarmTime in the fixture -> JSON-safe nulls
        self.assertIsNone(cyberpunk["last_compile_seconds"])
        self.assertIsNone(cyberpunk["estimate_seconds"])
        self.assertIsNone(cyberpunk["engine"])
        self.assertIsNone(cyberpunk["api"])
        self.assertIsNone(cyberpunk["new_pipelines"])
        json.dumps(library)  # must stay JSON-serialisable (no datetimes)

    def test_library_appid_is_none_for_non_numeric_id(self):
        kept = json.loads(json.dumps(KEPT))
        kept["Games"].append(
            {
                "Game": {"Id": "epic:night-city", "Name": "Non Numeric Id"},
                "Status": "Ready",
            }
        )
        (self.home / "SCSKiller-data" / "games.json").write_text(json.dumps(kept), "utf-8")
        self.plugin._kept_cache = {}
        library = asyncio.run(self.plugin.get_library())
        row = next(game for game in library["games"] if game["game_id"] == "epic:night-city")
        self.assertIsNone(row["appid"])
        self.assertIsNone(row["stats"]["shaders"])
        self.assertIsNone(row["warmed_at"])
        self.assertIsNone(self.main.steam_appid("epic:night-city"))
        self.assertIsNone(self.main.steam_appid("steam:abc"))
        self.assertIsNone(self.main.steam_appid(""))
        self.assertEqual(self.main.steam_appid(1091500), 1091500)
        self.assertEqual(self.main.steam_appid("steam:1091500"), 1091500)

    def test_status_fast_path_uses_games_json(self):
        status = asyncio.run(self.plugin.get_status(1091500))
        self.assertTrue(status["ok"])
        self.assertEqual(status["game_id"], "steam:1091500")
        self.assertEqual(status["name"], "Cyberpunk 2077")
        self.assertEqual(status["source"], "games.json")
        self.assertEqual(status["recorded_pipelines"], 5775)
        self.assertEqual(status["seconds"], 0.0)

    def test_status_unknown_game_without_cli_is_an_error(self):
        status = asyncio.run(self.plugin.get_status(999999))
        self.assertFalse(status["ok"])
        self.assertIn("not found", status["error"].lower())

    def test_library_without_games_json(self):
        (self.home / "SCSKiller-data" / "games.json").unlink()
        library = asyncio.run(self.plugin.get_library())
        self.assertFalse(library["ok"])
        self.assertIn("scan", library["error"].lower())

    # -- detection -------------------------------------------------------- #

    def test_resolve_appimage_uses_cli_switch(self):
        appimage = self.home / "Applications" / "SCSKiller-x86_64.AppImage"
        appimage.write_text("", "utf-8")
        appimage.chmod(0o755)
        self.plugin.settings["cli_path"] = ""
        original = self.main._platform
        self.main._platform = lambda: "linux"
        try:
            resolved = self.main.Runner(self.plugin).resolve()
        finally:
            self.main._platform = original
        self.assertEqual(resolved["mode"], "appimage")
        self.assertEqual(resolved["argv"][-1], "--cli")
        self.assertTrue(resolved["ok"])

    def test_resolve_explicit_cli(self):
        binary = self.use_cli()
        resolved = self.main.Runner(self.plugin).resolve()
        self.assertEqual(resolved["mode"], "path")
        self.assertEqual(resolved["argv"], [str(binary)])
        self.assertTrue(resolved["ok"])

    def test_resolve_missing_path(self):
        self.plugin.settings["cli_path"] = str(self.home / "nope")
        resolved = self.main.Runner(self.plugin).resolve()
        self.assertFalse(resolved["ok"])
        self.assertIn("does not exist", resolved["error"])

    @unittest.skipUnless(os.name == "nt", "Windows install layout")
    def test_resolve_windows_install(self):
        """SCSKiller's Windows install ships the CLI at current\\cli\\scskiller.exe."""
        exe = self.home / "AppData" / "Local" / "SCSKiller" / "current" / "cli" / "scskiller.exe"
        exe.parent.mkdir(parents=True)
        exe.write_bytes(b"MZ")
        self.plugin.settings["cli_path"] = ""
        resolved = self.main.Runner(self.plugin).resolve()
        self.assertTrue(resolved["ok"], resolved)
        self.assertEqual(resolved["mode"], "exe")
        self.assertEqual(resolved["argv"], [str(exe)])

    @unittest.skipUnless(os.name == "nt", "Windows data folder")
    def test_windows_data_dir_comes_from_localappdata(self):
        """%LOCALAPPDATA%\\SCSKiller\\games.json is the Windows state file."""
        os.environ.pop("SCSKILLER_DATA_DIR", None)
        data = Path(os.environ["LOCALAPPDATA"]) / "SCSKiller"
        data.mkdir(parents=True, exist_ok=True)
        (data / "games.json").write_text(json.dumps(KEPT), "utf-8")
        self.assertEqual(self.main.scskiller_data_dir(), data)
        status = asyncio.run(self.plugin.get_status(1091500))
        self.assertTrue(status["ok"], status)
        self.assertEqual(status["name"], "Cyberpunk 2077")
        self.assertEqual(status["source"], "games.json")

    def test_open_app_without_gui_is_an_error(self):
        result = asyncio.run(self.plugin.open_app())
        self.assertFalse(result["ok"])

    def test_platform_is_reported(self):
        detection = asyncio.run(self.plugin.detect())
        self.assertIn(detection["platform"], ("windows", "wsl", "linux"))
        self.assertIn("data_dirs", detection)

    # -- compiling -------------------------------------------------------- #

    def test_compile_streams_progress_and_finishes(self):
        self.use_cli()
        real_is_running = self.main._is_running
        self.main._is_running = lambda exe: False

        async def fake_spawn(argv, runner):
            self.argv = argv
            return FakeProcess(COMPILE_LINES)

        self.plugin._spawn = fake_spawn

        async def scenario():
            started = await self.plugin.start_compile(620)
            self.assertTrue(started["ok"])
            await self.plugin._compile_task
            return self.plugin._compile_task

        try:
            asyncio.run(scenario())
        finally:
            self.main._is_running = real_is_running

        self.assertEqual(self.argv[-2:], ["compile", "steam:620"])
        job = self.plugin._jobs["steam:620"]
        self.assertTrue(job["ok"])
        self.assertEqual(job["exit_code"], 0)
        self.assertFalse(job["running"])
        self.assertEqual(len(job["lines"]), 3)
        self.assertEqual(job["stage"], "Done")

        names = [name for name, _ in self.events]
        self.assertIn("scsk_compile_started", names)
        self.assertEqual(names.count("scsk_compile_line"), 3)
        self.assertIn("scsk_compile_done", names)
        done = [payload for name, payload in self.events if name == "scsk_compile_done"][0]
        self.assertTrue(done["ok"])

    def test_compile_passes_threads_and_idle(self):
        self.use_cli()
        self.plugin.settings.update({"threads": 4, "idle": True})
        self.main._is_running = lambda exe: False
        argv = {}

        async def fake_spawn(command, runner):
            argv["value"] = command
            return FakeProcess(["Done"])

        self.plugin._spawn = fake_spawn

        async def scenario():
            await self.plugin.start_compile(620)
            await self.plugin._compile_task

        asyncio.run(scenario())
        command = argv["value"]
        self.assertIn("compile", command)
        self.assertIn("steam:620", command)
        self.assertEqual(command[command.index("--threads") + 1], "4")
        self.assertIn("--idle", command)

    def test_compile_failure_is_reported(self):
        self.use_cli()
        self.main._is_running = lambda exe: False

        async def fake_spawn(command, runner):
            return FakeProcess(["21:04:12 steam:620 Warming - driver lost the device"], code=1)

        self.plugin._spawn = fake_spawn

        async def scenario():
            await self.plugin.start_compile(620)
            await self.plugin._compile_task

        asyncio.run(scenario())
        job = self.plugin._jobs["steam:620"]
        self.assertFalse(job["ok"])
        self.assertEqual(job["exit_code"], 1)
        self.assertIn("exited with 1", job["error"])

    def test_compile_refused_while_game_runs(self):
        self.use_cli()
        self.main._is_running = lambda exe: True

        async def scenario():
            return await self.plugin.start_compile(1091500)

        started = asyncio.run(scenario())
        self.assertFalse(started["ok"])
        self.assertIn("close the game", started["error"])

    def test_only_one_compile_at_a_time(self):
        self.use_cli()
        self.main._is_running = lambda exe: False

        async def fake_spawn(command, runner):
            await asyncio.sleep(0.05)
            return FakeProcess(["Done"])

        self.plugin._spawn = fake_spawn

        async def scenario():
            first = await self.plugin.start_compile(620)
            second = await self.plugin.start_compile(570)
            await self.plugin._compile_task
            return first, second

        first, second = asyncio.run(scenario())
        self.assertTrue(first["ok"])
        # a second request is queued instead of refused, then started when the first ends
        self.assertTrue(second["ok"])
        self.assertTrue(second["queued"])
        self.assertEqual(second["position"], 1)

    def test_compiles_is_empty_on_a_fresh_plugin(self):
        result = asyncio.run(self.plugin.get_compiles())
        self.assertEqual(result, {"ok": True, "running": 0, "jobs": [], "queue": []})

    def test_queue_drains_when_the_running_compile_ends(self):
        """The drain used to run on the task that was ending, so the queue stayed stuck."""
        self.use_cli()
        self.main._is_running = lambda exe: False
        spawned = []

        async def fake_spawn(command, runner):
            await asyncio.sleep(0.01)
            spawned.append(command[-1])
            return FakeProcess(["Done"])

        self.plugin._spawn = fake_spawn

        async def scenario():
            await self.plugin.start_compile(620)
            await self.plugin.start_compile(570)
            await asyncio.sleep(0.2)

        asyncio.run(scenario())
        self.assertEqual(spawned, ["steam:620", "steam:570"])
        self.assertEqual(self.plugin._queue, [])
        self.assertFalse(self.plugin._jobs["steam:570"]["running"])

    def test_start_queued_starts_a_waiting_game_now(self):
        self.use_cli()
        self.main._is_running = lambda exe: False
        spawned = []

        async def fake_spawn(command, runner):
            spawned.append(command[-1])
            return FakeProcess(["Done"])

        self.plugin._spawn = fake_spawn
        self.plugin._queue = [{"app_id": "steam:570", "argv": ["scskiller.exe", "compile", "steam:570"]}]

        async def scenario():
            started = await self.plugin.start_queued("steam:570")
            await asyncio.sleep(0.05)
            return started

        started = asyncio.run(scenario())
        self.assertTrue(started["ok"])
        self.assertEqual(spawned, ["steam:570"])
        self.assertEqual(self.plugin._queue, [])
        self.assertFalse(self.plugin._jobs["steam:570"]["running"])

    def test_start_queued_refuses_while_a_compile_runs(self):
        self.use_cli()
        self.main._is_running = lambda exe: False
        gate = asyncio.Event()

        async def fake_spawn(command, runner):
            return GatedProcess(COMPILE_LINES, gate)

        self.plugin._spawn = fake_spawn

        async def scenario():
            await self.plugin.start_compile(620)
            await asyncio.sleep(0.02)
            queued = await self.plugin.start_compile(570)
            refused = await self.plugin.start_queued("steam:570")
            return queued, refused

        queued, refused = asyncio.run(scenario())
        self.assertTrue(queued["queued"])
        self.assertFalse(refused["ok"])
        self.assertIn("already running", refused["error"])

    def test_pause_verbs_progress(self):
        """Suspend freezes, resume thaws: the two ntdll calls were swapped once."""
        self.assertEqual(self.main._pause_verb(True), "NtSuspendProcess")
        self.assertEqual(self.main._pause_verb(False), "NtResumeProcess")

    def test_cancel_resumes_a_paused_compile_first(self):
        """A suspended CLI cannot react to CTRL_BREAK: Stop has to thaw it before cancelling."""
        self.use_cli()
        self.main._is_running = lambda exe: False
        gate = asyncio.Event()
        calls = []

        async def fake_spawn(command, runner):
            return GatedProcess(COMPILE_LINES, gate)

        self.plugin._spawn = fake_spawn
        # never touch a real process id from a unit test
        self.main._terminate = lambda process: None
        self.main._kill_tree = lambda process: None

        def fake_pause(pid, paused):
            calls.append((pid, paused))
            return True

        original = self.main._set_process_paused
        self.main._set_process_paused = fake_pause
        self.addCleanup(setattr, self.main, "_set_process_paused", original)

        async def scenario():
            await self.plugin.start_compile(620)
            await asyncio.sleep(0.05)
            await self.plugin.pause_compile()
            await self.plugin.cancel_compile()
            await asyncio.sleep(0.1)

        asyncio.run(scenario())
        self.assertEqual(calls, [(4343, True), (4343, False)])
        self.assertFalse(self.plugin._jobs["steam:620"]["paused"])

    def test_compiles_lists_the_running_job_first(self):
        self.use_cli()
        self.main._is_running = lambda exe: False
        gate = asyncio.Event()

        async def fake_spawn(command, runner):
            return GatedProcess(COMPILE_LINES, gate)

        self.plugin._spawn = fake_spawn
        # a finished job that started later must still sort below the running one
        self.plugin._jobs["steam:570"] = {
            "app_id": "steam:570",
            "started_at": time.time() + 60,
            "lines": [],
            "stage": "Done",
            "running": False,
            "exit_code": 0,
            "error": None,
            "ok": True,
        }

        async def scenario():
            started = await self.plugin.start_compile(620)
            self.assertTrue(started["ok"])
            await asyncio.sleep(0.02)  # the job is between two progress lines
            while_running = await self.plugin.get_compiles()
            gate.set()
            await self.plugin._compile_task
            return while_running, await self.plugin.get_compiles()

        running, finished = asyncio.run(scenario())
        self.assertEqual(running["running"], 1)
        self.assertEqual(len(running["jobs"]), 2)
        first = running["jobs"][0]
        self.assertEqual(first["app_id"], "steam:620")
        self.assertTrue(first["running"])
        self.assertEqual(first["stage"], "Indexing 120/8423")
        self.assertEqual(running["jobs"][1]["app_id"], "steam:570")
        self.assertFalse(running["jobs"][1]["running"])

        self.assertEqual(finished["running"], 0)
        self.assertEqual(
            {job["app_id"] for job in finished["jobs"]}, {"steam:620", "steam:570"}
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)


