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
//
// IMPORTANT: walk requires an embedded Windows manifest declaring
// Common Controls v6 (otherwise the runtime crashes on first widget
// with "TTM_ADDTOOL failed"). The build pipeline (000-RegularUpdate.bat)
// runs `rsrc -manifest obliance-installer-wizard.exe.manifest` before
// `go build` to generate a .syso file that the Go linker picks up
// automatically. Don't ship a sidecar .manifest only — the server's
// streaming download endpoint serves the .exe alone.

//go:build windows

package main

import (
	"bytes"
	_ "embed"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"image/png"
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

// Logo embarqué — généré depuis client/public/logo.svg via ImageMagick au
// moment du build (cf. test-build-wizard.bat et 000-RegularUpdate.bat). Si
// l'asset est introuvable à la compilation, ce directive échoue avec
// "no matching files found" — c'est volontaire, le wizard ne doit pas être
// distribué sans son identité visuelle.
//
//go:embed logo.png
var logoPNG []byte

// version est injecté au link-time par 000-RegularUpdate.bat via
// -ldflags="-X main.version=$AGENT_VER". Reste "dev" pour les builds de test
// (test-build-wizard.bat ne fixe pas la version).
var version = "dev"

// Palette dérivée du logo Obliance (dégradé #c2001b → #ee5223). On reste
// volontairement sobre côté wizard — on accentue uniquement le séparateur
// header et le bouton n'est pas customisé (walk ne le permet pas proprement
// et le style natif Windows reste cohérent avec l'OS hôte).
var (
	colorBrand     = walk.RGB(0xc2, 0x00, 0x1b)
	colorText      = walk.RGB(0x1a, 0x1a, 0x1a)
	colorTextMuted = walk.RGB(0x66, 0x66, 0x66)
	colorBg        = walk.RGB(0xff, 0xff, 0xff)
	colorBgHeader  = walk.RGB(0xfa, 0xfa, 0xfa)
)

func loadLogoBitmap() *walk.Bitmap {
	img, err := png.Decode(bytes.NewReader(logoPNG))
	if err != nil {
		return nil
	}
	bmp, err := walk.NewBitmapFromImageForDPI(img, 96)
	if err != nil {
		return nil
	}
	return bmp
}

func main() {
	cfg := readEmbeddedConfig()
	logo := loadLogoBitmap()

	var mw *walk.MainWindow
	var serverEdit, keyEdit *walk.LineEdit
	var logEdit *walk.TextEdit
	var installBtn *walk.PushButton

	headerChildren := []Widget{}
	if logo != nil {
		headerChildren = append(headerChildren, ImageView{
			Image:   logo,
			Mode:    ImageViewModeIdeal,
			MinSize: Size{Width: 240, Height: 56},
			MaxSize: Size{Width: 240, Height: 56},
		})
	} else {
		// Fallback si l'image n'a pas pu être décodée (corruption du
		// PNG embarqué, par exemple) — on garde un texte de marque pour
		// que l'opérateur identifie quand même la fenêtre.
		headerChildren = append(headerChildren, Label{
			Text:      "Obliance",
			TextColor: colorBrand,
			Font:      Font{Family: "Segoe UI", PointSize: 18, Bold: true},
		})
	}
	headerChildren = append(headerChildren,
		HSpacer{},
		Composite{
			Layout: VBox{MarginsZero: true, Spacing: 2},
			Children: []Widget{
				VSpacer{},
				Label{
					Text:      "Install Wizard",
					TextColor: colorText,
					Font:      Font{Family: "Segoe UI", PointSize: 10, Bold: true},
				},
				Label{
					Text:      "v" + version,
					TextColor: colorTextMuted,
					Font:      Font{Family: "Segoe UI", PointSize: 8},
				},
				VSpacer{},
			},
		},
	)

	err := MainWindow{
		AssignTo:   &mw,
		Title:      "Obliance Agent — Install Wizard",
		MinSize:    Size{Width: 600, Height: 470},
		Size:       Size{Width: 600, Height: 470},
		Background: SolidColorBrush{Color: colorBg},
		Layout:     VBox{MarginsZero: true, SpacingZero: true},
		Children: []Widget{
			// Bandeau header — logo à gauche, titre + version à droite.
			Composite{
				Background: SolidColorBrush{Color: colorBgHeader},
				Layout: HBox{
					Margins: Margins{Left: 22, Top: 14, Right: 22, Bottom: 14},
					Spacing: 14,
				},
				Children: headerChildren,
			},
			// Filet rouge de marque sous le header.
			Composite{
				Background: SolidColorBrush{Color: colorBrand},
				MinSize:    Size{Height: 2},
				MaxSize:    Size{Height: 2},
				Layout:     HBox{MarginsZero: true},
			},
			// Corps du wizard (formulaire + log).
			Composite{
				Background: SolidColorBrush{Color: colorBg},
				Layout: VBox{
					Margins: Margins{Left: 22, Top: 18, Right: 22, Bottom: 18},
					Spacing: 6,
				},
				Children: []Widget{
					Label{
						Text:      "Server URL",
						TextColor: colorText,
						Font:      Font{Family: "Segoe UI", PointSize: 9, Bold: true},
					},
					LineEdit{
						AssignTo:  &serverEdit,
						Text:      cfg.ServerURL,
						CueBanner: "https://obliance.example.com",
					},
					VSpacer{Size: 6},
					Label{
						Text:      "API Key",
						TextColor: colorText,
						Font:      Font{Family: "Segoe UI", PointSize: 9, Bold: true},
					},
					LineEdit{
						AssignTo:  &keyEdit,
						Text:      cfg.APIKey,
						CueBanner: "obli_xxxxxxxxxxxxxxxxxxxxxxxxxxxx",
					},
					VSpacer{Size: 12},
					Composite{
						Layout: HBox{MarginsZero: true, Spacing: 8},
						Children: []Widget{
							HSpacer{},
							PushButton{
								AssignTo: &installBtn,
								Text:     "Install Agent",
								MinSize:  Size{Width: 170, Height: 34},
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
					VSpacer{Size: 12},
					Label{
						Text:      "Install log",
						TextColor: colorTextMuted,
						Font:      Font{Family: "Segoe UI", PointSize: 8},
					},
					TextEdit{
						AssignTo: &logEdit,
						ReadOnly: true,
						VScroll:  true,
						MinSize:  Size{Height: 130},
					},
				},
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
