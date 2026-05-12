# Obliance Agent Install Wizard

Stand-alone Windows .exe that wraps the MSI for offline-friendly
manual installs. Ship the .exe to a target Windows box (USB, RDP
clipboard, share, etc.), double-click, fill in Server URL + API Key,
click Install. The embedded MSI is dumped to `%TEMP%` and msiexec
runs with the right public properties.

## Build

```
# Pre-flight: the embedded MSI must live next to main.go before
# `go build` so //go:embed picks it up.
cp ../../dist/obliance-agent.msi ./obliance-agent.msi

# Build (Windows, Go 1.22+).
GOOS=windows GOARCH=amd64 go build -ldflags="-s -w -H windowsgui" \
    -o ../../dist/obliance-installer-wizard.exe ./

# Cleanup the temp MSI copy.
rm obliance-agent.msi
```

`-H windowsgui` suppresses the console window — without it,
double-clicking the .exe pops an empty cmd.exe behind the wizard.

`-s -w` strips debug info to shrink the binary (the wizard is
shipped, so size matters for download speed).

## Sign

After build, run the standard Certum SimplySign pipeline:

```
powershell -ExecutionPolicy Bypass -File D:\Sign\Sign.ps1 ^
    -Path ..\..\dist\obliance-installer-wizard.exe
```

## Pre-configured downloads

The server endpoint `GET /api/agent/installer/wizard.exe?keyId=N`
appends a tail blob to the binary with `{ serverUrl, apiKey }`. The
wizard reads its own file at startup, locates the magic
`OBLI_CFG`, and pre-fills the two text fields. Authenticode signature
is invalidated by the append — operators will see a single
SmartScreen "More info → Run anyway" warning. The MSI inside stays
signed.

## Manifest

`obliance-installer-wizard.exe.manifest` ships alongside the .exe
(not embedded via .syso to avoid a windres dependency). Windows
auto-loads it because of the matching filename, unlocking:

- Common Controls v6 (modern theming)
- Per-monitor v2 DPI awareness
- asInvoker rights (msiexec handles its own UAC prompt)
