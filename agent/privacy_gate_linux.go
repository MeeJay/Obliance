//go:build linux

package main

import (
	"os"
	"path/filepath"
)

const gateFile = "/etc/obliance/privacy.gate"

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
	// Write to a temp file in the same dir then rename for atomicity.
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
