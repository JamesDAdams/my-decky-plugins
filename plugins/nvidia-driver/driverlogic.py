"""Pure helpers for the NVIDIA driver badge plugin.

Kept out of ``main.py`` on purpose: the tests in ``tests/`` import this module without
Decky being present, so a CI run never needs the loader.

Nothing here talks to the network or to Windows; every input is a string or a dict.
"""

from __future__ import annotations

import re
from typing import Any, Dict, Iterable, Optional

#: NVIDIA's public GFE package URL, keyed by driver version (the file the app downloads).
PACKAGE_URL = (
    "https://international-gfe.download.nvidia.com/Windows/{version}/"
    "{version}-desktop-win10-win11-64bit-international-dch-whql-g.exe"
)

_LATEST_RE = re.compile(r'"latestDispDriverVersion"\s*:\s*"(\d+(?:\.\d+)+)"')
_INSTALLED_RE = re.compile(r'"installedDispDriverVersion"\s*:\s*"(\d+(?:\.\d+)+)"')
_URL_RE = re.compile(
    r'"downloadURL"\s*:\s*"(https://[^"]+/Windows/(\d+(?:\.\d+)+)/[^"]+\.exe)"', re.IGNORECASE
)
_NOTIF_RE = re.compile(r'"0-(\d+(?:\.\d+)+)"')


def version_tuple(version: Any) -> tuple:
    """``"621.24"`` -> ``(621, 24)``; anything unparsable sorts lowest."""
    parts = re.findall(r"\d+", str(version or ""))
    if not parts:
        return (0,)
    return tuple(int(part) for part in parts[:4])


def is_newer(latest: Any, installed: Any) -> bool:
    """True only when both versions parse and ``latest`` is strictly greater."""
    if not latest or not installed:
        return False
    return version_tuple(latest) > version_tuple(installed)


def package_url(version: str) -> str:
    return PACKAGE_URL.format(version=str(version))


def pick_recommended(payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """The driver the NVIDIA app recommends for this machine, from its own status payload.

    Preference order: the channel the user picked, an entry flagged as an update, then the
    first recommendation. ``installedDriver`` is never used as the recommendation.
    """
    if not isinstance(payload, dict):
        return None
    installed = str(((payload.get("installedDriver") or {}).get("version")) or "")
    preferred = str(payload.get("preferredChannel") or "")
    drivers = [item for item in (payload.get("recommendedDrivers") or []) if isinstance(item, dict)]
    if not drivers:
        return None

    def rank(item: Dict[str, Any]) -> tuple:
        same_channel = 1 if preferred and item.get("channel") == preferred else 0
        update = 1 if item.get("isUpdateAvailable") else 0
        return (same_channel, update)

    ordered = sorted(drivers, key=rank, reverse=True)
    chosen = ordered[0]
    version = str(chosen.get("version") or "")
    if not version or version == installed:
        return None
    return {
        "version": version,
        "name": str(chosen.get("name") or ""),
        "channel": str(chosen.get("channel") or ""),
        "release_date": str(chosen.get("releaseDate") or ""),
        "update": bool(chosen.get("isUpdateAvailable")) or is_newer(version, installed),
    }


def parse_app_log(text: str) -> Dict[str, Any]:
    """Latest driver facts from the NVIDIA App's own ``console.log`` tail.

    Used when the app is closed (the MCP server only exists while it runs). The log is the
    same source the app's sidebar badge reads: ``latestDispDriverVersion`` of the driver
    details it fetched, and the ``notification db state`` lines it compares.
    """
    result: Dict[str, Any] = {"installed": "", "latest": "", "url": "", "notified": []}
    if not text:
        return result

    installed_matches = _INSTALLED_RE.findall(text)
    if installed_matches:
        result["installed"] = installed_matches[-1]

    latest_matches = _LATEST_RE.findall(text)
    candidates = list(latest_matches)

    notified = _NOTIF_RE.findall(text)
    if notified:
        # the block is ["0-<installed>", "<hash>", "0-<latest>"]; keep every version seen
        result["notified"] = notified[-4:]
        candidates.extend(notified)

    if candidates:
        best = max(candidates, key=version_tuple)
        result["latest"] = best
        installed = result["installed"] or (notified[0] if notified else "")
        result["installed"] = installed

    for url, version in _URL_RE.findall(text):
        if version == result["latest"]:
            result["url"] = url
    return result


def dedupe_urls(urls: Iterable[str]) -> list:
    seen = []
    for url in urls:
        if url and url not in seen:
            seen.append(url)
    return seen
