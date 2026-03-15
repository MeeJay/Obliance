# build-windows.ps1 - Build Obliance.exe and OblianceSetup.msi for Windows
# Run from the desktop-app/ directory:
#   .\build-windows.ps1
#
# Prerequisites:
#   - Go 1.21+ (with CGO_ENABLED=1 and MinGW/MSVC in PATH)
#   - WiX Toolset v4: dotnet tool install --global wix
#
# To release a new version:
#   1. Edit desktop-app/VERSION  (e.g. 1.2.0)
#   2. Run this script - the version is injected everywhere automatically.
#
# Outputs:
#   dist\Obliance.exe        - portable executable
#   dist\OblianceSetup.msi   - Windows installer with Start Menu + optional Desktop shortcut

# NOTE: Set-StrictMode is intentionally NOT used here.
# On certain PowerShell + Go version combinations, Set-StrictMode -Version Latest causes
# variables set before a `go run` call to become undefined afterwards (a known PS strict-mode
# interaction with native commands).  $ErrorActionPreference = 'Stop' is sufficient.
$ErrorActionPreference = 'Stop'

# All script-level variables declared up-front so they are always in scope.
$AppName     = 'Obliance'
$ExeName     = 'Obliance.exe'
$MsiName     = 'OblianceSetup.msi'
$WxsFile     = 'installer.wxs'
$DistDir     = 'dist'
# NOTE: resource_windows.syso is committed to the repo and auto-linked by Go.
# Do NOT regenerate it via rsrc here — rsrc can produce an incompatible syso
# that causes the resulting exe to refuse to launch on Windows.
# If you need to update the icon, run tools\convert_icon manually and commit
# the new resource_windows.syso.
$sysoFile    = 'resource_windows.syso'

# --- Read version (single source of truth) ---
# Edit the VERSION file to bump; this script injects it into the binary and MSI.
if (-not (Test-Path 'VERSION')) { Write-Error "VERSION file not found in $(Get-Location)." }
$Version = (Get-Content 'VERSION' -Raw).Trim()
if (-not ($Version -match '^\d+\.\d+\.\d+$')) {
    Write-Error "VERSION file must contain a plain 'X.Y.Z' version string, got: '$Version'"
}
Write-Host "  Version: $Version" -ForegroundColor White

Write-Host "=== Step 1: Checking prerequisites ===" -ForegroundColor Cyan

# Ensure Go is available
if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
    Write-Error "Go not found in PATH. Install Go 1.21+ and ensure it is in your PATH."
}
Write-Host "  Go: $(go version)"

# Ensure WiX v4 is available
if (-not (Get-Command wix -ErrorAction SilentlyContinue)) {
    Write-Host "  WiX not found - installing via dotnet tool..." -ForegroundColor Yellow
    dotnet tool install --global wix
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to install WiX. Ensure .NET SDK is installed: https://dot.net"
    }
}
Write-Host "  WiX: $(wix --version 2>&1 | Select-Object -First 1)"

# Ensure logo.ico exists (needed by both the Go build and the WiX installer)
if (-not (Test-Path 'logo.ico')) {
    Write-Error "logo.ico not found. Run tools\convert_icon to generate it from logo.webp."
}
Write-Host "  logo.ico: OK"

# --- Step 2: Verify committed icon resource is present ---
Write-Host "`n=== Step 2: Icon resource ===" -ForegroundColor Cyan
# resource_windows.syso is committed to the repo; Go links it automatically.
# We do NOT regenerate it here -- rsrc can produce an incompatible syso that
# causes the exe to refuse to launch. Use tools\convert_icon + commit if the
# icon changes.
if (Test-Path $sysoFile) {
    $sysoSize = (Get-Item $sysoFile).Length
    Write-Host "  $sysoFile OK ($sysoSize bytes, committed)"
} else {
    Write-Warning "$sysoFile not found - exe will launch without a custom icon."
}

# --- Step 3: Build the Go binary ---
Write-Host "`n=== Step 3: Building $ExeName ===" -ForegroundColor Cyan

# webview_go's bundled WebView2.h includes "EventToken.h" - a Windows Runtime header
# that MinGW distributions (TDM-GCC, w64devkit, MSYS2) place in a winrt/ subdirectory
# which is NOT on the compiler's default include path.
# We write a minimal stub to a short, space-free path (spaces in -I paths break CGO
# flag parsing even when quoted).  CGO_CXXFLAGS is used because webview.cc is C++;
# CGO_CFLAGS only covers plain C compilation units.
# This is the same approach used in 00-D1-build-msi.bat.
$stubDir = 'C:\obliance-winrt'
if (-not (Test-Path $stubDir)) { New-Item -ItemType Directory -Path $stubDir | Out-Null }
Set-Content "$stubDir\EventToken.h" @'
#pragma once
typedef struct EventRegistrationToken { __int64 value; } EventRegistrationToken;
'@ -Encoding ASCII
$env:CGO_CXXFLAGS = '-IC:/obliance-winrt'
Write-Host "  EventToken.h stub: $stubDir"

$env:CGO_ENABLED = '1'
# -H windowsgui  suppresses the console window that would otherwise flash on launch.
# -s -w          strip debug symbols + DWARF info (halves binary size, required for
#                a working GUI exe -- matches the flags used in 00-D1-build-msi.bat.
# -X main.appVersion injects the version string so React can detect outdated clients.
if (-not (Test-Path $DistDir)) { New-Item -ItemType Directory -Path $DistDir | Out-Null }
$distExe = Join-Path $DistDir $ExeName
go build -ldflags "-H windowsgui -s -w -X main.appVersion=$Version" -o $distExe .
if ($LASTEXITCODE -ne 0) {
    Write-Error "go build failed."
}

$exeSize = (Get-Item $distExe).Length / 1MB
Write-Host ("  Built: dist\{0} ({1:F1} MB)" -f $ExeName, $exeSize)

# --- Step 4: Build the MSI with WiX ---
Write-Host "`n=== Step 4: Building $MsiName ===" -ForegroundColor Cyan

# WiX reads the version from installer.wxs - replace the placeholder at build time.
$wxsContent = Get-Content $WxsFile -Raw
$wxsPatched = $wxsContent -replace 'DESKTOP_VERSION_PLACEHOLDER', $Version

$wxsTemp = "$WxsFile.patched.wxs"
Set-Content $wxsTemp $wxsPatched -Encoding UTF8

$msiPath = Join-Path $DistDir $MsiName
wix build $wxsTemp -o $msiPath
if ($LASTEXITCODE -ne 0) {
    Remove-Item $wxsTemp -ErrorAction SilentlyContinue
    Write-Error "WiX build failed."
}
Remove-Item $wxsTemp

$msiSize = (Get-Item $msiPath).Length / 1MB
Write-Host ("  Built: {0} ({1:F1} MB)" -f $msiPath, $msiSize)

# --- Done ---
Write-Host "`n=== Done! (v$Version) ===" -ForegroundColor Green
Write-Host "  Executable : $distExe"
Write-Host "  Installer  : $msiPath"
Write-Host ""
Write-Host "To install: double-click $msiPath  (or: msiexec /i $msiPath)"
Write-Host "To test silent install: msiexec /i $msiPath /qn"
