# Wake Steam's screensaver.
#
# Steam opens a `Screensaver_uid2` CEF target when Big Picture goes idle. While it is up the
# navigation manager swallows every gamepad press (measured 2026-11-22: `pad-sim.mjs` reported the
# same focused element for six presses in a row, and a desktop capture was black). It closes on a
# real OS input event, which the virtual gamepad dispatch is not.
#
# The keys sent are harmless: a lone Shift press, then a mouse move of one pixel and back.
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Wake {
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public int type; public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public int dwFlags; public int time; public IntPtr dwExtraInfo; }
  [DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
}
"@

function Send-Key($vk) {
  $input = New-Object Wake+INPUT
  $input.type = 1
  $input.ki.wVk = $vk
  $input.ki.wScan = 0
  $input.ki.dwFlags = 0
  $input.ki.time = 0
  $input.ki.dwExtraInfo = [IntPtr]::Zero
  $down = $input
  $up = $input
  $up.ki.dwFlags = 2
  [void][Wake]::SendInput(1, @($down), [System.Runtime.InteropServices.Marshal]::SizeOf($down))
  Start-Sleep -Milliseconds 60
  [void][Wake]::SendInput(1, @($up), [System.Runtime.InteropServices.Marshal]::SizeOf($up))
}

$point = $null
Add-Type -AssemblyName System.Windows.Forms
[void][Wake]::SetCursorPos(900, 500)
Start-Sleep -Milliseconds 80
Send-Key 0x10   # Shift: no action in Big Picture, but enough to wake it
Start-Sleep -Milliseconds 400

$targets = (Invoke-WebRequest "http://localhost:8080/json" -UseBasicParsing -TimeoutSec 5).Content | ConvertFrom-Json
$screensaver = $targets | Where-Object { $_.title -like "Screensaver*" }
if ($screensaver) { "screensaver still up" } else { "screensaver gone" }
