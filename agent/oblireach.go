package main

// oblireach.go — Native screen-streaming protocol handler for the Obliance agent.
//
// Activated when the server sends open_remote_tunnel with protocol="oblireach".
// Instead of proxying to a local VNC/RDP service, the agent captures the screen
// directly, encodes frames as JPEG, and streams them to the browser over the
// existing WebSocket relay infrastructure.
//
// Platform-specific capture / input code lives in:
//   oblireach_windows.go  (Windows — GDI screen capture, SendInput events)
//   oblireach_stub.go     (all other platforms — returns "not supported")

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"
)

// ── Wire types ────────────────────────────────────────────────────────────────

const (
	orFrameTypeJPEG = byte(0x01)
	// 0x02 reserved for H.264
	// 0x03 reserved for Opus
)

// orControlMsg is a JSON control frame.
type orControlMsg struct {
	Type   string `json:"type"`
	// init / resize
	Width  int `json:"width,omitempty"`
	Height int `json:"height,omitempty"`
	FPS    int `json:"fps,omitempty"`
	// cursor
	X int `json:"x,omitempty"`
	Y int `json:"y,omitempty"`
}

// orInputMsg is an inbound JSON frame from the browser.
type orInputMsg struct {
	Type   string `json:"type"`
	// mouse + cursor position (shared)
	X      int     `json:"x"`
	Y      int     `json:"y"`
	Action string  `json:"action"`  // move | down | up | scroll
	Button int     `json:"button"`  // 1=left,2=middle,3=right
	Delta  float64 `json:"delta"`   // scroll wheel (lines)
	// key
	Code  string `json:"code"`
	Ctrl  bool   `json:"ctrl"`
	Shift bool   `json:"shift"`
	Alt   bool   `json:"alt"`
	Meta  bool   `json:"meta"`
	// resize_viewport
	Width  int `json:"width,omitempty"`
	Height int `json:"height,omitempty"`
}

// ── orSession tracks one active Oblireach streaming session ──────────────────

type orSession struct {
	ws      *wsConn
	closeCh chan struct{}
	once    sync.Once
}

func (s *orSession) close() {
	s.once.Do(func() { close(s.closeCh) })
	s.ws.Close()
}

// ── handleOblireach — called from the command dispatcher ─────────────────────

// handleOblireach is invoked when `protocol == "oblireach"` in an
// open_remote_tunnel command.  It:
//  1. Connects the agent WebSocket to the relay.
//  2. Sends an `init` control frame.
//  3. Launches the capture loop.
//  4. Returns immediately (relay runs in background goroutines).
func (d *CommandDispatcher) handleOblireach(cmd AgentCommand) (interface{}, error) {
	sessionToken := payloadString(cmd.Payload, "sessionToken")
	if sessionToken == "" {
		return nil, fmt.Errorf("oblireach: missing sessionToken in payload")
	}

	// Resolve relay WebSocket URL.
	// Payload may contain a direct "relayWsUrl" (used when a dedicated
	// Oblireach relay server is deployed).  Fall back to the Obliance
	// built-in tunnel endpoint so the feature works out of the box.
	relayWsURL := payloadString(cmd.Payload, "relayWsUrl")
	if relayWsURL == "" {
		base := strings.TrimRight(d.serverURL, "/")
		switch {
		case strings.HasPrefix(base, "https://"):
			relayWsURL = "wss://" + base[8:]
		case strings.HasPrefix(base, "http://"):
			relayWsURL = "ws://" + base[7:]
		default:
			relayWsURL = base
		}
		relayWsURL += "/api/remote/agent-tunnel/" + sessionToken
	} else {
		// Dedicated relay: append role + sessionToken query params
		sep := "?"
		if strings.Contains(relayWsURL, "?") {
			sep = "&"
		}
		relayWsURL += sep + "role=agent&sessionToken=" + sessionToken
	}

	log.Printf("[oblireach] cmd %s: connecting to relay %s", cmd.ID, relayWsURL)

	ws, err := wsConnect(relayWsURL, http.Header{
		"X-Api-Key":            []string{d.apiKey},
		"X-Oblireach-ApiKey":   []string{d.apiKey},
	})
	if err != nil {
		return nil, fmt.Errorf("oblireach: relay connect: %w", err)
	}

	// Check capture support before sending init
	w, h, err := orScreenSize()
	if err != nil {
		ws.Close()
		return nil, fmt.Errorf("oblireach: screen size: %w", err)
	}

	closeCh := make(chan struct{})
	sess := &orSession{ws: ws, closeCh: closeCh}
	activeTunnels.add(sessionToken, &tunnelState{ws: ws, closeCh: closeCh})

	// Send init frame
	initMsg, _ := json.Marshal(orControlMsg{Type: "init", Width: w, Height: h, FPS: orDefaultFPS()})
	if err := ws.WriteFrame(0x1, initMsg); err != nil {
		sess.close()
		return nil, fmt.Errorf("oblireach: send init: %w", err)
	}

	// ── Capture loop: screen → relay ─────────────────────────────────────────
	go func() {
		defer func() {
			activeTunnels.remove(sessionToken)
			sess.close()
			log.Printf("[oblireach] session %s: capture loop ended", sessionToken[:8])
		}()

		interval := time.Second / time.Duration(orDefaultFPS())
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for {
			select {
			case <-closeCh:
				return
			case <-ticker.C:
			}

			jpeg, err := orCaptureJPEG()
			if err != nil {
				log.Printf("[oblireach] capture error: %v", err)
				continue
			}

			// Prepend 1-byte frame type
			frame := make([]byte, 1+len(jpeg))
			frame[0] = orFrameTypeJPEG
			copy(frame[1:], jpeg)

			if err := ws.WriteFrame(0x2, frame); err != nil {
				log.Printf("[oblireach] ws write error: %v", err)
				return
			}
		}
	}()

	// ── Input loop: relay → OS events ────────────────────────────────────────
	go func() {
		defer func() {
			sess.close()
			log.Printf("[oblireach] session %s: input loop ended", sessionToken[:8])
		}()

		for {
			select {
			case <-closeCh:
				return
			default:
			}

			opcode, payload, err := ws.ReadFrame()
			if err != nil {
				return
			}
			switch opcode {
			case 0x8: // close
				return
			case 0x9: // ping → pong
				_ = ws.SendPong(payload)
			case 0x1: // text = JSON control
				var msg orInputMsg
				if err := json.Unmarshal(payload, &msg); err != nil {
					continue
				}
				orHandleInput(msg)
			}
		}
	}()

	// ── Keepalive ─────────────────────────────────────────────────────────────
	go func() {
		t := time.NewTicker(15 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-closeCh:
				return
			case <-t.C:
				if err := ws.WriteFrame(0x9, nil); err != nil {
					sess.close()
					return
				}
			}
		}
	}()

	log.Printf("[oblireach] cmd %s: streaming started (token=%s)", cmd.ID, sessionToken[:8])
	return map[string]string{"sessionToken": sessionToken, "status": "streaming"}, nil
}

// orHandleInput dispatches a browser input event to the platform-specific
// injection layer.  No-op on unsupported platforms.
func orHandleInput(msg orInputMsg) {
	switch msg.Type {
	case "mouse":
		orInjectMouse(msg)
	case "key":
		orInjectKey(msg)
	case "ping":
		// nothing — keepalive handled in frame loop
	}
}
