# Obliance Agent Installer for Windows
# Usage: irm "https://your-server/api/agent/installer/windows?key=<apikey>" | iex

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

# ── 1. Download MSI ───────────────────────────────────────────────────────────

$TempMsi = Join-Path $env:TEMP "obliance-agent.msi"

Write-Host "[1/2] Downloading agent MSI..."
try {
    Invoke-WebRequest "$ServerUrl/api/agent/installer/windows.msi" `
        -UseBasicParsing -OutFile $TempMsi -ErrorAction Stop
} catch {
    Write-Error "Download failed: $_"
    exit 1
}

# ── 2. Install silently (UAC prompt for elevation) ────────────────────────────

Write-Host "[2/2] Installing (admin rights required — UAC prompt may appear)..."
$ArgList = "/i `"$TempMsi`" SERVERURL=`"$ServerUrl`" APIKEY=`"$ApiKey`" /quiet /norestart /l*v `"$env:TEMP\obliance-agent-install.log`""
$proc = Start-Process msiexec -ArgumentList $ArgList -Wait -Verb RunAs -PassThru
Remove-Item $TempMsi -ErrorAction SilentlyContinue

if ($proc.ExitCode -ne 0) {
    Write-Error "Installation failed (msiexec exit code $($proc.ExitCode)). See $env:TEMP\obliance-agent-install.log"
    exit 1
}

Write-Host ""
Write-Host "=============================="
Write-Host " Installation complete!"
Write-Host " The device will appear in"
Write-Host " the Obliance admin panel"
Write-Host " once approved."
Write-Host "=============================="
