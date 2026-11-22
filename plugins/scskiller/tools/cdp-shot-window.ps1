# Capture Steam's Big Picture window with PrintWindow (works when the view is occluded).
# Usage: powershell -ExecutionPolicy Bypass -File tools/cdp-shot-window.ps1 <out.png>
param([Parameter(Mandatory = $true)][string]$Out)

$code = @'
using System;
using System.Text;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public class BpmShot {
  public delegate bool EnumProc(IntPtr handle, IntPtr param);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr param);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr handle, StringBuilder text, int size);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr handle);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr handle, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr handle, out RECT rect);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  public static IntPtr Found = IntPtr.Zero;
  public static string Capture(string path) {
    Found = IntPtr.Zero;
    EnumWindows((handle, param) => {
      if (!IsWindowVisible(handle)) return true;
      StringBuilder text = new StringBuilder(512);
      GetWindowText(handle, text, 512);
      if (text.ToString().IndexOf("Big Picture", StringComparison.OrdinalIgnoreCase) >= 0 && Found == IntPtr.Zero) {
        Found = handle;
      }
      return true;
    }, IntPtr.Zero);
    if (Found == IntPtr.Zero) return "window not found";
    RECT rect;
    GetWindowRect(Found, out rect);
    int width = rect.Right - rect.Left;
    int height = rect.Bottom - rect.Top;
    using (Bitmap bitmap = new Bitmap(width, height, PixelFormat.Format32bppArgb)) {
      using (Graphics graphics = Graphics.FromImage(bitmap)) {
        IntPtr hdc = graphics.GetHdc();
        PrintWindow(Found, hdc, 2);
        graphics.ReleaseHdc(hdc);
      }
      bitmap.Save(path, ImageFormat.Png);
    }
    return "saved " + path + " (" + width + "x" + height + ")";
  }
}
'@

Add-Type -TypeDefinition $code -ReferencedAssemblies System.Drawing
[BpmShot]::Capture($Out)
