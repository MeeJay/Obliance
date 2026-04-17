//go:build !windows

package main

// On unix systems the agent writes shared state files with mode 0666 which
// is already readable & writable by anyone — no extra ACL dance needed.
func ensureUsersWritable(_ string, _ bool) error { return nil }
