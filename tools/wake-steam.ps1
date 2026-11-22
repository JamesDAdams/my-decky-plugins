# Wake Steam's screensaver.
#
# Steam opens a `Screensaver_uid2` CEF target when Big Picture goes idle. While it is up the
# navigation manager swallows every gamepad press (measured 2026-11-22: `pad-sim.mjs` reported the
# same focused element for six presses in a row, and a desktop capture was black) and it comes back
# after a couple of idle minutes, so wake it right before a walk.
#
# The virtual gamepad dispatch does NOT wake it: it needs a real OS input event. A lone Shift press
# sometimes was not enough, so this moves the mouse across the screen and clicks once on the
# screensaver overlay (which is full screen: the click only dismisses it).
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Wake {
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public int mouseData; public int dwFlags; public int time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public int dwFlags; public int time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] public struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public int type; public INPUTUNION u; }
  [DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder t, int max);
  public struct POINT { public int X; public int Y; }
}
"@

function Send-Key([int]$vk) {
  $input = New-Object Wake+INPUT
  $input.type = 1
  $input.u.ki.wVk = $vk
  [void][Wake]::SendInput(1, @($input), [System.Runtime.InteropServices.Marshal]::SizeOf($input))
  $up = $input
  $up.u.ki.dwFlags = 2
  [void][Wake]::SendInput(1, @($up), [System.Runtime.InteropServices.Marshal]::SizeOf($up))
}

function Send-Click {
  $down = New-Object Wake+INPUT
  $down.type = 0
  $down.u.mi.dwFlags = 0x02    # MOUSEEVENTF_LEFTDOWN
  [void][Wake]::SendInput(1, @($down), [System.Runtime.InteropServices.Marshal]::SizeOf($down))
  Start-Sleep -Milliseconds 80
  $up = New-Object Wake+INPUT
  $up.type = 0
  $up.u.mi.dwFlags = 0x04      # MOUSEEVENTF_LEFTUP
  [void][Wake]::SendInput(1, @($up), [System.Runtime.InteropServices.Marshal]::SizeOf($up))
}

$titles = {
  (Invoke-WebRequest "http://localhost:8080/json" -UseBasicParsing -TimeoutSec 5).Content | ConvertFrom-Json | ForEach-Object { $_.title }
}

for ($round = 1; $round -le 3; $round++) {
  if (-not (& $titles | Where-Object { $_ -like "Screensaver*" })) {
    "screensaver gone after $($round - 1) attempt(s)"
    if (& $titles | Where-Object { $_ -eq "Steam Big Picture Mode" }) {
      Add-Type -AssemblyName System.Windows.Forms | Out-Null
    }
    break
  }
  $point = New-Object Wake+POINT
  if ([Wake]::GetCursorPos([ref]$point)) {
    [void][Wake]::SetCursorPos($point.X + 40, $point.Y + 40)
    Start-Sleep -Milliseconds 100
    [void][Wake]::SetCursorPos($point.X, $point.Y)
  }
  Start-Sleep -Milliseconds 150
  Send-Click
  Start-Sleep -Milliseconds 150
  Send-Key 0x10   # Shift
  Start-Sleep -Milliseconds 300
  if (& $titles | Where-Object { $_ -like "Screensaver*" }) {
    Send-Key 0x1B  # Escape
    Start-Sleep -Milliseconds 300
  }
}
$foreground = New-Object System.Text.StringBuilder 256
[void][Wake]::GetWindowText([Wake]::GetForegroundWindow(), $foreground, 256)
"foreground: $($foreground.ToString())"
