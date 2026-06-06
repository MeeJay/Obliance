//go:build !windows

package main

import "fmt"

// VM interactive console is Windows/Hyper-V only.

func (d *CommandDispatcher) handleOpenVmConsole(_ AgentCommand) (interface{}, error) {
	return nil, fmt.Errorf("vm console is only supported on Windows Hyper-V hosts")
}

func (d *CommandDispatcher) handleCloseVmConsole(_ AgentCommand) (interface{}, error) {
	return nil, fmt.Errorf("vm console is only supported on Windows Hyper-V hosts")
}

func (d *CommandDispatcher) handleInstallVmConsole(_ AgentCommand) (interface{}, error) {
	return nil, fmt.Errorf("vm console is only supported on Windows Hyper-V hosts")
}
