//go:build windows

package main

// ensureTmuxAvailable / tmuxBinPath — no-op on Windows. The Unix
// build wraps shells in tmux for resume support and tries to install
// it automatically from the host package manager; Windows has no
// equivalent multiplexer in the current design, so resume is a Unix-
// only feature. Symbols kept identical to the Unix build so main.go
// can call them unconditionally.

func ensureTmuxAvailable() {}
func tmuxBinPath() string  { return "" }
