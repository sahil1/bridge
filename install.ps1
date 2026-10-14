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
    $url = if ($env:BRIDGE_VERSION) { "https://github.com/$repo/releases/download/$($env:BRIDGE_VERSION)/$file" } else { "https://github.com/$repo/releases/latest/download/$file" }
    Write-Host "Downloading Bridge AI..."
    Invoke-WebRequest -Uri $url -OutFile $exe -UseBasicParsing
  }

  # Updating: close the app and its server (both run as "Bridge AI"), so the new version starts fresh.
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
