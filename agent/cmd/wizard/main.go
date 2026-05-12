// Obliance Agent — Install Wizard
//
// A standalone .exe distributed alongside the MSI for hostile Windows
// boxes that can't (or shouldn't) pull files via Invoke-WebRequest /
// BitsTransfer. The MSI is embedded directly into this binary via
// //go:embed, so a single file copy + double-click is enough to
// trigger an interactive enrolment.
//
// Flow:
//   1. Wizard starts, reads its own .exe tail for an optional
//      pre-baked config (server URL + API key the operator picked at
//      download time). Empty tail → fields stay blank for manual
//      entry.
//   2. Operator validates / fills the two fields, clicks Install.
//   3. The embedded MSI is dumped to %TEMP%\obliance-agent.msi and
//      msiexec is invoked with SERVERURL=... APIKEY=.... msiexec
//      handles the UAC prompt itself, so the wizard can stay on the
//      desktop with `asInvoker` rights.
//
// GUI: github.com/lxn/walk — pure win32 bindings, ~5 MB extra to the
// binary, no runtime dependency. Cross-platform GUI libs (fyne, etc.)
// were rejected as overkill for a Windows-only tool.

//go:build windows

package main

import (
	_ "embed"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/lxn/walk"
	. "github.com/lxn/walk/declarative" //nolint:revive // declarative DSL is the canonical walk pattern
)

// Embedded MSI — placed next to this file by the build pipeline (see
// 000-RegularUpdate.bat). The build step copies agent/dist/obliance-agent.msi
// into agent/cmd/wizard/ before invoking `go build`, then removes the
// copy after the wizard binary is signed. Without that copy this
// directive fails at compile time with "no matching files found".
//
//go:embed obliance-agent.msi
var msiData []byte

func main() {
	cfg := readEmbeddedConfig()

	var mw *walk.MainWindow
	var serverEdit, keyEdit *walk.LineEdit
	var logEdit *walk.TextEdit
	var installBtn *walk.PushButton

	err := MainWindow{
		AssignTo: &mw,
		Title:    "Obliance Agent — Install Wizard",
		MinSize:  Size{Width: 560, Height: 380},
		Size:     Size{Width: 560, Height: 380},
		Layout:   VBox{Margins: Margins{Left: 18, Top: 18, Right: 18, Bottom: 18}, Spacing: 8},
		Children: []Widget{
			Label{Text: "Server URL", TextColor: walk.RGB(0x55, 0x55, 0x55)},
			LineEdit{
				AssignTo: &serverEdit,
				Text:     cfg.ServerURL,
				CueBanner: "https://obliance.example.com",
			},
			Label{Text: "API Key", TextColor: walk.RGB(0x55, 0x55, 0x55)},
			LineEdit{
				AssignTo: &keyEdit,
				Text:     cfg.APIKey,
				CueBanner: "obli_xxxxxxxxxxxxxxxxxxxxxxxxxxxx",
			},
			Composite{
				Layout: HBox{Margins: Margins{Top: 8}, Spacing: 8},
				Children: []Widget{
					HSpacer{},
					PushButton{
						AssignTo: &installBtn,
						Text:     "Install Agent",
						MinSize:  Size{Width: 160, Height: 32},
						OnClicked: func() {
							serverURL := strings.TrimSpace(serverEdit.Text())
							apiKey := strings.TrimSpace(keyEdit.Text())
							if serverURL == "" || apiKey == "" {
								walk.MsgBox(mw,
									"Missing fields",
									"Server URL and API Key are required.",
									walk.MsgBoxIconExclamation)
								return
							}
							installBtn.SetEnabled(false)
							_ = logEdit.SetText("")
							go func() {
								err := runInstall(serverURL, apiKey, logEdit, mw)
								mw.Synchronize(func() {
									installBtn.SetEnabled(true)
									if err != nil {
										walk.MsgBox(mw,
											"Install failed",
											err.Error(),
											walk.MsgBoxIconError)
									} else {
										walk.MsgBox(mw,
											"Done",
											"The Obliance agent has been installed.\nIt will appear in the admin panel after a few seconds.",
											walk.MsgBoxIconInformation)
									}
								})
							}()
						},
					},
				},
			},
			Label{Text: "Install log", TextColor: walk.RGB(0x55, 0x55, 0x55)},
			TextEdit{
				AssignTo: &logEdit,
				ReadOnly: true,
				VScroll:  true,
				MinSize:  Size{Height: 120},
			},
		},
	}.Create()
	if err != nil {
		walk.MsgBox(nil, "Startup error", err.Error(), walk.MsgBoxIconError)
		os.Exit(1)
	}
	mw.Run()
}

// runInstall extracts the embedded MSI to %TEMP% and launches
// msiexec.exe with the URL/key on the command line. msiexec itself
// triggers the UAC prompt for elevation, so the wizard process only
// needs `asInvoker` rights (no manifest-driven elevation here).
func runInstall(serverURL, apiKey string, logEdit *walk.TextEdit, mw *walk.MainWindow) error {
	appendLog := func(s string) {
		mw.Synchronize(func() { logEdit.AppendText(s + "\r\n") })
	}

	tmpDir := os.TempDir()
	msiPath := filepath.Join(tmpDir, "obliance-agent.msi")
	appendLog(fmt.Sprintf("Extracting MSI to %s (%d bytes)…", msiPath, len(msiData)))
	if err := os.WriteFile(msiPath, msiData, 0o644); err != nil {
		return fmt.Errorf("write MSI: %w", err)
	}

	// /qb = basic UI (small progress bar, no full Wizard). /quiet would
	// be silent but ops would have no feedback when UAC prompts twice.
	// We pass the SERVERURL / APIKEY public-properties documented in
	// agent/installer/product.wxs.
	appendLog("Launching msiexec.exe…")
	cmd := exec.Command("msiexec.exe",
		"/i", msiPath,
		fmt.Sprintf("SERVERURL=%s", serverURL),
		fmt.Sprintf("APIKEY=%s", apiKey),
		"/qb",
	)
	out, err := cmd.CombinedOutput()
	if len(out) > 0 {
		appendLog(strings.TrimRight(string(out), "\r\n"))
	}
	if err != nil {
		return fmt.Errorf("msiexec returned an error: %w", err)
	}
	appendLog("Install completed successfully.")
	return nil
}

// ── Embedded config (auto-fill from download URL) ────────────────────────────
//
// The server's wizard.exe endpoint can append a small JSON blob to
// the end of the binary, fenced by a magic and a 4-byte little-endian
// length:
//
//	[binary bytes ...][json bytes][magic 8B = "OBLI_CFG"][len uint32 LE]
//
// Appending bytes to the PE file does break the Authenticode
// signature, but the MSI inside the wizard stays signed — operators
// will see a single SmartScreen "More info → Run anyway" prompt for
// the wrapper. We accept the trade-off because the alternative
// (downloading a ZIP with .exe + .json side-by-side) is uglier UX
// and still doesn't avoid SmartScreen for an unsigned wrapper.
//
// If the magic is absent the wizard starts with empty fields — the
// operator types Server URL and API Key by hand.

const cfgMagic = "OBLI_CFG"
const cfgMaxBytes = 1 << 20 // sanity cap: 1 MB of pre-fill is plenty

type embeddedConfig struct {
	ServerURL string `json:"serverUrl"`
	APIKey    string `json:"apiKey"`
}

func readEmbeddedConfig() embeddedConfig {
	var empty embeddedConfig
	exe, err := os.Executable()
	if err != nil {
		return empty
	}
	f, err := os.Open(exe)
	if err != nil {
		return empty
	}
	defer f.Close()
	stat, err := f.Stat()
	if err != nil {
		return empty
	}
	size := stat.Size()
	if size < int64(len(cfgMagic)+4) {
		return empty
	}
	tail := make([]byte, len(cfgMagic)+4)
	if _, err := f.ReadAt(tail, size-int64(len(tail))); err != nil {
		return empty
	}
	if string(tail[:len(cfgMagic)]) != cfgMagic {
		return empty
	}
	cfgLen := int64(binary.LittleEndian.Uint32(tail[len(cfgMagic):]))
	if cfgLen <= 0 || cfgLen > cfgMaxBytes {
		return empty
	}
	cfgStart := size - int64(len(tail)) - cfgLen
	if cfgStart < 0 {
		return empty
	}
	cfgBuf := make([]byte, cfgLen)
	if _, err := f.ReadAt(cfgBuf, cfgStart); err != nil {
		return empty
	}
	var c embeddedConfig
	if err := json.Unmarshal(cfgBuf, &c); err != nil {
		return empty
	}
	return c
}
