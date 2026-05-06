package main

import (
	"log"
	"math"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/disk"
	"github.com/shirou/gopsutil/v3/mem"
)

// Live-metrics support — two distinct mechanisms:
//
//   - TriggerImmediatePush(): signals the regular HTTP push loop to
//     wake up and push straight away. Used for the manual refresh
//     button, which wants the FULL bundle (metrics + inventory +
//     command acks). The HTTP push pipeline persists to the DB and
//     evaluates thresholds, so it's the right tool when the admin
//     wants a guaranteed "everything is now fresh".
//
//   - TriggerLiveMetrics(windowSec): runs a separate goroutine that,
//     while the window is open, samples cpu/ram/disks every 3 s and
//     sends a lightweight `metrics_sample` message over the WS
//     command channel. The server forwards it to the watching
//     browser WITHOUT touching the DB or threshold pipeline — pure
//     UI streaming. Reverts to nothing on window expiry; the regular
//     HTTP push keeps doing its full bundle at its configured cadence.

const liveSampleInterval = 3 * time.Second

var (
	liveMu      sync.Mutex
	liveUntil   time.Time
	liveRunning bool
	pulseCh     = make(chan struct{}, 1)
)

// TriggerImmediatePush signals the HTTP push loop to wake up and push
// straight away. Buffered channel + non-blocking send means a flood
// of refresh-now clicks doesn't pile up — the loop only consumes one
// pulse and runs a single push.
func TriggerImmediatePush() {
	select {
	case pulseCh <- struct{}{}:
	default:
	}
}

// WaitForNextPushOrPulse blocks until either `base` has elapsed OR
// an immediate-push pulse arrives. Drop-in replacement for the bare
// `time.Sleep` in the HTTP push loop — preserves the configured
// cadence by default, but lets the manual refresh button skip ahead.
func WaitForNextPushOrPulse(base time.Duration) {
	t := time.NewTimer(base)
	defer t.Stop()
	select {
	case <-t.C:
	case <-pulseCh:
	}
}

// TriggerLiveMetrics extends the live-stream window by `windowSec`.
// While the window is open, a goroutine samples lightweight metrics
// every 3s and pushes them on the WS channel as `metrics_sample`
// messages. Calling it again before expiry pushes the deadline
// forward — keeping the page open continually re-arms it client-side
// via a periodic re-request.
func TriggerLiveMetrics(windowSec int) {
	if windowSec <= 0 {
		return
	}
	liveMu.Lock()
	deadline := time.Now().Add(time.Duration(windowSec) * time.Second)
	if deadline.After(liveUntil) {
		liveUntil = deadline
	}
	startNeeded := !liveRunning
	if startNeeded {
		liveRunning = true
	}
	liveMu.Unlock()
	if startNeeded {
		go runLiveMetricsLoop()
	}
}

// runLiveMetricsLoop is the streaming goroutine. It exits cleanly
// once the window expires; subsequent TriggerLiveMetrics calls spawn
// a fresh goroutine.
func runLiveMetricsLoop() {
	defer func() {
		liveMu.Lock()
		liveRunning = false
		liveMu.Unlock()
		if r := recover(); r != nil {
			log.Printf("PANIC in live metrics loop: %v", r)
		}
	}()
	// Send one sample immediately so the user sees a value within
	// ~1s of opening the page, then settle into the cadence.
	sendLiveSample()
	t := time.NewTicker(liveSampleInterval)
	defer t.Stop()
	for range t.C {
		liveMu.Lock()
		expired := time.Now().After(liveUntil)
		liveMu.Unlock()
		if expired {
			return
		}
		sendLiveSample()
	}
}

// sendLiveSample collects the cheap subset of metrics (cpu / ram /
// disks-with-percent) and ships them over the WS command channel.
// Heavier metrics (gpus, network rates, full inventory) stay on the
// HTTP push so we don't pay for them every 3s.
func sendLiveSample() {
	m := collectLiveMetrics()
	if m == nil {
		return
	}
	SendOnCommandChannel(map[string]any{
		"type":    "metrics_sample",
		"metrics": m,
		"sentAt":  time.Now().UnixMilli(),
	})
}

// collectLiveMetrics — cheap subset of /metrics suitable for 3s
// streaming. Skips inventory, gpus, per-interface network, kernel
// loadavg etc. Just cpu / memory / disks with usage. Per-disk IO
// counters are intentionally excluded (they require a delta from a
// previous sample, which the regular HTTP push already maintains).
//
// Returns nil on collection error so we never push a half-empty
// payload — the next tick retries.
func collectLiveMetrics() map[string]any {
	out := make(map[string]any)

	// CPU — gopsutil's `Percent(0, false)` returns the aggregate
	// percentage since the last call. The HTTP push and live loop
	// share the same underlying counter, so a live sample taken
	// shortly after a HTTP push will reset the delta — acceptable,
	// the user just sees one slightly-low first sample.
	if cpus, err := cpu.Percent(0, false); err == nil && len(cpus) > 0 {
		out["cpu"] = map[string]any{
			"percent": math.Round(cpus[0]*10) / 10,
		}
	}

	// Memory — total / used / percent. Cheap, single syscall.
	if v, err := mem.VirtualMemory(); err == nil {
		out["memory"] = map[string]any{
			"totalMb": v.Total / 1048576,
			"usedMb":  v.Used / 1048576,
			"percent": math.Round(v.UsedPercent*10) / 10,
		}
	}

	// Disks — same partition list as the HTTP push, but only the
	// percent / used / total fields. We re-do the partition scan
	// every tick because mounts can come and go (USB plug/unplug)
	// and we want the user to see those quickly.
	if parts, err := disk.Partitions(false); err == nil {
		disks := make([]map[string]any, 0, len(parts))
		for _, p := range parts {
			usage, err := disk.Usage(p.Mountpoint)
			if err != nil || usage.Total == 0 {
				continue
			}
			disks = append(disks, map[string]any{
				"mount":   p.Mountpoint,
				"totalGb": math.Round(float64(usage.Total)/1073741824*10) / 10,
				"usedGb":  math.Round(float64(usage.Used)/1073741824*10) / 10,
				"percent": math.Round(usage.UsedPercent*10) / 10,
				// Mark removable / fstype so the UI can colour them
				// like the HTTP-push version (the same isExcludedDisk
				// pipeline runs server-side for both).
				"fstype":    p.Fstype,
				"removable": isRemovableDisk(p.Device, p.Mountpoint, p.Fstype),
			})
		}
		out["disks"] = disks
	}

	if len(out) == 0 {
		return nil
	}
	return out
}
