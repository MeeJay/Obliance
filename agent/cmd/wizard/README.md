# Obliance Agent Install Wizard

Stand-alone Windows .exe that wraps the MSI for offline-friendly
manual installs. Ship the .exe to a target Windows box (USB, RDP
clipboard, share, etc.), double-click, fill in Server URL + API Key,
click Install. The embedded MSI is dumped to `%TEMP%` and msiexec
runs with the right public properties.

## Build

```
# 1. Embed the MSI next to main.go (read by //go:embed).
cp ../../dist/obliance-agent.msi ./obliance-agent.msi

# 2. Embed the manifest as a Windows resource. Without this, walk
#    crashes on first widget with "TTM_ADDTOOL failed" because
#    Common Controls v6 isn't initialised. `rsrc` generates a .syso
#    file that `go build` auto-links into the PE.
go run github.com/akavel/rsrc@latest \
    -manifest obliance-installer-wizard.exe.manifest \
    -o rsrc_windows.syso

# 3. Build.
GOOS=windows GOARCH=amd64 go build -ldflags="-s -w -H windowsgui" \
    -o ../../dist/obliance-installer-wizard.exe ./

# 4. Cleanup intermediate files.
rm obliance-agent.msi rsrc_windows.syso
```

`-H windowsgui` suppresses the console window — without it,
double-clicking the .exe pops an empty cmd.exe behind the wizard.

`-s -w` strips debug info to shrink the binary (the wizard is
shipped, so size matters for download speed).

The 4 build steps are wired into `000-RegularUpdate.bat`'s
`[8/9] Building install wizard` block — running the regular release
script produces a signed `obliance-installer-wizard.exe` in
`agent/dist/`.

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

`obliance-installer-wizard.exe.manifest` is embedded INTO the .exe at
build time via `rsrc` (see build step 2). Embedding (rather than
shipping a sidecar) was forced by the runtime crash described above
— walk depends on Common Controls v6 being declared in the loaded
manifest, and the sidecar form isn't reliably picked up when the
download endpoint streams a standalone .exe.

The manifest unlocks:

- Common Controls v6 (modern theming — also fixes `TTM_ADDTOOL`)
- Per-monitor v2 DPI awareness
- asInvoker rights (msiexec handles its own UAC prompt)
