//go:build windows

package main

import "golang.org/x/sys/windows/registry"

// getLastLoggedInUser returns the last interactive logon user from the registry.
func getLastLoggedInUser() string {
	k, err := registry.OpenKey(registry.LOCAL_MACHINE,
		`SOFTWARE\Microsoft\Windows\CurrentVersion\Authentication\LogonUI`,
		registry.QUERY_VALUE)
	if err != nil {
		return ""
	}
	defer k.Close()

	val, _, err := k.GetStringValue("LastLoggedOnUser")
	if err != nil {
		// Fallback: try LastLoggedOnSAMUser
		val, _, err = k.GetStringValue("LastLoggedOnSAMUser")
		if err != nil {
			return ""
		}
	}
	return val
}
