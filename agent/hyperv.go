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
