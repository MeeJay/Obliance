//go:build windows

package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"strings"
	"sync"
)

// ── Detection (cached) ───────────────────────────────────────────────────────

var (
	hyperVDetectOnce sync.Once
	hyperVHostType   string
)

// detectVirtualizationHost returns "hyperv" when the Hyper-V role is present
// and the management service is installed, else "". Cached for process life —
// the role doesn't change without a reboot.
func detectVirtualizationHost() string {
	hyperVDetectOnce.Do(func() {
		// vmms = Hyper-V Virtual Machine Management service. Present only when
		// the role is installed. We don't require it to be Running (a host with
		// the role but the service stopped is still a Hyper-V host).
		out, err := hiddenCmd("powershell", "-NoProfile", "-NonInteractive", "-Command",
			"if (Get-Service vmms -ErrorAction SilentlyContinue) { 'yes' } else { 'no' }",
		).Output()
		if err == nil && strings.TrimSpace(string(out)) == "yes" {
			hyperVHostType = "hyperv"
		}
	})
	return hyperVHostType
}

// ── Enumeration ──────────────────────────────────────────────────────────────

// psCheckpoint mirrors the checkpoint sub-object emitted by the enum script.
type psCheckpoint struct {
	Name       string `json:"name"`
	CreatedAt  string `json:"createdAt"`
	ParentName string `json:"parentName"`
}

// psVM mirrors the ConvertTo-Json shape emitted by enumerateHyperVVMs's script.
type psVM struct {
	VMId              string         `json:"vmId"`
	Name              string         `json:"name"`
	RawState          string         `json:"rawState"`
	CPUCount          int            `json:"cpuCount"`
	MemoryBytes       int64          `json:"memoryBytes"`
	UptimeSeconds     int64          `json:"uptimeSeconds"`
	CheckpointCount   int            `json:"checkpointCount"`
	Checkpoints       []psCheckpoint `json:"checkpoints"`
	IPAddresses       interface{}    `json:"ipAddresses"` // string | []string | null
	Generation        int            `json:"generation"`
	Notes             string         `json:"notes"`
	CPUUsagePercent   int            `json:"cpuUsagePercent"`
	MemoryDemandBytes int64          `json:"memoryDemandBytes"`
	DynamicMemory     bool           `json:"dynamicMemory"`
	Heartbeat         string         `json:"heartbeat"`
	IntegrationSvcVer string         `json:"integrationSvcVer"`
	Version           string         `json:"version"`
	StatusText        string         `json:"statusText"`
	GuestOS           string         `json:"guestOs"`
	AutomaticStart    string         `json:"automaticStart"`
	AutomaticStop     string         `json:"automaticStop"`
}

const enumScript = `
$ErrorActionPreference = 'SilentlyContinue'
$vms = Get-VM | ForEach-Object {
  $vm = $_
  $ips = @(); try { $ips = @(($vm | Get-VMNetworkAdapter).IPAddresses) } catch {}
  $cps = @()
  try {
    $cps = @(Get-VMCheckpoint -VMName $vm.Name | ForEach-Object {
      [pscustomobject]@{
        name       = $_.Name
        createdAt  = if ($_.CreationTime) { $_.CreationTime.ToUniversalTime().ToString('o') } else { '' }
        parentName = "$($_.ParentSnapshotName)"
      }
    })
  } catch {}
  $guestOs = ''
  try { $guestOs = "$(($vm | Get-VMKvpData -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq 'OSName' }).Data)" } catch {}
  $isVer = ''
  try { $isVer = "$((Get-VMIntegrationService -VMName $vm.Name -Name 'Guest Service Interface' -ErrorAction SilentlyContinue).PrimaryStatusDescription)" } catch {}
  [pscustomobject]@{
    vmId              = $vm.VMId.Guid
    name              = $vm.Name
    rawState          = "$($vm.State)"
    cpuCount          = [int]$vm.ProcessorCount
    memoryBytes       = [int64]$vm.MemoryAssigned
    uptimeSeconds     = [int64]$vm.Uptime.TotalSeconds
    checkpointCount   = [int]$cps.Count
    checkpoints       = $cps
    ipAddresses       = $ips
    generation        = [int]$vm.Generation
    notes             = "$($vm.Notes)"
    cpuUsagePercent   = [int]$vm.CPUUsage
    memoryDemandBytes = [int64]$vm.MemoryDemand
    dynamicMemory     = [bool]$vm.DynamicMemoryEnabled
    heartbeat         = "$($vm.Heartbeat)"
    integrationSvcVer = "$($vm.IntegrationServicesVersion)"
    version           = "$($vm.Version)"
    statusText        = "$($vm.Status)"
    guestOs           = $guestOs
    automaticStart    = "$($vm.AutomaticStartAction)"
    automaticStop     = "$($vm.AutomaticStopAction)"
  }
}
# Force an array even for 0/1 VMs so ConvertTo-Json yields [] / [ {} ].
ConvertTo-Json -InputObject @($vms) -Compress -Depth 5
`

func normaliseVMState(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "running":
		return "running"
	case "off":
		return "off"
	case "saved":
		return "saved"
	case "paused":
		return "paused"
	case "starting", "stopping", "saving", "pausing", "resuming", "reset", "fastsaved", "fastsaving":
		return "transitioning"
	default:
		return "unknown"
	}
}

func enumerateHyperVVMs() ([]HyperVVM, error) {
	out, err := hiddenCmd("powershell", "-NoProfile", "-NonInteractive", "-Command", enumScript).Output()
	if err != nil {
		return nil, err
	}
	trimmed := strings.TrimSpace(string(out))
	if trimmed == "" {
		return []HyperVVM{}, nil
	}
	var raw []psVM
	if err := json.Unmarshal([]byte(trimmed), &raw); err != nil {
		return nil, fmt.Errorf("parse VM json: %w", err)
	}
	vms := make([]HyperVVM, 0, len(raw))
	for _, r := range raw {
		ips := []string{}
		switch v := r.IPAddresses.(type) {
		case string:
			if v != "" {
				ips = append(ips, v)
			}
		case []interface{}:
			for _, item := range v {
				if s, ok := item.(string); ok && s != "" {
					ips = append(ips, s)
				}
			}
		}
		cps := make([]HyperVCheckpoint, 0, len(r.Checkpoints))
		for _, c := range r.Checkpoints {
			cps = append(cps, HyperVCheckpoint{Name: c.Name, CreatedAt: c.CreatedAt, ParentName: c.ParentName})
		}
		vms = append(vms, HyperVVM{
			VMId:              r.VMId,
			Name:              r.Name,
			State:             normaliseVMState(r.RawState),
			RawState:          r.RawState,
			CPUCount:          r.CPUCount,
			MemoryBytes:       r.MemoryBytes,
			UptimeSeconds:     r.UptimeSeconds,
			CheckpointCount:   r.CheckpointCount,
			Checkpoints:       cps,
			IPAddresses:       ips,
			Generation:        r.Generation,
			Notes:             r.Notes,
			CPUUsagePercent:   r.CPUUsagePercent,
			MemoryDemandBytes: r.MemoryDemandBytes,
			DynamicMemory:     r.DynamicMemory,
			Heartbeat:         r.Heartbeat,
			IntegrationSvcVer: r.IntegrationSvcVer,
			Version:           r.Version,
			StatusText:        r.StatusText,
			GuestOS:           r.GuestOS,
			AutomaticStart:    r.AutomaticStart,
			AutomaticStop:     r.AutomaticStop,
		})
	}
	return vms, nil
}

// ── Control ──────────────────────────────────────────────────────────────────

// runHyperVControl performs a control action on a VM addressed by its VMId
// GUID. Returns a short human-readable result message or an error. params
// carries action-specific fields (checkpoint name, edit values, create spec).
func runHyperVControl(action, vmID string, params map[string]interface{}) (string, error) {
	// Resolve the VM by stable Id for everything except create.
	vmRef := fmt.Sprintf("(Get-VM -Id '%s')", psEscape(vmID))

	var script string
	switch action {
	case "start":
		script = fmt.Sprintf("Start-VM -VM %s", vmRef)
	case "stop": // hard power off
		script = fmt.Sprintf("Stop-VM -VM %s -TurnOff -Force", vmRef)
	case "shutdown": // graceful via integration services
		script = fmt.Sprintf("Stop-VM -VM %s -Force", vmRef)
	case "restart":
		script = fmt.Sprintf("Restart-VM -VM %s -Force", vmRef)
	case "save":
		script = fmt.Sprintf("Save-VM -VM %s", vmRef)
	case "pause":
		script = fmt.Sprintf("Suspend-VM -VM %s", vmRef)
	case "resume":
		script = fmt.Sprintf("Resume-VM -VM %s", vmRef)
	case "checkpoint_create":
		name := psStr(params, "checkpointName")
		if name != "" {
			script = fmt.Sprintf("Checkpoint-VM -VM %s -SnapshotName '%s'", vmRef, psEscape(name))
		} else {
			script = fmt.Sprintf("Checkpoint-VM -VM %s", vmRef)
		}
	case "checkpoint_apply":
		name := psStr(params, "checkpointName")
		script = fmt.Sprintf("Restore-VMCheckpoint -VMName ((%s).Name) -Name '%s' -Confirm:$false", vmRef, psEscape(name))
	case "checkpoint_delete":
		name := psStr(params, "checkpointName")
		script = fmt.Sprintf("Remove-VMCheckpoint -VMName ((%s).Name) -Name '%s'", vmRef, psEscape(name))
	case "edit":
		var parts []string
		if cpu := psInt(params, "cpuCount"); cpu > 0 {
			parts = append(parts, fmt.Sprintf("-ProcessorCount %d", cpu))
		}
		if mem := psInt64(params, "memoryStartupBytes"); mem > 0 {
			parts = append(parts, fmt.Sprintf("-MemoryStartupBytes %d", mem))
		}
		if len(parts) == 0 {
			return "", fmt.Errorf("edit: no recognised settings to apply")
		}
		script = fmt.Sprintf("Set-VM -VM %s %s", vmRef, strings.Join(parts, " "))
	case "create":
		name := psStr(params, "name")
		if name == "" {
			return "", fmt.Errorf("create: name is required")
		}
		cpu := psInt(params, "cpuCount")
		mem := psInt64(params, "memoryStartupBytes")
		gen := psInt(params, "generation")
		sw := psStr(params, "switchName")
		vhdBytes := psInt64(params, "vhdSizeBytes")
		if cpu <= 0 {
			cpu = 2
		}
		if mem <= 0 {
			mem = 2147483648 // 2 GiB
		}
		if gen != 1 && gen != 2 {
			gen = 2
		}
		var b strings.Builder
		fmt.Fprintf(&b, "$vmName='%s'; ", psEscape(name))
		fmt.Fprintf(&b, "$vhd=Join-Path ((Get-VMHost).VirtualHardDiskPath) ($vmName + '.vhdx'); ")
		if vhdBytes <= 0 {
			vhdBytes = 64424509440 // 60 GiB
		}
		fmt.Fprintf(&b, "New-VM -Name $vmName -MemoryStartupBytes %d -Generation %d -NewVHDPath $vhd -NewVHDSizeBytes %d", mem, gen, vhdBytes)
		if sw != "" {
			fmt.Fprintf(&b, " -SwitchName '%s'", psEscape(sw))
		}
		fmt.Fprintf(&b, "; Set-VM -Name $vmName -ProcessorCount %d", cpu)
		script = b.String()
	case "delete":
		// Force off first so Remove-VM doesn't refuse on a running guest.
		script = fmt.Sprintf("Stop-VM -VM %s -TurnOff -Force -ErrorAction SilentlyContinue; Remove-VM -VM %s -Force", vmRef, vmRef)
	default:
		return "", fmt.Errorf("unknown hyperv action %q", action)
	}

	full := "$ErrorActionPreference='Stop'; " + script
	out, err := hiddenCmd("powershell", "-NoProfile", "-NonInteractive", "-Command", full).CombinedOutput()
	if err != nil {
		msg := strings.TrimSpace(string(out))
		if msg == "" {
			msg = err.Error()
		}
		return "", fmt.Errorf("%s", msg)
	}
	return fmt.Sprintf("hyperv %s ok", action), nil
}

// ── Console thumbnail (A layer) ──────────────────────────────────────────────
//
// Grabs the VM framebuffer via Msvm_VirtualSystemManagementService.
// GetVirtualSystemThumbnailImage — the same RGB565 thumbnail Hyper-V Manager
// and VMConnect render as a preview. Works at BIOS / boot / login, no guest
// agent. We ask PowerShell/CIM for the raw RGB565 bytes (base64) + actual
// dimensions, then convert to PNG in Go.

const thumbScriptTmpl = `
$ErrorActionPreference='Stop'
$ns='root\virtualization\v2'
$vm = Get-CimInstance -Namespace $ns -ClassName Msvm_ComputerSystem -Filter "Name='%s'"
if (-not $vm) { throw 'vm not found' }
$vssd = Get-CimAssociatedInstance -InputObject $vm -Namespace $ns -ResultClassName Msvm_VirtualSystemSettingData -Association Msvm_SettingsDefineState | Select-Object -First 1
$svc = Get-CimInstance -Namespace $ns -ClassName Msvm_VirtualSystemManagementService
$res = Invoke-CimMethod -InputObject $svc -MethodName GetVirtualSystemThumbnailImage -Arguments @{ TargetSystem = $vssd; WidthPixels = [uint16]%d; HeightPixels = [uint16]%d }
if ($res.ReturnValue -ne 0 -or -not $res.ImageData) { throw "thumbnail unavailable (rv=$($res.ReturnValue))" }
# width/height come back implicitly via the byte count (w*h*2); echo requested.
Write-Output ("%d %d " + [Convert]::ToBase64String($res.ImageData))
`

// captureHyperVThumbnail returns a base64-encoded PNG of the VM console at
// (w x h). Errors when the VM has no framebuffer (rare) or the host refuses.
func captureHyperVThumbnail(vmID string, w, h int) (string, error) {
	script := fmt.Sprintf(thumbScriptTmpl, psEscape(vmID), w, h, w, h)
	out, err := hiddenCmd("powershell", "-NoProfile", "-NonInteractive", "-Command", script).Output()
	if err != nil {
		return "", fmt.Errorf("thumbnail capture failed: %w", err)
	}
	fields := strings.Fields(strings.TrimSpace(string(out)))
	if len(fields) < 3 {
		return "", fmt.Errorf("unexpected thumbnail output")
	}
	gw, gh := w, h
	fmt.Sscanf(fields[0], "%d", &gw)
	fmt.Sscanf(fields[1], "%d", &gh)
	raw, err := base64.StdEncoding.DecodeString(fields[2])
	if err != nil {
		return "", fmt.Errorf("decode thumbnail bytes: %w", err)
	}
	pngBytes, err := rgb565ToPNG(raw, gw, gh)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(pngBytes), nil
}

// rgb565ToPNG converts a little-endian RGB565 framebuffer to PNG bytes.
func rgb565ToPNG(data []byte, w, h int) ([]byte, error) {
	if w <= 0 || h <= 0 {
		return nil, fmt.Errorf("invalid thumbnail dimensions %dx%d", w, h)
	}
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	n := w * h
	for i := 0; i < n; i++ {
		if 2*i+1 >= len(data) {
			break
		}
		px := uint16(data[2*i]) | uint16(data[2*i+1])<<8
		r := uint8((px>>11)&0x1f) << 3
		g := uint8((px>>5)&0x3f) << 2
		b := uint8(px&0x1f) << 3
		img.SetRGBA(i%w, i/w, color.RGBA{R: r, G: g, B: b, A: 255})
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// ── PowerShell helpers ───────────────────────────────────────────────────────

// psEscape doubles single quotes for safe interpolation into a single-quoted
// PowerShell string literal.
func psEscape(s string) string { return strings.ReplaceAll(s, "'", "''") }

func psStr(m map[string]interface{}, k string) string {
	if m == nil {
		return ""
	}
	if v, ok := m[k].(string); ok {
		return v
	}
	return ""
}

func psInt(m map[string]interface{}, k string) int {
	if m == nil {
		return 0
	}
	switch v := m[k].(type) {
	case float64:
		return int(v)
	case int:
		return v
	}
	return 0
}

func psInt64(m map[string]interface{}, k string) int64 {
	if m == nil {
		return 0
	}
	switch v := m[k].(type) {
	case float64:
		return int64(v)
	case int64:
		return v
	case int:
		return int64(v)
	}
	return 0
}
