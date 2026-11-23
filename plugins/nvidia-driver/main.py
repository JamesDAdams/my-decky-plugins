"""Decky Loader backend for the NVIDIA driver badge.

The NVIDIA App already answers the question this plugin asks: whether a newer driver is
available. Its local MCP server (``http://127.0.0.1:13508/mcp``, started by NvContainer and
announced in ``%LOCALAPPDATA%\\NVIDIA Corporation\\NVIDIA App\\McpServer\\server.json``)
exposes the read-only tool ``nvapp_client_get_driver_status``, whose payload carries the
installed version and the recommended one with ``isUpdateAvailable``. Verified on this
machine: installed 621.01, recommended 621.24, ``isUpdateAvailable: true``.

Two more facts shaped the code:

  * the app offers no install command over that server (its 13 tools are read-only or game
    settings), so the install runs NVIDIA's own package, the exact ``-g.exe`` the app lists
    for that version, with the installer's documented silent switches;
  * a display driver install needs elevation. The backend starts the package through
    ``ShellExecuteW(... "runas" ...)``: Windows shows its own UAC prompt and the plugin
    never asks for a password itself.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path
from typing import Any, Dict, Optional

import decky  # type: ignore

#: Decky loads ``main.py`` by path without adding the plugin folder to ``sys.path`` (measured:
#: ``ModuleNotFoundError: No module named 'driverlogic'`` in the plugin log), so a sibling
#: module has to be reachable before it is imported.
_PLUGIN_DIR = Path(__file__).resolve().parent
if str(_PLUGIN_DIR) not in sys.path:
    sys.path.insert(0, str(_PLUGIN_DIR))

from driverlogic import is_newer, package_url, parse_app_log, pick_recommended, version_tuple  # noqa: E402

PLUGIN_NAME = "NvidiaDriver"
MCP_FALLBACK_URL = "http://127.0.0.1:13508/mcp"
NVIDIA_APP = Path(r"C:\Program Files\NVIDIA Corporation\NVIDIA App\CEF\NVIDIA App.exe")
DOWNLOAD_DIRNAME = "NvidiaDriver"
STATUS_FILE = "install-status.json"
CANCEL_FILE = "install-cancel.flag"
CREATE_NO_WINDOW = 0x08000000
STATE_TTL = 600.0          # the app's picture of "latest" changes once per release, not per minute
INSTALLED_TTL = 60.0       # nvidia-smi is cheap but not free
LIVE_PHASES = ("downloading", "starting", "installing")

_lock = threading.Lock()
_installed_cache: Dict[str, Any] = {"value": "", "gpu": "", "at": 0.0}
_state_cache: Dict[str, Any] = {"value": None, "at": 0.0}
_EMPTY_STATUS: Dict[str, Any] = {
    "phase": "idle",
    "percent": 0.0,
    "version": "",
    "path": "",
    "message": "",
    "error": "",
    "bytes": 0,
    "total": 0,
    "speed": 0.0,
    "started_at": 0.0,
}


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
    except Exception:  # logging must never break a call
        pass
    try:
        print(f"[{PLUGIN_NAME}] {line}")
    except Exception:
        pass


def local_appdata() -> Path:
    value = os.environ.get("LOCALAPPDATA")
    if value:
        return Path(value)
    return Path.home() / "AppData" / "Local"


def app_data_dir() -> Path:
    path = local_appdata() / DOWNLOAD_DIRNAME
    try:
        path.mkdir(parents=True, exist_ok=True)
    except OSError:
        pass
    return path


def nvidia_app_log() -> Path:
    return local_appdata() / "NVIDIA Corporation" / "NVIDIA App" / "console.log"


def system_exe(name: str) -> str:
    root = os.environ.get("SystemRoot", r"C:\Windows")
    candidate = Path(root) / "System32" / name
    return str(candidate) if candidate.is_file() else name


# --------------------------------------------------------------------------- #
# installed driver (nvidia-smi)
# --------------------------------------------------------------------------- #

def nvidia_smi() -> Dict[str, str]:
    """Driver version and GPU name as the driver itself reports them."""
    try:
        completed = subprocess.run(  # noqa: S603 - fixed argv, no shell
            [system_exe("nvidia-smi.exe"), "--query-gpu=driver_version,name", "--format=csv,noheader"],
            capture_output=True,
            text=True,
            timeout=10,
            creationflags=CREATE_NO_WINDOW,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        return {"error": f"nvidia-smi failed: {exc}"}
    first = ""
    for line in (completed.stdout or "").splitlines():
        if line.strip():
            first = line.strip()
            break
    if not first:
        return {"error": "nvidia-smi returned nothing"}
    version, _, name = first.partition(",")
    return {"version": version.strip(), "gpu": name.strip()}


def installed_info(force: bool = False) -> Dict[str, str]:
    with _lock:
        fresh = time.time() - float(_installed_cache["at"] or 0) < INSTALLED_TTL
        if fresh and not force:
            return {"version": str(_installed_cache["value"]), "gpu": str(_installed_cache["gpu"])}
    info = nvidia_smi()
    if info.get("version"):
        with _lock:
            _installed_cache.update({"value": info["version"], "gpu": info.get("gpu", ""), "at": time.time()})
    return {"version": info.get("version", ""), "gpu": info.get("gpu", ""), "error": info.get("error", "")}


# --------------------------------------------------------------------------- #
# the NVIDIA App's MCP status
# --------------------------------------------------------------------------- #

def mcp_url() -> str:
    config = local_appdata() / "NVIDIA Corporation" / "NVIDIA App" / "McpServer" / "server.json"
    try:
        payload = json.loads(config.read_text("utf-8"))
        url = str(payload.get("http") or "")
        if url.startswith("http://127.0.0.1:"):
            return url
    except (OSError, ValueError):
        pass
    return MCP_FALLBACK_URL


def _mcp_post(payload: Dict[str, Any], timeout: float = 6.0) -> Optional[Dict[str, Any]]:
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        mcp_url(),
        data=body,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "Connection": "close",
        },
        method="POST",
    )
    # no proxy for loopback: a proxy configured for this Windows user turns the call into a
    # 503 (measured inside Decky's plugin sandbox), while the same request works directly
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(request, timeout=timeout) as reply:  # noqa: S310 - fixed loopback URL
            raw = reply.read().decode("utf-8", "replace")
            content_type = reply.headers.get("Content-Type", "")
    except Exception as exc:
        raise RuntimeError(f"nvidia app mcp: {exc}") from exc
    if "text/event-stream" in content_type:
        # one SSE frame per reply: keep the last JSON object
        for line in raw.splitlines():
            if line.startswith("data:"):
                raw = line[5:].strip()
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise RuntimeError("nvidia app mcp: unexpected reply")
    if data.get("error"):
        raise RuntimeError(f"nvidia app mcp: {data['error']}")
    return data.get("result") if isinstance(data.get("result"), dict) else None


def mcp_driver_status() -> Dict[str, Any]:
    """The app's own answer: installed driver + recommended drivers for this machine.

    No ``initialize`` handshake: the app's server answers ``tools/call`` statelessly, and every
    handshake it did receive left a session behind - after a dozen checks it started refusing
    all calls with ``503 Too many active sessions`` (measured; a plain tools/call still worked).
    """
    result = _mcp_post(
        {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {"name": "nvapp_client_get_driver_status", "arguments": {}},
        },
        timeout=8.0,
    )
    if not result:
        raise RuntimeError("nvidia app mcp: empty result")
    structured = result.get("structuredContent")
    if isinstance(structured, dict) and structured.get("installedDriver"):
        return structured
    # older server builds only fill the text content: keep the JSON block it printed
    for item in result.get("content") or []:
        text = str((item or {}).get("text") or "")
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            try:
                parsed = json.loads(match.group(0))
                if isinstance(parsed, dict) and parsed.get("installedDriver"):
                    return parsed
            except ValueError:
                continue
    raise RuntimeError("nvidia app mcp: no driver status in the reply")


def log_fallback() -> Dict[str, Any]:
    path = nvidia_app_log()
    try:
        stat = path.stat()
        with path.open("rb") as handle:
            handle.seek(max(0, stat.st_size - 4 * 1024 * 1024))
            text = handle.read().decode("utf-8", "replace")
    except OSError as exc:
        return {"error": f"cannot read the NVIDIA App log: {exc}"}
    parsed = parse_app_log(text)
    parsed["log_at"] = stat.st_mtime
    return parsed


# --------------------------------------------------------------------------- #
# state
# --------------------------------------------------------------------------- #

def status_path() -> Path:
    return app_data_dir() / STATUS_FILE


def cancel_path() -> Path:
    return app_data_dir() / CANCEL_FILE


def read_install_status() -> Dict[str, Any]:
    """The helper's own progress file (written by tools/install.ps1)."""
    try:
        payload = json.loads(status_path().read_text("utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(payload, dict):
        return {}
    phase = str(payload.get("phase") or "")
    try:
        stamp = float(payload.get("time") or 0) / 1000.0
    except (TypeError, ValueError):
        stamp = 0.0
    age = max(0.0, time.time() - stamp) if stamp else None
    if phase in LIVE_PHASES and (age is None or age > 50 * 60):
        payload["phase"] = "timeout"
        payload["message"] = "the installer stopped reporting; check the NVIDIA App"
        payload["error"] = ""
    return payload


def install_snapshot() -> Dict[str, Any]:
    merged = dict(_EMPTY_STATUS)
    merged.update(read_install_status())
    return merged


def _write_status(payload: Dict[str, Any]) -> None:
    merged = dict(_EMPTY_STATUS)
    merged.update(payload)
    merged["time"] = int(time.time() * 1000)
    try:
        status_path().write_text(json.dumps(merged, sort_keys=True), "utf-8")
    except OSError as exc:
        log("cannot write install status:", exc)


def powershell_exe() -> str:
    found = shutil.which("powershell.exe")
    if found:
        return found
    root = (
        Path(os.environ.get("SystemRoot", r"C:\Windows"))
        / "System32"
        / "WindowsPowerShell"
        / "v1.0"
        / "powershell.exe"
    )
    return str(root) if root.is_file() else ""


def get_state(force: bool = False) -> Dict[str, Any]:
    """Everything the panel and the badge need, plus where each fact came from."""
    now = time.time()
    status = read_install_status()
    if str(status.get("phase") or "") == "done":
        # the driver changed: never answer from a cache built before the installer finished
        try:
            stamp = float(status.get("time") or 0) / 1000.0
        except (TypeError, ValueError):
            stamp = 0.0
        if stamp and stamp > float(_state_cache["at"] or 0):
            force = True
    with _lock:
        cached = _state_cache["value"]
        if cached is not None and not force and now - float(_state_cache["at"] or 0) < STATE_TTL:
            state = dict(cached)
            state["install"] = install_snapshot()
            return state

    installed = installed_info(force=force)
    state: Dict[str, Any] = {
        "ok": True,
        "gpu": installed.get("gpu", ""),
        "installed": installed.get("version", ""),
        "latest": "",
        "update": False,
        "name": "",
        "release_date": "",
        "channel": "",
        "source": "none",
        "checked_at": now,
        "error": installed.get("error", ""),
        "install": install_snapshot(),
    }

    try:
        payload = mcp_driver_status()
        recommended = pick_recommended(payload)
        state["source"] = "nvidia-app"
        state["system"] = str(payload.get("systemType") or "")
        state["channel"] = str(payload.get("preferredChannel") or "")
        if recommended:
            state["latest"] = recommended["version"]
            state["name"] = recommended["name"]
            state["release_date"] = recommended["release_date"]
            state["update"] = bool(recommended["update"])
            if not state["installed"]:
                state["installed"] = str(((payload.get("installedDriver") or {}).get("version")) or "")
    except Exception as exc:
        state["mcp_error"] = str(exc)
        fallback = log_fallback()
        if fallback.get("latest"):
            state["source"] = "nvidia-app-log"
            state["latest"] = str(fallback.get("latest"))
            state["installed"] = state["installed"] or str(fallback.get("installed") or "")
            state["update"] = is_newer(state["latest"], state["installed"])
            state["url"] = str(fallback.get("url") or "")
            state["checked_at"] = float(fallback.get("log_at") or now)
            state["name"] = "GeForce driver"
        else:
            state["source"] = "none"
            state["error"] = state["error"] or str(exc)

    if state["source"] == "nvidia-app" and state["latest"] and state["installed"]:
        # the installed driver is the truth: once nvidia-smi reports the recommended version the
        # badge has to disappear even if the app still flags the release as an update
        state["update"] = is_newer(state["latest"], state["installed"])
    with _lock:
        _state_cache.update({"value": dict(state), "at": now})
    state["install"] = install_snapshot()
    return state


# --------------------------------------------------------------------------- #
# install
# --------------------------------------------------------------------------- #

def _download_url(version: str) -> str:
    fallback = log_fallback()
    if str(fallback.get("latest") or "") == version and fallback.get("url"):
        return str(fallback["url"])
    return package_url(version)


def start_install(state: Dict[str, Any]) -> Dict[str, Any]:
    """Hand the download + install to tools/install.ps1 and return at once.

    The work runs in its own process on purpose: a background thread inside Decky's plugin
    sandbox wedged the sandbox (the panel stopped answering), while this helper keeps the
    panel responsive and survives a plugin reload or a Steam restart.
    """
    script = _PLUGIN_DIR / "tools" / "install.ps1"
    if not script.is_file():
        return {"ok": False, "error": f"installer helper missing: {script}"}
    shell = powershell_exe()
    if not shell:
        return {"ok": False, "error": "PowerShell is not available"}
    version = str(state.get("latest") or "")
    url = _download_url(version)
    cancel_path().unlink(missing_ok=True)
    _write_status(
        {
            "phase": "starting",
            "percent": 0.0,
            "version": version,
            "path": str(app_data_dir() / f"{version}-nvidia-driver-g.exe"),
            "message": f"Preparing {version}",
        }
    )
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
        "-Version",
        version,
        "-Url",
        url,
        "-Dir",
        str(app_data_dir()),
        "-Status",
        str(status_path()),
        "-Cancel",
        str(cancel_path()),
        "-InstalledBefore",
        str(state.get("installed") or ""),
    ]
    try:
        subprocess.Popen(  # noqa: S603 - fixed argv, no shell
            argv,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            close_fds=True,
            cwd=str(_PLUGIN_DIR),
            creationflags=CREATE_NO_WINDOW,
        )
    except OSError as exc:
        _write_status({"phase": "error", "error": f"cannot start the installer: {exc}"})
        return {"ok": False, "error": f"cannot start the installer: {exc}"}
    log("install started:", version, "from", url)
    return {"ok": True, "version": version, "install": install_snapshot()}


# --------------------------------------------------------------------------- #
# plugin
# --------------------------------------------------------------------------- #

class Plugin:
    async def _main(self) -> None:
        # Keep _main trivial: measured on this loader, doing the nvidia-smi + MCP probe inside
        # _main left the sandbox unable to answer later calls (the panel then hung), while the
        # same probe run from a normal method returns in ~200 ms. The frontend asks for the
        # state as soon as its panel/badge loads, so nothing is lost.
        log("plugin loaded; NVIDIA App:", str(NVIDIA_APP))

    async def _unload(self) -> None:
        log("plugin unloaded")

    async def _uninstall(self) -> None:
        pass

    async def report(self, message: Any) -> None:
        log("frontend:", str(message)[:2000])

    async def get_state(self, force: bool = False) -> Dict[str, Any]:
        return get_state(force=bool(force))

    async def install(self) -> Dict[str, Any]:
        status = install_snapshot()
        if str(status.get("phase") or "") in LIVE_PHASES:
            return {"ok": False, "error": "an install is already running", "install": status}
        state = get_state(force=True)
        if not state.get("update") or not state.get("latest"):
            return {
                "ok": False,
                "error": state.get("error") or "no newer driver is available",
                "state": state,
            }
        return start_install(state)

    async def cancel_install(self) -> Dict[str, Any]:
        try:
            cancel_path().write_text("cancel", "utf-8")
        except OSError as exc:
            return {"ok": False, "error": str(exc)}
        return {"ok": True, "install": install_snapshot()}

    async def open_nvidia_app(self) -> Dict[str, Any]:
        app = NVIDIA_APP
        if not app.is_file():
            return {"ok": False, "error": f"NVIDIA App not found at {app}"}
        try:
            subprocess.Popen(  # noqa: S603 - fixed path, no shell
                [str(app)],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                close_fds=True,
            )
            return {"ok": True}
        except OSError as exc:
            return {"ok": False, "error": str(exc)}
