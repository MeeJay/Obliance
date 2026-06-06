# Builds the Hyper-V VM interactive-console helper (FreeRDP + H.264) and bundles
# it + its DLLs into agent/dist/vmconsole.zip, downloaded on-demand by Hyper-V
# hosts (see vmconsole_windows.go ensureVmConsoleInstalled).
#
# One-time toolchain on the Windows build machine (MSYS2 at C:\msys64):
#   pacman -S mingw-w64-x86_64-gcc mingw-w64-x86_64-pkgconf mingw-w64-x86_64-freerdp
#
# Non-fatal: if MSYS2/FreeRDP is missing it warns and exits 0 so the release
# continues (the agent still builds; the console feature just won't be available
# until the bundle is produced on a properly-equipped build machine).
$ErrorActionPreference = 'Stop'
$here    = Split-Path -Parent $MyInvocation.MyCommand.Path     # ...\agent\vmconsole
$distDir = Join-Path $here '..\dist'
$bash    = 'C:\msys64\usr\bin\bash.exe'

if (-not (Test-Path $bash)) {
  Write-Warning 'MSYS2 not found at C:\msys64 - skipping VM console helper build (download-on-demand feature unavailable).'
  exit 0
}

# Windows path -> MSYS2 path (/d/Obliance/agent/vmconsole)
$drive = $here.Substring(0,1).ToLower()
$bsrc  = "/$drive" + ($here.Substring(2) -replace '\\','/')

Write-Host '[VMConsole] Compiling helper (MSYS2 mingw64 + freerdp3 + x264)...'
$build = "export MSYSTEM=MINGW64; export PATH=/mingw64/bin:/usr/bin; cd '$bsrc' || exit 9; gcc -D__STDC_NO_THREADS__ -O2 vmconsole.c -o vmconsole.exe `$(pkg-config --cflags --libs freerdp3 x264) -lws2_32; echo BUILD_EXIT=`$?"
& $bash -lc $build

$exe = Join-Path $here 'vmconsole.exe'
if (-not (Test-Path $exe)) {
  Write-Warning '[VMConsole] compile failed (is mingw-w64-x86_64-freerdp/x264 installed?) - skipping bundle.'
  exit 0
}

# Gather DLL closure via ldd
& $bash -lc "export MSYSTEM=MINGW64; export PATH=/mingw64/bin:/usr/bin; ldd '$bsrc/vmconsole.exe' > '$bsrc/ldd.txt' 2>&1"

$stage = Join-Path $env:TEMP 'vmconsole-stage'
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force $stage | Out-Null
Copy-Item $exe $stage -Force
Get-Content (Join-Path $here 'ldd.txt') | ForEach-Object {
  if ($_ -match '=>\s+(/mingw64/bin/\S+\.dll)') {
    $p = ($matches[1] -replace '^/mingw64','C:\msys64\mingw64') -replace '/','\'
    if (Test-Path $p) { Copy-Item $p $stage -Force }
  }
}
# OpenSSL legacy provider (needed for NTLM in SSO) - agent sets OPENSSL_MODULES here
$leg = 'C:\msys64\mingw64\lib\ossl-modules\legacy.dll'
if (Test-Path $leg) { Copy-Item $leg $stage -Force }

New-Item -ItemType Directory -Force $distDir | Out-Null
$zip = Join-Path $distDir 'vmconsole.zip'
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -Force
$mb = [math]::Round((Get-Item $zip).Length/1MB,1)
Write-Host "[VMConsole] agent/dist/vmconsole.zip built: $mb MB, $((Get-ChildItem $stage).Count) files"
