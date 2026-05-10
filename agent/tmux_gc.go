//go:build !windows

package main

import (
	"log"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// Garbage collector for orphan tmux sessions created by the remote-shell
// tunnel. Goal: a tmux session that hasn't been attached in a while is
// almost certainly orphaned (the originating tunnel died and no one
// resumed it). We kill it so the host doesn't accumulate idle bash
// processes forever.
//
// Default idle threshold: 30 min. Configurable via env
// `OBLI_SHELL_IDLE_TIMEOUT` (seconds; minimum 60s to avoid eating
// freshly-detached sessions before the user can resume).
//
// Sweep cadence: every 60s. Cheap (one `tmux ls` exec).

const tmuxGcDefaultIdleSec = 30 * 60
const tmuxGcSweepInterval = 60 * time.Second

// startTmuxGc launches the GC goroutine. Safe to call from main even
// if tmux isn't installed: the first sweep no-ops on `tmux: not found`
// and the goroutine keeps sleeping (cheap idle).
func startTmuxGc() {
	go func() {
		for {
			tmuxGcSweep()
			time.Sleep(tmuxGcSweepInterval)
		}
	}()
}

func tmuxGcIdleThresholdSec() int64 {
	v := os.Getenv("OBLI_SHELL_IDLE_TIMEOUT")
	if v == "" {
		return tmuxGcDefaultIdleSec
	}
	n, err := strconv.ParseInt(strings.TrimSpace(v), 10, 64)
	if err != nil || n < 60 {
		return tmuxGcDefaultIdleSec
	}
	return n
}

// One pass — list every `obliance-*` tmux session, kill those that
// are detached AND have been idle for more than the threshold.
func tmuxGcSweep() {
	tmuxPath := tmuxBinPath()
	if tmuxPath == "" {
		return
	}
	// Format: <name> <attached> <activity-epoch-seconds>
	out, err := exec.Command(tmuxPath, "list-sessions", "-F", "#{session_name} #{session_attached} #{session_activity}").Output()
	if err != nil {
		// tmux server may simply not be running (no session active).
		// `list-sessions` exits 1 in that case — silent return.
		return
	}
	threshold := tmuxGcIdleThresholdSec()
	now := time.Now().Unix()
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		parts := strings.Fields(line)
		if len(parts) < 3 {
			continue
		}
		name := parts[0]
		if !strings.HasPrefix(name, "obliance-") {
			continue
		}
		attached, _ := strconv.Atoi(parts[1])
		if attached > 0 {
			continue // someone's actively viewing — leave it
		}
		activityEpoch, _ := strconv.ParseInt(parts[2], 10, 64)
		idle := now - activityEpoch
		if idle < threshold {
			continue
		}
		// Kill the orphan. We don't tell the server here — the
		// existing session row will be `closed`/`expired` on the
		// next reconnect attempt (the agent will report
		// "session not found" to a Resume request, which the
		// service already maps to a close).
		killCmd := exec.Command(tmuxPath, "kill-session", "-t", name)
		_ = killCmd.Run()
		log.Printf("tmux GC: killed orphan session %s (idle %ds, threshold %ds)", name, idle, threshold)
	}
}
