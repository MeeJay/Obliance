//go:build !windows

package main

import "fmt"

// orScreenSize returns the primary monitor's pixel dimensions.
func orScreenSize() (width, height int, err error) {
	return 0, 0, fmt.Errorf("oblireach: screen capture is not yet supported on this platform")
}

// orCaptureJPEG captures one screen frame and returns it as JPEG bytes.
func orCaptureJPEG() ([]byte, error) {
	return nil, fmt.Errorf("oblireach: screen capture is not yet supported on this platform")
}

// orDefaultFPS returns the target capture frame rate.
func orDefaultFPS() int { return 15 }

// orInjectMouse injects a mouse event into the OS input stream.
func orInjectMouse(msg orInputMsg) {}

// orInjectKey injects a keyboard event into the OS input stream.
func orInjectKey(msg orInputMsg) {}
