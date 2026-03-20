package main

// tunnel.go — Remote-access relay for the Obliance agent.
//
// Supported protocols:
//   rdp  — TCP relay to localhost:3389 (Windows RDP)
//   ssh  — PTY shell session (PowerShell on Windows, bash/sh on Unix)
//
// Flow (rdp):
//   Server sends open_remote_tunnel → agent:
//     1. Ensures the local service is reachable
//     2. Connects to the Obliance server via WebSocket
//     3. Connects to the local service via TCP
//     4. Relays bytes bidirectionally until one side closes
//
// Flow (ssh):
//   1. Spawns a local shell process (PowerShell / bash)
//   2. Connects to the Obliance server via WebSocket
//   3. Relays shell stdout/stderr → WS (binary frames)
//        and WS frames → shell stdin
//
// The relay runs entirely in background goroutines; the command ack is sent
// immediately after the connections are established (not when they close).

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// ── Tunnel state ──────────────────────────────────────────────────────────────

type tunnelState struct {
	ws      *wsConn
	tcp     net.Conn // nil for ssh/shell tunnels
	closeCh chan struct{}
	once    sync.Once // ensures closeCh is closed exactly once
}

func (ts *tunnelState) close() {
	ts.once.Do(func() { close(ts.closeCh) })
	ts.ws.Close()
	if ts.tcp != nil {
		ts.tcp.Close()
	}
}

// tunnelRegistry holds all active tunnels keyed by session token.
type tunnelRegistry struct {
	mu      sync.Mutex
	tunnels map[string]*tunnelState
}

var activeTunnels = &tunnelRegistry{
	tunnels: make(map[string]*tunnelState),
}

func (r *tunnelRegistry) add(token string, ts *tunnelState) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.tunnels[token] = ts
}

func (r *tunnelRegistry) remove(token string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.tunnels, token)
}

func (r *tunnelRegistry) take(token string) (*tunnelState, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	ts, ok := r.tunnels[token]
	if ok {
		delete(r.tunnels, token)
	}
	return ts, ok
}

func (r *tunnelRegistry) count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.tunnels)
}

// ── Command handlers ──────────────────────────────────────────────────────────

// handleOpenRemoteTunnel implements the "open_remote_tunnel" command.
// It establishes a WebSocket connection to the Obliance server and a TCP
// connection to the local RDP service, then relays traffic between them in two
// background goroutines. It returns as soon as both connections are open.
func (d *CommandDispatcher) handleOpenRemoteTunnel(cmd AgentCommand) (interface{}, error) {
	sessionToken := payloadString(cmd.Payload, "sessionToken")
	if sessionToken == "" {
		return nil, fmt.Errorf("open_remote_tunnel: missing sessionToken in payload")
	}
	protocol := payloadString(cmd.Payload, "protocol")
	if protocol == "" {
		protocol = "rdp"
	}

	// Build the WebSocket URL for the agent-side tunnel endpoint
	base := strings.TrimRight(d.serverURL, "/")
	var wsBase string
	switch {
	case strings.HasPrefix(base, "https://"):
		wsBase = "wss://" + base[8:]
	case strings.HasPrefix(base, "http://"):
		wsBase = "ws://" + base[7:]
	default:
		wsBase = base
	}
	wsURL := wsBase + "/api/remote/agent-tunnel/" + sessionToken

	log.Printf("Command %s: opening %s tunnel → %s", cmd.ID, protocol, wsURL)

	// WTS session ID (Windows): 0 = SYSTEM, >0 = user session
	wtsSessionId := 0
	if v, ok := cmd.Payload["sessionId"]; ok {
		switch sv := v.(type) {
		case float64:
			wtsSessionId = int(sv)
		case int:
			wtsSessionId = sv
		}
	}

	// Route by protocol
	if protocol == "ssh" || protocol == "cmd" || protocol == "powershell" {
		return d.handleShellTunnel(cmd.ID, wsURL, sessionToken, protocol, wtsSessionId)
	}
	// ── RDP : TCP relay ──────────────────────────────────────────────────────
	tcpAddr := "localhost:3389" // RDP only
	if protocol != "rdp" {
		return nil, fmt.Errorf("open_remote_tunnel: unsupported TCP protocol %q", protocol)
	}

	// 2. Connect WebSocket to Obliance server
	ws, err := wsConnect(wsURL, http.Header{
		"X-Api-Key": []string{d.apiKey},
	})
	if err != nil {
		return nil, fmt.Errorf("open_remote_tunnel: server WS connect failed: %w", err)
	}

	// 3. Connect TCP to local service
	svc, err := net.Dial("tcp", tcpAddr)
	if err != nil {
		ws.Close()
		return nil, fmt.Errorf("open_remote_tunnel: %s connect failed: %w", protocol, err)
	}

	closeCh := make(chan struct{})
	ts := &tunnelState{ws: ws, tcp: svc, closeCh: closeCh}
	activeTunnels.add(sessionToken, ts)

	// 4. Keepalive — send a WS ping every 25 s so intermediate proxies
	// (cPanel/WHM Nginx, NPM…) never drop the tunnel on their idle timeout.
	go func() {
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-closeCh:
				return
			case <-ticker.C:
				if err := ws.WriteFrame(0x9, nil); err != nil {
					ts.close()
					return
				}
			}
		}
	}()

	// 5. Service → WebSocket relay
	go func() {
		defer func() {
			activeTunnels.remove(sessionToken)
			ts.close()
			log.Printf("%s tunnel %s: svc→WS relay finished", protocol, sessionToken)
		}()
		buf := make([]byte, 32768)
		for {
			select {
			case <-closeCh:
				return
			default:
			}
			n, err := svc.Read(buf)
			if err != nil {
				if err != io.EOF {
					log.Printf("%s tunnel %s: svc read error: %v", protocol, sessionToken, err)
				}
				return
			}
			if err := ws.WriteFrame(0x2, buf[:n]); err != nil {
				log.Printf("%s tunnel %s: WS write error: %v", protocol, sessionToken, err)
				return
			}
		}
	}()

	// 5. WebSocket → Service relay
	go func() {
		defer func() {
			ts.close()
			log.Printf("%s tunnel %s: WS→svc relay finished", protocol, sessionToken)
		}()
		for {
			select {
			case <-closeCh:
				return
			default:
			}
			opcode, payload, err := ws.ReadFrame()
			if err != nil {
				if err != io.EOF {
					log.Printf("%s tunnel %s: WS read error: %v", protocol, sessionToken, err)
				}
				return
			}
			switch opcode {
			case 0x8:
				return
			case 0x9:
				_ = ws.SendPong(payload)
			case 0x1, 0x2:
				if len(payload) == 0 {
					continue
				}
				if _, err := svc.Write(payload); err != nil {
					log.Printf("%s tunnel %s: svc write error: %v", protocol, sessionToken, err)
					return
				}
			}
		}
	}()

	log.Printf("Command %s: %s tunnel established (token=%s)", cmd.ID, protocol, sessionToken)
	return map[string]string{"sessionToken": sessionToken, "status": "tunnel_open"}, nil
}

// handleShellTunnel spawns a local shell inside a PTY (Unix) or ConPTY
// (Windows) and relays its I/O over WebSocket.
// This backs the "ssh" protocol which gives a remote shell inside the browser.
func (d *CommandDispatcher) handleShellTunnel(cmdID, wsURL, sessionToken, shellCmd string, wtsSessionId int) (interface{}, error) {
	// Connect WebSocket to Obliance server first so we can reject early if down.
	ws, err := wsConnect(wsURL, http.Header{
		"X-Api-Key": []string{d.apiKey},
	})
	if err != nil {
		return nil, fmt.Errorf("open_remote_tunnel(ssh): server WS connect failed: %w", err)
	}

	// Start a platform-specific PTY / ConPTY shell with a sensible default size.
	// The browser sends an initial resize message immediately after connecting
	// so the actual size is corrected within milliseconds.
	shell, err := newShellSession(220, 50, shellCmd, wtsSessionId)
	if err != nil {
		ws.Close()
		return nil, fmt.Errorf("open_remote_tunnel(ssh): start shell: %w", err)
	}

	closeCh := make(chan struct{})
	var once sync.Once
	closeAll := func() {
		once.Do(func() {
			close(closeCh)
			ws.Close()
			shell.Close()
		})
	}
	activeTunnels.add(sessionToken, &tunnelState{ws: ws, closeCh: closeCh})

	// Keepalive — same as RDP: prevent proxy idle-timeout from killing the tunnel.
	go func() {
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-closeCh:
				return
			case <-ticker.C:
				if err := ws.WriteFrame(0x9, nil); err != nil {
					closeAll()
					return
				}
			}
		}
	}()

	// Shell PTY output → WebSocket (binary frames)
	go func() {
		defer func() {
			activeTunnels.remove(sessionToken)
			closeAll()
			log.Printf("ssh tunnel %s: shell→WS relay finished", sessionToken)
		}()
		buf := make([]byte, 4096)
		for {
			n, err := shell.Read(buf)
			if n > 0 {
				_ = ws.WriteFrame(0x2, buf[:n])
			}
			if err != nil {
				return
			}
		}
	}()

	// WebSocket → shell PTY input (with resize message handling)
	go func() {
		defer func() {
			closeAll()
			log.Printf("ssh tunnel %s: WS→shell relay finished", sessionToken)
		}()
		for {
			opcode, payload, err := ws.ReadFrame()
			if err != nil {
				return
			}
			switch opcode {
			case 0x8: // close
				return
			case 0x9: // ping
				_ = ws.SendPong(payload)
			case 0x1: // text frame = JSON control message (resize, ...)
				var msg struct {
					Type string `json:"type"`
					Cols uint16 `json:"cols"`
					Rows uint16 `json:"rows"`
				}
				if json.Unmarshal(payload, &msg) == nil && msg.Type == "resize" {
					_ = shell.Resize(msg.Cols, msg.Rows)
				}
				// Never write control messages to the shell stdin.
			case 0x2: // binary frame = raw shell stdin
				if len(payload) == 0 {
					continue
				}
				_, _ = shell.Write(payload)
			}
		}
	}()

	log.Printf("Command %s: ssh shell tunnel established (token=%s)", cmdID, sessionToken)
	return map[string]string{"sessionToken": sessionToken, "status": "tunnel_open"}, nil
}

// handleCloseRemoteTunnel implements the "close_remote_tunnel" command.
// It looks up the active tunnel by session token and shuts it down.
func (d *CommandDispatcher) handleCloseRemoteTunnel(cmd AgentCommand) (interface{}, error) {
	sessionToken := payloadString(cmd.Payload, "sessionToken")
	if sessionToken == "" {
		return nil, fmt.Errorf("close_remote_tunnel: missing sessionToken in payload")
	}

	ts, ok := activeTunnels.take(sessionToken)
	if !ok {
		log.Printf("Command %s: close_remote_tunnel: tunnel %s not found (already closed?)", cmd.ID, sessionToken)
		return map[string]string{
			"sessionToken": sessionToken,
			"status":       "not_found",
		}, nil
	}

	ts.close()
	log.Printf("Command %s: tunnel closed (token=%s)", cmd.ID, sessionToken)
	return map[string]string{
		"sessionToken": sessionToken,
		"status":       "tunnel_closed",
	}, nil
}
