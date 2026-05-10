//go:build !windows

package main

import (
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// tmuxBinPath resolves the tmux binary the agent should use. Priority:
//
//   1. ./tmux next to the agent executable (bundled fallback for
//      air-gapped installs that can't reach a package mirror)
//   2. /opt/obliance/bin/tmux (where installer-scripts drop the
//      bundled binary when the OS doesn't have tmux available)
//   3. tmux on PATH (apt/dnf/yum/apk/pacman/brew/pkg install)
//
// Empty string means "no tmux available, fall back to direct shell
// spawn". The caller (tunnel_shell_unix.newShellSession) treats that
// as a graceful no-resume mode.
func tmuxBinPath() string {
	exe, err := os.Executable()
	if err == nil {
		side := filepath.Join(filepath.Dir(exe), "tmux")
		if stat, err := os.Stat(side); err == nil && !stat.IsDir() {
			return side
		}
	}
	if stat, err := os.Stat("/opt/obliance/bin/tmux"); err == nil && !stat.IsDir() {
		return "/opt/obliance/bin/tmux"
	}
	if p, err := exec.LookPath("tmux"); err == nil {
		return p
	}
	return ""
}

// ensureTmuxAvailable is the (B) of the A+B plan: at agent startup, if
// tmux isn't installed, ATTEMPT to install it via the host's package
// manager. Best-effort — failure is logged and the agent continues to
// run in direct-spawn mode (no resume support, but no crash either).
//
// Only runs when:
//   - the agent process is root (otherwise the install would fail
//     and noisily fall over a sudo password prompt)
//   - tmux is genuinely not found in the priority list above
//   - the env var OBLI_DISABLE_TMUX_AUTOINSTALL is not set (escape
//     hatch for hosts where the SOC forbids package installs)
//
// (A) — bundled static binary — is consulted FIRST via tmuxBinPath
// before we get here, so this function is the second line of
// defence.
func ensureTmuxAvailable() {
	if os.Getenv("OBLI_DISABLE_TMUX_AUTOINSTALL") != "" {
		return
	}
	if tmuxBinPath() != "" {
		return // already available somewhere
	}
	if os.Geteuid() != 0 {
		log.Printf("tmux not found and agent is not root — skip auto-install (Resume feature disabled; install tmux manually for resume support)")
		return
	}

	managers := []struct {
		name string
		bin  string
		args []string
	}{
		// Order matters — try the package manager most likely to
		// already be configured on the host first.
		{"apt-get", "apt-get", []string{"install", "-y", "tmux"}},
		{"dnf", "dnf", []string{"install", "-y", "tmux"}},
		{"yum", "yum", []string{"install", "-y", "tmux"}},
		{"zypper", "zypper", []string{"install", "-y", "tmux"}},
		{"apk", "apk", []string{"add", "--no-cache", "tmux"}},
		{"pacman", "pacman", []string{"-S", "--noconfirm", "tmux"}},
		// macOS has no system package manager — only attempt brew
		// when it's been installed by the operator. We don't try to
		// install brew itself (would require interactive consent).
		{"brew", "brew", []string{"install", "tmux"}},
		// FreeBSD
		{"pkg", "pkg", []string{"install", "-y", "tmux"}},
	}
	for _, m := range managers {
		if _, err := exec.LookPath(m.bin); err != nil {
			continue
		}
		// apt-get may need an `update` first on a clean image. Only
		// for apt-get — dnf / pacman / apk handle this implicitly or
		// have a separate cache state.
		if m.name == "apt-get" {
			_ = exec.Command(m.bin, "update").Run()
		}
		cmd := exec.Command(m.bin, m.args...)
		// Surface the install output to the agent log so operators
		// can see why it failed (e.g. "No package tmux available").
		out, err := cmd.CombinedOutput()
		if err == nil && tmuxBinPath() != "" {
			log.Printf("tmux installed via %s (Resume feature enabled)", m.name)
			return
		}
		log.Printf("tmux auto-install via %s failed: %v (output: %s)", m.name, err, strings.TrimSpace(string(out)))
	}

	log.Printf("tmux auto-install: no usable package manager on %s. Resume feature disabled until tmux is installed manually.", runtime.GOOS)
}
