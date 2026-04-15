//go:build windows

package main

import "io"

// On Windows we don't use a Unix PTY; curses-style apps are rare anyway.
// We just pipe stdout/stderr. The `usePty` flag is silently ignored.

func startStreamWithPty(s *runningStream, cols, rows int) error {
	return startStreamWithPipe(s)
}

func startStreamWithPipe(s *runningStream) error {
	stdout, err := s.cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := s.cmd.StderrPipe()
	if err != nil {
		return err
	}
	if err := s.cmd.Start(); err != nil {
		return err
	}
	s.closer = multiCloser{stdout, stderr}
	go readLoop(s, stdout)
	go readLoop(s, stderr)
	return nil
}

func resizeStreamPty(s *runningStream, cols, rows int) {
	// No-op on Windows
}

type multiCloser struct {
	a io.Closer
	b io.Closer
}

func (m multiCloser) Close() error {
	_ = m.a.Close()
	_ = m.b.Close()
	return nil
}
