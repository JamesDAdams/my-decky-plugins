import decky


class Plugin:
    """Backend of the "DeckyShortcut" plugin.

    The plugin is almost entirely frontend (it draws a pill in Big Picture and
    listens for input). This backend owns the lifecycle, logs, and receives the
    frontend's diagnostic lines so support can be done from files instead of
    guessing:

        Windows: %USERPROFILE%\\homebrew\\logs\\decky-qam-shortcut\\*.log
        SteamOS: /home/deck/homebrew/logs/decky-qam-shortcut/*.log
    """

    async def report(self, message: str) -> None:
        """Called from the frontend (src/report.ts) for its diagnostic lines."""
        decky.logger.info("frontend: %s", message)

    async def _main(self):
        decky.logger.info("DeckyShortcut backend loaded")

    async def _unload(self):
        decky.logger.info("DeckyShortcut backend unloaded")

    async def _uninstall(self):
        decky.logger.info("DeckyShortcut backend uninstalled")

    async def _migration(self):
        pass
