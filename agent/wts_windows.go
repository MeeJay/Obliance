//go:build windows

package main

import (
	"fmt"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	procWTSEnumerateSessionsW = wtsapi32.NewProc("WTSEnumerateSessionsW")
	procWTSFreeMemory         = wtsapi32.NewProc("WTSFreeMemory")
	procWTSQuerySessionInfoW  = wtsapi32.NewProc("WTSQuerySessionInformationW")
)

const (
	wtsCurrentServerHandle = 0
	wtsActive              = 0
	wtsUserName            = 5  // WTSInfoClass: WTSUserName
	wtsDomainName          = 7  // WTSInfoClass: WTSDomainName
)

type wtsSessionInfoW struct {
	SessionID      uint32
	WinStationName [33]uint16
	State          uint32
}

type WtsSession struct {
	ID       int    `json:"id"`
	Name     string `json:"name"`
	Username string `json:"username"`
	Domain   string `json:"domain"`
	State    string `json:"state"`
}

func (d *CommandDispatcher) handleListWtsSessions(_ AgentCommand) (interface{}, error) {
	sessions, err := enumWtsSessions()
	if err != nil {
		return nil, fmt.Errorf("list_wts_sessions: %w", err)
	}
	return map[string]interface{}{"sessions": sessions}, nil
}

func enumWtsSessions() ([]WtsSession, error) {
	var pSessionInfo uintptr
	var count uint32

	r, _, err := procWTSEnumerateSessionsW.Call(
		wtsCurrentServerHandle,
		0, // reserved
		1, // version
		uintptr(unsafe.Pointer(&pSessionInfo)),
		uintptr(unsafe.Pointer(&count)),
	)
	if r == 0 {
		return nil, fmt.Errorf("WTSEnumerateSessionsW: %w", err)
	}
	defer procWTSFreeMemory.Call(pSessionInfo)

	entrySize := unsafe.Sizeof(wtsSessionInfoW{})
	var sessions []WtsSession

	for i := uint32(0); i < count; i++ {
		entry := (*wtsSessionInfoW)(unsafe.Pointer(pSessionInfo + uintptr(i)*entrySize))

		state := wtsStateString(entry.State)
		// Only return active/disconnected sessions (skip listeners, idle, etc.)
		if entry.State != wtsActive && entry.State != 4 /* WTSDisconnected */ {
			continue
		}
		// Skip session 0 (services session) and sessions with no user
		username := querySessionString(entry.SessionID, wtsUserName)
		if username == "" {
			continue
		}
		domain := querySessionString(entry.SessionID, wtsDomainName)
		stationName := windows.UTF16ToString(entry.WinStationName[:])

		sessions = append(sessions, WtsSession{
			ID:       int(entry.SessionID),
			Name:     stationName,
			Username: username,
			Domain:   domain,
			State:    state,
		})
	}

	return sessions, nil
}

func querySessionString(sessionID uint32, infoClass uint32) string {
	var buf uintptr
	var bytesReturned uint32
	r, _, _ := procWTSQuerySessionInfoW.Call(
		wtsCurrentServerHandle,
		uintptr(sessionID),
		uintptr(infoClass),
		uintptr(unsafe.Pointer(&buf)),
		uintptr(unsafe.Pointer(&bytesReturned)),
	)
	if r == 0 || buf == 0 {
		return ""
	}
	defer procWTSFreeMemory.Call(buf)

	// buf points to a null-terminated UTF-16 string
	s := windows.UTF16PtrToString((*uint16)(unsafe.Pointer(buf)))
	return s
}

func wtsStateString(state uint32) string {
	switch state {
	case 0:
		return "active"
	case 1:
		return "connected"
	case 4:
		return "disconnected"
	default:
		return "other"
	}
}
