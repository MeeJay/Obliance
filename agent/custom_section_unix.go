//go:build !windows

package main

import (
	"os"

	"github.com/creack/pty"
)

func startStreamWithPty(s *runningStream, cols, rows int) error {
	// Open a pseudo-terminal and start the process attached to it.
	f, err := pty.StartWithSize(s.cmd, &pty.Winsize{
		Cols: uint16(cols),
		Rows: uint16(rows),
	})
	if err != nil {
		return err
	}
	s.closer = f
	go readLoop(s, f)
	return nil
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

type multiCloser struct {
	a io.Closer
	b io.Closer
}

func (m multiCloser) Close() error {
	_ = m.a.Close()
	_ = m.b.Close()
	return nil
}

func resizeStreamPty(s *runningStream, cols, rows int) {
	if s.closer == nil {
		return
	}
	f, ok := s.closer.(*os.File)
	if !ok {
		return
	}
	_ = pty.Setsize(f, &pty.Winsize{Cols: uint16(cols), Rows: uint16(rows)})
}
