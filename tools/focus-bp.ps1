# Bring Steam Big Picture to the foreground.
#
# Steam's navigation manager only has an active context (m_ActiveContext) while its window is
# focused: with the window behind another app, every nav probe answers "nothing" and a gamepad
# press is swallowed. Run this before pad-sim.mjs / nav-audit.mjs.
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class BpFocus {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr extra);
  public delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr extra);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int max);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int cmd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
}
"@

$found = $null
$callback = [BpFocus+EnumWindowsProc]{
  param($hwnd, $extra)
  if (-not [BpFocus]::IsWindowVisible($hwnd)) { return $true }
  $text = New-Object System.Text.StringBuilder 512
  [void][BpFocus]::GetWindowText($hwnd, $text, 512)
  if ($text.ToString() -eq "Steam Big Picture Mode") {
    $script:found = $hwnd
    return $false
  }
  return $true
}
[void][BpFocus]::EnumWindows($callback, [IntPtr]::Zero)

if (-not $found) {
  Write-Output "no Steam Big Picture Mode window"
  exit 1
}
[void][BpFocus]::ShowWindow($found, 9)   # SW_RESTORE
[void][BpFocus]::SetForegroundWindow($found)
Start-Sleep -Milliseconds 400
Write-Output "focused Steam Big Picture Mode"
