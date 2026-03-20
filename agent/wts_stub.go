//go:build !windows

package main

import "fmt"

type WtsSession struct {
	ID       int    `json:"id"`
	Name     string `json:"name"`
	Username string `json:"username"`
	Domain   string `json:"domain"`
	State    string `json:"state"`
}

func (d *CommandDispatcher) handleListWtsSessions(_ AgentCommand) (interface{}, error) {
	return nil, fmt.Errorf("list_wts_sessions: not supported on this platform")
}
