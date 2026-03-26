// +build !windows

package main

import (
	"context"
	"fmt"
)

func runPS(_ string) ([]byte, error) {
	return nil, fmt.Errorf("powershell not available on this platform")
}

func runPSContext(_ context.Context, _ string) ([]byte, error) {
	return nil, fmt.Errorf("powershell not available on this platform")
}
