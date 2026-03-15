package main

// tunnel.go — VNC remote-access relay for the Obliance agent.
//
// Flow:
//   Server sends open_remote_tunnel → agent:
//     1. Connects to the Obliance server via WebSocket
//        (ws(s)://<serverURL>/api/remote/agent-tunnel/<sessionToken>)
//     2. Connects to the local VNC service (localhost:5900 TCP)
//     3. Relays bytes bidirectionally until one side closes
//
// The relay runs entirely in background goroutines; the command ack is sent
// immediately after the connections are established (not when they close).

import (
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"strings"
	"sync"
)

// ── Tunnel state ──────────────────────────────────────────────────────────────

type tunnelState struct {
	ws      *wsConn
	vnc     net.Conn
	closeCh chan struct{}
	once    sync.Once // ensures closeCh is closed exactly once
}

func (ts *tunnelState) close() {
	ts.once.Do(func() { close(ts.closeCh) })
	ts.ws.Close()
	ts.vnc.Close()
}

// tunnelRegistry holds all active VNC tunnels keyed by session token.
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

// ── Command handlers ──────────────────────────────────────────────────────────

// handleOpenRemoteTunnel implements the "open_remote_tunnel" command.
// It establishes a WebSocket connection to the Obliance server and a TCP
// connection to the local VNC daemon, then relays traffic between them in two
// background goroutines. It returns as soon as both connections are open.
func (d *CommandDispatcher) handleOpenRemoteTunnel(cmd AgentCommand) (interface{}, error) {
	sessionToken := payloadString(cmd.Payload, "sessionToken")
	if sessionToken == "" {
		return nil, fmt.Errorf("open_remote_tunnel: missing sessionToken in payload")
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
		wsBase = base // already ws:// or wss://
	}
	wsURL := wsBase + "/api/remote/agent-tunnel/" + sessionToken

	log.Printf("Command %s: opening VNC tunnel → %s", cmd.ID, wsURL)

	// 1. Connect WebSocket to Obliance server
	ws, err := wsConnect(wsURL, http.Header{
		"X-Api-Key": []string{d.apiKey},
	})
	if err != nil {
		return nil, fmt.Errorf("open_remote_tunnel: server WS connect failed: %w", err)
	}

	// 2. Connect TCP to local VNC service
	vnc, err := net.Dial("tcp", "localhost:5900")
	if err != nil {
		ws.Close()
		return nil, fmt.Errorf("open_remote_tunnel: VNC connect failed (is VNC enabled on localhost:5900?): %w", err)
	}

	closeCh := make(chan struct{})
	ts := &tunnelState{ws: ws, vnc: vnc, closeCh: closeCh}
	activeTunnels.add(sessionToken, ts)

	// 3. VNC → WebSocket relay (reads TCP bytes, sends WS binary frames)
	go func() {
		defer func() {
			activeTunnels.remove(sessionToken)
			ts.close()
			log.Printf("VNC tunnel %s: VNC→WS relay finished", sessionToken)
		}()

		buf := make([]byte, 32768)
		for {
			select {
			case <-closeCh:
				return
			default:
			}
			n, err := vnc.Read(buf)
			if err != nil {
				if err != io.EOF {
					log.Printf("VNC tunnel %s: VNC read error: %v", sessionToken, err)
				}
				return
			}
			if err := ws.WriteFrame(0x2, buf[:n]); err != nil { // 0x2 = binary
				log.Printf("VNC tunnel %s: WS write error: %v", sessionToken, err)
				return
			}
		}
	}()

	// 4. WebSocket → VNC relay (reads WS frames, writes TCP bytes)
	go func() {
		defer func() {
			ts.close()
			log.Printf("VNC tunnel %s: WS→VNC relay finished", sessionToken)
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
					log.Printf("VNC tunnel %s: WS read error: %v", sessionToken, err)
				}
				return
			}
			switch opcode {
			case 0x8: // close frame
				return
			case 0x9: // ping → respond with pong
				_ = ws.SendPong(payload)
			case 0x1, 0x2: // text or binary → forward to VNC
				if len(payload) == 0 {
					continue
				}
				if _, err := vnc.Write(payload); err != nil {
					log.Printf("VNC tunnel %s: VNC write error: %v", sessionToken, err)
					return
				}
			}
		}
	}()

	log.Printf("Command %s: VNC tunnel established (token=%s)", cmd.ID, sessionToken)
	return map[string]string{
		"sessionToken": sessionToken,
		"status":       "tunnel_open",
	}, nil
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
	log.Printf("Command %s: VNC tunnel closed (token=%s)", cmd.ID, sessionToken)
	return map[string]string{
		"sessionToken": sessionToken,
		"status":       "tunnel_closed",
	}, nil
}
