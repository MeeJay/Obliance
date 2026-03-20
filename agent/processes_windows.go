package main

import (
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	modKernel32Win           = windows.NewLazySystemDLL("kernel32.dll")
	modPsapi                 = windows.NewLazySystemDLL("psapi.dll")
	procCreateToolhelp32     = modKernel32Win.NewProc("CreateToolhelp32Snapshot")
	procProcess32FirstW      = modKernel32Win.NewProc("Process32FirstW")
	procProcess32NextW       = modKernel32Win.NewProc("Process32NextW")
	procGetProcessMemoryInfo = modPsapi.NewProc("GetProcessMemoryInfo")
)

const (
	_TH32CS_SNAPPROCESS = 0x00000002
	_MAX_PATH           = 260
)

type processEntry32W struct {
	Size            uint32
	Usage           uint32
	ProcessID       uint32
	DefaultHeapID   uintptr
	ModuleID        uint32
	Threads         uint32
	ParentProcessID uint32
	PriClassBase    int32
	Flags           uint32
	ExeFile         [_MAX_PATH]uint16
}

type processMemoryCountersEx struct {
	CB                         uint32
	PageFaultCount             uint32
	PeakWorkingSetSize         uintptr
	WorkingSetSize             uintptr
	QuotaPeakPagedPoolUsage    uintptr
	QuotaPagedPoolUsage        uintptr
	QuotaPeakNonPagedPoolUsage uintptr
	QuotaNonPagedPoolUsage     uintptr
	PagefileUsage              uintptr
	PeakPagefileUsage          uintptr
	PrivateUsage               uintptr
}

type cpuSnapshot struct {
	kernel uint64
	user   uint64
}

var (
	prevCPUSnap     map[uint32]cpuSnapshot
	prevCPUSnapTime time.Time
)

func collectProcessesWindows() ([]ProcessInfo, error) {
	handle, _, _ := procCreateToolhelp32.Call(_TH32CS_SNAPPROCESS, 0)
	if handle == uintptr(windows.InvalidHandle) {
		return collectProcessesTasklist()
	}
	snapHandle := windows.Handle(handle)
	defer windows.CloseHandle(snapHandle)

	var entry processEntry32W
	entry.Size = uint32(unsafe.Sizeof(entry))

	ret, _, err := procProcess32FirstW.Call(uintptr(snapHandle), uintptr(unsafe.Pointer(&entry)))
	if ret == 0 {
		return nil, err
	}

	now := time.Now()
	elapsed := now.Sub(prevCPUSnapTime).Seconds()
	hasPrev := prevCPUSnap != nil && elapsed > 0

	var sysInfo windows.SystemInfo
	windows.GetSystemInfo(&sysInfo)
	logicalCPUs := float64(sysInfo.NumberOfProcessors)
	if logicalCPUs < 1 {
		logicalCPUs = 1
	}

	newSnap := make(map[uint32]cpuSnapshot)
	var processes []ProcessInfo

	for {
		pid := entry.ProcessID
		if pid != 0 {
			name := windows.UTF16ToString(entry.ExeFile[:])
			proc := ProcessInfo{
				PID:  int(pid),
				Name: name,
			}

			hProc, e := windows.OpenProcess(
				windows.PROCESS_QUERY_LIMITED_INFORMATION|windows.PROCESS_VM_READ,
				false, pid,
			)
			if e == nil {
				// Memory (working set)
				var memCounters processMemoryCountersEx
				memCounters.CB = uint32(unsafe.Sizeof(memCounters))
				r, _, _ := procGetProcessMemoryInfo.Call(
					uintptr(hProc),
					uintptr(unsafe.Pointer(&memCounters)),
					uintptr(memCounters.CB),
				)
				if r != 0 {
					proc.MemBytes = int64(memCounters.WorkingSetSize)
				}

				// CPU times (kernel + user) for delta-based CPU%
				var creation, exit, kernel, user windows.Filetime
				if windows.GetProcessTimes(hProc, &creation, &exit, &kernel, &user) == nil {
					k := uint64(kernel.HighDateTime)<<32 | uint64(kernel.LowDateTime)
					u := uint64(user.HighDateTime)<<32 | uint64(user.LowDateTime)
					newSnap[pid] = cpuSnapshot{kernel: k, user: u}

					if hasPrev {
						if prev, ok := prevCPUSnap[pid]; ok {
							deltaK := k - prev.kernel
							deltaU := u - prev.user
							totalDelta := float64(deltaK+deltaU) / 1e7 // 100ns -> seconds
							cpuPct := (totalDelta / elapsed) / logicalCPUs * 100
							if cpuPct > 100 {
								cpuPct = 100
							}
							if cpuPct < 0 {
								cpuPct = 0
							}
							proc.CPUPercent = float64(int(cpuPct*10)) / 10
						}
					}
				}

				// Process owner
				proc.User = getProcessUser(hProc)

				windows.CloseHandle(hProc)
			}

			processes = append(processes, proc)
		}

		entry.Size = uint32(unsafe.Sizeof(entry))
		ret, _, _ = procProcess32NextW.Call(uintptr(snapHandle), uintptr(unsafe.Pointer(&entry)))
		if ret == 0 {
			break
		}
	}

	prevCPUSnap = newSnap
	prevCPUSnapTime = now

	return processes, nil
}

func getProcessUser(hProc windows.Handle) string {
	var token windows.Token
	if windows.OpenProcessToken(hProc, windows.TOKEN_QUERY, &token) != nil {
		return ""
	}
	defer token.Close()

	tokenUser, err := token.GetTokenUser()
	if err != nil {
		return ""
	}

	account, domain, _, err := tokenUser.User.Sid.LookupAccount("")
	if err != nil {
		return ""
	}

	if domain != "" {
		return domain + `\` + account
	}
	return account
}
