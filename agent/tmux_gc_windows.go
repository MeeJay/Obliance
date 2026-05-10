//go:build windows

package main

// startTmuxGc — no-op on Windows. The Unix build wraps shells in
// tmux for resume support and needs a GC to kill orphaned tmux
// sessions. Windows has no equivalent multiplexer, so there's no
// orphan state to clean. Symbol kept identical to the Unix build
// so main.go can call it unconditionally.
func startTmuxGc() {}
