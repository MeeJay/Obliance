//go:build !linux

package main

import "fmt"

// Native ProxyJump (SSH bastion T1) is Linux-only; other platforms keep the
// managed shell ("ssh <machine>" inside the bastion).

func (d *CommandDispatcher) handleSshJumpGrant(cmd AgentCommand) (interface{}, error) {
	return nil, fmt.Errorf("native ProxyJump is only supported on Linux")
}

func (d *CommandDispatcher) handleSshJumpRevoke(cmd AgentCommand) (interface{}, error) {
	return map[string]interface{}{"removed": 0}, nil
}

func sshJumpTargetAddr() (string, error) {
	return "", fmt.Errorf("native ProxyJump is only supported on Linux")
}

func startSshJumpJanitor() {}
