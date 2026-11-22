import subprocess
import sys
import time
from pathlib import Path

marker = Path(r"C:\Users\JamesAdams\AppData\Local\Temp\ss-spawn-marker.txt")
script = Path(r"C:\Users\JamesAdams\AppData\Local\Temp\ss-spawn-probe.ps1")
script.write_text(
    "param([string]$Marker)\n"
    "Set-Content -LiteralPath $Marker -Value ('alive ' + $PID + ' ' + (Get-Date -Format o))\n",
    "utf-8",
)
if marker.exists():
    marker.unlink()

argv = [
    r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe",
    "-NoProfile",
    "-NonInteractive",
    "-WindowStyle",
    "Hidden",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    str(script),
    "-Marker",
    str(marker),
]
for flags, label in ((0x00000008, "DETACHED_PROCESS"), (0x08000000, "CREATE_NO_WINDOW"), (0x00000010, "CREATE_NEW_CONSOLE"), (0, "none")):
    if marker.exists():
        marker.unlink()
    try:
        proc = subprocess.Popen(
            argv,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            close_fds=True,
            creationflags=flags,
        )
    except OSError as exc:
        print(f"{label}: spawn failed {exc}")
        continue
    time.sleep(1.5)
    ok = marker.exists()
    print(f"{label}: pid={proc.pid} marker={ok} text={marker.read_text('utf-8').strip() if ok else '-'}")
