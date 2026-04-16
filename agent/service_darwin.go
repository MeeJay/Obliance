//go:build darwin

package main

import (
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

const (
	launchdLabel    = "com.obliance.agent"
	launchdPlist    = "/Library/LaunchDaemons/com.obliance.agent.plist"
	installBinPath  = "/usr/local/bin/obliance-agent"
	logFile         = "/var/log/obliance-agent.log"

	trayLabel       = "com.obliance.tray"
	trayPlistPath   = "/Library/LaunchAgents/com.obliance.tray.plist"
	trayBinPath     = "/usr/local/bin/obliance-tray"
)

// runAsService checks for "install" / "uninstall" positional arguments
// (after flag.Parse, these appear in flag.Args()).
func runAsService(urlFlag, keyFlag *string) bool {
	args := flag.Args()
	if len(args) == 0 {
		return false
	}
	switch args[0] {
	case "install":
		installLaunchdService(*urlFlag, *keyFlag)
		return true
	case "uninstall":
		uninstallLaunchdService()
		return true
	}
	return false
}

// installLaunchdService:
//  1. Initialises the agent config (saves to /etc/obliance-agent/config.json)
//  2. Copies the current binary to /usr/local/bin/obliance-agent
//  3. Writes the launchd plist
//  4. Loads the daemon (launchctl load)
func installLaunchdService(urlArg, keyArg string) {
	if urlArg == "" || keyArg == "" {
		fmt.Fprintln(os.Stderr, "Usage: sudo obliance-agent --url <URL> --key <KEY> install")
		os.Exit(1)
	}

	// ── 1. Save config ──────────────────────────────────────────────────────
	cfg := setupConfig(urlArg, keyArg)
	fmt.Printf("Config saved to %s\n", configFile)

	// ── 2. Copy binary ──────────────────────────────────────────────────────
	exePath, err := os.Executable()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Cannot determine binary path: %v\n", err)
		os.Exit(1)
	}
	// Resolve symlinks so we copy the real binary
	exePath, _ = filepath.EvalSymlinks(exePath)

	if exePath != installBinPath {
		if err := copyFile(exePath, installBinPath, 0755); err != nil {
			fmt.Fprintf(os.Stderr, "Failed to copy binary to %s: %v\n", installBinPath, err)
			fmt.Fprintln(os.Stderr, "Run with sudo or ensure /usr/local/bin is writable.")
			os.Exit(1)
		}
		fmt.Printf("Binary installed to %s\n", installBinPath)
	}

	// ── 3. Write plist ──────────────────────────────────────────────────────
	plistContent := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>%s</string>

    <key>ProgramArguments</key>
    <array>
        <string>%s</string>
    </array>

    <!-- Restart automatically if it crashes -->
    <key>KeepAlive</key>
    <true/>

    <!-- Start on boot -->
    <key>RunAtLoad</key>
    <true/>

    <key>StandardOutPath</key>
    <string>%s</string>
    <key>StandardErrorPath</key>
    <string>%s</string>

    <!-- Lower priority so it doesn't interfere with the user's work -->
    <key>ProcessType</key>
    <string>Background</string>
</dict>
</plist>
`, launchdLabel, installBinPath, logFile, logFile)

	if err := os.WriteFile(launchdPlist, []byte(plistContent), 0644); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to write plist to %s: %v\n", launchdPlist, err)
		os.Exit(1)
	}
	fmt.Printf("Plist written to %s\n", launchdPlist)

	// ── 4. Load daemon ──────────────────────────────────────────────────────
	// Unload first in case an old version is running
	_ = newCmd("launchctl", "unload", launchdPlist).Run()

	if err := newCmd("launchctl", "load", launchdPlist).Run(); err != nil {
		fmt.Fprintf(os.Stderr, "launchctl load failed: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("\n✓ Obliance Agent installed and running (label: %s)\n", launchdLabel)
	fmt.Printf("  Logs: %s\n", logFile)
	fmt.Println("  To stop:      sudo launchctl unload " + launchdPlist)
	fmt.Println("  To uninstall: sudo obliance-agent uninstall")
	_ = cfg // config already saved

	// ── 5. Install tray (menu bar icon) ─────────────────────────────────────
	// The tray binary is downloaded from the same server endpoint the agent
	// itself uses. Failure is non-fatal — the agent works without the tray.
	if err := installTray(cfg.ServerURL); err != nil {
		fmt.Fprintf(os.Stderr, "Warning: tray installation skipped: %v\n", err)
	}
}

// installTray downloads the obliance-tray binary for the current architecture
// and registers it as a per-user LaunchAgent. When a user logs in, launchd
// starts the tray in their Aqua session automatically.
func installTray(serverURL string) error {
	arch := runtime.GOARCH // "amd64" or "arm64"
	filename := fmt.Sprintf("obliance-tray-darwin-%s", arch)
	url := fmt.Sprintf("%s/api/agent/download/%s", strings.TrimRight(serverURL, "/"), filename)

	fmt.Printf("Downloading tray binary from %s…\n", url)
	resp, err := http.Get(url)
	if err != nil {
		return fmt.Errorf("download: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return fmt.Errorf("tray binary not available on server (skipped)")
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download: HTTP %d", resp.StatusCode)
	}

	out, err := os.OpenFile(trayBinPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0755)
	if err != nil {
		return fmt.Errorf("open %s: %w", trayBinPath, err)
	}
	if _, err := io.Copy(out, resp.Body); err != nil {
		out.Close()
		return fmt.Errorf("write %s: %w", trayBinPath, err)
	}
	out.Close()

	// Clear the quarantine attribute Gatekeeper adds to downloaded files so
	// the LaunchAgent can exec it without a security warning.
	_ = newCmd("xattr", "-d", "com.apple.quarantine", trayBinPath).Run()

	fmt.Printf("Tray binary installed to %s\n", trayBinPath)

	// ── Write LaunchAgent plist ─────────────────────────────────────────────
	trayPlistContent := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>%s</string>

    <key>ProgramArguments</key>
    <array>
        <string>%s</string>
    </array>

    <!-- Launch once a user logs into Aqua, restart on crash -->
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>LimitLoadToSessionType</key>
    <string>Aqua</string>

    <key>StandardOutPath</key>
    <string>/tmp/obliance-tray.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/obliance-tray.log</string>
</dict>
</plist>
`, trayLabel, trayBinPath)

	if err := os.WriteFile(trayPlistPath, []byte(trayPlistContent), 0644); err != nil {
		return fmt.Errorf("write plist %s: %w", trayPlistPath, err)
	}
	fmt.Printf("LaunchAgent plist written to %s\n", trayPlistPath)

	// ── Bootstrap for the user who invoked sudo (if any) ─────────────────────
	// $SUDO_UID is set by sudo and identifies the real user's UID. Without
	// it (e.g. root login shell), we skip bootstrapping and rely on the next
	// login to pick the LaunchAgent up automatically.
	if uid := os.Getenv("SUDO_UID"); uid != "" {
		_ = newCmd("launchctl", "bootout", fmt.Sprintf("gui/%s/%s", uid, trayLabel)).Run()
		if err := newCmd("launchctl", "bootstrap", fmt.Sprintf("gui/%s", uid), trayPlistPath).Run(); err != nil {
			fmt.Fprintf(os.Stderr, "Warning: launchctl bootstrap failed (user will see tray at next login): %v\n", err)
		} else {
			fmt.Printf("Tray loaded for user UID %s\n", uid)
		}
	} else {
		fmt.Println("Tray will appear in the menu bar at the next user login.")
	}

	return nil
}

// uninstallLaunchdService stops and removes the launchd daemon AND the
// per-user tray LaunchAgent.
func uninstallLaunchdService() {
	fmt.Println("Unloading launchd daemon…")
	if err := newCmd("launchctl", "unload", launchdPlist).Run(); err != nil {
		fmt.Fprintf(os.Stderr, "Warning: launchctl unload: %v\n", err)
	}

	// Best-effort tray removal. Bootout first for the sudo-invoking user,
	// then delete the plist + binary.
	if uid := os.Getenv("SUDO_UID"); uid != "" {
		_ = newCmd("launchctl", "bootout", fmt.Sprintf("gui/%s/%s", uid, trayLabel)).Run()
	}

	for _, path := range []string{launchdPlist, installBinPath, trayPlistPath, trayBinPath} {
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			fmt.Fprintf(os.Stderr, "Warning: could not remove %s: %v\n", path, err)
		} else if err == nil {
			fmt.Printf("Removed %s\n", path)
		}
	}

	fmt.Println("\n✓ Obliance Agent uninstalled.")
	fmt.Println("  Config and logs were kept. Remove manually if needed:")
	fmt.Printf("    sudo rm -rf %s %s\n", configDir, logFile)
}

// copyFile copies src to dst with the given permission bits.
func copyFile(src, dst string, mode os.FileMode) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		return err
	}

	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, in)
	return err
}
