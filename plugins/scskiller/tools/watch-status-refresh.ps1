# Watch the SCSKiller CLI around the moment a compile ends: proves the frontend asks for a
# fresh status when the done event arrives.
#   powershell -File tools/watch-status-refresh.ps1 -KillAfter 6 -Seconds 22
param([int]$KillAfter = 6, [int]$Seconds = 22)

$first = New-Object 'System.Collections.Generic.Dictionary[string,double]'
$killed = New-Object System.Collections.Generic.List[string]
$start = Get-Date
$deadline = $start.AddSeconds($Seconds)
$killAt = $start.AddSeconds($KillAfter)

while ((Get-Date) -lt $deadline) {
    $elapsed = ((Get-Date) - $start).TotalSeconds
    foreach ($proc in Get-CimInstance Win32_Process -Filter "Name = 'scskiller.exe'") {
        $line = $proc.CommandLine
        if ($line -notmatch 'cli\\scskiller\.exe') { continue }
        if (-not $first.ContainsKey($line)) {
            $first[$line] = [math]::Round($elapsed, 1)
        }
        if ($elapsed -gt $KillAfter -and $line -match ' compile ') {
            try {
                Stop-Process -Id $proc.ProcessId -Force -ErrorAction Stop
                $killed.Add([math]::Round($elapsed, 1))
            } catch { }
        }
    }
    Start-Sleep -Milliseconds 120
}

"== cli invocations (first seen) =="
$first.GetEnumerator() | Sort-Object Value | ForEach-Object { "{0,6} s  {1}" -f $_.Value, $_.Key }
"== compile killed at =="
($killed -join ", ") + " s"
