//go:build windows

package main

import (
	"golang.org/x/sys/windows/registry"
)

const (
	gateRegPath  = `Software\Obliance\PrivacyGate`
	gateValueKey = "GateBlob"
)

// readPrivacyGateBlob reads the JSON blob from HKLM. Returns nil/no-error if
// the key does not exist yet.
func readPrivacyGateBlob() ([]byte, error) {
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, gateRegPath, registry.QUERY_VALUE)
	if err != nil {
		if err == registry.ErrNotExist {
			return nil, nil
		}
		return nil, err
	}
	defer k.Close()
	val, _, err := k.GetBinaryValue(gateValueKey)
	if err != nil {
		if err == registry.ErrNotExist {
			return nil, nil
		}
		return nil, err
	}
	return val, nil
}

// writePrivacyGateBlob writes the JSON blob under HKLM\Software\Obliance.
// The agent runs as SYSTEM so it can write here; a standard user with regedit
// will not be able to read or modify the value because the parent key has a
// SYSTEM-only DACL inherited from our installer.
func writePrivacyGateBlob(data []byte) error {
	k, _, err := registry.CreateKey(registry.LOCAL_MACHINE, gateRegPath, registry.ALL_ACCESS)
	if err != nil {
		return err
	}
	defer k.Close()
	return k.SetBinaryValue(gateValueKey, data)
}

// deletePrivacyGateBlob removes the stored value and the key.
func deletePrivacyGateBlob() error {
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, gateRegPath, registry.ALL_ACCESS)
	if err != nil {
		if err == registry.ErrNotExist {
			return nil
		}
		return err
	}
	_ = k.DeleteValue(gateValueKey)
	k.Close()
	return registry.DeleteKey(registry.LOCAL_MACHINE, gateRegPath)
}
