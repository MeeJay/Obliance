//go:build !windows && !linux && !darwin

package main

import "errors"

func readPrivacyGateBlob() ([]byte, error)   { return nil, nil }
func writePrivacyGateBlob(_ []byte) error    { return errors.New("privacy gate not supported on this platform") }
func deletePrivacyGateBlob() error           { return nil }
