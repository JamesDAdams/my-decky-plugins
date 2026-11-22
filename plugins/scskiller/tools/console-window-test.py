"""Does spawning the CLI create a visible console window?

On Windows 10+ the console window belongs to `conhost.exe`, not to the child process, so the
count is global: every top-level window of class `ConsoleWindowClass` that is visible. The
plugin's backend runs without a console (Decky's loader), so a bare console child gets a new
window -> that is the black flash.

Run it with ``pythonw.exe`` so this process has no console either.
"""
import ctypes
import ctypes.wintypes as wintypes
import io
import contextlib
import pathlib
import runpy
import subprocess
import sys
import time
from pathlib import Path

CREATE_NO_WINDOW = 0x08000000
CREATE_NEW_PROCESS_GROUP = 0x00000200
CLI = Path.home() / "AppData/Local/SCSKiller.App/current/cli/scskiller.exe"
LONG = ["cmd.exe", "/c", "ping", "-n", "3", "127.0.0.1"]

user32 = ctypes.windll.user32


def console_window_count():
    count = [0]

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def callback(hwnd, _lparam):
        if not user32.IsWindowVisible(hwnd):
            return True
        name = ctypes.create_unicode_buffer(64)
        user32.GetClassNameW(hwnd, name, 64)
        if name.value == "ConsoleWindowClass":
            count[0] += 1
        return True

    user32.EnumWindows(callback, 0)
    return count[0]


def benchmark(label, command, kwargs):
    baseline = console_window_count()
    startup = subprocess.STARTUPINFO()
    startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    startup.wShowWindow = subprocess.SW_HIDE
    extra = dict(kwargs)
    if extra.get("startupinfo") == "hide":
        extra["startupinfo"] = startup
    process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **extra)
    peak = baseline
    deadline = time.time() + 6.0
    while time.time() < deadline and process.poll() is None:
        peak = max(peak, console_window_count())
        time.sleep(0.02)
    process.wait(timeout=20)
    print(f"{label}: extra console windows = {peak - baseline} (exit {process.returncode})")
    return peak - baseline


if __name__ == "__main__":
    command = [str(CLI), "status", "--json"] if "--cli" in sys.argv else LONG
    if "--cli" in sys.argv and not CLI.is_file():
        sys.exit(f"CLI not found: {CLI}")
    bare = benchmark("bare spawn   ", command, {})
    hidden = benchmark(
        "plugin flags ",
        command,
        {"creationflags": CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW, "startupinfo": "hide"},
    )
    print("VERDICT:", "flags hide the window" if hidden == 0 else "flags DO NOT hide it")
    if bare == 0:
        print("(the bare spawn showed no window here: this shell had a console to inherit)")
