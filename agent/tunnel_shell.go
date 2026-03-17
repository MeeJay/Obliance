package main

// shellSession abstracts a platform-specific PTY (Unix) or ConPTY (Windows)
// shell. The two platform implementations live in tunnel_shell_unix.go and
// tunnel_shell_windows.go respectively.
type shellSession interface {
	// Read returns output from the shell (merged stdout + stderr).
	Read([]byte) (int, error)

	// Write sends input to the shell's stdin.
	Write([]byte) (int, error)

	// Resize informs the underlying PTY / ConPTY of a new terminal size.
	// Ignored gracefully if the resize fails.
	Resize(cols, rows uint16) error

	// Close terminates the shell process and releases all OS resources.
	Close() error
}
