package main

// websocket.go — minimal WebSocket client built on top of Go's stdlib only.
// No external dependencies required (no gorilla/websocket, nhooyr.io/websocket, …).
// Implements just enough of RFC 6455 to:
//   - Perform the HTTP/1.1 upgrade handshake
//   - Read unmasked frames from the server
//   - Write masked binary frames to the server (clients MUST mask)
//   - Respond to server ping frames with pong frames
//   - Send a close frame and shut down cleanly

import (
	"bufio"
	"crypto/rand"
	"crypto/sha1"
	"crypto/tls"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
)

const wsGUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

// wsConn is an established WebSocket client connection.
type wsConn struct {
	conn net.Conn
	r    *bufio.Reader
}

// wsConnect dials rawURL (ws:// or wss://, or http:// / https:// aliases),
// performs the HTTP upgrade handshake, and returns a ready-to-use wsConn.
// extraHeaders are appended verbatim to the upgrade request.
func wsConnect(rawURL string, extraHeaders http.Header) (*wsConn, error) {
	scheme, host, path, err := parseWsURL(rawURL)
	if err != nil {
		return nil, err
	}

	// Dial TCP (plain or TLS)
	var conn net.Conn
	if scheme == "wss" {
		conn, err = tls.Dial("tcp", host, &tls.Config{
			InsecureSkipVerify: true, // self-signed certs are common in self-hosted RMM
		})
	} else {
		conn, err = net.Dial("tcp", host)
	}
	if err != nil {
		return nil, fmt.Errorf("wsConnect: dial %s: %w", host, err)
	}

	// Generate random 16-byte WebSocket key
	keyBytes := make([]byte, 16)
	if _, err := rand.Read(keyBytes); err != nil {
		conn.Close()
		return nil, fmt.Errorf("wsConnect: rand key: %w", err)
	}
	key := base64.StdEncoding.EncodeToString(keyBytes)

	// Build the HTTP/1.1 upgrade request
	var sb strings.Builder
	sb.WriteString("GET " + path + " HTTP/1.1\r\n")
	sb.WriteString("Host: " + host + "\r\n")
	sb.WriteString("Upgrade: websocket\r\n")
	sb.WriteString("Connection: Upgrade\r\n")
	sb.WriteString("Sec-WebSocket-Key: " + key + "\r\n")
	sb.WriteString("Sec-WebSocket-Version: 13\r\n")
	for k, vals := range extraHeaders {
		for _, v := range vals {
			sb.WriteString(k + ": " + v + "\r\n")
		}
	}
	sb.WriteString("\r\n")

	if _, err := io.WriteString(conn, sb.String()); err != nil {
		conn.Close()
		return nil, fmt.Errorf("wsConnect: write handshake: %w", err)
	}

	// Read and validate the server response
	r := bufio.NewReaderSize(conn, 65536)

	statusLine, err := r.ReadString('\n')
	if err != nil {
		conn.Close()
		return nil, fmt.Errorf("wsConnect: read status line: %w", err)
	}
	if !strings.Contains(statusLine, "101") {
		conn.Close()
		return nil, fmt.Errorf("wsConnect: expected 101 Switching Protocols, got: %s", strings.TrimSpace(statusLine))
	}

	// Drain the response headers
	for {
		line, err := r.ReadString('\n')
		if err != nil {
			conn.Close()
			return nil, fmt.Errorf("wsConnect: drain headers: %w", err)
		}
		if strings.TrimSpace(line) == "" {
			break
		}
	}

	return &wsConn{conn: conn, r: r}, nil
}

// parseWsURL splits rawURL into (scheme, host:port, /path?query).
func parseWsURL(rawURL string) (scheme, host, path string, err error) {
	switch {
	case strings.HasPrefix(rawURL, "wss://"):
		scheme, rawURL = "wss", rawURL[6:]
	case strings.HasPrefix(rawURL, "ws://"):
		scheme, rawURL = "ws", rawURL[5:]
	case strings.HasPrefix(rawURL, "https://"):
		scheme, rawURL = "wss", rawURL[8:]
	case strings.HasPrefix(rawURL, "http://"):
		scheme, rawURL = "ws", rawURL[7:]
	default:
		err = fmt.Errorf("parseWsURL: unsupported scheme in %q", rawURL)
		return
	}

	if idx := strings.Index(rawURL, "/"); idx >= 0 {
		host, path = rawURL[:idx], rawURL[idx:]
	} else {
		host, path = rawURL, "/"
	}

	if !strings.Contains(host, ":") {
		if scheme == "wss" {
			host += ":443"
		} else {
			host += ":80"
		}
	}
	return
}

// wsAccept computes the expected Sec-WebSocket-Accept value (RFC 6455 §4.1).
func wsAccept(key string) string {
	h := sha1.New()
	h.Write([]byte(key + wsGUID))
	return base64.StdEncoding.EncodeToString(h.Sum(nil))
}

// ── Frame I/O ─────────────────────────────────────────────────────────────────

// ReadFrame reads one complete WebSocket frame from the server.
// Returns (opcode, payload, error).
// The server sends UNMASKED frames; this function handles that transparently.
func (ws *wsConn) ReadFrame() (opcode byte, payload []byte, err error) {
	// Header byte 0: FIN + RSV + opcode
	h0, err := ws.r.ReadByte()
	if err != nil {
		return 0, nil, err
	}
	opcode = h0 & 0x0F

	// Header byte 1: MASK flag + base payload length
	h1, err := ws.r.ReadByte()
	if err != nil {
		return 0, nil, err
	}
	masked := (h1 & 0x80) != 0
	payLen := uint64(h1 & 0x7F)

	switch payLen {
	case 126:
		var l uint16
		if err = binary.Read(ws.r, binary.BigEndian, &l); err != nil {
			return 0, nil, err
		}
		payLen = uint64(l)
	case 127:
		if err = binary.Read(ws.r, binary.BigEndian, &payLen); err != nil {
			return 0, nil, err
		}
	}

	var maskKey [4]byte
	if masked {
		if _, err = io.ReadFull(ws.r, maskKey[:]); err != nil {
			return 0, nil, err
		}
	}

	if payLen > 0 {
		payload = make([]byte, payLen)
		if _, err = io.ReadFull(ws.r, payload); err != nil {
			return 0, nil, err
		}
		if masked {
			for i := range payload {
				payload[i] ^= maskKey[i%4]
			}
		}
	}
	return opcode, payload, nil
}

// WriteFrame sends a WebSocket frame to the server.
// Clients MUST mask every frame they send (RFC 6455 §5.3).
// opcode: 0x1 text, 0x2 binary, 0x8 close, 0x9 ping, 0xA pong.
func (ws *wsConn) WriteFrame(opcode byte, payload []byte) error {
	payLen := len(payload)

	// Assemble the 2-byte base header + optional extended length
	var header []byte
	header = append(header, 0x80|opcode) // FIN=1 | opcode

	switch {
	case payLen <= 125:
		header = append(header, 0x80|byte(payLen)) // MASK=1
	case payLen <= 65535:
		header = append(header, 0x80|126)
		header = append(header, byte(payLen>>8), byte(payLen))
	default:
		header = append(header, 0x80|127)
		for i := 7; i >= 0; i-- {
			header = append(header, byte(payLen>>(uint(i)*8)))
		}
	}

	// 4-byte masking key
	var maskKey [4]byte
	if _, err := rand.Read(maskKey[:]); err != nil {
		return fmt.Errorf("wsConn.WriteFrame: generate mask: %w", err)
	}
	header = append(header, maskKey[:]...)

	// Apply mask to payload copy
	masked := make([]byte, payLen)
	for i, b := range payload {
		masked[i] = b ^ maskKey[i%4]
	}

	frame := append(header, masked...)
	_, err := ws.conn.Write(frame)
	return err
}

// SendPong replies to a server ping with a pong carrying the same payload.
func (ws *wsConn) SendPong(payload []byte) error {
	return ws.WriteFrame(0xA, payload)
}

// Close sends a WebSocket close frame and closes the underlying TCP connection.
func (ws *wsConn) Close() {
	_ = ws.WriteFrame(0x8, []byte{}) // best-effort close frame
	_ = ws.conn.Close()
}
