param(
  [Parameter(Mandatory = $true)][string]$SteamRoot,
  [Parameter(Mandatory = $true)][string]$TargetAccount,
  [int]$AppId = 0,
  [Parameter(Mandatory = $true)][string]$StatusFile,
  [int]$TimeoutSec = 180,
  # Reads the install and rewrites nothing: prints the loginusers.vdf lines it would change.
  [switch]$DryRun
)

# Account switch helper for the Steam Switch Decky plugin.
#
# Steam rewrites config/loginusers.vdf when the client exits, so the wanted account can only
# be written there once steam.exe is gone; the client then has to be started again and the
# game launched on the new account. main.py starts this script detached, because the plugin's
# own process (and the client it lives in) does not survive that restart.
#
# The script only ever moves data around: it reads the accounts Steam already remembers, marks
# one of them as the auto-login account, and never touches a password or a credential file.

$ErrorActionPreference = 'Stop'

$script:LogFile = Join-Path (Split-Path -Parent $StatusFile) 'switch-helper.log'

function Write-Log([string]$text) {
  try {
    $line = ('{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $text)
    [System.IO.File]::AppendAllText($script:LogFile, $line + "`r`n", (New-Object System.Text.UTF8Encoding($false)))
  } catch { }
}

function Write-State([string]$state, [string]$message) {
  $payload = [ordered]@{
    state          = $state
    message        = $message
    appid          = $AppId
    target         = $TargetAccount
    time           = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    consumed       = $false
    pid            = $PID
  }
  $json = ($payload | ConvertTo-Json -Compress)
  $temp = $StatusFile + '.tmp'
  try {
    [System.IO.File]::WriteAllText($temp, $json, (New-Object System.Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $temp -Destination $StatusFile -Force
  } catch {
    Write-Log ("cannot write status: {0}" -f $_)
  }
  Write-Log ("[{0}] {1}" -f $state, $message)
}

function Read-Accounts([string]$vdf) {
  $lines = (Get-Content -LiteralPath $vdf -Raw) -split "`r?`n"
  $accounts = @()
  $current = $null
  foreach ($line in $lines) {
    if ($line -match '^\s*"(\d{17})"\s*$') {
      if ($current) { $accounts += [pscustomobject]$current }
      $current = [ordered]@{ id64 = $Matches[1]; account = $null; persona = $null; auto = $false; remember = $false }
      continue
    }
    if (-not $current) { continue }
    if ($line -match '^\s*"AccountName"\s+"([^"]*)"') { $current.account = $Matches[1] }
    elseif ($line -match '^\s*"PersonaName"\s+"([^"]*)"') { $current.persona = $Matches[1] }
    elseif ($line -match '^\s*"AutoLogin"\s+"1"') { $current.auto = $true }
    elseif ($line -match '^\s*"RememberPassword"\s+"1"') { $current.remember = $true }
  }
  if ($current) { $accounts += [pscustomobject]$current }
  return $accounts
}

function Set-AutoLogin([string]$vdf, [string]$target, [switch]$WhatIfOnly) {
  $lines = (Get-Content -LiteralPath $vdf -Raw) -split "`r?`n"
  $out = New-Object System.Collections.Generic.List[string]
  $account = $null
  $inBlock = $false
  $seenFlag = $false
  $stamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  foreach ($line in $lines) {
    if ($line -match '^\s*"(\d{17})"\s*$') {
      $account = $null; $inBlock = $false; $seenFlag = $false; $out.Add($line); continue
    }
    if ($line -match '^\s*\{\s*$') { $inBlock = $true; $out.Add($line); continue }
    if ($line -match '^\s*\}\s*$') {
      # accounts whose entry has no auto-login key at all (older Steam builds) get one
      if ($inBlock -and $account -eq $target -and -not $seenFlag) {
        $out.Add("`t`t" + '"AutoLogin"' + "`t`t" + '"1"')
        $seenFlag = $true
      }
      $inBlock = $false
      $out.Add($line)
      continue
    }
    if ($line -match '^\s*"AccountName"\s+"([^"]*)"') { $account = $Matches[1]; $out.Add($line); continue }
    # current Steam writes "AutoLogin", older builds "AllowAutoLogin": keep the key that is there
    if ($line -match '^(\s*)"(AutoLogin|AllowAutoLogin)"\s+"[01]"\s*$') {
      $key = $Matches[2]
      $value = '0'
      if ($account -eq $target) { $value = '1'; $seenFlag = $true }
      $out.Add(($Matches[1] + '"' + $key + '"' + "`t`t" + '"' + $value + '"'))
      continue
    }
    if ($line -match '^(\s*)"timestamp"\s+"\d+"\s*$' -and $account -eq $target) {
      $out.Add(($Matches[1] + '"timestamp"' + "`t`t" + '"' + $stamp + '"'))
      continue
    }
    $out.Add($line)
  }
  $text = ($out -join "`r`n")
  if ($WhatIfOnly) { return $text }
  [System.IO.File]::WriteAllText($vdf, $text, (New-Object System.Text.UTF8Encoding($false)))
  return $text
}

function Wait-SteamExit([int]$timeoutSec) {
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while ((Get-Date) -lt $deadline) {
    if (-not (Get-Process -Name steam -ErrorAction SilentlyContinue)) { return $true }
    Start-Sleep -Milliseconds 400
  }
  return (-not (Get-Process -Name steam -ErrorAction SilentlyContinue))
}

try {
  Write-State 'starting' "target=$TargetAccount appid=$AppId root=$SteamRoot"

  $exe = Join-Path $SteamRoot 'steam.exe'
  $vdf = Join-Path $SteamRoot 'config\loginusers.vdf'
  if (-not (Test-Path -LiteralPath $vdf)) { throw "loginusers.vdf not found at $vdf" }

  $accounts = Read-Accounts $vdf
  $account = $accounts | Where-Object { $_.account -eq $TargetAccount } | Select-Object -First 1
  if (-not $account) { throw "account '$TargetAccount' is not remembered on this PC" }
  if (-not $account.remember) { throw "Steam does not remember '$TargetAccount' on this PC (no automatic sign-in)" }
  $targetId32 = [uint64]$account.id64 - [uint64]76561197960265728
  Write-Log ("accounts: " + (($accounts | ForEach-Object { $_.account }) -join ', ') + " target=$targetId32")

  if ($DryRun) {
    # Offline check of the file rewrite (used by the tests and by support questions).
    $preview = Set-AutoLogin $vdf $TargetAccount -WhatIfOnly
    $preview -split "`r?`n" | Where-Object { $_ -match '"AccountName"|"AutoLogin"|"AllowAutoLogin"|"timestamp"|"RememberPassword"' } | Write-Host
    Write-State 'dry-run' "would sign in as $TargetAccount and launch app $AppId"
    exit 0
  }

  if (-not (Test-Path -LiteralPath $exe)) { throw "steam.exe not found at $exe" }

  # Already signed in as the target: nothing to restart, just start the game.
  $active = (Get-ItemProperty 'HKCU:\Software\Valve\Steam\ActiveProcess' -ErrorAction SilentlyContinue).ActiveUser
  if (($null -ne $active) -and (("{0}" -f $active) -eq ("{0}" -f $targetId32))) {
    Write-State 'logged-in' "already signed in as $TargetAccount"
  } else {
    Write-State 'shutdown' 'asking Steam to quit'
    if (Get-Process -Name steam -ErrorAction SilentlyContinue) {
      try { Start-Process -FilePath $exe -ArgumentList '-shutdown' -WorkingDirectory $SteamRoot | Out-Null } catch { Write-Log ("shutdown request failed: {0}" -f $_) }
      if (-not (Wait-SteamExit 75)) {
        Write-State 'killing' 'steam.exe did not exit in time, forcing it'
        Stop-Process -Name steam -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 3
      }
    }
    Write-State 'stopped' 'steam.exe is gone'

    Set-AutoLogin $vdf $TargetAccount
    New-ItemProperty -Path 'HKCU:\Software\Valve\Steam' -Name 'AutoLoginUser' -PropertyType String -Value $TargetAccount -Force | Out-Null
    Write-State 'edited' "AutoLoginUser=$TargetAccount written (registry + loginusers.vdf)"

    Start-Process -FilePath $exe -ArgumentList '-bigpicture' -WorkingDirectory $SteamRoot | Out-Null
    Write-State 'relaunched' 'steam.exe -bigpicture started'

    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    $loggedIn = $false
    while ((Get-Date) -lt $deadline) {
      Start-Sleep -Milliseconds 700
      $active = (Get-ItemProperty 'HKCU:\Software\Valve\Steam\ActiveProcess' -ErrorAction SilentlyContinue).ActiveUser
      if (($null -ne $active) -and (("{0}" -f $active) -eq ("{0}" -f $targetId32))) { $loggedIn = $true; break }
      if (-not (Get-Process -Name steam -ErrorAction SilentlyContinue)) { break }
    }
    if (-not $loggedIn) {
      Write-State 'login-failed' "Steam did not sign in as $TargetAccount within ${TimeoutSec}s (Steam Guard or expired session?)"
      exit 1
    }
    Write-State 'logged-in' "signed in as $TargetAccount"
  }

  if ($AppId -gt 0) {
    Start-Sleep -Seconds 2
    Write-State 'launching' "steam://rungameid/$AppId"
    Start-Process ("steam://rungameid/$AppId") | Out-Null
    Write-State 'done' 'switched and launched'
  } else {
    Write-State 'done' 'switched account'
  }
  exit 0
} catch {
  Write-State 'error' ("{0}" -f $_)
  exit 1
}
