# Build the Steam Switch plugin, install it into Decky and refresh the release zip.
#
#   powershell -ExecutionPolicy Bypass -File .\build.ps1                 # build + install + zip
#   powershell -ExecutionPolicy Bypass -File .\build.ps1 -NoInstall      # build + zip only
#
# Node comes from PATH by default; pass -Node "C:\path\to\node.exe" when it does not.
# Python is auto-detected (PATH, then the DSH runtime); pass -Python to force one.

param(
    [string]$Node = "node",
    [string]$Python = "",
    [switch]$NoInstall
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

function Resolve-Python {
    param([string]$Explicit)
    if ($Explicit) { return $Explicit }
    $candidates = @(
        (Join-Path $env:USERPROFILE ".dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe"),
        "python",
        "python3",
        "py"
    )
    foreach ($candidate in $candidates) {
        if ($candidate -match "\\" -and -not (Test-Path $candidate)) { continue }
        try {
            $probe = & $candidate -c "print('ok')" 2>$null
        } catch {
            continue
        }
        if ("$probe".Trim() -eq "ok") { return $candidate }
    }
    throw "no working Python found: pass -Python <python.exe>"
}

$py = Resolve-Python -Explicit $Python

Push-Location $here
try {
    Write-Host "== typecheck =="
    & $Node "node_modules/typescript/bin/tsc" --noEmit
    if ($LASTEXITCODE -ne 0) { throw "tsc failed" }

    Write-Host "== build =="
    & $Node "node_modules/rollup/dist/bin/rollup" -c
    if ($LASTEXITCODE -ne 0) { throw "rollup failed" }

    Write-Host "== ASCII check =="
    & $Node -e "const fs=require('fs');const t=fs.readFileSync(process.argv[1],'utf8');const bad=[...t].filter(c=>c.codePointAt(0)>127);if(bad.length){console.error('non-ASCII chars in bundle: '+bad.slice(0,10).join(' '));process.exit(1)}" "dist/index.js"
    if ($LASTEXITCODE -ne 0) { throw "bundle must be ASCII only (Decky serves it without a charset)" }

    Write-Host "== tests =="
    & $py -m unittest discover -s tests
    if ($LASTEXITCODE -ne 0) { throw "tests failed" }

    $version = (Get-Content package.json -Raw | ConvertFrom-Json).version

    if (-not $NoInstall) {
        $dest = Join-Path $env:USERPROFILE "homebrew/plugins/SteamSwitch"
        Write-Host "== install -> $dest =="
        New-Item -ItemType Directory -Force -Path $dest | Out-Null
        foreach ($item in "plugin.json", "package.json", "main.py", "README.md", "LICENSE") {
            if (Test-Path (Join-Path $here $item)) { Copy-Item (Join-Path $here $item) $dest -Force }
        }
        Copy-Item (Join-Path $here "dist") $dest -Recurse -Force
        Copy-Item (Join-Path $here "src") $dest -Recurse -Force
        $destTools = Join-Path $dest "tools"
        New-Item -ItemType Directory -Force -Path $destTools | Out-Null
        Copy-Item (Join-Path $here "tools/switch.ps1") $destTools -Force
        Write-Host "installed; restart Steam so the Python backend loads (main.py is not hot-reloaded)"
    }

    Write-Host "== package =="
    $releases = Join-Path (Split-Path -Parent (Split-Path -Parent $here)) "releases"
    New-Item -ItemType Directory -Force -Path $releases | Out-Null
    $stage = Join-Path $here ".stage"
    if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
    $root = New-Item -ItemType Directory -Force -Path (Join-Path $stage "SteamSwitch")
    foreach ($item in "plugin.json", "package.json", "main.py", "README.md", "LICENSE") {
        if (Test-Path (Join-Path $here $item)) { Copy-Item (Join-Path $here $item) $root.FullName }
    }
    Copy-Item (Join-Path $here "dist"), (Join-Path $here "src") -Destination $root.FullName -Recurse
    $stageTools = New-Item -ItemType Directory -Force -Path (Join-Path $root.FullName "tools")
    Copy-Item (Join-Path $here "tools/switch.ps1") $stageTools.FullName -Force
    $zip = Join-Path $releases ("SteamSwitch-decky-{0}.zip" -f $version)
    if (Test-Path $zip) { Remove-Item -Force $zip }
    # Python writes forward-slash entries; Compress-Archive writes backslashes, which
    # Decky's installer cannot extract.
    & $py (Join-Path $here "tools/make_zip.py") $root.FullName $zip
    if ($LASTEXITCODE -ne 0) { throw "zip failed" }
    if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
    Write-Host ("zip: {0} ({1} bytes)" -f $zip, (Get-Item $zip).Length)
}
finally {
    Pop-Location
}
