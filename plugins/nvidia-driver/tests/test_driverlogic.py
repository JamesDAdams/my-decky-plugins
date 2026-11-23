"""Unit tests for the pure helpers (no Decky, no Windows, no network)."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from driverlogic import is_newer, package_url, parse_app_log, pick_recommended, version_tuple


MCP_PAYLOAD = {
    "systemType": "GEFORCE",
    "installedDriver": {"version": "621.01", "channel": "GAME_READY", "availableActions": ["reinstall"]},
    "preferredChannel": "GAME_READY",
    "recommendedDrivers": [
        {
            "name": "GeForce Game Ready Driver",
            "version": "621.24",
            "channel": "GAME_READY",
            "releaseDate": "2026-11-12",
            "isUpdateAvailable": True,
            "availableActions": ["install"],
        }
    ],
    "previouslyInstalledDriver": {"name": "GeForce Game Ready Driver", "version": "617.42"},
}

LOG_TAIL = """
2026-11-23 17:14:06.565 INFO  nvapp/SidebarNotificationBadgeService  reward notification badge enable state true
2026-11-23 17:14:14.329 INFO  nvapp/SidebarNotificationBadgeService  notification db state [
\t"0-621.01",
\t"281979263f734e7ebf86335e4daa481d",
\t"0-621.24"
]
\t"installedDispDriverVersion": "621.24",
\t"latestDispDriverVersion": "621.24"
\t"downloadURL": "https://international-gfe.download.nvidia.com/Windows/621.24/621.24-desktop-win10-win11-64bit-international-dch-whql-g.exe",
"""


class VersionTests(unittest.TestCase):
    def test_tuple(self):
        self.assertEqual(version_tuple("621.24"), (621, 24))
        self.assertEqual(version_tuple(""), (0,))

    def test_newer(self):
        self.assertTrue(is_newer("621.24", "621.01"))
        self.assertFalse(is_newer("621.01", "621.01"))
        self.assertFalse(is_newer("", "621.01"))


class RecommendedTests(unittest.TestCase):
    def test_real_payload(self):
        picked = pick_recommended(MCP_PAYLOAD)
        self.assertIsNotNone(picked)
        self.assertEqual(picked["version"], "621.24")
        self.assertTrue(picked["update"])
        self.assertEqual(picked["release_date"], "2026-11-12")

    def test_same_version_is_not_an_update(self):
        payload = dict(MCP_PAYLOAD)
        payload["recommendedDrivers"] = [dict(MCP_PAYLOAD["recommendedDrivers"][0], version="621.01", isUpdateAvailable=False)]
        self.assertIsNone(pick_recommended(payload))

    def test_empty(self):
        self.assertIsNone(pick_recommended({}))
        self.assertIsNone(pick_recommended({"installedDriver": {"version": "1.0"}, "recommendedDrivers": []}))


class LogTests(unittest.TestCase):
    def test_reads_latest_and_url(self):
        parsed = parse_app_log(LOG_TAIL)
        self.assertEqual(parsed["latest"], "621.24")
        self.assertEqual(parsed["installed"], "621.24")
        self.assertIn("/Windows/621.24/", parsed["url"])

    def test_empty(self):
        self.assertEqual(parse_app_log("")["latest"], "")


class UrlTests(unittest.TestCase):
    def test_package_url(self):
        url = package_url("621.24")
        self.assertIn("/Windows/621.24/", url)
        self.assertTrue(url.endswith("-g.exe"))


if __name__ == "__main__":
    unittest.main()
