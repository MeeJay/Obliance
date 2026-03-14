// Obliance Agent — Diagnostic tool
// Compile + run on the target machine to check which metrics work.
//
// Usage (from the agent/ directory):
//   go run ./cmd/diag
//
// Or cross-compile from dev:
//   GOOS=darwin GOARCH=arm64 go build -o diag ./cmd/diag && scp diag user@mac:~/ && ssh user@mac ./diag

package main

import (
	"fmt"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/disk"
	"github.com/shirou/gopsutil/v3/host"
	"github.com/shirou/gopsutil/v3/load"
	"github.com/shirou/gopsutil/v3/mem"
	gnet "github.com/shirou/gopsutil/v3/net"
)

func ok(label string)         { fmt.Printf("  ✅  %-28s\n", label) }
func fail(label, err string)  { fmt.Printf("  ❌  %-28s  → %s\n", label, err) }
func info(label, val string)  { fmt.Printf("  ℹ️   %-28s  → %s\n", label, val) }

func sep(title string) { fmt.Printf("\n── %s %s\n", title, strings.Repeat("─", 40-len(title))) }

func main() {
	fmt.Printf("\nObliance Agent — Diagnostics\n")
	fmt.Printf("Platform : %s / %s\n", runtime.GOOS, runtime.GOARCH)

	// ── OS Info ───────────────────────────────────────────────────────────────
	sep("OS Info")
	if h, err := host.Info(); err != nil {
		fail("host.Info()", err.Error())
	} else {
		ok("host.Info()")
		info("OS", h.OS)
		info("Platform", h.Platform+" "+h.PlatformVersion)
		info("Hostname", h.Hostname)
		info("Uptime", fmt.Sprintf("%d s", h.Uptime))
	}

	// ── CPU — model & frequency ───────────────────────────────────────────────
	sep("CPU — model/freq (cpu.Info)")
	if infos, err := cpu.Info(); err != nil {
		fail("cpu.Info()", err.Error())
	} else if len(infos) == 0 {
		fail("cpu.Info()", "returned 0 entries")
	} else {
		ok("cpu.Info()")
		info("Model", infos[0].ModelName)
		info("Base MHz", fmt.Sprintf("%.0f", infos[0].Mhz))
		info("Cores reported", fmt.Sprintf("%d entries", len(infos)))
	}

	// ── CPU — per-core usage (two samples needed) ─────────────────────────────
	sep("CPU — per-core % (cpu.Percent, 500 ms)")
	if pcts, err := cpu.Percent(500*time.Millisecond, true); err != nil {
		fail("cpu.Percent(perCPU=true)", err.Error())
	} else if len(pcts) == 0 {
		fail("cpu.Percent(perCPU=true)", "returned 0 values")
	} else {
		ok("cpu.Percent(perCPU=true)")
		info("Logical CPUs", fmt.Sprintf("%d", len(pcts)))
		for i, p := range pcts {
			info(fmt.Sprintf("  core[%02d]", i), fmt.Sprintf("%.1f%%", p))
		}
	}

	// ── CPU — total usage ─────────────────────────────────────────────────────
	sep("CPU — total % (cpu.Percent, 500 ms)")
	if pcts, err := cpu.Percent(500*time.Millisecond, false); err != nil {
		fail("cpu.Percent(perCPU=false)", err.Error())
	} else {
		ok("cpu.Percent(perCPU=false)")
		info("Total", fmt.Sprintf("%.1f%%", pcts[0]))
	}

	// ── Load average ──────────────────────────────────────────────────────────
	sep("Load Average")
	if l, err := load.Avg(); err != nil {
		fail("load.Avg()", err.Error())
	} else {
		ok("load.Avg()")
		info("Load1", fmt.Sprintf("%.2f", l.Load1))
	}

	// ── Memory ────────────────────────────────────────────────────────────────
	sep("Memory")
	if v, err := mem.VirtualMemory(); err != nil {
		fail("mem.VirtualMemory()", err.Error())
	} else {
		ok("mem.VirtualMemory()")
		info("Total", fmt.Sprintf("%d MB", v.Total/1048576))
		info("Used", fmt.Sprintf("%d MB (%.1f%%)", v.Used/1048576, v.UsedPercent))
	}
	if s, err := mem.SwapMemory(); err != nil {
		fail("mem.SwapMemory()", err.Error())
	} else {
		ok("mem.SwapMemory()")
		info("Swap Total", fmt.Sprintf("%d MB", s.Total/1048576))
	}

	// ── Disk ──────────────────────────────────────────────────────────────────
	sep("Disk")
	if parts, err := disk.Partitions(false); err != nil {
		fail("disk.Partitions()", err.Error())
	} else {
		ok("disk.Partitions()")
		info("Partitions", fmt.Sprintf("%d found", len(parts)))
		for _, p := range parts {
			if u, err := disk.Usage(p.Mountpoint); err == nil && u.Total > 0 {
				info("  "+p.Mountpoint, fmt.Sprintf("%.0f GB total, %.1f%% used [%s]", float64(u.Total)/1e9, u.UsedPercent, p.Fstype))
			}
		}
	}

	// ── Network ───────────────────────────────────────────────────────────────
	sep("Network")
	if stats, err := gnet.IOCounters(true); err != nil {
		fail("net.IOCounters(perNic=true)", err.Error())
	} else {
		ok("net.IOCounters(perNic=true)")
		for _, s := range stats {
			info("  "+s.Name, fmt.Sprintf("rx=%d tx=%d bytes", s.BytesRecv, s.BytesSent))
		}
	}

	// ── Temperature sensors ───────────────────────────────────────────────────
	sep("Temperature sensors")
	if temps, err := host.SensorsTemperatures(); err != nil {
		fail("host.SensorsTemperatures()", err.Error())
	} else if len(temps) == 0 {
		info("SensorsTemperatures()", "0 sensors returned (normal on macOS without sudo)")
	} else {
		ok("SensorsTemperatures()")
		for _, t := range temps {
			if t.Temperature > 0 {
				info("  "+t.SensorKey, fmt.Sprintf("%.1f°C", t.Temperature))
			}
		}
	}

	// ── Apple GPU via ioreg ───────────────────────────────────────────────────
	sep("Apple GPU (ioreg)")
	chipOut, err := exec.Command("sysctl", "-n", "machdep.cpu.brand_string").Output()
	if err != nil {
		fail("sysctl machdep.cpu.brand_string", err.Error())
	} else {
		chip := strings.TrimSpace(string(chipOut))
		ok("sysctl machdep.cpu.brand_string")
		info("Chip", chip)
		if strings.HasPrefix(chip, "Apple") {
			out, err2 := exec.Command("ioreg", "-r", "-c", "AGXAccelerator", "-w", "0").Output()
			if err2 != nil {
				fail("ioreg AGXAccelerator", err2.Error())
			} else {
				raw := string(out)
				const key = `"Device Utilization %"`
				if idx := strings.Index(raw, key); idx >= 0 {
					rest := strings.TrimSpace(raw[idx+len(key):])
					rest = strings.TrimPrefix(rest, "=")
					end := strings.IndexAny(strings.TrimSpace(rest), ",}\n\r")
					var val string
					if end >= 0 {
						val = strings.TrimSpace(rest)[:end]
					}
					ok("ioreg AGXAccelerator")
					info("GPU Device Utilization", val+"%")
				} else {
					fail("ioreg AGXAccelerator", `"Device Utilization %" key not found in output`)
				}
			}
		} else {
			info("GPU", "Non-Apple chip, ioreg path skipped")
		}
	}

	fmt.Printf("\n── Done %s\n\n", strings.Repeat("─", 44))
}
