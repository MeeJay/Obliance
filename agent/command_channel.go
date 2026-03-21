package main

// command_channel.go — persistent WebSocket "push channel" from server to agent.
//
// The agent maintains a long-lived WebSocket to /api/agent/ws.
// The server uses this channel to deliver commands instantly (e.g.
// open_remote_tunnel) instead of waiting for the next poll cycle (≤60 s).
//
// Protocol (text frames, JSON):
//
//   Server → Agent  {"type":"command","id":"...","commandType":"...","payload":{...}}
//   Agent  → Server {"type":"ack","id":"...","commandType":"...","success":true/false,
//                    "sessionToken":"...","error":"..."}
//
// Auth: standard X-Api-Key header on the WebSocket upgrade request.
// Reconnect: automatic, with a 10 s back-off.

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"
)

// ── Message types ─────────────────────────────────────────────────────────────

type hubCommand struct {
	Type        string          `json:"type"`
	ID          string          `json:"id"`
	CommandType string          `json:"commandType"`
	Payload     json.RawMessage `json:"payload"`
}

type hubAck struct {
	Type         string          `json:"type"`
	ID           string          `json:"id"`
	CommandType  string          `json:"commandType"`
	Success      bool            `json:"success"`
	Result       json.RawMessage `json:"result,omitempty"`
	SessionToken string          `json:"sessionToken,omitempty"`
	Error        string          `json:"error,omitempty"`
}

// ── Global WS writer ─────────────────────────────────────────────────────────
// Allows other goroutines (e.g. privacy watcher) to send messages on the
// command channel when it is connected.

var (
	cmdChanWs   *wsConn
	cmdChanMu   sync.Mutex
)

// SendOnCommandChannel sends a JSON text frame on the command channel WS.
// No-op if the channel is not connected.
func SendOnCommandChannel(msg interface{}) {
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}
	cmdChanMu.Lock()
	ws := cmdChanWs
	cmdChanMu.Unlock()
	if ws == nil {
		return
	}
	_ = ws.WriteFrame(0x1, data)
}

// ── Entry point ───────────────────────────────────────────────────────────────

// runCommandChannel loops forever, reconnecting to the server command channel
// after each disconnect.  It should be started in a goroutine.
func runCommandChannel(d *CommandDispatcher, serverURL, apiKey string) {
	for {
		if err := connectCommandChannel(d, serverURL, apiKey); err != nil {
			log.Printf("[cmd-channel] disconnected: %v — retrying in 10s", err)
		}
		time.Sleep(10 * time.Second)
	}
}

// connectCommandChannel dials /api/agent/ws, handles incoming commands and
// returns when the connection is lost.
func connectCommandChannel(d *CommandDispatcher, serverURL, apiKey string) error {
	base := strings.TrimRight(serverURL, "/")
	var wsBase string
	switch {
	case strings.HasPrefix(base, "https://"):
		wsBase = "wss://" + base[8:]
	case strings.HasPrefix(base, "http://"):
		wsBase = "ws://" + base[7:]
	default:
		wsBase = base
	}
	wsURL := wsBase + "/api/agent/ws"

	ws, err := wsConnect(wsURL, http.Header{
		"X-Api-Key":     []string{apiKey},
		"X-Device-UUID": []string{d.deviceUUID},
	})
	if err != nil {
		return fmt.Errorf("connect: %w", err)
	}
	defer func() {
		cmdChanMu.Lock()
		cmdChanWs = nil
		cmdChanMu.Unlock()
		ws.Close()
	}()

	cmdChanMu.Lock()
	cmdChanWs = ws
	cmdChanMu.Unlock()

	log.Printf("[cmd-channel] connected to %s", wsURL)

	// Mutex protects concurrent writes from multiple command goroutines.
	var mu sync.Mutex
	sendAck := func(a hubAck) {
		data, err := json.Marshal(a)
		if err != nil {
			return
		}
		mu.Lock()
		defer mu.Unlock()
		_ = ws.WriteFrame(0x1, data) // text frame
	}

	for {
		opcode, payload, err := ws.ReadFrame()
		if err != nil {
			return fmt.Errorf("read: %w", err)
		}

		switch opcode {
		case 0x8: // close frame — server asked us to disconnect
			if len(payload) >= 2 {
				code := uint16(payload[0])<<8 | uint16(payload[1])
				reason := ""
				if len(payload) > 2 {
					reason = string(payload[2:])
				}
				log.Printf("[cmd-channel] server closed: code=%d reason=%q", code, reason)
			} else {
				log.Printf("[cmd-channel] server closed (no close code)")
			}
			return nil

		case 0x9: // ping — respond with pong
			mu.Lock()
			_ = ws.SendPong(payload)
			mu.Unlock()

		case 0x1, 0x2: // text or binary — parse as command JSON
			var msg hubCommand
			if err := json.Unmarshal(payload, &msg); err != nil {
				continue
			}
			if msg.Type != "command" {
				continue
			}
			// Dispatch each command in its own goroutine so the read loop is
			// never blocked by a slow operation (e.g. remote tunnel setup).
			go dispatchHubCommand(d, msg, sendAck)
		}
	}
}

// ── Command dispatch ──────────────────────────────────────────────────────────

func dispatchHubCommand(d *CommandDispatcher, msg hubCommand, sendAck func(hubAck)) {
	// Re-use the existing AgentCommand + dispatcher infrastructure.
	var payloadMap map[string]interface{}
	if len(msg.Payload) > 0 {
		_ = json.Unmarshal(msg.Payload, &payloadMap)
	}
	if payloadMap == nil {
		payloadMap = make(map[string]interface{})
	}

	cmd := AgentCommand{
		ID:      msg.ID,
		Type:    msg.CommandType,
		Payload: payloadMap,
	}

	var result interface{}
	var cmdErr error

	switch msg.CommandType {
	case "open_remote_tunnel":
		result, cmdErr = d.handleOpenRemoteTunnel(cmd)
	case "close_remote_tunnel":
		result, cmdErr = d.handleCloseRemoteTunnel(cmd)
	default:
		// All other command types are executed synchronously so the result
		// can be sent back via the WS channel immediately, without waiting
		// for the next HTTP push cycle (which can be up to 60 s away).
		result, cmdErr = d.ExecuteSync(cmd)
	}

	ack := hubAck{
		Type:        "ack",
		ID:          msg.ID,
		CommandType: msg.CommandType,
		Success:     cmdErr == nil,
	}
	if cmdErr != nil {
		ack.Error = cmdErr.Error()
		log.Printf("[cmd-channel] command %s (%s) failed: %v", msg.ID, msg.CommandType, cmdErr)
	} else if result != nil {
		if data, err := json.Marshal(result); err == nil {
			ack.Result = json.RawMessage(data)
		}
	}

	// Carry the session token in the ack so the server can route it.
	if st, ok := payloadMap["sessionToken"].(string); ok {
		ack.SessionToken = st
	}
	if ack.SessionToken == "" {
		if r, ok := result.(map[string]string); ok {
			ack.SessionToken = r["sessionToken"]
		}
	}

	sendAck(ack)
}
