package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// Hyper-V (and future hypervisors) support. Detection + VM enumeration +
// control. Platform-specific work lives in hyperv_windows.go; non-Windows
// builds get stubs in hyperv_other.go.
//
// The agent reports the host type on every push (cheap, cached) and posts
// the full VM list to /api/agent/hyperv-vms after an inventory scan or when
// the server sends a hyperv_list_vms command. Control actions arrive as
// hyperv_control commands carrying { action, vmId, params }.

// HyperVCheckpoint mirrors VmCheckpoint in shared/types.ts.
type HyperVCheckpoint struct {
	Name       string `json:"name"`
	CreatedAt  string `json:"createdAt"`
	ParentName string `json:"parentName"`
}

// HyperVVM is the per-VM payload posted to the server. Field names match the
// server's ingest mapper (hyperV.service.ts).
type HyperVVM struct {
	VMId            string             `json:"vmId"`
	Name            string             `json:"name"`
	State           string             `json:"state"`    // normalised: running|off|saved|paused|transitioning|unknown
	RawState        string             `json:"rawState"` // hypervisor-native string
	CPUCount        int                `json:"cpuCount"`
	MemoryBytes     int64              `json:"memoryBytes"`
	UptimeSeconds   int64              `json:"uptimeSeconds"`
	CheckpointCount int                `json:"checkpointCount"`
	Checkpoints     []HyperVCheckpoint `json:"checkpoints"`
	IPAddresses     []string           `json:"ipAddresses"`
	// MACAddresses holds one entry per virtual NIC, normalised to
	// "00:15:5D:01:02:03". Unlike IPAddresses it does NOT need integration
	// services in the guest — Hyper-V knows the adapter MACs itself — so it is
	// the only network identifier available for every VM. Caveat: a VM with a
	// *dynamic* MAC that has never been started reports all-zeroes; those are
	// dropped rather than reported as a bogus 00:00:00:00:00:00.
	MACAddresses    []string           `json:"macAddresses"`
	Generation      int                `json:"generation"`
	Notes           string             `json:"notes"`
	// Live consumption + richer info (best-effort; zero/empty when the VM is
	// off or the data isn't available).
	CPUUsagePercent    int    `json:"cpuUsagePercent"`
	MemoryDemandBytes  int64  `json:"memoryDemandBytes"`
	DynamicMemory      bool   `json:"dynamicMemory"`
	Heartbeat          string `json:"heartbeat"`          // integration-services heartbeat (OkApplicationsHealthy, NoContact, …)
	IntegrationSvcVer  string `json:"integrationSvcVer"`  // guest integration services version
	Version            string `json:"version"`            // VM configuration version
	StatusText         string `json:"statusText"`         // operational status ("Operating normally", …)
	GuestOS            string `json:"guestOs"`            // guest OS name via KVP, if exposed
	AutomaticStart     string `json:"automaticStart"`     // Nothing | Start | StartIfRunning
	AutomaticStop      string `json:"automaticStop"`      // TurnOff | Save | ShutDown
}

type hyperVVMsBody struct {
	DeviceUUID string     `json:"deviceUuid"`
	HostType   string     `json:"hostType"`
	VMs        []HyperVVM `json:"vms"`
}

type hyperVThumbBody struct {
	DeviceUUID string `json:"deviceUuid"`
	VMId       string `json:"vmId"`
	Width      int    `json:"width"`
	Height     int    `json:"height"`
	PNGBase64  string `json:"pngBase64,omitempty"`
	// Set when the framebuffer couldn't be captured (VM off, no integration
	// video, host refused). The server relays it to the open console so the
	// UI shows the reason instead of an endless spinner.
	Error string `json:"error,omitempty"`
}

// postThumbBody POSTs a thumbnail body (frame or error) to the server.
func postThumbBody(cfg *Config, body hyperVThumbBody) error {
	data, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequest("POST", cfg.ServerURL+"/api/agent/hyperv-thumbnail", bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", cfg.APIKey)
	req.Header.Set("X-Device-UUID", cfg.DeviceUUID)
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("hyperv-thumbnail POST returned HTTP %d", resp.StatusCode)
	}
	return nil
}

// postHyperVThumbnail captures the VM console framebuffer and ships it to the
// server (which relays it to any open console preview/viewer). On capture
// failure it ships the ERROR instead, so the UI can explain why. No-op on
// non-hosts.
func postHyperVThumbnail(cfg *Config, vmID string, w, h int) error {
	if detectVirtualizationHost() == "" {
		return nil
	}
	if w <= 0 {
		w = 640
	}
	if h <= 0 {
		h = 480
	}
	pngB64, capErr := captureHyperVThumbnail(vmID, w, h)
	if capErr != nil {
		// Best-effort error relay; return the original capture error.
		_ = postThumbBody(cfg, hyperVThumbBody{DeviceUUID: cfg.DeviceUUID, VMId: vmID, Error: capErr.Error()})
		return capErr
	}
	return postThumbBody(cfg, hyperVThumbBody{DeviceUUID: cfg.DeviceUUID, VMId: vmID, Width: w, Height: h, PNGBase64: pngB64})
}

// postHyperVVMs ships the current VM inventory to the server. No-op when the
// host isn't a hypervisor.
func postHyperVVMs(cfg *Config) error {
	host := detectVirtualizationHost()
	if host == "" {
		return nil
	}
	vms, err := enumerateHyperVVMs()
	if err != nil {
		return fmt.Errorf("enumerate VMs: %w", err)
	}
	body := hyperVVMsBody{DeviceUUID: cfg.DeviceUUID, HostType: host, VMs: vms}
	data, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequest("POST", cfg.ServerURL+"/api/agent/hyperv-vms", bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", cfg.APIKey)
	req.Header.Set("X-Device-UUID", cfg.DeviceUUID)
	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("hyperv-vms POST returned HTTP %d", resp.StatusCode)
	}
	return nil
}
