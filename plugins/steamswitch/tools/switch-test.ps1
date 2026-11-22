param(
  [Parameter(Mandatory = $true)][string]$Target,
  [int]$AppId = 0,
  [string]$StatusFile = "$env:TEMP\steamswitch-test-status.json",
  [int]$LoginTimeoutSec = 150
)

# Standalone proof of the account-switch + launch sequence, with no plugin involved.
# It does, in order: ask Steam to quit, wait for the process to be gone (Steam rewrites
# loginusers.vdf on exit, so edits must happen afterwards), mark the wanted account as the
# auto-login one, restart Steam, wait for that account to be the active user, then launch
# the app through the steam:// protocol.

$ErrorActionPreference = 'Stop'

function Write-State([string]$state, [string]$message) {
  $payload = [ordered]@{
    time    = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    state   = $state
    message = $message
  }
  ($payload | ConvertTo-Json -Compress) | Set-Content -LiteralPath $StatusFile -Encoding UTF8
  Write-Host ("[{0}] {1}" -f $state, $message)
}

function Get-SteamRoot {
  $root = (Get-ItemProperty 'HKCU:\Software\Valve\Steam' -ErrorAction Stop).SteamPath
  if (-not $root) { throw 'Steam not installed for this user' }
  return ($root -replace '/', '\')
}

function Read-Accounts([string]$vdf) {
  $lines = (Get-Content -LiteralPath $vdf -Raw) -split "`r?`n"
  $accounts = @()
  $current = $null
  foreach ($line in $lines) {
    if ($line -match '^\s*"(\d{17})"\s*$') {
      if ($current) { $accounts += [pscustomobject]$current }
      $current = [ordered]@{ id64 = $Matches[1]; name = $null; autoLogin = $false; persona = $null }
      continue
    }
    if (-not $current) { continue }
    if ($line -match '^\s*"AccountName"\s+"([^"]+)"') { $current.name = $Matches[1] }
    elseif ($line -match '^\s*"PersonaName"\s+"([^"]*)"') { $current.persona = $Matches[1] }
    elseif ($line -match '^\s*"AutoLogin"\s+"1"') { $current.autoLogin = $true }
  }
  if ($current) { $accounts += [pscustomobject]$current }
  return $accounts
}

function Set-AutoLogin([string]$vdf, [string]$target) {
  $lines = (Get-Content -LiteralPath $vdf -Raw) -split "`r?`n"
  $out = New-Object System.Collections.Generic.List[string]
  $account = $null
  $stamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  foreach ($line in $lines) {
    if ($line -match '^\s*"(\d{17})"\s*$') { $account = $null; $out.Add($line); continue }
    if ($line -match '^\s*"AccountName"\s+"([^"]+)"') { $account = $Matches[1]; $out.Add($line); continue }
    if ($line -match '^(\s*)"AutoLogin"\s+"[01]"\s*$') {
      $indent = $Matches[1]
      $value = '0'
      if ($account -eq $target) { $value = '1' }
      $out.Add(($indent + '"AutoLogin"' + "`t`t" + '"' + $value + '"'))
      continue
    }
    if ($line -match '^(\s*)"timestamp"\s+"\d+"\s*$' -and $account -eq $target) {
      $out.Add(($Matches[1] + '"timestamp"' + "`t`t" + '"' + $stamp + '"'))
      continue
    }
    $out.Add($line)
  }
  $text = ($out -join "`r`n")
  [System.IO.File]::WriteAllText($vdf, $text, (New-Object System.Text.UTF8Encoding($false)))
}

Write-State 'start' "target=$Target appid=$AppId"

$root = Get-SteamRoot
$exe = Join-Path $root 'steam.exe'
$vdf = Join-Path $root 'config\loginusers.vdf'
if (-not (Test-Path -LiteralPath $exe)) { throw "steam.exe not found at $exe" }
if (-not (Test-Path -LiteralPath $vdf)) { throw "loginusers.vdf not found at $vdf" }

$accounts = Read-Accounts $vdf
$targetAccount = $accounts | Where-Object { $_.name -eq $Target } | Select-Object -First 1
if (-not $targetAccount) { throw "account '$Target' is not saved on this PC" }
$targetId32 = [uint64]$targetAccount.id64 - [uint64]76561197960265728
Write-State 'accounts' ("saved: " + (($accounts | ForEach-Object { $_.name }) -join ', ') + " targetId32=$targetId32")

Write-State 'shutdown' 'asking Steam to quit'
try { Start-Process -FilePath $exe -ArgumentList '-shutdown' -WorkingDirectory $root | Out-Null } catch { }
$deadline = (Get-Date).AddSeconds(75)
while ((Get-Date) -lt $deadline) {
  if (-not (Get-Process -Name steam -ErrorAction SilentlyContinue)) { break }
  Start-Sleep -Milliseconds 500
}
if (Get-Process -Name steam -ErrorAction SilentlyContinue) {
  Write-State 'killing' 'steam.exe still alive after 75s, forcing it'
  Stop-Process -Name steam -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 3
}
Write-State 'stopped' 'steam.exe is gone'

Set-AutoLogin $vdf $Target
New-ItemProperty -Path 'HKCU:\Software\Valve\Steam' -Name 'AutoLoginUser' -PropertyType String -Value $Target -Force | Out-Null
Write-State 'edited' "AutoLoginUser=$Target written to registry and loginusers.vdf"

Start-Process -FilePath $exe -ArgumentList '-bigpicture' -WorkingDirectory $root | Out-Null
Write-State 'relaunched' 'steam.exe -bigpicture started'

$deadline = (Get-Date).AddSeconds($LoginTimeoutSec)
$loggedIn = $false
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 700
  $active = Get-ItemProperty 'HKCU:\Software\Valve\Steam\ActiveProcess' -ErrorAction SilentlyContinue
  if ($active -and ("{0}" -f $active.ActiveUser) -eq ("{0}" -f $targetId32)) { $loggedIn = $true; break }
  if (-not (Get-Process -Name steam -ErrorAction SilentlyContinue)) { break }
}
if (-not $loggedIn) {
  Write-State 'login-failed' "did not reach account $Target within ${LoginTimeoutSec}s"
  exit 1
}
Write-State 'logged-in' "active user is $Target ($targetId32)"

if ($AppId -gt 0) {
  Start-Sleep -Seconds 2
  Start-Process ("steam://rungameid/$AppId") | Out-Null
  Write-State 'launching' "steam://rungameid/$AppId sent"
}
Write-State 'done' 'sequence complete'
