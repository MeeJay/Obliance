package main

// vnc.go — ensures a VNC server is running on localhost:5900 before a tunnel
// is opened.  Called by handleOpenRemoteTunnel in tunnel.go.
//
// Platform strategy:
//
//   Windows  Try to start TightVNC / UltraVNC as a service.  Falls back to
//            known installation paths and finally to a tvnserver.exe that can
//            be bundled alongside the agent in the MSI.
//
//   macOS    Activate the built-in Screen Sharing (ARD) via kickstart.  The
//            agent runs as root (LaunchDaemon), so the activation always has
//            the right privileges.
//
//   Linux    Start x11vnc against the current X11 display.  If x11vnc is not
//            installed, the function attempts a silent install via apt-get,
//            dnf or yum before starting it.

import (
	"fmt"
	"log"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const (
	vncAddr            = "127.0.0.1:5900"
	vncStartupTimeout  = 15 * time.Second
	vncStartupPollRate = 500 * time.Millisecond
)

// ensureVNCRunning checks whether a VNC server is accepting connections on
// port 5900.  If it is not, it attempts to start one using OS-specific
// mechanisms.  Returns nil when VNC is (or becomes) available.
func ensureVNCRunning() error {
	if isVNCPortOpen() {
		log.Printf("VNC: port 5900 already open")
		return nil
	}

	log.Printf("VNC: port 5900 not responding — attempting to start VNC server (OS: %s)", runtime.GOOS)

	switch runtime.GOOS {
	case "windows":
		return startWindowsVNC()
	case "darwin":
		return startMacVNC()
	case "linux":
		return startLinuxVNC()
	default:
		return fmt.Errorf("VNC auto-start not supported on %s — please start a VNC server manually on port 5900", runtime.GOOS)
	}
}

// isVNCPortOpen probes port 5900 with a short timeout.
func isVNCPortOpen() bool {
	c, err := net.DialTimeout("tcp", vncAddr, 2*time.Second)
	if err != nil {
		return false
	}
	c.Close()
	return true
}

// waitForVNC polls port 5900 every 500 ms until it opens or the deadline
// vncStartupTimeout is reached.
func waitForVNC() error {
	deadline := time.Now().Add(vncStartupTimeout)
	for time.Now().Before(deadline) {
		if isVNCPortOpen() {
			log.Printf("VNC: port 5900 is now open")
			return nil
		}
		time.Sleep(vncPollRate())
	}
	return fmt.Errorf("VNC server did not become available within %s", vncStartupTimeout)
}

func vncPollRate() time.Duration { return vncStartupPollRate }

// ── Windows ───────────────────────────────────────────────────────────────────

func startWindowsVNC() error {
	// Attempt 1 — start a known VNC Windows service.
	for _, svc := range []string{"tvnserver", "uvnc_service", "WinVNC4", "vncserver"} {
		if err := exec.Command("net", "start", svc).Run(); err == nil {
			log.Printf("VNC: started Windows service %q", svc)
			return waitForVNC()
		}
	}

	// Attempt 2 — launch from a known installation path.
	for _, p := range []string{
		`C:\Program Files\TightVNC\tvnserver.exe`,
		`C:\Program Files (x86)\TightVNC\tvnserver.exe`,
		`C:\Program Files\UltraVNC\winvnc.exe`,
		`C:\Program Files (x86)\UltraVNC\winvnc.exe`,
	} {
		if _, err := os.Stat(p); err == nil {
			// -run starts the server in the foreground; we detach it.
			_ = exec.Command(p, "-run").Start()
			log.Printf("VNC: launched %q", p)
			return waitForVNC()
		}
	}

	// Attempt 3 — bundled tvnserver.exe placed next to the agent binary by the
	// MSI.  Add tvnserver.exe to the WiX manifest and it will be delivered here
	// automatically on every managed device.
	if exe, err := os.Executable(); err == nil {
		bundled := filepath.Join(filepath.Dir(exe), "tvnserver.exe")
		if _, err := os.Stat(bundled); err == nil {
			_ = exec.Command(bundled, "-run").Start()
			log.Printf("VNC: launched bundled tvnserver.exe from %q", bundled)
			return waitForVNC()
		}
	}

	return fmt.Errorf(
		"VNC: no VNC server found on this Windows machine.\n" +
			"Install TightVNC (https://www.tightvnc.com) or place tvnserver.exe " +
			"alongside the Obliance agent binary so it is bundled automatically.",
	)
}

// ── macOS ─────────────────────────────────────────────────────────────────────

func startMacVNC() error {
	kickstart := `/System/Library/CoreServices/RemoteManagement/` +
		`ARDAgent.app/Contents/Resources/kickstart`

	if _, err := os.Stat(kickstart); err == nil {
		// Activate Screen Sharing through the ARD kickstart utility.
		// The agent runs as root (LaunchDaemon), so this always succeeds.
		// Use CombinedOutput so we can detect macOS TCC permission warnings.
		out, err := exec.Command(kickstart,
			"-activate",
			"-configure",
			"-access", "-on",
			"-allowAccessFor", "-allUsers",
			"-privs", "-all",
			"-clientopts", "-setvnclegacy", "-vnclegacy", "yes",
			"-restart", "-agent",
		).CombinedOutput()

		outStr := strings.TrimSpace(string(out))
		if err == nil {
			log.Printf("VNC: macOS Screen Sharing activated via ARD kickstart")
			// Surface TCC permission warnings so admins can act on them.
			if strings.Contains(outStr, "Screen recording might be disabled") {
				log.Printf("VNC: WARNING — Screen Recording permission is not granted to screensharingd. " +
					"The remote session may show a blank screen. " +
					"Fix: System Settings → Privacy & Security → Screen Recording → enable Screen Sharing, " +
					"or push a TCC MDM profile granting com.apple.screencapture to com.apple.screensharing.")
			}
			if strings.Contains(outStr, "Screen control might be disabled") {
				log.Printf("VNC: WARNING — Accessibility permission is not granted. " +
					"Remote input (keyboard/mouse) may not work. " +
					"Fix: System Settings → Privacy & Security → Accessibility → enable Remote Management.")
			}
			return waitForVNC()
		}
		log.Printf("VNC: ARD kickstart returned error (%v) output: %s — falling back to launchctl", err, outStr)
	}

	// Fallback: load the Screen Sharing LaunchDaemon directly.
	_ = exec.Command("launchctl", "load", "-w",
		"/System/Library/LaunchDaemons/com.apple.screensharing.plist").Run()
	log.Printf("VNC: macOS Screen Sharing loaded via launchctl")
	return waitForVNC()
}

// ── Linux ─────────────────────────────────────────────────────────────────────

func startLinuxVNC() error {
	// Make sure x11vnc is installed.
	if _, err := exec.LookPath("x11vnc"); err != nil {
		log.Printf("VNC: x11vnc not found — attempting silent installation")
		_ = exec.Command("apt-get", "install", "-y", "-qq", "x11vnc").Run()
		if _, err := exec.LookPath("x11vnc"); err != nil {
			_ = exec.Command("dnf", "install", "-y", "-q", "x11vnc").Run()
		}
		if _, err := exec.LookPath("x11vnc"); err != nil {
			_ = exec.Command("yum", "install", "-y", "x11vnc").Run()
		}
		if _, lookErr := exec.LookPath("x11vnc"); lookErr != nil {
			return fmt.Errorf("VNC: x11vnc is not installed and automatic installation failed — run: apt-get install x11vnc")
		}
	}

	// Start x11vnc in the background.
	//   -find      : auto-discover the running X11 display (avoids hardcoding
	//                DISPLAY= which is unreliable when the agent runs as root in
	//                a systemd service context without a login session)
	//   -forever   : keep running after the first client disconnects
	//   -nopw      : no VNC password (tunnel is already authenticated end-to-end)
	//   -shared    : allow multiple simultaneous viewers
	//   -localhost : only accept connections from 127.0.0.1 (the agent itself)
	//   -bg        : daemonise immediately
	err := exec.Command("x11vnc",
		"-find",
		"-forever",
		"-nopw",
		"-shared",
		"-localhost",
		"-rfbport", "5900",
		"-bg",
		"-quiet",
		"-o", "/tmp/obliance-x11vnc.log",
	).Start()
	if err != nil {
		return fmt.Errorf("VNC: failed to start x11vnc: %w", err)
	}
	log.Printf("VNC: x11vnc started (auto-discovering display via -find)")
	return waitForVNC()
}
