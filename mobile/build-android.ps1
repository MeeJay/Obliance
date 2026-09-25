<#
.SYNOPSIS
    Builds, verifies and publishes the signed Obli Shell release APK of one app
    into the server drop zone (mobile/release/).

.DESCRIPTION
    1. Reads mobile/android/VERSION (MAJOR.MINOR.PATCH -> versionCode).
    2. gradlew test<App>DebugUnitTest assemble<App>Release (the release is
       signed through mobile/android/local.properties, never through this script).
    3. Refuses an unsigned APK.
    4. apksigner verify --print-certs: the certificate SHA-256 must equal
       mobile/android/RELEASE-FINGERPRINT.txt, otherwise nothing is published.
    5. aapt2 dump badging: package, versionCode, versionName, minSdk (checked
       against VERSION and tools.obli.<app>).
    6. Copies the APK to mobile/release/<app>.apk and writes
       mobile/release/manifest.json (UTF-8 without BOM), the exact fields read
       by server/src/controllers/mobileApp.controller.ts.

    Exit code 0 on success, 1 on any failure. Windows PowerShell 5.1 compatible.
    The keystore passwords are never read, printed or passed by this script.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File D:\Obliance\mobile\build-android.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File D:\Obliance\mobile\build-android.ps1 -App obliance -MinSupported 10200
#>
[CmdletBinding()]
param(
    # Product flavor (row of the app table in app/build.gradle.kts).
    [string]$App = 'obliance',
    # Shells below this versionCode are told to force the update.
    # 10000 = 1.0.0, the first release (nothing older exists).
    [int]$MinSupported = 10000,
    [string]$JavaHome = 'C:\Program Files\Android\openjdk\jdk-21.0.8',
    [string]$BuildToolsVersion = '37.0.0'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$MobileDir   = $PSScriptRoot
$AndroidDir  = Join-Path $MobileDir 'android'
$ReleaseDir  = Join-Path $MobileDir 'release'
$VersionFile = Join-Path $AndroidDir 'VERSION'
$FingerprintFile = Join-Path $AndroidDir 'RELEASE-FINGERPRINT.txt'

function Fail([string]$Message) {
    throw $Message
}

function Write-Step([string]$Message) {
    Write-Host ''
    Write-Host "==> $Message" -ForegroundColor Cyan
}

# Runs a native command without letting its stderr abort the script (PS 5.1
# turns redirected stderr lines into ErrorRecords). Returns exit code + output.
function Invoke-Native {
    param(
        [Parameter(Mandatory = $true)][string]$Exe,
        [string[]]$Arguments = @(),
        [switch]$Quiet
    )
    $ErrorActionPreference = 'Continue'
    $lines = New-Object System.Collections.Generic.List[string]
    & $Exe @Arguments 2>&1 | ForEach-Object {
        $line = "$_"
        $lines.Add($line)
        if (-not $Quiet) { Write-Host $line }
    }
    $code = $LASTEXITCODE
    if ($null -eq $code) { $code = 0 }
    return New-Object PSObject -Property @{ ExitCode = $code; Output = $lines.ToArray() }
}

# 64 hex chars, lowercase, no separators; $null when not a SHA-256.
function Normalize-Sha256([string]$Value) {
    if ($null -eq $Value) { return $null }
    $hex = ($Value -replace '[\s:]', '').ToLowerInvariant()
    if ($hex -match '^[0-9a-f]{64}$') { return $hex }
    return $null
}

function Json-String([string]$Value) {
    if ($null -eq $Value) { return 'null' }
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append('"')
    foreach ($ch in $Value.ToCharArray()) {
        $c = [int]$ch
        if ($ch -eq '"') { [void]$sb.Append('\"') }
        elseif ($ch -eq '\') { [void]$sb.Append('\\') }
        elseif ($c -lt 0x20 -or $c -gt 0x7e) { [void]$sb.Append(('\u{0:x4}' -f $c)) }
        else { [void]$sb.Append($ch) }
    }
    [void]$sb.Append('"')
    return $sb.ToString()
}

function Get-SdkDir {
    $localProps = Join-Path $AndroidDir 'local.properties'
    if (Test-Path -LiteralPath $localProps) {
        # Only the sdk.dir line is looked at: this file also holds secrets.
        foreach ($line in [System.IO.File]::ReadAllLines($localProps)) {
            if ($line -match '^\s*sdk\.dir\s*=\s*(.+?)\s*$') {
                $dir = $Matches[1] -replace '\\:', ':' -replace '\\\\', '\'
                return $dir
            }
        }
    }
    if ($env:ANDROID_HOME) { return $env:ANDROID_HOME }
    if ($env:ANDROID_SDK_ROOT) { return $env:ANDROID_SDK_ROOT }
    return 'D:\LifeTrack\.android-sdk'
}

$exitCode = 0
$pushed = $false
try {
    # ---- Inputs ---------------------------------------------------------------
    if ($App -notmatch '^[a-z][a-z0-9]*$') { Fail "Invalid -App '$App' (expected a lowercase flavor id such as obliance)." }
    $Flavor = $App.Substring(0, 1).ToUpperInvariant() + $App.Substring(1)
    $ExpectedPackage = "tools.obli.$App"

    if (-not (Test-Path -LiteralPath $VersionFile)) { Fail "Missing $VersionFile" }
    $VersionName = ([System.IO.File]::ReadAllText($VersionFile)).Trim()
    if ($VersionName -notmatch '^(\d+)\.(\d+)\.(\d+)$') { Fail "VERSION must be MAJOR.MINOR.PATCH, got '$VersionName'" }
    $major = [int]$Matches[1]; $minor = [int]$Matches[2]; $patch = [int]$Matches[3]
    if ($minor -gt 99 -or $patch -gt 99 -or $major -lt 1) { Fail "VERSION out of range: '$VersionName'" }
    $VersionCode = $major * 10000 + $minor * 100 + $patch

    if ($MinSupported -lt 0 -or $MinSupported -gt $VersionCode) {
        Fail "-MinSupported must be between 0 and the versionCode being built ($VersionCode), got $MinSupported"
    }

    if (-not (Test-Path -LiteralPath $FingerprintFile)) { Fail "Missing $FingerprintFile (expected signing certificate SHA-256)." }
    $expectedList = @()
    foreach ($line in [System.IO.File]::ReadAllLines($FingerprintFile)) {
        if ($line -match '^\s*#') { continue }
        foreach ($m in [regex]::Matches($line, '[0-9A-Fa-f]{2}(?::?[0-9A-Fa-f]{2}){31}')) {
            $n = Normalize-Sha256 $m.Value
            if ($n -and ($expectedList -notcontains $n)) { $expectedList += $n }
        }
    }
    if ($expectedList.Count -ne 1) { Fail "RELEASE-FINGERPRINT.txt must contain exactly one SHA-256 (found $($expectedList.Count))." }
    $ExpectedSigner = $expectedList[0]

    # ---- Toolchain ------------------------------------------------------------
    if (Test-Path -LiteralPath (Join-Path $JavaHome 'bin\java.exe')) {
        $env:JAVA_HOME = $JavaHome
    } elseif (-not ($env:JAVA_HOME -and (Test-Path -LiteralPath (Join-Path $env:JAVA_HOME 'bin\java.exe')))) {
        Fail "No JDK found at '$JavaHome' and JAVA_HOME is not usable."
    }
    $env:Path = (Join-Path $env:JAVA_HOME 'bin') + ';' + $env:Path

    $SdkDir = Get-SdkDir
    $BuildTools = Join-Path $SdkDir "build-tools\$BuildToolsVersion"
    if (-not (Test-Path -LiteralPath (Join-Path $BuildTools 'apksigner.bat'))) {
        $candidates = @(Get-ChildItem -LiteralPath (Join-Path $SdkDir 'build-tools') -Directory -ErrorAction SilentlyContinue |
            Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'apksigner.bat') } |
            Sort-Object { try { [version]$_.Name } catch { [version]'0.0' } } -Descending)
        if ($candidates.Count -eq 0) { Fail "No build-tools with apksigner.bat under $SdkDir" }
        $BuildTools = $candidates[0].FullName
    }
    $Apksigner = Join-Path $BuildTools 'apksigner.bat'
    $Aapt2 = Join-Path $BuildTools 'aapt2.exe'
    if (-not (Test-Path -LiteralPath $Aapt2)) { Fail "Missing $Aapt2" }

    Write-Host "Obli Shell release: app=$App version=$VersionName ($VersionCode) minSupported=$MinSupported"
    Write-Host "JAVA_HOME=$env:JAVA_HOME"
    Write-Host "build-tools=$BuildTools"

    # ---- Build ----------------------------------------------------------------
    # Stale outputs must never be mistaken for this build's APK.
    $OutDir = Join-Path $AndroidDir "app\build\outputs\apk\$App\release"
    if (Test-Path -LiteralPath $OutDir) {
        Get-ChildItem -LiteralPath $OutDir -Filter '*.apk' -File | Remove-Item -Force
    }

    Write-Step "gradlew test${Flavor}DebugUnitTest assemble${Flavor}Release"
    # --no-daemon + in-process Kotlin: no Gradle/Kotlin daemon outlives the
    # build. On Windows a daemon inherits the caller's stdout handle, so a
    # caller reading this script through a pipe (CI, another script) would
    # otherwise wait for hours after the script itself has exited.
    Push-Location -LiteralPath $AndroidDir
    $pushed = $true
    $gradle = Invoke-Native -Exe (Join-Path $AndroidDir 'gradlew.bat') -Arguments @(
        "test${Flavor}DebugUnitTest", "assemble${Flavor}Release",
        '--no-daemon', '-Pkotlin.compiler.execution.strategy=in-process', '--console=plain')
    Pop-Location
    $pushed = $false
    if ($gradle.ExitCode -ne 0) { Fail "Gradle failed (exit code $($gradle.ExitCode))." }

    $SignedApk = Join-Path $OutDir "app-$App-release.apk"
    $UnsignedApk = Join-Path $OutDir "app-$App-release-unsigned.apk"
    if (-not (Test-Path -LiteralPath $SignedApk)) {
        if (Test-Path -LiteralPath $UnsignedApk) {
            Fail "Only the UNSIGNED APK was produced ($UnsignedApk). Release signing is not configured: check obli.keystore.file / obli.keystore.password / obli.key.alias / obli.key.password in mobile/android/local.properties."
        }
        Fail "No release APK found in $OutDir"
    }

    # ---- Signature ------------------------------------------------------------
    Write-Step 'apksigner verify --print-certs'
    $verify = Invoke-Native -Exe $Apksigner -Arguments @('verify', '--print-certs', $SignedApk)
    if ($verify.ExitCode -ne 0) { Fail "apksigner verify failed (exit code $($verify.ExitCode))." }
    $signers = @()
    foreach ($line in $verify.Output) {
        if ($line -match 'certificate SHA-256 digest:\s*([0-9A-Fa-f:]+)') {
            $n = Normalize-Sha256 $Matches[1]
            if ($n -and ($signers -notcontains $n)) { $signers += $n }
        }
    }
    if ($signers.Count -eq 0) { Fail 'apksigner printed no certificate SHA-256 digest.' }
    if ($signers.Count -gt 1) { Fail "APK carries several signing certificates ($($signers -join ', ')); expected exactly one." }
    $SignerSha256 = $signers[0]
    if ($SignerSha256 -ne $ExpectedSigner) {
        Fail "SIGNING CERTIFICATE MISMATCH: APK is signed by $SignerSha256 but RELEASE-FINGERPRINT.txt expects $ExpectedSigner. Nothing was published. STOP and check which keystore was used."
    }
    Write-Host "Signer matches RELEASE-FINGERPRINT.txt: $SignerSha256" -ForegroundColor Green

    # ---- Badging --------------------------------------------------------------
    Write-Step 'aapt2 dump badging'
    $badging = Invoke-Native -Exe $Aapt2 -Arguments @('dump', 'badging', $SignedApk) -Quiet
    if ($badging.ExitCode -ne 0) {
        $badging.Output | Select-Object -First 20 | ForEach-Object { Write-Host $_ }
        Fail "aapt2 dump badging failed (exit code $($badging.ExitCode))."
    }
    $PackageName = $null; $ApkVersionCode = $null; $ApkVersionName = $null; $MinSdk = $null
    foreach ($line in $badging.Output) {
        if ($line -match "^package:") {
            if ($line -match "\bname='([^']+)'") { $PackageName = $Matches[1] }
            if ($line -match "\bversionCode='(\d+)'") { $ApkVersionCode = [int]$Matches[1] }
            if ($line -match "\bversionName='([^']*)'") { $ApkVersionName = $Matches[1] }
        } elseif ($line -match "^(?:minSdkVersion|sdkVersion):'(\d+)'") {
            if ($null -eq $MinSdk) { $MinSdk = [int]$Matches[1] }
        }
    }
    Write-Host "package=$PackageName versionCode=$ApkVersionCode versionName=$ApkVersionName minSdk=$MinSdk"
    if ($PackageName -ne $ExpectedPackage) { Fail "Package is '$PackageName', expected '$ExpectedPackage'." }
    if ($ApkVersionCode -ne $VersionCode) { Fail "APK versionCode $ApkVersionCode does not match VERSION $VersionName ($VersionCode)." }
    if ($ApkVersionName -ne $VersionName) { Fail "APK versionName '$ApkVersionName' does not match VERSION '$VersionName'." }
    if ($null -eq $MinSdk) { Fail 'minSdk not found in aapt2 badging output.' }

    # ---- Publish into the drop zone -------------------------------------------
    Write-Step "Publishing to $ReleaseDir"
    if (-not (Test-Path -LiteralPath $ReleaseDir)) { New-Item -ItemType Directory -Path $ReleaseDir | Out-Null }
    $ApkSha256 = (Get-FileHash -LiteralPath $SignedApk -Algorithm SHA256).Hash.ToLowerInvariant()
    $SizeBytes = (Get-Item -LiteralPath $SignedApk).Length

    $TargetApk = Join-Path $ReleaseDir "$App.apk"
    $TmpApk = "$TargetApk.tmp"
    Copy-Item -LiteralPath $SignedApk -Destination $TmpApk -Force
    $copiedSha = (Get-FileHash -LiteralPath $TmpApk -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($copiedSha -ne $ApkSha256) {
        Remove-Item -LiteralPath $TmpApk -Force -ErrorAction SilentlyContinue
        Fail 'Copy of the APK is corrupted (SHA-256 differs).'
    }
    Move-Item -LiteralPath $TmpApk -Destination $TargetApk -Force

    $BuiltAt = [DateTime]::UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", [System.Globalization.CultureInfo]::InvariantCulture)
    $nl = "`n"
    $json = '{' + $nl +
        '  "schema": 1,' + $nl +
        '  "app": ' + (Json-String $App) + ',' + $nl +
        '  "packageName": ' + (Json-String $PackageName) + ',' + $nl +
        '  "version": ' + (Json-String $VersionName) + ',' + $nl +
        '  "versionCode": ' + $VersionCode + ',' + $nl +
        '  "minSupportedVersionCode": ' + $MinSupported + ',' + $nl +
        '  "minSdk": ' + $MinSdk + ',' + $nl +
        '  "sha256": ' + (Json-String $ApkSha256) + ',' + $nl +
        '  "sizeBytes": ' + $SizeBytes + ',' + $nl +
        '  "signerSha256": ' + (Json-String $SignerSha256) + ',' + $nl +
        '  "builtAt": ' + (Json-String $BuiltAt) + $nl +
        '}' + $nl
    $ManifestFile = Join-Path $ReleaseDir 'manifest.json'
    [System.IO.File]::WriteAllText($ManifestFile, $json, (New-Object System.Text.UTF8Encoding($false)))

    $Mapping = Join-Path $AndroidDir "app\build\outputs\mapping\${App}Release\mapping.txt"
    if (Test-Path -LiteralPath $Mapping) { Write-Host "R8 mapping to archive with this release: $Mapping" }

    Write-Host ''
    Write-Host ("OK {0} {1} ({2}) {3} minSdk={4} minSupported={5} size={6} sha256={7} signer={8} -> {9}" -f `
        $App, $VersionName, $VersionCode, $PackageName, $MinSdk, $MinSupported, $SizeBytes, $ApkSha256, $SignerSha256, $TargetApk) -ForegroundColor Green
    Write-Host 'Next: rebuild the server image (the APK is baked into it).'
}
catch {
    if ($pushed) { Pop-Location }
    Write-Host ''
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    $exitCode = 1
}
exit $exitCode
