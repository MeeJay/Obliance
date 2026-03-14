//go:build windows

package main

import (
	"embed"
	"os"
	"path/filepath"
	"sync"
)

// lhmEmbedFS holds the bundled LibreHardwareMonitor DLLs (net472 build, v0.9.6).
// These are extracted to %ProgramData%\OblianceAgent\lhm\ on first use so that
// the WinRing0 kernel driver can be installed alongside them.
//
// Files embedded:
//   - LibreHardwareMonitorLib.dll  — main LHM library (WinRing0 embedded as resource)
//   - HidSharp.dll                 — USB HID sensor support
//   - DiskInfoToolkit.dll          — disk sensor dependency
//   - RAMSPDToolkit-NDD.dll        — RAM SPD dependency
//   - System.Memory.dll + others   — .NET Framework 4.x compatibility shims
//
//go:embed lhm_dlls
var lhmEmbedFS embed.FS

const lhmBuildTag = "v0.9.6-net472"

var (
	lhmExtractOnce sync.Once
	lhmExtractDir  string
	lhmExtractOK   bool
)

// ensureLHMExtracted extracts the bundled LHM DLLs to a persistent directory
// the first time it is called. Uses a version-tagged marker file so DLLs are
// only re-extracted when the embedded version changes.
//
// Target directory: %ProgramData%\OblianceAgent\lhm\
// (falls back to os.TempDir if ProgramData is unavailable)
//
// The agent must run with administrator / SYSTEM privileges for LHM to install
// the WinRing0 kernel driver on first use (standard for a Windows service).
func ensureLHMExtracted() (dir string, ok bool) {
	lhmExtractOnce.Do(func() {
		base := os.Getenv("ProgramData")
		if base == "" {
			base = os.TempDir()
		}
		target := filepath.Join(base, "OblianceAgent", "lhm")

		// If the version marker already exists, the DLLs are up to date.
		marker := filepath.Join(target, ".lhm-"+lhmBuildTag)
		if _, err := os.Stat(marker); err == nil {
			lhmExtractDir = target
			lhmExtractOK = true
			return
		}

		if err := os.MkdirAll(target, 0755); err != nil {
			return
		}

		entries, err := lhmEmbedFS.ReadDir("lhm_dlls")
		if err != nil {
			return
		}

		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			data, err := lhmEmbedFS.ReadFile("lhm_dlls/" + e.Name())
			if err != nil {
				continue
			}
			dest := filepath.Join(target, e.Name())
			// Skip if already present with same size (avoid Defender triggering
			// on repeated writes of the same binary).
			if info, err := os.Stat(dest); err == nil && info.Size() == int64(len(data)) {
				continue
			}
			if err := os.WriteFile(dest, data, 0644); err != nil {
				return // partial extraction — do not mark as OK
			}
		}

		// All files written: leave marker for next startup.
		_ = os.WriteFile(marker, []byte(lhmBuildTag+"\n"), 0644)
		lhmExtractDir = target
		lhmExtractOK = true
	})
	return lhmExtractDir, lhmExtractOK
}
