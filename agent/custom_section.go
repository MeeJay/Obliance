package main

// ============================================================================
// Custom Section live output streams.
//
// On start_custom_section, spawns the configured command either in a PTY
// (for curses apps like htop/top/less) or with piped stdout/stderr. Stdout
// bytes are base64-encoded and pushed back to the server over the command
// channel as unsolicited messages of type 'custom_section_output'. On stop
// or process exit, a 'custom_section_closed' message is sent.
//
// Two separate opens on the same agent get two separate streams (and two
// separate processes) — this is required by the product design.
// ============================================================================

import (
	"encoding/base64"
	"fmt"
	"io"
	"os"
	"os/exec"
	"runtime"
	"sync"
	"syscall"
	"time"
)

type runningStream struct {
	streamID string
	cmd      *exec.Cmd
	closer   io.Closer // pty or stdout pipe, whichever applies
	done     chan struct{}
	cancel   func()
}

var (
	streamsMu sync.Mutex
	streams   = map[string]*runningStream{}
)

// StartCustomSection spawns the command and begins streaming output.
func StartCustomSection(streamID, command, rt string, usePty bool, cols, rows int) error {
	streamsMu.Lock()
	if _, ok := streams[streamID]; ok {
		streamsMu.Unlock()
		return fmt.Errorf("stream already running")
	}
	streamsMu.Unlock()

	// Build the exec.Cmd: wrap in a shell so the user's command is
	// interpreted naturally (supports pipes, env vars, quotes).
	var cmd *exec.Cmd
	switch rt {
	case "powershell":
		cmd = exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", command)
	case "cmd":
		cmd = exec.Command("cmd.exe", "/c", command)
	case "sh":
		cmd = exec.Command("sh", "-c", command)
	case "bash":
		fallthrough
	default:
		if runtime.GOOS == "windows" {
			cmd = exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", command)
		} else {
			cmd = exec.Command("bash", "-lc", command)
		}
	}

	// Curses apps (htop, top, less, watch) check the TERM env var and refuse
	// to start without it. Services running as systemd daemons often have an
	// empty env, so we inject a sane default.
	cmd.Env = append(os.Environ(),
		"TERM=xterm-256color",
		"LANG=C.UTF-8",
		"LC_ALL=C.UTF-8",
	)

	stream := &runningStream{
		streamID: streamID,
		cmd:      cmd,
		done:     make(chan struct{}),
	}
	doneOnce := sync.Once{}
	stream.cancel = func() {
		doneOnce.Do(func() { close(stream.done) })
	}

	if usePty && runtime.GOOS != "windows" {
		// Lazy-import to avoid pulling pty on Windows compilation.
		if err := startStreamWithPty(stream, cols, rows); err != nil {
			return err
		}
	} else {
		if err := startStreamWithPipe(stream); err != nil {
			return err
		}
	}

	streamsMu.Lock()
	streams[streamID] = stream
	streamsMu.Unlock()

	return nil
}

// StopCustomSection terminates the process for the given stream id.
func StopCustomSection(streamID string) {
	streamsMu.Lock()
	s, ok := streams[streamID]
	if ok {
		delete(streams, streamID)
	}
	streamsMu.Unlock()
	if !ok {
		return
	}
	s.cancel()
	if s.closer != nil {
		_ = s.closer.Close()
	}
	if s.cmd != nil && s.cmd.Process != nil {
		// Kill the process and its children (for shells that spawn subprocs).
		_ = s.cmd.Process.Signal(syscall.SIGKILL)
	}
}

// ResizeCustomSection updates the PTY window size (no-op on pipe-mode).
func ResizeCustomSection(streamID string, cols, rows int) {
	streamsMu.Lock()
	s, ok := streams[streamID]
	streamsMu.Unlock()
	if !ok {
		return
	}
	resizeStreamPty(s, cols, rows)
}

// sendStreamOutput pushes a chunk of bytes back to the server via the
// agent command channel as an unsolicited message.
func sendStreamOutput(streamID string, data []byte) {
	SendOnCommandChannel(map[string]any{
		"type":     "custom_section_output",
		"streamId": streamID,
		"data":     base64.StdEncoding.EncodeToString(data),
	})
}

func sendStreamClosed(streamID string, code int) {
	SendOnCommandChannel(map[string]any{
		"type":     "custom_section_closed",
		"streamId": streamID,
		"code":     code,
	})
}

// readLoop streams from the given reader to the server, in reasonably
// sized chunks. Exits on EOF / closed / stop signal.
func readLoop(s *runningStream, r io.Reader) {
	buf := make([]byte, 4096)
	for {
		select {
		case <-s.done:
			return
		default:
		}
		n, err := r.Read(buf)
		if n > 0 {
			sendStreamOutput(s.streamID, buf[:n])
		}
		if err != nil {
			break
		}
		// Small yield so a flood of output doesn't pin the CPU.
		time.Sleep(5 * time.Millisecond)
	}
	// Wait for the process to end, get exit code
	code := 0
	if s.cmd != nil {
		_ = s.cmd.Wait()
		if s.cmd.ProcessState != nil {
			code = s.cmd.ProcessState.ExitCode()
		}
	}
	sendStreamClosed(s.streamID, code)
	streamsMu.Lock()
	delete(streams, s.streamID)
	streamsMu.Unlock()
}

// StopAllCustomSections is called on agent shutdown.
func StopAllCustomSections() {
	streamsMu.Lock()
	ids := make([]string, 0, len(streams))
	for id := range streams {
		ids = append(ids, id)
	}
	streamsMu.Unlock()
	for _, id := range ids {
		StopCustomSection(id)
	}
}
