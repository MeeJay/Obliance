//go:build windows

package main

import (
	"context"
	"os/exec"
	"syscall"
	"unsafe"
)

var (
	// kernel32 is declared in tunnel_shell_windows.go
	procCreateJobObject   = kernel32.NewProc("CreateJobObjectW")
	procSetInformationJob = kernel32.NewProc("SetInformationJobObject")
	procAssignProcess     = kernel32.NewProc("AssignProcessToJobObject")
	procOpenProcess       = kernel32.NewProc("OpenProcess")
)

const (
	jobObjectExtendedLimitInformationClass = 9
	jOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE    = 0x2000
	_PROCESS_ALL_ACCESS                    = 0x1F0FFF
)

type jobObjectBasicLimitInformation struct {
	PerProcessUserTimeLimit int64
	PerJobUserTimeLimit     int64
	LimitFlags              uint32
	MinimumWorkingSetSize   uintptr
	MaximumWorkingSetSize   uintptr
	ActiveProcessLimit      uint32
	Affinity                uintptr
	PriorityClass           uint32
	SchedulingClass         uint32
}

type ioCounters struct {
	ReadOperationCount  uint64
	WriteOperationCount uint64
	OtherOperationCount uint64
	ReadTransferCount   uint64
	WriteTransferCount  uint64
	OtherTransferCount  uint64
}

type jobObjectExtendedLimitInformation struct {
	BasicLimitInformation jobObjectBasicLimitInformation
	IoInfo                ioCounters
	ProcessMemoryLimit    uintptr
	JobMemoryLimit        uintptr
	PeakProcessMemoryUsed uintptr
	PeakJobMemoryUsed     uintptr
}

// newCmd wraps exec.Command and hides the console window on Windows so that
// child processes (powershell, sc, schtasks, msiexec…) never flash a CMD.
func newCmd(name string, args ...string) *exec.Cmd {
	cmd := exec.Command(name, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd
}

// newCmdDetached creates a fully detached child process that survives the
// parent's exit. Used for the MSI update batch script which must keep running
// after the agent service stops.
func newCmdDetached(name string, args ...string) *exec.Cmd {
	cmd := exec.Command(name, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP | 0x00000008, // CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS
	}
	return cmd
}

// newCmdContext wraps exec.CommandContext with the same hidden-window behavior.
// When the context expires, Go kills the main process. For full child-tree
// cleanup, use runCmdContextWithJobObject instead.
func newCmdContext(ctx context.Context, name string, args ...string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd
}

// createJobObject creates a Windows Job Object configured to kill all
// processes in the job when the handle is closed.
func createJobObject() (syscall.Handle, error) {
	r, _, err := procCreateJobObject.Call(0, 0)
	if r == 0 {
		return syscall.InvalidHandle, err
	}
	job := syscall.Handle(r)

	info := jobObjectExtendedLimitInformation{}
	info.BasicLimitInformation.LimitFlags = jOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE

	r2, _, err := procSetInformationJob.Call(
		uintptr(job),
		uintptr(jobObjectExtendedLimitInformationClass),
		uintptr(unsafe.Pointer(&info)),
		unsafe.Sizeof(info),
	)
	if r2 == 0 {
		syscall.CloseHandle(job)
		return syscall.InvalidHandle, err
	}
	return job, nil
}

// runCmdContextWithJobObject starts a command inside a Windows Job Object.
// When the context expires or the returned cleanup func is called, the entire
// process tree (powershell + COM hosts + msiexec children) is killed.
// The command's Stdout and Stderr must be set to buffers before calling.
func runCmdContextWithJobObject(ctx context.Context, cmd *exec.Cmd) error {
	if err := cmd.Start(); err != nil {
		return err
	}

	job, jobErr := createJobObject()
	if jobErr == nil {
		// AssignProcessToJobObject needs a process HANDLE, not a PID.
		h, _, _ := procOpenProcess.Call(_PROCESS_ALL_ACCESS, 0, uintptr(cmd.Process.Pid))
		if h != 0 {
			procAssignProcess.Call(uintptr(job), h)
			syscall.CloseHandle(syscall.Handle(h))
		}
	}

	// Wait for completion or context cancellation in a goroutine
	doneCh := make(chan error, 1)
	go func() { doneCh <- cmd.Wait() }()

	var err error
	select {
	case err = <-doneCh:
		// Process finished normally
	case <-ctx.Done():
		// Timeout — close the job handle to kill entire tree
		if jobErr == nil {
			syscall.CloseHandle(job)
			job = syscall.InvalidHandle
		}
		cmd.Process.Kill()
		<-doneCh
		err = ctx.Err()
	}

	if job != syscall.InvalidHandle && jobErr == nil {
		syscall.CloseHandle(job)
	}

	return err
}
