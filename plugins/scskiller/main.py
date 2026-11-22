"""Decky Loader backend for the SCSKiller plugin.

The plugin does not reimplement SCSKiller: it drives the `scskiller` command line
that ships inside SCSKiller's Linux package (the AppImage contains both
`SCSKiller.Ui` and `scskiller`). Two things come out of that:

  * `scskiller status <game>`  -> one game's state, as labelled text lines
  * `scskiller compile <game>` -> the compile queue for that game, progress on stdout

Everything runs as the desktop user (uid 1000 on a Steam Deck), never as root,
because SCSKiller writes its state and the shader caches in that user's home.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import signal
import subprocess
import time
from collections import deque
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:  # decky-loader >= 3.0
    import decky  # type: ignore
except ImportError:  # older loaders expose the same API as decky_plugin
    import decky_plugin as decky  # type: ignore


PLUGIN_NAME = "SCSKiller"

#: Game ids SCSKiller uses are `<store>:<id>`; a Steam appid is `steam:<appid>`.
GAME_ID_PREFIX = "steam:"

STATUS_TTL = 45.0          # seconds a status result stays fresh
STATUS_TIMEOUT = 25.0      # a status query must never freeze the game page
DETECT_TIMEOUT = 40.0
COMPILE_LINE_MAX = 400     # lines kept per compile job

#: Raw status name -> coarse kind used by the UI for colour and wording.
STATUS_KINDS = {
    "warmed": "ok",
    "ready": "todo",
    "stale": "stale",
    "needsrebuilding": "stale",
    "partlycompiled": "partial",
    "needsrecording": "recording",
    "needsrecordingonly": "recording",
    "needssteamstart": "todo",
    "needsofflinesession": "todo",
    "notcompatible": "blocked",
    "unsupported": "blocked",
}

_BYTES_UNITS = {"b": 1, "kb": 1024, "mb": 1024 ** 2, "gb": 1024 ** 3, "tb": 1024 ** 4}


def steam_appid(game_id: Any) -> Optional[int]:
    """'steam:1091500' or 1091500 -> 1091500; anything else -> None."""
    text = str(game_id or "").strip()
    if text.startswith(GAME_ID_PREFIX):
        text = text[len(GAME_ID_PREFIX):]
    return int(text) if text.isdigit() else None


# --------------------------------------------------------------------------- #
# small helpers
# --------------------------------------------------------------------------- #

def _decky_attr(name: str, default: Any = None) -> Any:
    return getattr(decky, name, default)


def _home() -> Path:
    """The desktop user's home, even when the plugin runs as root."""
    for attr in ("DECKY_USER_HOME", "DECKY_HOME"):
        value = _decky_attr(attr)
        if value:
            return Path(value)
    deck = Path("/home/deck")
    if deck.is_dir():
        return deck
    return Path(os.path.expanduser("~"))


def _plugin_dir() -> Path:
    value = _decky_attr("DECKY_PLUGIN_DIR")
    if value:
        return Path(value)
    return Path(__file__).resolve().parent


def _settings_dir() -> Path:
    value = _decky_attr("DECKY_PLUGIN_SETTINGS_DIR")
    if value:
        return Path(value)
    return _plugin_dir()


def _data_dir() -> Path:
    value = _decky_attr("DECKY_PLUGIN_RUNTIME_DIR")
    if value:
        return Path(value)
    return _settings_dir()


def scskiller_data_dir() -> Path:
    """Where SCSKiller keeps its state on this host."""
    override = os.environ.get("SCSKILLER_DATA_DIR")
    if override:
        return Path(override)
    if _platform() in ("windows", "wsl"):
        dirs = _windows_data_dirs()
        if dirs:
            return dirs[0]
        return Path(os.environ.get("LOCALAPPDATA") or (_home() / "AppData/Local")) / "SCSKiller"
    xdg = os.environ.get("XDG_DATA_HOME")
    base = Path(xdg) if xdg else _home() / ".local/share"
    return base / "SCSKiller"


IS_WINDOWS = os.name == "nt"

#: Windows process flags: own console group (so CTRL_BREAK is a graceful stop) and
#: no console window when we shell out to taskkill.
CREATE_NEW_PROCESS_GROUP = 0x00000200
CREATE_NO_WINDOW = 0x08000000

#: A console program started without this pops a terminal window for its whole run (the
#: 0.5s black flash when opening a game page or the settings tab). STARTF_USESHOWWINDOW +
#: SW_HIDE also covers the shell that creates the console.
_NO_WINDOW: Dict[str, Any] = {}
if IS_WINDOWS:
    _STARTUPINFO = subprocess.STARTUPINFO()
    _STARTUPINFO.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    _STARTUPINFO.wShowWindow = subprocess.SW_HIDE
    _NO_WINDOW = {"creationflags": CREATE_NO_WINDOW, "startupinfo": _STARTUPINFO}


def _platform() -> str:
    """`windows`, `wsl` or `linux`: where the Steam client actually runs.

    Decky usually runs on the Steam Deck, but it also runs on Windows builds of
    the Steam client (natively or from WSL), where SCSKiller is the Windows app.
    """
    if IS_WINDOWS:
        return "windows"
    try:
        version = Path("/proc/version").read_text("utf-8", errors="ignore").lower()
        if "microsoft" in version:
            return "wsl"
    except OSError:
        pass
    return "linux"


def _windows_data_dirs() -> List[Path]:
    """SCSKiller's `%LOCALAPPDATA%\\SCSKiller`, seen from Windows or from WSL."""
    dirs: List[Path] = []
    local = os.environ.get("LOCALAPPDATA")
    if local:
        dirs.append(Path(local) / "SCSKiller")
    if not IS_WINDOWS:
        users = Path("/mnt/c/Users")
        if users.is_dir():
            try:
                for entry in users.iterdir():
                    candidate = entry / "AppData" / "Local" / "SCSKiller"
                    if candidate.is_dir():
                        dirs.append(candidate)
            except OSError:
                pass
    return dirs


def _windows_roots() -> List[Path]:
    """Folders a Windows SCSKiller install can live under."""
    roots: List[Path] = []
    if IS_WINDOWS:
        for name in ("LOCALAPPDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "USERPROFILE"):
            value = os.environ.get(name)
            if value:
                roots.append(Path(value))
        roots.append(Path("C:/SCSKiller"))
        roots.append(_home() / "SCSKiller")
    else:
        users = Path("/mnt/c/Users")
        if users.is_dir():
            try:
                for entry in users.iterdir():
                    roots.append(entry / "AppData" / "Local")
            except OSError:
                pass
        roots += [Path("/mnt/c/Program Files"), Path("/mnt/c/SCSKiller")]
    return roots


def _windows_paths(relative: str) -> List[Path]:
    """Every place a Windows install file (e.g. `current/cli/scskiller.exe`) sits.

    Velopack installs the app in `%LOCALAPPDATA%\\SCSKiller.App` (the stable name
    in the uninstall entry's `InstallLocation`); the older/portable builds use
    `%LOCALAPPDATA%\\SCSKiller`.
    """
    suffix = Path(relative)
    paths: List[Path] = []
    if IS_WINDOWS:
        found = shutil.which(suffix.name)
        if found:
            paths.append(Path(found))
    for root in _windows_roots():
        for folder in ("SCSKiller.App", "SCSKiller"):
            paths.append(root / folder / suffix)
        paths.append(root / "Programs" / "SCSKiller" / suffix)
    return paths


def _windows_cli_candidates() -> List[Path]:
    return _windows_paths("current/cli/scskiller.exe")


def _windows_gui_candidates() -> List[Path]:
    return _windows_paths("current/SCSKiller.exe")


def _euid() -> int:
    return os.geteuid() if hasattr(os, "geteuid") else 0


def _uid() -> int:
    return os.getuid() if hasattr(os, "getuid") else 0


def _gid() -> int:
    return os.getgid() if hasattr(os, "getgid") else 0


def log(*parts: Any) -> None:
    message = " ".join(str(p) for p in parts)
    logger = _decky_attr("logger")
    if logger is not None:
        try:
            logger.info(message)
            return
        except Exception:  # pragma: no cover - logger is not critical
            pass
    print(f"[{PLUGIN_NAME}] {message}", flush=True)


def parse_bytes(text: str) -> Optional[int]:
    """'1.2 GB' / '345 MB' / '12 KB' -> bytes. Unknown text -> None."""
    if not text:
        return None
    match = re.search(r"([0-9][0-9.,]*)\s*([KMGTP]?B)\b", text, re.IGNORECASE)
    if not match:
        return None
    number = match.group(1).replace(",", "")
    try:
        value = float(number)
    except ValueError:
        return None
    unit = match.group(2).lower()
    return int(value * _BYTES_UNITS.get(unit, 1))


def parse_hms(text: str) -> Optional[int]:
    """'1:02:03' -> seconds."""
    match = re.match(r"^(\d+):(\d{2}):(\d{2})$", text.strip())
    if not match:
        return None
    hours, minutes, seconds = (int(g) for g in match.groups())
    return hours * 3600 + minutes * 60 + seconds


def parse_timespan(value: Any) -> Optional[int]:
    """SCSKiller's .NET TimeSpan text: '00:03:09.4972629' or '1.02:03:04' -> seconds."""
    if not isinstance(value, str) or not value.strip():
        return None
    match = re.match(r"^(?:(\d+)\.)?(\d+):(\d{2}):(\d{2})(?:\.(\d+))?$", value.strip())
    if not match:
        return parse_hms(value)
    days = int(match.group(1) or 0)
    hours = int(match.group(2))
    minutes = int(match.group(3))
    seconds = int(match.group(4))
    return days * 86400 + hours * 3600 + minutes * 60 + seconds


def normalize_status(raw: Optional[str]) -> Dict[str, str]:
    """Map an SCSKiller status name to a kind + a human label."""
    if not raw:
        return {"name": "", "kind": "unknown", "label": "Unknown"}
    name = raw.strip()
    key = re.sub(r"[^a-z]", "", name.lower())
    kind = STATUS_KINDS.get(key, "unknown")
    spaced = re.sub(r"(?<!^)(?=[A-Z])", " ", name).strip()
    labels = {
        "ok": "Warmed",
        "todo": "Not compiled yet",
        "stale": "Needs rebuilding",
        "partial": "Partly compiled",
        "recording": "Needs a recording",
        "blocked": "Not supported",
    }
    return {"name": name, "kind": kind, "label": labels.get(kind, spaced)}


def _kind_rank(kind: str) -> int:
    """Order the library list: what needs a compile first."""
    return {"stale": 0, "todo": 1, "partial": 2, "recording": 3, "ok": 4, "blocked": 5}.get(kind, 6)


# --------------------------------------------------------------------------- #
# parsers (pure functions, unit-tested in tests/)
# --------------------------------------------------------------------------- #

_DETAIL_PATTERNS: List[Tuple[str, str]] = [
    ("install", r"^install\s+(.+)$"),
    ("exe", r"^exe\s+(.+)$"),
    ("runs_as", r"^runs as\s+(.+)$"),
    ("warms_stage", r"^warms stage\s+(.+)$"),
    ("engine", r"^engine\s+(.+)$"),
    ("status", r"^status\s+([A-Za-z0-9_]+)\s*:?\s*(.*)$"),
    ("anti_cheat", r"^anti-cheat\s+(.+)$"),
    ("shaders", r"^shaders\s+(\S+)\s*$"),
    ("plan", r"^plan\s+(.+)$"),
    ("stutter", r"^stutter\s+(.+)$"),
    ("middleware", r"^middleware\s+(.+)$"),
    ("estimate", r"^estimate\s+(.+)$"),
    ("careful", r"^careful\s+(.+)$"),
    ("shared", r"^shared\s+(.+)$"),
    ("warmed", r"^warmed\s+(.+)$"),
    ("failed", r"^failed\s+(.+)$"),
    ("covered", r"^covered\s+(.+)$"),
    ("other_apis", r"^other APIs\s+(.+)$"),
    ("cache", r"^cache\s+(.+)$"),
    ("keys", r"^keys\s+(.+)$"),
    ("recorder", r"^recorder\s+(.+)$"),
    ("recording", r"^recording\s+(.+)$"),
    ("last_play", r"^last play\s+(.+)$"),
    ("first_launch", r"^1st launch\s+(.+)$"),
    ("prefix", r"^prefix\s+(.+)$"),
    ("mod", r"^mod\s+(.+)$"),
    ("warning", r"^warning\s+(.+)$"),
]


def parse_detail(text: str) -> Dict[str, Any]:
    """Parse `scskiller status <game>` detail output into a dict.

    The CLI prints one labelled field per line and the labels are stable words
    (`status`, `warmed`, `cache`, `covered`, ...), so we key on those instead of
    on exact column widths. Unknown lines are kept in `unparsed` for debugging.
    """
    result: Dict[str, Any] = {"raw": text, "fields": {}, "unparsed": []}
    fields: Dict[str, str] = result["fields"]

    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        for key, pattern in _DETAIL_PATTERNS:
            match = re.match(pattern, stripped)
            if not match:
                continue
            if key == "status":
                fields["status"] = match.group(1)
                reason = (match.group(2) or "").strip()
                if reason:
                    fields["status_reason"] = reason
            elif key in fields:
                # repeated labels (mod lines) are appended
                fields[key] = f"{fields[key]}\n{match.group(1).strip()}"
            else:
                fields[key] = match.group(1).strip()
            break
        else:
            if len(result["unparsed"]) < 40:
                result["unparsed"].append(stripped)

    # a game header line always names the id: "Name (steam:123, Steam)"
    header = re.search(r"\((?P<gid>[A-Za-z0-9_.\-]+:[^,)]+),\s*(?P<store>[^)]+)\)", text)
    if header:
        result["game_id"] = header.group("gid")
        result["store"] = header.group("store").strip()
        result["name"] = text.split("(", 1)[0].strip()

    status = normalize_status(fields.get("status"))
    result["status"] = status

    warmed = fields.get("warmed", "")
    if warmed and not warmed.lower().startswith("never"):
        match = re.search(
            r"(?P<when>\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s+for driver\s+(?P<driver>.+?)"
            r"(?:\s+in\s+(?P<duration>\d+:\d{2}:\d{2}))?(?:,|$)",
            warmed,
        )
        if match:
            result["warmed_at"] = match.group("when")
            result["warmed_driver"] = match.group("driver").strip()
            result["warmed_seconds"] = parse_hms(match.group("duration") or "")
        result["warmed_text"] = warmed
    else:
        result["warmed_at"] = None

    cache = fields.get("cache", "")
    if cache:
        result["cache_bytes"] = parse_bytes(cache)
        in_use = re.search(r"([0-9][0-9.,]*\s*[KMGTP]?B)\s+in use", cache, re.IGNORECASE)
        result["cache_in_use_bytes"] = parse_bytes(in_use.group(1)) if in_use else None

    covered = fields.get("covered", "")
    if covered:
        match = re.match(r"(\d+)%\s+for\s+(.+?)(?:,\s*(.+))?$", covered)
        if match:
            result["covered_pct"] = int(match.group(1))
            result["covered_api"] = match.group(2).strip()
            result["covered_note"] = (match.group(3) or "").strip() or None

    estimate = fields.get("estimate", "")
    if estimate:
        match = re.match(r"(.+?)\s+of cache,\s*(.+)$", estimate)
        if match:
            result["estimate_bytes"] = parse_bytes(match.group(1))
            result["estimate_seconds"] = parse_hms(match.group(2).strip())
        result["estimate_text"] = estimate

    shaders = fields.get("shaders", "")
    if shaders and shaders not in ("-", ""):
        try:
            result["shader_count"] = int(shaders.replace(",", ""))
        except ValueError:
            result["shader_count"] = None

    result["recorded_pipelines"] = None
    plan = fields.get("plan", "")
    if plan:
        match = re.search(r"(\d[\d,]*)\s+recorded", plan)
        if match:
            result["recorded_pipelines"] = int(match.group(1).replace(",", ""))

    result["recorder_installed"] = bool(re.match(r"installed", fields.get("recorder", ""), re.I))
    return result


_ROW_RE = re.compile(r"^(?P<status>\S+)\s+(?P<gid>\S+)\s+(?P<rest>.+)$")


def parse_rows(text: str) -> List[Dict[str, Any]]:
    """Parse `scskiller scan` / `scskiller status` (all games) table rows."""
    rows: List[Dict[str, Any]] = []
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith(("GPU:", "middleware:")):
            continue
        match = _ROW_RE.match(line.strip())
        if not match:
            continue
        gid = match.group("gid")
        if ":" not in gid:  # not a game id: header or a stray line
            continue
        rest = match.group("rest")
        flags: Dict[str, Any] = {}
        for flag in re.findall(r"\[([^\]]+)\]", rest):
            if flag.startswith("cache "):
                flags["cache_text"] = flag[len("cache "):].strip()
                flags["cache_bytes"] = parse_bytes(flags["cache_text"])
            elif flag == "recorder":
                flags["recorder"] = True
            elif flag == "no shader stutter":
                flags["no_stutter"] = True
            elif flag.startswith("known stutter:"):
                flags["known_stutter"] = flag.split(":", 1)[1].strip()
        name_part = re.sub(r"\s*\[[^\]]*\]", "", rest).strip()
        # the row ends with " - <why>"; a game name may itself contain " - ",
        # so the reason is split off from the right
        name, reason = name_part, ""
        if " - " in name_part:
            name, reason = name_part.rsplit(" - ", 1)
        status = normalize_status(match.group("status"))
        rows.append(
            {
                "game_id": gid,
                "name": name.strip(),
                "reason": reason.strip(),
                "status": status,
                "raw_status": match.group("status"),
                "flags": flags,
            }
        )
    return rows


_PROGRESS_RE = re.compile(r"^(?P<time>\d{2}:\d{2}:\d{2})\s+(?P<gid>\S+)\s+(?P<rest>.*)$")


def parse_progress_line(line: str) -> Dict[str, Any]:
    """A compile queue line: `HH:mm:ss <game id> <stage><progress> - error`."""
    match = _PROGRESS_RE.match(line.strip())
    if not match:
        return {"text": line.rstrip(), "stage": None, "error": None}
    rest = match.group("rest").strip()
    error = rest.split(" - ", 1)[1] if " - " in rest else None
    stage = rest.split(" - ", 1)[0].strip()
    return {
        "text": line.rstrip(),
        "time": match.group("time"),
        "game_id": match.group("gid"),
        "stage": stage,
        "error": error,
    }


# --------------------------------------------------------------------------- #
# SCSKiller's own library file (games.json): the fast, process-free status path
# --------------------------------------------------------------------------- #

GAMES_JSON = "games.json"


def iso_local(text: Any) -> Optional[str]:
    """`2026-11-20T22:41:07.123+01:00` -> `2026-11-20 22:41` (the user's clock)."""
    if not isinstance(text, str) or not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    try:
        parsed = parsed.astimezone()
    except (OSError, ValueError):
        pass
    return parsed.strftime("%Y-%m-%d %H:%M")


def map_kept_game(entry: Dict[str, Any], gid: str = "") -> Dict[str, Any]:
    """One `GameState` from games.json -> the shape the UI reads."""
    game = entry.get("Game") or {}
    reason = entry.get("StatusReason") or ""
    plan = entry.get("Plan") if isinstance(entry.get("Plan"), dict) else {}
    engine = entry.get("Engine") if isinstance(entry.get("Engine"), dict) else {}
    stutter = entry.get("KnownStutter")
    stutter_severity = None
    stutter_reason = None
    if isinstance(stutter, dict):
        stutter_severity = stutter.get("Severity")
        stutter_reason = stutter.get("Reason")
    elif isinstance(stutter, str):
        stutter_reason = stutter

    recorded = plan.get("Recorded")
    generated = plan.get("Generated")
    middleware = plan.get("MiddlewareItems")
    d3d11 = plan.get("D3D11Shaders")
    # SCSKiller's "Pipelines" column is recorded + generated + middleware + DX11 shaders
    pipelines = None
    if any(part is not None for part in (recorded, generated, middleware, d3d11)):
        pipelines = sum(part or 0 for part in (recorded, generated, middleware, d3d11))

    engine_text = " ".join(
        str(part) for part in (engine.get("Family"), engine.get("Version"), engine.get("GraphicsApi")) if part
    )

    return {
        "ok": True,
        "game_id": game.get("Id") or gid,
        "name": game.get("Name") or "",
        "store": game.get("Store") or "",
        "status": normalize_status(entry.get("Status")),
        "fields": {
            "status": entry.get("Status") or "",
            "status_reason": reason,
            "exe": game.get("ExePath") or "",
            "install": game.get("InstallDir") or "",
        },
        "reason": reason,
        "warmed_at": iso_local(entry.get("WarmedAt")),
        "warmed_driver": entry.get("WarmedDriverVersion") or None,
        "cache_bytes": entry.get("CacheOnDisk"),
        "estimate_bytes": entry.get("EstimatedCacheBytes"),
        "shader_count": entry.get("ShaderCount"),
        "recorded_pipelines": entry.get("RecordedPipelines") or plan.get("Recorded"),
        "recorder_installed": bool(entry.get("RecorderInstalled")),
        "known_stutter": stutter_severity or stutter_reason,
        "new_pipelines": entry.get("NewPipelines"),
        "source": "games.json",
        "stats": {
            "shaders": entry.get("ShaderCount"),
            "pipelines": pipelines,
            "recorded": recorded,
            "generated": generated,
            "d3d11_shaders": plan.get("D3D11Shaders"),
            "middleware": plan.get("MiddlewareItems"),
            "root_signatures": plan.get("RootSignatures"),
            "stage_sets": plan.get("StageSets"),
            "cache_bytes": entry.get("CacheOnDisk"),
            "cache_in_use_bytes": entry.get("CacheInUse"),
            "estimate_bytes": entry.get("EstimatedCacheBytes"),
            "estimate_seconds": parse_timespan(entry.get("EstimatedWarmTime")),
            "last_compile_seconds": parse_timespan(entry.get("LastWarmTime")),
            "warmed_at": iso_local(entry.get("WarmedAt")),
            "driver": entry.get("WarmedDriverVersion") or None,
            "api": engine.get("GraphicsApi") or entry.get("ApiDetected"),
            "engine": engine_text or None,
            "recorder": bool(entry.get("RecorderInstalled")),
            "new_pipelines": entry.get("NewPipelines"),
            "failed": entry.get("LastWarmFailed"),
            "skipped": entry.get("LastWarmSkipped"),
            "stutter": stutter_severity or None,
            "stutter_reason": stutter_reason,
        },
    }


def read_kept_list(path: Path) -> Optional[Dict[str, Any]]:
    try:
        data = json.loads(path.read_text("utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None



# --------------------------------------------------------------------------- #
# locating and running the CLI
# --------------------------------------------------------------------------- #

SETTINGS_FILE = "settings.json"
DEFAULT_SETTINGS: Dict[str, Any] = {
    "cli_path": "",          # explicit path to the `scskiller` CLI or to SCSKiller's AppImage
    "threads": 0,            # 0 = SCSKiller's own default
    "idle": False,           # compile at background priority
    "auto_refresh": 60,      # seconds between status refreshes on the game page (0 = manual)
    "extract_and_run": False,  # probe without FUSE (AppImage self-extracts to /tmp)
}


def _appimage_candidates(home: Path) -> List[Path]:
    names = [n for n in ("Applications", "Downloads", "Desktop", ".local/bin", "SCSKiller")]
    found: List[Path] = []
    for name in names:
        folder = home / name
        if not folder.is_dir():
            continue
        try:
            for entry in folder.iterdir():
                text = entry.name.lower()
                if not text.endswith(".appimage") or "scskiller" not in text:
                    continue
                if entry.is_file():
                    found.append(entry)
        except OSError:
            continue
    return found


def _binary_candidates(home: Path) -> List[Path]:
    candidates = [
        home / ".local/bin/scskiller",
        home / "SCSKiller/scskiller",
        home / "SCSKiller-linux/scskiller",
        home / "Applications/SCSKiller-linux/scskiller",
        home / "homebrew/data" / PLUGIN_NAME / "SCSKiller-linux/scskiller",
        home / "homebrew/data" / PLUGIN_NAME / "appimage/squashfs-root/scskiller",
        home / "homebrew/data" / PLUGIN_NAME / "SCSKiller/scskiller",
        Path("/opt/SCSKiller/scskiller"),
        Path("/usr/local/bin/scskiller"),
    ]
    return candidates


class Runner:
    """Builds and runs SCSKiller CLI commands as the desktop user."""

    def __init__(self, plugin: "Plugin") -> None:
        self.plugin = plugin

    # -- identity / environment ------------------------------------------- #

    def as_user(self) -> Tuple[int, int]:
        """uid/gid the CLI must run as (the owner of the desktop home)."""
        home = _home()
        try:
            stat = home.stat()
            if _euid() == 0:
                return stat.st_uid, stat.st_gid
        except OSError:
            pass
        return _uid(), _gid()

    def _preexec(self) -> Optional[Any]:
        if _euid() != 0:
            return None
        uid, gid = self.as_user()
        if uid == 0:
            return None

        def drop() -> None:  # pragma: no cover - runs in the child process
            try:
                os.setgroups([])
            except OSError:
                pass
            os.setgid(gid)
            os.setuid(uid)

        return drop

    def env(self) -> Dict[str, str]:
        # On Windows (and for any normal user on Linux) SCSKiller needs the real
        # environment: SystemRoot, TEMP, APPDATA, PATH, the WSL interop variables.
        if IS_WINDOWS or _euid() != 0:
            return dict(os.environ)
        home = _home()
        uid, _gid = self.as_user()
        env = {
            # AppImage mounts itself through FUSE; SteamOS images may lack it, in
            # which case the runtime can unpack to /tmp instead (slower, same CLI).
            "APPIMAGE_EXTRACT_AND_RUN": "1" if getattr(self.plugin, "extract_and_run", False) else "",
            "APPIMAGE_SILENT_INSTALL": "1",
            "HOME": str(home),
            "USER": home.name,
            "LOGNAME": home.name,
            "PATH": "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
            "LANG": os.environ.get("LANG", "en_US.UTF-8"),
            "LC_ALL": os.environ.get("LC_ALL", ""),
            "TERM": "dumb",
        }
        runtime = f"/run/user/{uid}"
        if Path(runtime).is_dir():
            env["XDG_RUNTIME_DIR"] = runtime
            env["DBUS_SESSION_BUS_ADDRESS"] = f"unix:path={runtime}/bus"
        data_home = os.environ.get("XDG_DATA_HOME")
        if data_home:
            env["XDG_DATA_HOME"] = data_home
        return {k: v for k, v in env.items() if v != ""}

    # -- command construction --------------------------------------------- #

    def resolve(self) -> Dict[str, Any]:
        """Work out how to invoke the CLI. Returns prefix + diagnostic info."""
        settings = self.plugin.settings
        home = _home()

        explicit = (settings.get("cli_path") or "").strip()
        if explicit:
            return self._describe(Path(explicit))

        if _platform() in ("windows", "wsl"):
            # SCSKiller is installed on Windows as a normal app; the CLI ships at
            # <install>\current\cli\scskiller.exe next to the GUI.
            for candidate in _windows_cli_candidates():
                if candidate.is_file():
                    return {"mode": "exe", "argv": [str(candidate)], "source": str(candidate), "ok": True}
            return {
                "mode": "none",
                "argv": [],
                "source": "",
                "ok": False,
                "error": "SCSKiller was not found: install SCSKiller for Windows, then press Detect "
                "(or set the path to scskiller.exe)",
            }

        for candidate in _binary_candidates(home):
            if candidate.is_file() and os.access(candidate, os.X_OK):
                return {"mode": "path", "argv": [str(candidate)], "source": str(candidate), "ok": True}

        appimages = _appimage_candidates(home)
        if appimages:
            return self._describe(appimages[0])

        return {
            "mode": "none",
            "argv": [],
            "source": "",
            "ok": False,
            "error": "SCSKiller was not found: install its Linux AppImage, then press Detect",
        }

    def _describe(self, path: Path) -> Dict[str, Any]:
        """How to call this file: Windows/mono CLI, AppImage through `--cli`, or a plain binary."""
        info: Dict[str, Any] = {"mode": "path", "source": str(path), "ok": False, "argv": []}
        if not path.exists():
            info["error"] = f"{path} does not exist"
            return info
        if path.suffix.lower() == ".exe":
            info["mode"] = "exe"
            info["argv"] = [str(path)]
            info["ok"] = True
            return info
        if path.suffix.lower() == ".appimage" or "appimage" in path.name.lower():
            # the AppImage holds the GUI and the CLI side by side; `--cli` runs the
            # CLI from inside the mounted image (src/SCSKiller.Ui/Program.cs)
            info["mode"] = "appimage"
            info["argv"] = [str(path), "--cli"]
            info["ok"] = os.access(path, os.X_OK)
            if not info["ok"]:
                info["error"] = f"{path} is not executable (chmod +x it)"
            return info
        info["argv"] = [str(path)]
        info["ok"] = os.access(path, os.X_OK)
        if not info["ok"]:
            info["error"] = f"{path} is not executable"
        return info

    # -- process helpers --------------------------------------------------- #

    async def exec(self, argv: List[str], timeout: float) -> Dict[str, Any]:
        started = time.time()
        try:
            process = await asyncio.create_subprocess_exec(
                *argv,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(_home()),
                env=self.env(),
                **_spawn_kwargs(self._preexec()),
            )
        except FileNotFoundError as exc:
            return {"code": 127, "stdout": "", "stderr": str(exc), "seconds": 0.0}
        except OSError as exc:
            return {"code": 126, "stdout": "", "stderr": str(exc), "seconds": 0.0}

        try:
            out, err = await asyncio.wait_for(process.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            _kill_tree(process)
            await process.wait()
            return {
                "code": 124,
                "stdout": "",
                "stderr": f"timed out after {timeout:.0f}s",
                "seconds": time.time() - started,
            }
        return {
            "code": process.returncode,
            "stdout": out.decode("utf-8", "replace"),
            "stderr": err.decode("utf-8", "replace"),
            "seconds": time.time() - started,
        }


def _spawn_kwargs(preexec: Optional[Any]) -> Dict[str, Any]:
    """Platform bits for a child that can be stopped gracefully later."""
    if IS_WINDOWS:
        # its own console group, so CTRL_BREAK reaches SCSKiller and not us - but with
        # CREATE_NO_WINDOW so that console never shows a window
        return {"creationflags": CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW, "startupinfo": _STARTUPINFO}
    return {"preexec_fn": preexec, "start_new_session": True}


def _pause_verb(paused: bool) -> str:
    """ntdll call to use: suspend freezes the process, resume thaws it.

    (Kept as a named helper: the two calls were swapped once, so "Pause" really resumed
    and the progress bar kept advancing while the panel said "paused".)
    """
    return "NtSuspendProcess" if paused else "NtResumeProcess"


def _set_process_paused(pid: int, paused: bool) -> bool:
    """Freeze/unfreeze a running process (the CLI compiles on its own threads)."""
    if not pid:
        return False
    if IS_WINDOWS:
        try:
            import ctypes

            kernel32 = ctypes.windll.kernel32
            handle = kernel32.OpenProcess(0x0800, False, int(pid))  # PROCESS_SUSPEND_RESUME
            if not handle:
                return False
            try:
                ntdll = ctypes.windll.ntdll
                call = getattr(ntdll, _pause_verb(paused))
                return call(handle) == 0
            finally:
                kernel32.CloseHandle(handle)
        except Exception:
            return False
    try:
        os.kill(int(pid), signal.SIGCONT if paused else signal.SIGSTOP)
        return True
    except OSError:
        return False


def _taskkill(pid: int) -> None:
    try:
        subprocess.run(
            ["taskkill", "/PID", str(pid), "/T", "/F"],
            capture_output=True,
            timeout=20,
            **_NO_WINDOW,
        )
    except (OSError, subprocess.SubprocessError):
        pass


def _terminate(process: asyncio.subprocess.Process) -> None:
    """Stop the compile between items, so the driver still writes its cache."""
    if process.returncode is not None:
        return
    if IS_WINDOWS:
        # SCSKiller's CLI installs Console.CancelKeyPress; CTRL_BREAK drives it
        try:
            process.send_signal(signal.CTRL_BREAK_EVENT)
            return
        except (OSError, ValueError, ProcessLookupError, AttributeError):
            _taskkill(process.pid)
            return
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except OSError:
        try:
            process.terminate()
        except ProcessLookupError:
            return


def _kill_tree(process: asyncio.subprocess.Process) -> None:
    if process.returncode is not None:
        return
    if IS_WINDOWS:
        _taskkill(process.pid)
        return
    _terminate(process)
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except OSError:
        try:
            process.kill()
        except ProcessLookupError:
            pass


# --------------------------------------------------------------------------- #
# the plugin
# --------------------------------------------------------------------------- #

class Plugin:
    settings: Dict[str, Any] = {}
    _status_cache: Dict[str, Dict[str, Any]] = {}
    _jobs: Dict[str, Dict[str, Any]] = {}
    _lock: Optional[asyncio.Lock] = None
    _compile_task: Optional[asyncio.Task] = None
    #: compiles requested while another one runs: [{"app_id", "argv"}], FIFO
    _queue: List[Dict[str, Any]] = []
    extract_and_run: bool = False
    _detection: Dict[str, Any] = {}

    # -- lifecycle --------------------------------------------------------- #

    async def _main(self) -> None:
        self.settings = self._load_settings()
        self.extract_and_run = bool(self.settings.get("extract_and_run"))
        self._status_cache = {}
        self._jobs = {}
        self._queue = []
        self._lock = asyncio.Lock()
        log("plugin loaded; settings:", json.dumps(self.settings, sort_keys=True))
        try:
            # probing the AppImage spawns a process: keep the plugin's event loop free
            detection = await asyncio.get_running_loop().run_in_executor(None, self._detect_blocking)
        except Exception as exc:  # a broken install must not stop the plugin loading
            detection = {"resolved": {"ok": False, "error": str(exc)}, "appimages": []}
        log("detection:", json.dumps(detection, sort_keys=True, default=str))
        self._detection = detection

    async def _unload(self) -> None:
        if self._compile_task and not self._compile_task.done():
            self._compile_task.cancel()
            try:
                await self._compile_task
            except (asyncio.CancelledError, Exception):
                pass
        log("plugin unloaded")

    # -- settings ---------------------------------------------------------- #

    def _settings_path(self) -> Path:
        return _settings_dir() / SETTINGS_FILE

    def _load_settings(self) -> Dict[str, Any]:
        settings = dict(DEFAULT_SETTINGS)
        try:
            data = json.loads(self._settings_path().read_text("utf-8"))
            if isinstance(data, dict):
                settings.update({k: v for k, v in data.items() if k in DEFAULT_SETTINGS})
        except (OSError, ValueError):
            pass
        return settings

    # -- diagnostics -------------------------------------------------------- #

    async def report(self, message: Any) -> None:
        """Frontend diagnostics: the plugin's page is a 1x1 CEF document, so the UI writes
        what it cannot show (injection detail, failed calls) into the Decky log."""
        try:
            log("frontend:", str(message)[:2000])
        except Exception:  # pragma: no cover - logging must never break the frontend call
            pass

    async def get_settings(self) -> Dict[str, Any]:
        return dict(self.settings)

    async def set_settings(self, patch: Dict[str, Any]) -> Dict[str, Any]:
        if isinstance(patch, dict):
            for key, value in patch.items():
                if key in DEFAULT_SETTINGS:
                    self.settings[key] = value
        try:
            self._settings_path().write_text(
                json.dumps(self.settings, indent=2, sort_keys=True), "utf-8"
            )
        except OSError as exc:
            log("could not save settings:", exc)
        self._status_cache.clear()
        return dict(self.settings)

    # -- detection / setup -------------------------------------------------- #

    def _gui_path(self) -> str:
        """`SCSKiller.exe`, the window app, when it is installed."""
        for candidate in _windows_gui_candidates():
            if candidate.is_file():
                return str(candidate)
        return ""

    def _detect_blocking(self) -> Dict[str, Any]:
        runner = Runner(self)
        resolved = runner.resolve()
        platform = _platform()
        info: Dict[str, Any] = {
            "platform": platform,
            "resolved": resolved,
            "home": str(_home()),
            "runs_as": runner.as_user()[0],
            "data_dir": str(scskiller_data_dir()),
            "data_dirs": [str(folder) for folder in self._data_candidates()],
            "data_dir_ok": self._kept() is not None,
            "gui": self._gui_path() if platform in ("windows", "wsl") else "",
            "appimages": [str(p) for p in _appimage_candidates(_home())] if platform == "linux" else [],
        }
        if resolved.get("ok") and resolved["argv"]:
            info["version"] = self._probe_version(runner, resolved["argv"])
            info["version_ok"] = bool(info["version"])
        return info

    def _probe_version(self, runner: Runner, argv: List[str]) -> str:
        """Ask the CLI for its version; fall back to AppImage self-extraction."""
        command = argv + ["--version"]
        result = self._run_probe(runner, command, 60)
        if result is None:
            return ""
        text = (result.stdout or result.stderr or "").strip()
        if result.returncode == 0:
            return text.splitlines()[0] if text else ""
        lowered = text.lower()
        if "appimage" in lowered and ("fuse" in lowered or "mount" in lowered or "dlopen" in lowered):
            # SteamOS images often lack libfuse2: unpack to /tmp instead of mounting
            self.extract_and_run = True
            retried = self._run_probe(runner, command, 300)
            if retried is not None and retried.returncode == 0:
                self.settings["extract_and_run"] = True
                self.extract_and_run = True
                text = (retried.stdout or retried.stderr or "").strip()
                return text.splitlines()[0] if text else ""
        return ""

    @staticmethod
    def _run_probe(runner: Runner, command: List[str], timeout: float):
        try:
            return subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=timeout,
                cwd=str(_home()),
                env=runner.env(),
                preexec_fn=runner._preexec(),
                **_NO_WINDOW,
            )
        except (OSError, subprocess.SubprocessError):
            return None

    async def detect(self) -> Dict[str, Any]:
        try:
            info = await asyncio.get_running_loop().run_in_executor(None, self._detect_blocking)
        except Exception as exc:  # never let setup break the plugin
            info = {
                "resolved": {"argv": [], "source": "", "ok": False, "error": str(exc), "mode": "none"},
                "home": str(_home()),
                "runs_as": Runner(self).as_user()[0],
                "data_dir": str(scskiller_data_dir()),
                "data_dir_ok": False,
                "appimages": [],
            }
        self._detection = info
        return info

    async def extract_appimage(self, path: str = "") -> Dict[str, Any]:
        """Extract SCSKiller's AppImage so its `scskiller` CLI can be run.

        Linux/SteamOS only: on Windows the CLI is already a plain `scskiller.exe`.
        """
        if _platform() != "linux":
            return {"ok": False, "error": "not needed here: SCSKiller's Windows install already has scskiller.exe"}
        runner = Runner(self)
        source = Path(path) if path else Path(
            (self._detection.get("appimages") or [""])[0]
        )
        if not source.is_file():
            return {"ok": False, "error": "no SCSKiller AppImage found"}
        target = _data_dir() / "SCSKiller-linux"
        if (target / "scskiller").is_file():
            self.settings["cli_path"] = str(target / "scskiller")
            await self.set_settings(self.settings)
            return {"ok": True, "path": str(target / "scskiller"), "already": True}

        try:
            source.chmod(source.stat().st_mode | 0o111)
        except OSError:
            pass
        tmp = _data_dir() / "appimage-extract"
        if tmp.exists():
            shutil.rmtree(tmp, ignore_errors=True)
        tmp.mkdir(parents=True, exist_ok=True)
        argv = [str(source), "--appimage-extract"]
        try:
            process = await asyncio.create_subprocess_exec(
                *argv,
                cwd=str(tmp),
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.PIPE,
                env=runner.env(),
                preexec_fn=runner._preexec(),
                **_NO_WINDOW,
            )
            _out, err = await asyncio.wait_for(process.communicate(), timeout=600)
        except asyncio.TimeoutError:
            return {"ok": False, "error": "extraction timed out"}
        except OSError as exc:
            return {"ok": False, "error": str(exc)}
        if process.returncode != 0:
            return {"ok": False, "error": err.decode("utf-8", "replace").strip()}

        extracted = tmp / "squashfs-root"
        cli = extracted / "scskiller"
        if not cli.is_file():
            return {"ok": False, "error": "the AppImage did not contain the scskiller CLI"}
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.exists():
                shutil.rmtree(target, ignore_errors=True)
            shutil.move(str(extracted), str(target))
            shutil.rmtree(tmp, ignore_errors=True)
        except OSError as exc:
            return {"ok": False, "error": f"could not move the extracted files: {exc}"}

        self.settings["cli_path"] = str(target / "scskiller")
        await self.set_settings(self.settings)
        info = await self.detect()
        return {"ok": True, "path": str(target / "scskiller"), "detection": info}

    async def open_app(self) -> Dict[str, Any]:
        """Bring SCSKiller's own window up (useful for keys, settings, recordings)."""
        gui = self._gui_path()
        if not gui:
            return {"ok": False, "error": "SCSKiller.exe was not found next to the CLI"}
        try:
            if IS_WINDOWS:
                os.startfile(gui)  # type: ignore[attr-defined]
            else:
                subprocess.Popen([gui], env=dict(os.environ), start_new_session=True)
        except OSError as exc:
            return {"ok": False, "error": str(exc)}
        return {"ok": True, "path": gui}

    # -- status ------------------------------------------------------------ #

    def _game_id(self, app_id: Any) -> str:
        text = str(app_id or "").strip()
        if not text:
            return ""
        if ":" in text:
            return text
        if text.isdigit():
            return GAME_ID_PREFIX + text
        return text

    async def get_status(self, app_id: Any, refresh: bool = False) -> Dict[str, Any]:
        gid = self._game_id(app_id)
        if not gid:
            return {"ok": False, "error": "no app id given", "game_id": ""}
        cached = self._status_cache.get(gid)
        ttl = float(self.settings.get("auto_refresh") or 0) or STATUS_TTL
        if cached and not refresh and time.time() - cached["at"] < max(ttl, 5.0):
            payload = dict(cached["data"])
            payload["cached"] = True
            return payload

        if refresh:
            # A refresh means "scan again", not "switch to the CLI's poorer view":
            # `scskiller status` rewrites games.json with the same numbers the app
            # shows (pipelines, cache, durations), so rescan and re-read that file.
            scan = await self._scan_cli()
            if scan.get("ok"):
                payload = await self._query_status(gid, False)
            else:
                payload = await self._query_status(gid, True)
        else:
            payload = await self._query_status(gid, False)

        payload["cached"] = False
        if payload.get("ok"):
            self._status_cache[gid] = {"at": time.time(), "data": payload}
        return payload

    # -- SCSKiller's own library file -------------------------------------- #

    def _data_candidates(self) -> List[Path]:
        """Every folder that can hold SCSKiller's games.json, most likely first."""
        dirs: List[Path] = []
        resolved = Runner(self).resolve()
        source = resolved.get("source") or ""
        if source.lower().endswith("scskiller.exe"):
            # a portable copy keeps its data in `data\` beside the app
            portable = Path(source).parent.parent.parent / "data"
            if portable.is_dir():
                dirs.append(portable)
        dirs.extend(_windows_data_dirs())
        default = scskiller_data_dir()
        if default not in dirs:
            dirs.append(default)
        return dirs

    def _kept(self, force: bool = False) -> Optional[Dict[str, Any]]:
        """games.json, cached on its mtime: SCSKiller rewrites it after every scan."""
        cache = getattr(self, "_kept_cache", {})
        for folder in self._data_candidates():
            path = folder / GAMES_JSON
            try:
                mtime = path.stat().st_mtime
            except OSError:
                continue
            hit = cache.get(str(path))
            if hit and not force and hit.get("mtime") == mtime:
                return hit.get("data")
            data = read_kept_list(path)
            if data is None:
                continue
            cache[str(path)] = {"mtime": mtime, "data": data}
            self._kept_cache = cache
            return data
        return None

    def _kept_game(self, gid: str) -> Optional[Dict[str, Any]]:
        kept = self._kept()
        if not kept:
            return None
        for entry in kept.get("Games") or []:
            if not isinstance(entry, dict):
                continue
            if (entry.get("Game") or {}).get("Id") == gid:
                return entry
        return None

    async def get_library(self, refresh: bool = False) -> Dict[str, Any]:
        """Every game SCSKiller knows, from games.json (no process spawned).

        `refresh=True` runs `scskiller status` first, which rescans the installed
        games and rewrites games.json; that is the slow path, only on demand.
        """
        if refresh:
            scan = await self._scan_cli()
            if not scan.get("ok"):
                return {"ok": False, "error": scan.get("error"), "games": [], "source": "cli"}

        kept = self._kept(force=refresh)
        if not kept:
            return {
                "ok": False,
                "error": "SCSKiller has not written its game list yet: run SCSKiller once, or press Scan",
                "games": [],
                "source": "none",
            }

        games: List[Dict[str, Any]] = []
        for entry in kept.get("Games") or []:
            if not isinstance(entry, dict):
                continue
            row = map_kept_game(entry)
            stats = row.get("stats") or {}
            games.append(
                {
                    "game_id": row["game_id"],
                    "name": row["name"],
                    "status": row["status"],
                    "reason": row.get("reason", ""),
                    "cache_bytes": row.get("cache_bytes"),
                    "recorder": row.get("recorder_installed", False),
                    "known_stutter": row.get("known_stutter"),
                    "appid": steam_appid(row["game_id"]),
                    "store": row.get("store", ""),
                    "stats": stats,
                    "warmed_at": row.get("warmed_at"),
                    "last_compile_seconds": stats.get("last_compile_seconds"),
                    "estimate_seconds": stats.get("estimate_seconds"),
                    "driver": stats.get("driver"),
                    "engine": stats.get("engine"),
                    "api": stats.get("api"),
                    "new_pipelines": row.get("new_pipelines"),
                }
            )
        games.sort(key=lambda game: (_kind_rank(game["status"]["kind"]), game["name"].lower()))
        return {
            "ok": True,
            "games": games,
            "build": kept.get("Build"),
            "driver": kept.get("Driver"),
            "source": "games.json",
        }

    async def _scan_cli(self) -> Dict[str, Any]:
        runner = Runner(self)
        resolved = runner.resolve()
        if not resolved.get("ok"):
            return {"ok": False, "error": resolved.get("error", "SCSKiller not found")}
        result = await runner.exec(resolved["argv"] + ["status"], STATUS_TIMEOUT)
        if result["code"] != 0:
            message = (result["stderr"] or "").strip().splitlines()
            return {"ok": False, "error": message[-1] if message else f"exit {result['code']}"}
        self._kept_cache = {}
        self._status_cache.clear()
        return {"ok": True, "seconds": round(result["seconds"], 2)}

    async def _query_status(self, gid: str, refresh: bool = False) -> Dict[str, Any]:
        # fast path: SCSKiller already computed this game's status in games.json
        if not refresh:
            entry = self._kept_game(gid)
            if entry:
                payload = map_kept_game(entry, gid)
                payload["seconds"] = 0.0
                payload["cli"] = "games.json"
                return payload

        runner = Runner(self)
        resolved = runner.resolve()
        if not resolved.get("ok"):
            return {"ok": False, "game_id": gid, "error": resolved.get("error", "SCSKiller not found"),
                    "resolved": resolved}

        result = await runner.exec(resolved["argv"] + ["status", gid], STATUS_TIMEOUT)
        text = result["stdout"]
        parsed = parse_detail(text)
        if result["code"] != 0 or not parsed.get("fields"):
            message = (result["stderr"] or text or "").strip().splitlines()
            error = message[-1] if message else f"scskiller status exited with {result['code']}"
            return {
                "ok": False,
                "game_id": gid,
                "error": error,
                "returncode": result["code"],
                "raw": text,
            }

        parsed.update(
            {
                "ok": True,
                "game_id": gid,
                "seconds": round(result["seconds"], 2),
                "cli": resolved.get("source", ""),
                "stats": {
                    "shaders": parsed.get("shader_count"),
                    "pipelines": parsed.get("recorded_pipelines"),
                    "recorded": parsed.get("recorded_pipelines"),
                    "cache_bytes": parsed.get("cache_bytes"),
                    "cache_in_use_bytes": parsed.get("cache_in_use_bytes"),
                    "estimate_bytes": parsed.get("estimate_bytes"),
                    "estimate_seconds": parsed.get("estimate_seconds"),
                    "last_compile_seconds": parsed.get("warmed_seconds"),
                    "warmed_at": parsed.get("warmed_at"),
                    "driver": parsed.get("warmed_driver"),
                    "api": parsed.get("covered_api"),
                    "engine": (parsed.get("fields") or {}).get("engine"),
                    "recorder": parsed.get("recorder_installed"),
                    "coverage_pct": parsed.get("covered_pct"),
                },
            }
        )
        return parsed

    async def get_all_statuses(self, refresh: bool = False) -> Dict[str, Any]:
        """`scskiller status` with no game: one row per game, for the QAM list."""
        runner = Runner(self)
        resolved = runner.resolve()
        if not resolved.get("ok"):
            return {"ok": False, "error": resolved.get("error", "SCSKiller not found"), "games": []}
        result = await runner.exec(resolved["argv"] + ["status"], STATUS_TIMEOUT)
        games = parse_rows(result["stdout"])
        if result["code"] != 0 and not games:
            return {"ok": False, "error": (result["stderr"] or "").strip(), "games": []}
        return {"ok": True, "games": games, "seconds": round(result["seconds"], 2)}

    async def is_game_running(self, app_id: Any) -> Dict[str, Any]:
        gid = self._game_id(app_id)
        exe = ""
        cached = self._status_cache.get(gid)
        if cached:
            exe = (cached["data"].get("fields") or {}).get("exe", "")
        if not exe:
            status = await self.get_status(gid)
            exe = (status.get("fields") or {}).get("exe", "")
        return {"running": _is_running(exe) if exe else False, "exe": exe}

    # -- compile ----------------------------------------------------------- #

    async def start_compile(self, app_id: Any, options: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        gid = self._game_id(app_id)
        if not gid:
            return {"ok": False, "error": "no app id given"}

        runner = Runner(self)
        resolved = runner.resolve()
        if not resolved.get("ok"):
            return {"ok": False, "error": resolved.get("error", "SCSKiller not found")}

        options = options or {}
        argv = resolved["argv"] + ["compile", gid]
        threads = int(options.get("threads") or self.settings.get("threads") or 0)
        if threads > 0:
            argv += ["--threads", str(threads)]
        if bool(options.get("idle", self.settings.get("idle", False))):
            argv += ["--idle"]

        # one CLI process at a time: anything requested meanwhile waits in the queue
        if self._busy():
            queue = list(self._queue or [])
            if gid in [item["app_id"] for item in queue]:
                return {"ok": False, "error": "this game is already queued"}
            queue.append({"app_id": gid, "argv": argv})
            self._queue = queue
            await self._emit("scsk_queue_changed", {"queue": [item["app_id"] for item in self._queue]})
            return {"ok": True, "queued": True, "position": len(self._queue)}

        return await self._begin_compile(gid, argv, runner)

    def _busy(self) -> bool:
        """True while a CLI compile process is alive: the queue has to wait."""
        return bool(self._compile_task and not self._compile_task.done())

    async def _begin_compile(
        self,
        gid: str,
        argv: List[str],
        runner: Optional[Runner] = None,
    ) -> Dict[str, Any]:
        """Spawn the CLI for `gid`. The caller owns the queue: this always starts a process."""
        running = await self.is_game_running(gid)
        if running["running"]:
            return {
                "ok": False,
                "error": "close the game first: SCSKiller compiles with the game closed",
                "running": True,
            }

        runner = runner or Runner(self)
        if not argv:
            resolved = runner.resolve()
            if not resolved.get("ok"):
                return {"ok": False, "error": resolved.get("error", "SCSKiller not found")}
            argv = resolved["argv"] + ["compile", gid]

        job = {
            "app_id": gid,
            "argv": argv,
            "started_at": time.time(),
            "lines": deque(maxlen=COMPILE_LINE_MAX),
            "stage": "",
            "running": True,
            "exit_code": None,
            "error": None,
            "ok": None,
        }
        self._jobs[gid] = job
        self._compile_task = asyncio.ensure_future(self._run_compile(job, runner))
        return {"ok": True, "job": self._job_snapshot(job)}

    async def _spawn(self, argv: List[str], runner: Runner):
        """Start the compile; stdout carries the queue's stage lines."""
        return await asyncio.create_subprocess_exec(
            *argv,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=str(_home()),
            env=runner.env(),
            **_spawn_kwargs(runner._preexec()),
        )

    async def _run_compile(self, job: Dict[str, Any], runner: Runner) -> None:
        gid = job["app_id"]
        await self._emit("scsk_compile_started", {"app_id": gid, "argv": job["argv"]})
        try:
            process = await self._spawn(job["argv"], runner)
        except OSError as exc:
            job.update({"running": False, "ok": False, "error": str(exc)})
            await self._emit("scsk_compile_done", {"app_id": gid, "ok": False, "error": str(exc)})
            return

        job["pid"] = process.pid
        assert process.stdout is not None
        try:
            while True:
                raw = await process.stdout.readline()
                if not raw:
                    break
                line = raw.decode("utf-8", "replace").rstrip()
                if not line:
                    continue
                info = parse_progress_line(line)
                job["lines"].append(info)
                if info.get("stage") and info["stage"] != job["stage"]:
                    job["stage"] = info["stage"]
                await self._emit("scsk_compile_line", {"app_id": gid, "line": info})
            await process.wait()
        except asyncio.CancelledError:
            # a Stop waits for SCSKiller to finish its in-flight items and commit the
            # driver's cache; only a process that ignores SIGTERM is killed
            _terminate(process)
            try:
                await asyncio.wait_for(asyncio.shield(process.wait()), timeout=30)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                _kill_tree(process)
                try:
                    await asyncio.shield(process.wait())
                except asyncio.CancelledError:
                    pass
            job.update({"running": False, "ok": False, "error": "stopped", "exit_code": process.returncode})
            await self._emit("scsk_compile_done", {"app_id": gid, "ok": False, "error": "stopped"})
            raise
        finally:
            job["running"] = False
            # release the busy slot before the tail: this very task is still "not done"
            if self._compile_task is asyncio.current_task():
                self._compile_task = None

        job["exit_code"] = process.returncode
        job["ok"] = process.returncode == 0
        if not job["ok"]:
            job["error"] = f"scskiller compile exited with {process.returncode}"
        self._status_cache.pop(gid, None)
        await self._emit(
            "scsk_compile_done",
            {"app_id": gid, "ok": job["ok"], "exit_code": job["exit_code"], "error": job["error"]},
        )
        await self._drain_queue()

    async def _drain_queue(self) -> None:
        """Start the next queued compile, FIFO, once the current CLI process is gone."""
        if self._busy():
            return
        while self._queue:
            queue = list(self._queue)
            item = queue.pop(0)
            self._queue = queue
            await self._emit("scsk_queue_changed", {"queue": [entry["app_id"] for entry in self._queue]})
            response = await self._begin_compile(item["app_id"], list(item.get("argv") or []))
            if response.get("ok"):
                return

    async def _drain_after(self, task: "asyncio.Task") -> None:
        """Wait for a cancelled compile task to settle, then start the next queued one."""
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass
        await self._drain_queue()

    async def start_queued(self, app_id: Any) -> Dict[str, Any]:
        """Queue row button: run that game now, i.e. move it from the queue to In progress."""
        gid = self._game_id(app_id)
        item = next((entry for entry in (self._queue or []) if entry["app_id"] == gid), None)
        if item is None:
            return {"ok": False, "error": "not in the queue"}
        if self._busy():
            return {"ok": False, "error": "a compile is already running: stop or pause it first"}
        self._queue = [entry for entry in self._queue if entry["app_id"] != gid]
        await self._emit("scsk_queue_changed", {"queue": [entry["app_id"] for entry in self._queue]})
        return await self._begin_compile(gid, list(item.get("argv") or []))

    async def clear_finished(self) -> Dict[str, Any]:
        """The page's "Clear All": forget the finished compiles, keep running ones and the queue."""
        self._jobs = {gid: job for gid, job in (self._jobs or {}).items() if job.get("running")}
        return {"ok": True, "jobs": [self._job_snapshot(job) for job in self._jobs.values()]}

    def _running_job(self) -> Optional[Dict[str, Any]]:
        for job in (self._jobs or {}).values():
            if job.get("running"):
                return job
        return None

    async def pause_compile(self) -> Dict[str, Any]:
        job = self._running_job()
        if not job or not job.get("pid"):
            return {"ok": False, "error": "no compile is running"}
        if job.get("paused"):
            return {"ok": True, "paused": True}
        if not _set_process_paused(int(job["pid"]), True):
            return {"ok": False, "error": "could not pause the compile"}
        job["paused"] = True
        await self._emit("scsk_compile_paused", {"app_id": job["app_id"], "paused": True})
        return {"ok": True, "paused": True, "job": self._job_snapshot(job)}

    async def resume_compile(self) -> Dict[str, Any]:
        job = self._running_job()
        if not job or not job.get("pid"):
            return {"ok": False, "error": "no compile is running"}
        if not job.get("paused"):
            return {"ok": True, "paused": False}
        if not _set_process_paused(int(job["pid"]), False):
            return {"ok": False, "error": "could not resume the compile"}
        job["paused"] = False
        await self._emit("scsk_compile_paused", {"app_id": job["app_id"], "paused": False})
        return {"ok": True, "paused": False, "job": self._job_snapshot(job)}

    async def cancel_queued(self, app_id: Any) -> Dict[str, Any]:
        gid = self._game_id(app_id)
        before = len(self._queue)
        self._queue = [item for item in self._queue if item["app_id"] != gid]
        if len(self._queue) == before:
            return {"ok": False, "error": "not in the queue"}
        await self._emit("scsk_queue_changed", {"queue": [entry["app_id"] for entry in self._queue]})
        return {"ok": True}

    async def clear_queue(self) -> Dict[str, Any]:
        self._queue = []
        await self._emit("scsk_queue_changed", {"queue": []})
        return {"ok": True}

    async def cancel_compile(self) -> Dict[str, Any]:
        if not self._compile_task or self._compile_task.done():
            return {"ok": False, "error": "no compile is running"}
        job = self._running_job()
        if job and job.get("paused") and job.get("pid"):
            # a suspended CLI cannot react to CTRL_BREAK: thaw it first so it can finish its
            # in-flight item and commit the driver cache, instead of waiting for the kill
            if _set_process_paused(int(job["pid"]), False):
                job["paused"] = False
                await self._emit("scsk_compile_paused", {"app_id": job["app_id"], "paused": False})
        task = self._compile_task
        task.cancel()
        # a Stop skips the tail of _run_compile, so the queue has to be drained here
        asyncio.ensure_future(self._drain_after(task))
        return {"ok": True}

    async def get_compile_state(self, app_id: Any = "") -> Dict[str, Any]:
        gid = self._game_id(app_id)
        job = self._jobs.get(gid) if gid else None
        if job is None:
            job = next((j for j in self._jobs.values() if j["running"]), None)
        if job is None:
            return {"ok": True, "running": False}
        return {"ok": True, "job": self._job_snapshot(job)}

    async def get_compiles(self) -> Dict[str, Any]:
        """Every compile this plugin tracked: running first, then newest started_at."""
        jobs = [self._job_snapshot(job) for job in (self._jobs or {}).values()]
        jobs.sort(key=lambda job: (0 if job.get("running") else 1, -(job.get("started_at") or 0)))
        queue = [{"app_id": item["app_id"], "position": index + 1} for index, item in enumerate(self._queue or [])]
        return {
            "ok": True,
            "running": sum(1 for job in jobs if job.get("running")),
            "jobs": jobs,
            "queue": queue,
        }

    @staticmethod
    def _job_snapshot(job: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "app_id": job["app_id"],
            "running": job["running"],
            "paused": bool(job.get("paused")),
            "stage": job.get("stage", ""),
            "started_at": job.get("started_at"),
            "exit_code": job.get("exit_code"),
            "ok": job.get("ok"),
            "error": job.get("error"),
            "lines": list(job["lines"])[-80:],
        }

    # -- events ------------------------------------------------------------ #

    async def _emit(self, name: str, payload: Dict[str, Any]) -> None:
        emitter = _decky_attr("emit")
        if emitter is None:
            return
        try:
            result = emitter(name, payload)
            if asyncio.iscoroutine(result):
                await result
        except Exception as exc:  # pragma: no cover - the UI must not break on events
            log(f"emit {name} failed:", exc)


def _is_running(exe_path: str) -> bool:
    """True when a process runs an executable with this name."""
    if not exe_path:
        return False
    wanted = os.path.basename(exe_path.replace("\\", "/"))
    if not wanted:
        return False

    if _platform() in ("windows", "wsl"):
        # the game runs on Windows, not in the Linux process namespace
        tasklist = "tasklist" if IS_WINDOWS else "tasklist.exe"
        try:
            result = subprocess.run(
                [tasklist, "/FI", f"IMAGENAME eq {wanted}", "/NH", "/FO", "CSV"],
                capture_output=True,
                text=True,
                timeout=20,
                **_NO_WINDOW,
            )
        except (OSError, subprocess.SubprocessError):
            return False
        return wanted.lower() in (result.stdout or "").lower()

    proc = Path("/proc")
    if not proc.is_dir():
        return False
    for entry in proc.iterdir():
        if not entry.name.isdigit():
            continue
        try:
            cmdline = (entry / "cmdline").read_bytes().decode("utf-8", "replace")
        except OSError:
            continue
        if not cmdline:
            continue
        for part in cmdline.split("\x00"):
            if os.path.basename(part).lower() == wanted:
                return True
    return False
