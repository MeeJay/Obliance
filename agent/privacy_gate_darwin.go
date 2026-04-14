//go:build darwin

package main

import (
	"os"
	"path/filepath"
)

// For simplicity we use a root-only file on macOS as well. The System
// keychain is only accessible to processes running as root with specific
// entitlements, and shelling out to `security` is flaky in LaunchDaemons
// without an interactive session. The agent runs as root anyway.
const gateFile = "/Library/Application Support/Obliance/privacy.gate"

func readPrivacyGateBlob() ([]byte, error) {
	b, err := os.ReadFile(gateFile)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	return b, nil
}

func writePrivacyGateBlob(data []byte) error {
	if err := os.MkdirAll(filepath.Dir(gateFile), 0700); err != nil {
		return err
	}
	tmp := gateFile + ".tmp"
	if err := os.WriteFile(tmp, data, 0600); err != nil {
		return err
	}
	return os.Rename(tmp, gateFile)
}

func deletePrivacyGateBlob() error {
	if err := os.Remove(gateFile); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}
