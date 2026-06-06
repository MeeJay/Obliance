//go:build windows

package main

import (
	"archive/zip"
	"bufio"
	"crypto/tls"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// vmConsoleDir is the writable install location for the downloaded helper
// bundle (helper exe + FreeRDP/x264 DLLs + OpenSSL legacy provider). We use
// ProgramData, not next to the agent exe (Program Files may be locked).
func vmConsoleDir() string { return filepath.Join(configDir, "vmconsole") }

// ensureVmConsoleInstalled returns the helper directory, downloading +
// extracting the ~130 MB vmconsole.zip bundle on first use (download-on-demand,
// only Hyper-V hosts ever reach here).
func (d *CommandDispatcher) ensureVmConsoleInstalled() (string, error) {
	dir := vmConsoleDir()
	helper := filepath.Join(dir, "vmconsole.exe")
	if _, err := os.Stat(helper); err == nil {
		return dir, nil
	}
	log.Printf("vm console: helper not present, downloading bundle…")
	if err := d.downloadVmConsole(dir); err != nil {
		return "", err
	}
	if _, err := os.Stat(helper); err != nil {
		return "", fmt.Errorf("vm console helper missing after install")
	}
	log.Printf("vm console: helper installed at %s", dir)
	return dir, nil
}

func (d *CommandDispatcher) downloadVmConsole(dir string) error {
	url := strings.TrimRight(d.serverURL, "/") + "/api/agent/download/vmconsole.zip"
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("X-Api-Key", d.apiKey)
	resp, err := (&http.Client{Timeout: 15 * time.Minute}).Do(req)
	if err != nil {
		return fmt.Errorf("download vmconsole.zip: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download vmconsole.zip: server returned %d", resp.StatusCode)
	}
	tmp := filepath.Join(os.TempDir(), "obl-vmconsole.zip")
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err := io.Copy(f, resp.Body); err != nil {
		f.Close()
		return err
	}
	f.Close()
	defer os.Remove(tmp)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	return unzipFlat(tmp, dir)
}

// unzipFlat extracts a zip into dir, flattening any directory structure (the
// bundle is a flat set of files).
func unzipFlat(zipPath, dir string) error {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return err
	}
	defer r.Close()
	for _, zf := range r.File {
		if zf.FileInfo().IsDir() {
			continue
		}
		rc, err := zf.Open()
		if err != nil {
			return err
		}
		out, err := os.OpenFile(filepath.Join(dir, filepath.Base(zf.Name)),
			os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
		if err != nil {
			rc.Close()
			return err
		}
		_, cerr := io.Copy(out, rc)
		out.Close()
		rc.Close()
		if cerr != nil {
			return cerr
		}
	}
	return nil
}

// handleInstallVmConsole pre-downloads the helper (explicit "Install" action).
func (d *CommandDispatcher) handleInstallVmConsole(cmd AgentCommand) (interface{}, error) {
	if detectVirtualizationHost() == "" {
		return nil, fmt.Errorf("this host is not a Hyper-V host")
	}
	dir, err := d.ensureVmConsoleInstalled()
	if err != nil {
		return nil, err
	}
	return map[string]string{"status": "installed", "path": dir}, nil
}

// VM interactive console (Layer B). The Obliance agent spawns the bundled
// FreeRDP helper (vmconsole.exe), which connects to the Hyper-V VM basic console
// (host 2179 + VM GUID pre-connection blob, SSO as the agent's SYSTEM identity —
// no stored credentials), captures the framebuffer and encodes H.264. This
// handler bridges the helper's framed stdout to the SAME remote-tunnel relay
// that tunnel.go uses:
//
//   browser <-> /api/remote/tunnel/{token}  <->  server relay  <->
//   /api/remote/agent-tunnel/{token} <-> THIS agent <-> helper stdin/stdout <-> VM
//
// Helper stdout protocol: [1 byte type][uint32 LE len][payload]
//   'I' init  -> { width, height }   -> we emit a JSON "init" text WS frame
//   'F' frame -> H.264 Annex-B       -> we emit a binary WS frame [0x02][annexb]
// Browser input (JSON text WS frames) is relayed to the helper's stdin (the
// helper injects it into the FreeRDP session in a later increment).

type vmConsoleSession struct {
	closeOnce sync.Once
	closeFn   func()
}

var (
	vmConsolesMu sync.Mutex
	vmConsoles   = map[string]*vmConsoleSession{}
)

func vmConsoleRegister(token string, closeFn func()) {
	vmConsolesMu.Lock()
	vmConsoles[token] = &vmConsoleSession{closeFn: closeFn}
	vmConsolesMu.Unlock()
}

func vmConsoleUnregister(token string) {
	vmConsolesMu.Lock()
	delete(vmConsoles, token)
	vmConsolesMu.Unlock()
}

// handleCloseVmConsole stops an active VM console session by token.
func (d *CommandDispatcher) handleCloseVmConsole(cmd AgentCommand) (interface{}, error) {
	token := payloadString(cmd.Payload, "sessionToken")
	vmConsolesMu.Lock()
	s := vmConsoles[token]
	vmConsolesMu.Unlock()
	if s == nil {
		return map[string]string{"status": "not_found"}, nil
	}
	s.closeOnce.Do(func() { s.closeFn() })
	return map[string]string{"status": "vm_console_closed"}, nil
}

func (d *CommandDispatcher) handleOpenVmConsole(cmd AgentCommand) (interface{}, error) {
	sessionToken := payloadString(cmd.Payload, "sessionToken")
	if sessionToken == "" {
		return nil, fmt.Errorf("open_vm_console: missing sessionToken")
	}
	vmID := payloadString(cmd.Payload, "vmId")
	if vmID == "" {
		return nil, fmt.Errorf("open_vm_console: missing vmId")
	}

	// Helper bundle is downloaded on demand to ProgramData on first use.
	helperDir, err := d.ensureVmConsoleInstalled()
	if err != nil {
		return nil, fmt.Errorf("vm console: %w", err)
	}
	helper := filepath.Join(helperDir, "vmconsole.exe")

	// Relay WS URL — same scheme derivation as tunnel.go.
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

	var tlsCfg *tls.Config
	if d.tlsInsecureSkipVerify {
		tlsCfg = &tls.Config{InsecureSkipVerify: true}
	}
	ws, err := wsConnect(wsURL, http.Header{"X-Api-Key": []string{d.apiKey}}, tlsCfg)
	if err != nil {
		return nil, fmt.Errorf("vm console: relay WS connect failed: %w", err)
	}

	// Spawn the helper in stream mode ("-"), unlimited frames ("0").
	hc := hiddenCmd(helper, vmID, "-", "0")
	hc.Dir = helperDir
	hc.Env = append(os.Environ(), "OPENSSL_MODULES="+helperDir)
	stdout, err := hc.StdoutPipe()
	if err != nil {
		ws.Close()
		return nil, err
	}
	stdin, err := hc.StdinPipe()
	if err != nil {
		ws.Close()
		return nil, err
	}
	if err := hc.Start(); err != nil {
		ws.Close()
		return nil, fmt.Errorf("vm console: helper start: %w", err)
	}

	closeCh := make(chan struct{})
	var once sync.Once
	closeAll := func() {
		once.Do(func() { close(closeCh) })
		ws.Close()
		_ = stdin.Close()
		if hc.Process != nil {
			_ = hc.Process.Kill()
		}
		vmConsoleUnregister(sessionToken)
	}
	vmConsoleRegister(sessionToken, closeAll)

	// Keepalive so proxies don't drop the relay.
	go func() {
		t := time.NewTicker(15 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-closeCh:
				return
			case <-t.C:
				if ws.WriteFrame(0x9, nil) != nil {
					closeAll()
					return
				}
			}
		}
	}()

	// Helper framed stdout -> WS (init as JSON text, frames as 0x02 binary).
	go func() {
		defer closeAll()
		r := bufio.NewReaderSize(stdout, 1<<20)
		hdr := make([]byte, 5)
		for {
			if _, err := io.ReadFull(r, hdr); err != nil {
				return
			}
			n := binary.LittleEndian.Uint32(hdr[1:5])
			payload := make([]byte, n)
			if _, err := io.ReadFull(r, payload); err != nil {
				return
			}
			switch hdr[0] {
			case 'I':
				if n >= 8 {
					w := binary.LittleEndian.Uint32(payload[0:4])
					h := binary.LittleEndian.Uint32(payload[4:8])
					msg, _ := json.Marshal(map[string]interface{}{
						"type": "init", "width": w, "height": h, "fps": 30, "codec": "h264",
					})
					if ws.WriteFrame(0x1, msg) != nil {
						return
					}
				}
			case 'F':
				frame := make([]byte, 0, n+1)
				frame = append(frame, 0x02) // browser frame-type: H.264
				frame = append(frame, payload...)
				if ws.WriteFrame(0x2, frame) != nil {
					return
				}
			}
		}
	}()

	// WS (browser input) -> helper stdin, line-delimited JSON.
	go func() {
		defer closeAll()
		for {
			opcode, payload, err := ws.ReadFrame()
			if err != nil {
				return
			}
			switch opcode {
			case 0x8:
				return
			case 0x9:
				_ = ws.SendPong(payload)
			case 0x1, 0x2:
				if len(payload) > 0 {
					_, _ = stdin.Write(append(payload, '\n'))
				}
			}
		}
	}()

	// Reap the helper when it exits.
	go func() {
		_ = hc.Wait()
		closeAll()
	}()

	log.Printf("Command %s: vm console open (vm=%s token=%s)", cmd.ID, vmID, sessionToken)
	return map[string]string{"status": "vm_console_open", "sessionToken": sessionToken}, nil
}
