"""Decky Loader backend for the Steam Switch plugin.

Steam shows "Borrow" on the page of a game that belongs to another account, even when the
game is already installed on this PC and that account is signed in (and remembered) on it.
This plugin replaces that button with "Switch account & Play": it restarts the client signed
into the account that owns the game and launches the game there.

Two constraints shape the code:

  * Steam rewrites ``config/loginusers.vdf`` when it exits, so the file can only be edited
    after the client is gone - and the client then has to be started again. That work must
    outlive this process, so it is handed to a PowerShell script started detached
    (DETACHED_PROCESS); progress comes back through a small JSON status file.
  * no account name is ever hard-coded: the accounts are whatever the local Steam install
    already remembers, and the account to switch to is the one that owns the game (Steam
    exposes it as the app manifest's ``LastOwner`` and as ``owner_account_id`` on the page).
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

try:  # decky-loader >= 3.0
    import decky  # type: ignore
except ImportError:  # older loaders expose the same API as decky_plugin
    import decky_plugin as decky  # type: ignore


PLUGIN_NAME = "SteamSwitch"

#: SteamID64 of an account id 0; account ids are ``id64 - STEAM_ID_BASE``.
STEAM_ID_BASE = 76561197960265728

STEAM_KEY = r"Software\Valve\Steam"
ACTIVE_KEY = STEAM_KEY + r"\ActiveProcess"

STATE_FILE = "switch-state.json"
TERMINAL_STATES = {"done", "error", "login-failed", "cancelled"}
SWITCH_TIMEOUT = 180
STATE_TTL = 900.0          # a terminal status older than this is just history

#: thrown at the helper when it cannot start Steam again
HELPER_LOG_LIMIT = 4000


# --------------------------------------------------------------------------- #
# logging / paths
# --------------------------------------------------------------------------- #

def log(*parts: Any) -> None:
    line = " ".join(str(part) for part in parts)
    try:
        logger = getattr(decky, "logger", None)
        if logger is not None:
            logger.info(line)
            return
    except Exception:  # pragma: no cover - logging must never break a call
        pass
    try:
        print(f"[{PLUGIN_NAME}] {line}")
    except Exception:  # pragma: no cover
        pass


def _decky_attr(name: str, default: Any = None) -> Any:
    return getattr(decky, name, default)


def is_supported() -> bool:
    """Account switching is implemented for the Windows Steam client only (see module docstring)."""
    return sys.platform == "win32"


def plugin_dir() -> Path:
    value = _decky_attr("DECKY_PLUGIN_DIR")
    if value:
        return Path(value)
    return Path(__file__).resolve().parent


def data_dir() -> Path:
    for attr in ("DECKY_PLUGIN_RUNTIME_DIR", "DECKY_PLUGIN_SETTINGS_DIR"):
        value = _decky_attr(attr)
        if value:
            path = Path(value)
            try:
                path.mkdir(parents=True, exist_ok=True)
            except OSError:
                continue
            return path
    return plugin_dir()


def state_path() -> Path:
    return data_dir() / STATE_FILE


# --------------------------------------------------------------------------- #
# VDF (Valve's key/value format) - enough for loginusers.vdf and app manifests
# --------------------------------------------------------------------------- #

_VDF_TOKEN = re.compile(r'"((?:[^"\\]|\\.)*)"|([{}])|//[^\n]*')


def _unescape(text: str) -> str:
    return text.replace("\\\\", "\\").replace('\\"', '"')


def vdf_loads(text: str) -> Dict[str, Any]:
    """Parse the subset of VDF Steam writes: quoted keys, quoted values, nested blocks."""
    tokens: List[tuple] = []
    for match in _VDF_TOKEN.finditer(text or ""):
        if match.group(1) is not None:
            tokens.append(("s", _unescape(match.group(1))))
        elif match.group(2) is not None:
            tokens.append(("b", match.group(2)))

    def parse(pos: int) -> tuple:
        out: Dict[str, Any] = {}
        while pos < len(tokens):
            kind, value = tokens[pos]
            if kind == "b":
                if value == "}":
                    return out, pos + 1
                pos += 1
                continue
            key = value
            pos += 1
            if pos < len(tokens) and tokens[pos] == ("b", "{"):
                child, pos = parse(pos + 1)
                out[key] = child
            elif pos < len(tokens) and tokens[pos][0] == "s":
                out[key] = tokens[pos][1]
                pos += 1
        return out, pos

    parsed, _ = parse(0)
    return parsed


# --------------------------------------------------------------------------- #
# local Steam install
# --------------------------------------------------------------------------- #

def _reg_value(path: str, name: str) -> Optional[Any]:
    try:
        import winreg  # type: ignore
    except ImportError:
        return None
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, path) as key:
            value, _kind = winreg.QueryValueEx(key, name)
            return value
    except OSError:
        return None


def steam_root() -> Optional[Path]:
    if sys.platform != "win32":
        return None
    raw = _reg_value(STEAM_KEY, "SteamPath")
    if not raw:
        return None
    path = Path(str(raw).replace("/", "\\"))
    return path if path.is_dir() else None


def active_user_id64() -> int:
    """The account Steam is currently signed in as, or 0 when signed out."""
    raw = _reg_value(ACTIVE_KEY, "ActiveUser")
    try:
        value = int(raw or 0)
    except (TypeError, ValueError):
        return 0
    if value <= 0:
        return 0
    return value + STEAM_ID_BASE


def read_accounts(root: Path) -> List[Dict[str, Any]]:
    """Every account Steam remembers for this Windows user, newest first."""
    path = root / "config" / "loginusers.vdf"
    try:
        parsed = vdf_loads(path.read_text("utf-8", errors="replace"))
    except OSError:
        return []
    users = parsed.get("users")
    if not isinstance(users, dict):
        return []
    accounts: List[Dict[str, Any]] = []
    for id64, entry in users.items():
        if not isinstance(entry, dict) or not str(id64).isdigit():
            continue
        try:
            stamp = int(str(entry.get("timestamp") or 0))
        except ValueError:
            stamp = 0
        accounts.append(
            {
                "id64": str(id64),
                "id32": int(id64) - STEAM_ID_BASE,
                "account": str(entry.get("AccountName") or ""),
                "persona": str(entry.get("PersonaName") or entry.get("AccountName") or ""),
                "remember": str(entry.get("RememberPassword") or "0") == "1",
                "auto": str(entry.get("AutoLogin") or entry.get("AllowAutoLogin") or "0") == "1",
                "timestamp": stamp,
            }
        )
    accounts.sort(key=lambda item: item["timestamp"], reverse=True)
    return accounts


def library_folders(root: Path) -> List[Path]:
    """Every steamapps folder Steam knows about (main install first)."""
    folders: List[Path] = []
    main = root / "steamapps"
    if main.is_dir():
        folders.append(main)
    try:
        parsed = vdf_loads((main / "libraryfolders.vdf").read_text("utf-8", errors="replace"))
    except OSError:
        parsed = {}
    entries = parsed.get("libraryfolders") or parsed.get("LibraryFolders") or {}
    if isinstance(entries, dict):
        for entry in entries.values():
            if not isinstance(entry, dict):
                continue
            raw = entry.get("path")
            if not raw:
                continue
            candidate = Path(str(raw)) / "steamapps"
            if candidate.is_dir() and candidate not in folders:
                folders.append(candidate)
    return folders


def app_manifest(root: Path, appid: int) -> Optional[Dict[str, Any]]:
    """The installed-app manifest for ``appid``, from whichever library holds it."""
    for folder in library_folders(root):
        path = folder / f"appmanifest_{appid}.acf"
        if not path.is_file():
            continue
        try:
            parsed = vdf_loads(path.read_text("utf-8", errors="replace"))
        except OSError:
            continue
        state = parsed.get("AppState")
        if isinstance(state, dict):
            return state
    return None


def manifest_installed(manifest: Optional[Dict[str, Any]]) -> bool:
    """StateFlags bit 4 is "fully installed"; a missing manifest means "not installed"."""
    if not manifest:
        return False
    try:
        flags = int(str(manifest.get("StateFlags") or 0))
    except ValueError:
        return False
    return bool(flags & 4)


def manifest_owner_id64(manifest: Optional[Dict[str, Any]]) -> int:
    if not manifest:
        return 0
    try:
        return int(str(manifest.get("LastOwner") or 0))
    except ValueError:
        return 0


def find_account(accounts: List[Dict[str, Any]], id64: int) -> Optional[Dict[str, Any]]:
    for account in accounts:
        if id64 and str(account["id64"]) == str(id64):
            return account
    return None


def current_account(root: Path, accounts: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    found = find_account(accounts, active_user_id64())
    if found:
        return found
    for account in accounts:
        if account["auto"]:
            return account
    return accounts[0] if accounts else None


# --------------------------------------------------------------------------- #
# game state
# --------------------------------------------------------------------------- #

def game_state(appid: int, owner_account_id: Optional[int] = None) -> Dict[str, Any]:
    """Everything the page needs to decide whether "Switch account & Play" applies."""
    result: Dict[str, Any] = {
        "ok": False,
        "supported": is_supported(),
        "appid": appid,
        "installed": False,
        "can_switch": False,
        "reason": "",
        "owner": None,
        "current": None,
        "target": None,
        "other": [],
    }
    if not is_supported():
        result["reason"] = "Steam account switching is only implemented for Windows"
        return result

    root = steam_root()
    if root is None:
        result["reason"] = "no Steam install found for this Windows user"
        return result

    accounts = read_accounts(root)
    current = current_account(root, accounts)
    if current is None:
        result["reason"] = "no Steam account is saved on this PC"
        return result
    result["ok"] = True
    result["current"] = current
    result["other"] = [a for a in accounts if a["id64"] != current["id64"]]

    manifest = app_manifest(root, appid)
    result["installed"] = manifest_installed(manifest)
    result["name"] = str((manifest or {}).get("name") or "")

    owner_id64 = 0
    if owner_account_id:
        owner_id64 = int(owner_account_id) + STEAM_ID_BASE
    if not owner_id64:
        owner_id64 = manifest_owner_id64(manifest)
    owner = find_account(accounts, owner_id64)
    result["owner"] = owner

    if owner is not None and owner["id64"] == current["id64"]:
        result["reason"] = "the signed-in account already owns this game"
        return result

    target = owner
    if target is None:
        if owner_id64:
            result["reason"] = "the owning account is not signed in on this PC"
            return result
        if len(result["other"]) == 1:
            target = result["other"][0]
            result["reason"] = "owning account unknown; using the other saved account"
        else:
            result["reason"] = "cannot tell which saved account owns this game"
            return result

    result["target"] = target
    if not result["installed"]:
        result["reason"] = "the game is not installed on this PC"
        return result
    if not target.get("remember"):
        result["reason"] = "Steam does not remember that account's password on this PC"
        return result

    result["can_switch"] = True
    result["reason"] = "ready"
    return result


# --------------------------------------------------------------------------- #
# status file (written by the detached helper)
# --------------------------------------------------------------------------- #

def read_state() -> Dict[str, Any]:
    path = state_path()
    try:
        data = json.loads(path.read_text("utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(data, dict):
        return {}
    try:
        stamp = float(data.get("time") or 0) / 1000.0
    except (TypeError, ValueError):
        stamp = 0.0
    data["age"] = max(0.0, time.time() - stamp) if stamp else None
    return data


def write_state(payload: Dict[str, Any]) -> None:
    path = state_path()
    try:
        path.write_text(json.dumps(payload, indent=2, sort_keys=True), "utf-8")
    except OSError as exc:
        log("cannot write", path, exc)


def switch_in_progress() -> bool:
    state = read_state()
    if not state:
        return False
    name = str(state.get("state") or "")
    if name in TERMINAL_STATES:
        return False
    age = state.get("age")
    if age is None:
        return False
    # "starting" is written by this process just before the helper is spawned; if the helper
    # really ran it replaces that record with its own (which carries its pid) within a second.
    limit = 20.0 if name == "starting" else float(SWITCH_TIMEOUT)
    return age < limit


async def helper_alive(wait: float) -> bool:
    """True once the helper wrote its own state (it always includes its pid)."""
    deadline = time.time() + max(0.0, wait)
    while time.time() < deadline:
        if read_state().get("pid"):
            return True
        await asyncio.sleep(0.2)
    return bool(read_state().get("pid"))


# --------------------------------------------------------------------------- #
# the detached helper
# --------------------------------------------------------------------------- #

def helper_script() -> Path:
    return plugin_dir() / "tools" / "switch.ps1"


def powershell_exe() -> Optional[str]:
    found = shutil.which("powershell.exe") or shutil.which("powershell")
    if found:
        return found
    fallback = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
    return str(fallback) if fallback.is_file() else None


async def spawn_helper(target: Dict[str, Any], appid: int) -> Dict[str, Any]:
    """Start tools/switch.ps1 detached: it has to outlive Steam shutting down."""
    if not is_supported():
        return {"ok": False, "error": "Steam account switching is only implemented for Windows"}
    shell = powershell_exe()
    if not shell:
        return {"ok": False, "error": "PowerShell is not available"}
    script = helper_script()
    if not script.is_file():
        return {"ok": False, "error": f"helper script missing: {script}"}
    root = steam_root()
    if root is None:
        return {"ok": False, "error": "no Steam install found for this Windows user"}

    argv = [
        shell,
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        str(script),
        "-SteamRoot",
        str(root),
        "-TargetAccount",
        str(target["account"]),
        "-AppId",
        str(int(appid)),
        "-StatusFile",
        str(state_path()),
        "-TimeoutSec",
        str(SWITCH_TIMEOUT),
    ]
    write_state(
        {
            "state": "starting",
            "message": f"switching to {target['account']}"
            + (f" and launching app {appid}" if appid else ""),
            "appid": int(appid),
            "target": target["account"],
            "target_persona": target["persona"],
            "time": int(time.time() * 1000),
            "consumed": False,
        }
    )
    try:
        subprocess.Popen(  # noqa: S603 - fixed argv, no shell
            argv,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            close_fds=True,
            creationflags=0x08000000,  # CREATE_NO_WINDOW: CONSOLE-FREE AND SURVIVES THE CALLER
            cwd=str(plugin_dir()),
        )
    except OSError as exc:
        write_state(
            {
                "state": "error",
                "message": f"cannot start the helper: {exc}",
                "appid": int(appid),
                "time": int(time.time() * 1000),
                "consumed": False,
            }
        )
        return {"ok": False, "error": f"cannot start the helper: {exc}"}
    if not await helper_alive(4.0):
        write_state(
            {
                "state": "error",
                "message": "the helper did not start (PowerShell refused to run)",
                "appid": int(appid),
                "target": target["account"],
                "time": int(time.time() * 1000),
                "consumed": False,
            }
        )
        return {"ok": False, "error": "the helper did not start (PowerShell refused to run)"}
    log("helper started for", target["account"], "app", appid)
    return {"ok": True, "state": "starting", "target": target}


def launch_only(appid: int) -> Dict[str, Any]:
    """Switch not needed (already the right account): just start the game."""
    if not is_supported():
        return {"ok": False, "error": "Windows only"}
    try:
        os.startfile(f"steam://rungameid/{int(appid)}")  # type: ignore[attr-defined]
        return {"ok": True, "state": "launched"}
    except OSError as exc:
        return {"ok": False, "error": str(exc)}


# --------------------------------------------------------------------------- #
# the plugin
# --------------------------------------------------------------------------- #

class Plugin:
    _started: float = 0.0

    async def _main(self) -> None:
        self._started = time.time()
        log("plugin loaded; state file:", state_path())
        # one line so a support request carries the two facts that matter
        try:
            root = steam_root()
            accounts = read_accounts(root) if root else []
            current = current_account(root, accounts) if root else None
            log(
                "steam:", str(root),
                "| accounts:", ", ".join(str(a["account"]) for a in accounts) or "none",
                "| current:", str((current or {}).get("account") or "none"),
            )
        except Exception as exc:  # pragma: no cover - diagnostics only
            log("startup probe failed:", exc)

    async def _unload(self) -> None:
        log("plugin unloaded")

    # -- diagnostics -------------------------------------------------------- #

    async def report(self, message: Any) -> None:
        """Frontend diagnostics: the plugin's own document is 1x1, all UI lives in Big Picture."""
        try:
            log("frontend:", str(message)[:2000])
        except Exception:  # pragma: no cover
            pass

    # -- read --------------------------------------------------------------- #

    async def get_status(self) -> Dict[str, Any]:
        """Accounts on this PC + the last switch result, for the QAM panel."""
        if not is_supported():
            return {
                "ok": False,
                "supported": False,
                "error": "Steam account switching is only implemented for Windows",
                "accounts": [],
                "current": None,
                "last": read_state(),
            }
        root = steam_root()
        if root is None:
            return {
                "ok": False,
                "supported": True,
                "error": "no Steam install found for this Windows user",
                "accounts": [],
                "current": None,
                "last": read_state(),
            }
        accounts = read_accounts(root)
        current = current_account(root, accounts)
        return {
            "ok": True,
            "supported": True,
            "steam_root": str(root),
            "accounts": accounts,
            "current": current,
            "last": read_state(),
            "busy": switch_in_progress(),
        }

    async def game_state(self, appid: Any, owner_account_id: Any = None) -> Dict[str, Any]:
        """Per-page decision: is this game borrowed, and which saved account owns it?"""
        try:
            app = int(appid)
        except (TypeError, ValueError):
            return {"ok": False, "supported": is_supported(), "reason": f"bad appid {appid!r}"}
        try:
            owner = int(owner_account_id) if owner_account_id else None
        except (TypeError, ValueError):
            owner = None
        state = game_state(app, owner)
        state["busy"] = switch_in_progress()
        return state

    async def last_result(self) -> Dict[str, Any]:
        state = read_state()
        age = state.get("age")
        if age is not None and age > STATE_TTL:
            state["stale"] = True
        return state

    async def ack_result(self) -> Dict[str, Any]:
        state = read_state()
        if not state:
            return {}
        state.pop("age", None)
        state["consumed"] = True
        write_state(state)
        state["age"] = 0
        return state

    # -- act ---------------------------------------------------------------- #

    async def switch_account(self, account: Any = None) -> Dict[str, Any]:
        """Switch the client to another account Steam remembers here (no game launch).

        Used by the button added to the account settings page: it names the account whose
        persona is on the label, so several remembered accounts each get their own button.
        """
        if switch_in_progress():
            return {"ok": False, "error": "a switch is already in progress", "busy": True}
        if not is_supported():
            return {"ok": False, "error": "Steam account switching is only implemented for Windows"}
        root = steam_root()
        if root is None:
            return {"ok": False, "error": "no Steam install found for this Windows user"}
        accounts = read_accounts(root)
        current = current_account(root, accounts)
        if current is None:
            return {"ok": False, "error": "no Steam account is saved on this PC"}
        wanted = str(account or "").strip()
        if wanted:
            target = next((a for a in accounts if a["account"] == wanted), None)
            if target is None:
                return {"ok": False, "error": f"account {wanted!r} is not saved on this PC"}
        else:
            others = [a for a in accounts if a["id64"] != current["id64"]]
            if len(others) != 1:
                return {
                    "ok": False,
                    "error": "several other accounts are saved here: name the one to use",
                    "accounts": others,
                }
            target = others[0]
        if target["id64"] == current["id64"]:
            return {"ok": False, "error": "already signed in as that account"}
        if not target.get("remember"):
            return {"ok": False, "error": "Steam does not remember that account's password on this PC"}

        spawned = await spawn_helper(target, 0)
        if not spawned.get("ok"):
            return {"ok": False, "error": spawned.get("error")}
        return {"ok": True, "state": "starting", "target": target, "current": current}

    async def switch_and_play(self, appid: Any, owner_account_id: Any = None) -> Dict[str, Any]:
        """Switch Steam to the account that owns `appid`, then launch it there."""
        try:
            app = int(appid)
        except (TypeError, ValueError):
            return {"ok": False, "error": f"bad appid {appid!r}"}
        try:
            owner = int(owner_account_id) if owner_account_id else None
        except (TypeError, ValueError):
            owner = None
        if switch_in_progress():
            return {"ok": False, "error": "a switch is already in progress", "busy": True}

        state = game_state(app, owner)
        target = state.get("target")
        current = state.get("current")
        owner_entry = state.get("owner")
        # already the owning account (or the page asked for the signed-in one): just play
        if current and owner_entry and owner_entry.get("id64") == current.get("id64"):
            return {"ok": True, "state": "launched", "launched": launch_only(app), "target": owner_entry}
        if target and current and target["id64"] == current["id64"]:
            return {"ok": True, "state": "launched", "launched": launch_only(app), "target": target}
        if not state.get("can_switch") or not target:
            return {"ok": False, "error": state.get("reason") or "cannot switch for this game", "state": state}

        spawned = await spawn_helper(target, app)
        if not spawned.get("ok"):
            return {"ok": False, "error": spawned.get("error"), "state": state}
        return {
            "ok": True,
            "state": "starting",
            "target": target,
            "current": current,
            "appid": app,
        }
