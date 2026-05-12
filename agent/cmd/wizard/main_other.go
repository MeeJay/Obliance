//go:build !windows

// The install wizard is a Windows-only tool. Building it on Linux /
// macOS only succeeds because Go requires at least one buildable file
// per package — this stub satisfies that requirement without
// pulling in walk (which has cgo dependencies on win32 headers and
// can't compile cross-platform). The 000-RegularUpdate.bat build step
// only invokes the build for GOOS=windows.

package main

import (
	"fmt"
	"os"
)

func main() {
	fmt.Fprintln(os.Stderr, "obliance-installer-wizard runs on Windows only.")
	os.Exit(1)
}
