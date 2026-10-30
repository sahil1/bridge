# Install Bridge AI on Windows with one command (in PowerShell):
#
#   irm https://raw.githubusercontent.com/sahil1/bridge/main/install.ps1 | iex
#
# Downloads the installer, installs Bridge AI for your user (no admin needed) and opens it. Run it
# again to update. Options, as environment variables:
#   $env:BRIDGE_VERSION = 'v1.24.0'   a specific release instead of the latest
#   $env:BRIDGE_EXE = 'C:\path\to\Bridge-AI-win-x64.exe'   install from a file you already have
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'  # the progress bar makes downloads many times slower

$repo = 'sahil1/bridge'
$file = 'Bridge-AI-win-x64.exe'   # also runs on Windows on Arm, through emulation
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("bridge-ai-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp | Out-Null
$exe = Join-Path $tmp $file

try {
  if ($env:BRIDGE_EXE) {
    Copy-Item $env:BRIDGE_EXE $exe
  } else {
    $base = if ($env:BRIDGE_VERSION) { "https://github.com/$repo/releases/download/$($env:BRIDGE_VERSION)" } else { "https://github.com/$repo/releases/latest/download" }
    Write-Host "Downloading Bridge AI..."
    Invoke-WebRequest -Uri "$base/$file" -OutFile $exe -UseBasicParsing
    # It must match the checksum its release lists (SHA256SUMS.txt, written when it was built), so a
    # damaged or swapped file isn't installed.
    $sums = (Invoke-WebRequest -Uri "$base/SHA256SUMS.txt" -UseBasicParsing).Content
    if ($sums -is [byte[]]) { $sums = [Text.Encoding]::UTF8.GetString($sums) }
    $want = ($sums -split "`n" | Where-Object { ($_ -split '\s+')[1] -eq $file } | ForEach-Object { ($_ -split '\s+')[0] }) | Select-Object -First 1
    if (-not $want) { throw "the release's checksums don't list $file" }
    $got = (Get-FileHash -Algorithm SHA256 -Path $exe).Hash.ToLower()
    if ($got -ne $want.ToLower()) { throw "the download of $file doesn't match its checksum; run the installer again" }
  }

  # Updating: close the app, its server and its terminal host (all run as "Bridge AI"), so the new
  # version starts fresh. Windows can't replace a program that's running, so agents stop here and
  # resume their sessions when the new version starts.
  Get-Process -Name 'Bridge AI' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 500

  Write-Host "Installing..."
  # /S: silent. Installs for this user in %LOCALAPPDATA%\Programs\Bridge AI, with Start menu and
  # desktop shortcuts.
  Start-Process -FilePath $exe -ArgumentList '/S' -Wait

  $app = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA 'Programs') -Filter 'Bridge AI.exe' -Recurse -Depth 1 -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
  if (-not $app) { throw "the installer finished but Bridge AI isn't in $env:LOCALAPPDATA\Programs" }
  Write-Host "Bridge AI is installed. Opening it now; next time, find it in the Start menu."
  Start-Process -FilePath $app
} catch {
  # Not `exit`: run through `irm | iex`, that would close your PowerShell window.
  Write-Host "Bridge AI install: $($_.Exception.Message)" -ForegroundColor Red
  return
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
