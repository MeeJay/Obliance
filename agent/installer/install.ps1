# Obliance Agent Installer for Windows
# Usage: irm "https://your-server/api/agent/installer/windows?key=<apikey>" -OutFile "$env:TEMP\obliance-install.ps1"; & "$env:TEMP\obliance-install.ps1"

$ServerUrl = "__SERVER_URL__"
$ApiKey    = "__API_KEY__"

if (!$ServerUrl -or $ServerUrl -eq "__SERVER_URL__") {
    Write-Error "Server URL not injected. Download this script via /api/agent/installer/windows?key=<apikey>"
    exit 1
}
if (!$ApiKey -or $ApiKey -eq "__API_KEY__") {
    Write-Error "API key not injected. Download this script via /api/agent/installer/windows?key=<apikey>"
    exit 1
}

Write-Host ""
Write-Host "=============================="
Write-Host " Obliance Agent Installer"
Write-Host "=============================="
Write-Host " Server : $ServerUrl"
Write-Host ""

# ── Check elevation ───────────────────────────────────────────────────────────

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)

if (-not $isAdmin) {
    Write-Error "This script must be run as Administrator. Right-click PowerShell > Run as Administrator."
    exit 1
}

# ── 1. Download MSI ───────────────────────────────────────────────────────────

$TempMsi  = Join-Path $env:TEMP "obliance-agent.msi"
$LogFile  = Join-Path $env:TEMP "obliance-agent-install.log"

Write-Host "[1/2] Downloading agent MSI..."
try {
    Invoke-WebRequest "$ServerUrl/api/agent/installer/windows.msi" `
        -UseBasicParsing -OutFile $TempMsi -ErrorAction Stop
} catch {
    Write-Error "Download failed: $_"
    exit 1
}

# ── 2. Install silently (already admin — no UAC needed) ───────────────────────

Write-Host "[2/2] Installing..."
$ArgList = "/i `"$TempMsi`" SERVERURL=`"$ServerUrl`" APIKEY=`"$ApiKey`" /quiet /norestart /l*v `"$LogFile`""

# Run msiexec directly (no -Verb RunAs — already elevated, and RunAs from an
# elevated context can deadlock Start-Process -Wait).
$proc = Start-Process "msiexec.exe" -ArgumentList $ArgList -Wait -PassThru
Remove-Item $TempMsi -ErrorAction SilentlyContinue

if ($proc.ExitCode -ne 0) {
    Write-Error "Installation failed (msiexec exit code $($proc.ExitCode)). Log: $LogFile"
    exit 1
}

Write-Host ""
Write-Host "=============================="
Write-Host " Installation complete!"
Write-Host " The device will appear in"
Write-Host " the Obliance admin panel"
Write-Host " once approved."
Write-Host "=============================="
