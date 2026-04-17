//go:build windows

package main

import (
	"fmt"
	"os/exec"
	"syscall"
)

// ensureUsersWritable grants the BUILTIN\Users group "Modify" rights on the
// given path. Needed because the agent runs as LocalSystem — files it
// creates under C:\ProgramData\OblianceAgent\ inherit an ACL that blocks
// writes by regular (non-admin) users, so the tray process running in the
// user session cannot toggle privacy.json / airgap.json etc.
//
// We use the well-known SID *S-1-5-32-545 ("Users") instead of the
// localised group name so the call works on French / German / Chinese /
// Japanese Windows without translation pitfalls.
//
// `recurse` controls whether existing files inside a directory are also
// updated (needed the first time; subsequent writes only need the file).
func ensureUsersWritable(path string, recurse bool) error {
	args := []string{path, "/grant", "*S-1-5-32-545:(M)"}
	if recurse {
		args = append(args, "/T")
	}
	// /C = continue on errors, /Q = quiet (suppress success messages).
	args = append(args, "/C", "/Q")

	cmd := exec.Command("icacls", args...)
	// Hide the icacls console window so Task Manager doesn't flash.
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("icacls %q: %w (%s)", path, err, string(out))
	}
	return nil
}
