param(
    [Parameter(Mandatory = $true)][string]$Version,
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $true)][string]$Dir,
    [Parameter(Mandatory = $true)][string]$Status,
    [Parameter(Mandatory = $true)][string]$Cancel,
    [string]$InstalledBefore = ""
)

# Downloads the NVIDIA package the NVIDIA App recommends and starts it with the installer's
# silent switches. Runs detached from Decky's plugin process: the plugin sandbox wedges when a
# background thread drives a subprocess/HTTP download (measured 2026-11-23), while a separate
# process keeps the panel responsive and survives a Steam restart.
#
# Every step is written to $Status as JSON; the plugin only reads that file.

$ErrorActionPreference = "Stop"
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12

function Write-Status {
    param([string]$Phase, [double]$Percent, [long]$Total, [long]$Bytes, [string]$Message, [string]$ErrorText)
    $payload = [ordered]@{
        phase     = $Phase
        percent   = [math]::Round([double]$Percent, 1)
        total     = $Total
        bytes     = $Bytes
        message   = $Message
        error     = $ErrorText
        time      = [int64]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
    }
    $json = $payload | ConvertTo-Json -Compress
    [System.IO.File]::WriteAllText($Status, $json, (New-Object System.Text.UTF8Encoding($false)))
}

function Get-DriverVersion {
    try {
        $line = (& "$env:SystemRoot\System32\nvidia-smi.exe" --query-gpu=driver_version --format=csv,noheader 2>$null | Select-Object -First 1)
        return ([string]$line).Trim()
    } catch {
        return ""
    }
}

try {
    if (-not (Test-Path -LiteralPath $Dir)) { New-Item -ItemType Directory -Path $Dir -Force | Out-Null }
    $target = Join-Path $Dir ("{0}-nvidia-driver-g.exe" -f $Version)
    $part = "$target.part"
    if (Test-Path -LiteralPath $Cancel) { Remove-Item -LiteralPath $Cancel -Force -ErrorAction SilentlyContinue }

    Write-Status -Phase "downloading" -Percent 0 -Total 0 -Bytes 0 -Message ("Downloading " + $Version) -ErrorText ""

    Add-Type -AssemblyName System.Net.Http
    $handler = New-Object System.Net.Http.HttpClientHandler
    $handler.AllowAutoRedirect = $true
    $client = New-Object System.Net.Http.HttpClient($handler)
    $client.Timeout = [TimeSpan]::FromHours(2)
    $request = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Get, $Url)
    [void]$request.Headers.TryAddWithoutValidation("User-Agent", "NVIDIA App/11.0.9.585")
    $response = $client.SendAsync($request, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
    if (-not $response.IsSuccessStatusCode) {
        Write-Status -Phase "error" -Percent 0 -Total 0 -Bytes 0 -Message "" -ErrorText ("download refused: HTTP " + [int]$response.StatusCode)
        exit 1
    }
    $total = 0
    if ($response.Content.Headers.ContentLength) { $total = [long]$response.Content.Headers.ContentLength }
    $stream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
    $file = [System.IO.File]::Create($part)
    $buffer = New-Object byte[] (1024 * 1024)
    $received = [long]0
    $last = Get-Date
    while ($true) {
        $read = $stream.Read($buffer, 0, $buffer.Length)
        if ($read -le 0) { break }
        $file.Write($buffer, 0, $read)
        $received += $read
        if (Test-Path -LiteralPath $Cancel) {
            $file.Close(); $stream.Dispose(); $client.Dispose()
            Remove-Item -LiteralPath $part -Force -ErrorAction SilentlyContinue
            Write-Status -Phase "cancelled" -Percent 0 -Total $total -Bytes $received -Message "Download cancelled" -ErrorText ""
            exit 0
        }
        if (((Get-Date) - $last).TotalMilliseconds -ge 700) {
            $percent = 0
            if ($total -gt 0) { $percent = ($received * 100.0) / $total }
            Write-Status -Phase "downloading" -Percent $percent -Total $total -Bytes $received -Message ("Downloading " + $Version) -ErrorText ""
            $last = Get-Date
        }
    }
    $file.Close(); $stream.Dispose(); $client.Dispose()
    if (Test-Path -LiteralPath $part) { Move-Item -LiteralPath $part -Destination $target -Force }

    Write-Status -Phase "starting" -Percent 100 -Total $total -Bytes $received -Message "Starting NVIDIA's installer" -ErrorText ""
    $before = Get-DriverVersion
    if (-not $before) { $before = $InstalledBefore }
    try {
        Start-Process -FilePath $target -ArgumentList "-s -noreboot" -Verb RunAs -PassThru | Out-Null
    } catch {
        Write-Status -Phase "error" -Percent 100 -Total $total -Bytes $received -Message "" -ErrorText ("elevation refused: " + $_.Exception.Message)
        exit 1
    }

    Write-Status -Phase "installing" -Percent 100 -Total $total -Bytes $received -Message "Installing - the screen may go black for a minute" -ErrorText ""
    $deadline = (Get-Date).AddMinutes(45)
    $seenSetup = $false
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 5
        $running = [bool](Get-Process -Name "setup" -ErrorAction SilentlyContinue)
        $seenSetup = $seenSetup -or $running
        $now = Get-DriverVersion
        if ($now -and $before -and $now -ne $before) {
            Write-Status -Phase "done" -Percent 100 -Total $total -Bytes $received -Message ("Driver " + $now + " installed") -ErrorText ""
            Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue
            exit 0
        }
        if ($seenSetup -and -not $running) {
            Start-Sleep -Seconds 4
            $now = Get-DriverVersion
            if ($now -and $before -and $now -ne $before) {
                Write-Status -Phase "done" -Percent 100 -Total $total -Bytes $received -Message ("Driver " + $now + " installed") -ErrorText ""
            } else {
                Write-Status -Phase "done" -Percent 100 -Total $total -Bytes $received -Message "Installer finished - restart Windows to finish the update" -ErrorText ""
            }
            Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue
            exit 0
        }
    }
    Write-Status -Phase "timeout" -Percent 100 -Total $total -Bytes $received -Message "Installer still running - check the NVIDIA App" -ErrorText ""
} catch {
    try { Write-Status -Phase "error" -Percent 0 -Total 0 -Bytes 0 -Message "" -ErrorText ([string]$_.Exception.Message) } catch { }
    exit 1
}
