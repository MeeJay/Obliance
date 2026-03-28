//go:build freebsd

package main

import (
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
)

const (
	freebsdRCScript  = "/usr/local/etc/rc.d/obliance_agent"
	installBinPath   = "/usr/local/sbin/obliance-agent"
	logFile          = "/var/log/obliance-agent.log"
)

func runAsService(urlFlag, keyFlag *string) bool {
	args := flag.Args()
	if len(args) == 0 {
		return false
	}
	switch args[0] {
	case "install":
		installFreeBSDService(*urlFlag, *keyFlag)
		return true
	case "uninstall":
		uninstallFreeBSDService()
		return true
	}
	return false
}

func installFreeBSDService(urlArg, keyArg string) {
	if urlArg == "" || keyArg == "" {
		fmt.Fprintln(os.Stderr, "Usage: sudo obliance-agent --url <URL> --key <KEY> install")
		os.Exit(1)
	}

	// ── 1. Save config ──────────────────────────────────────────────────────
	cfg := setupConfig(urlArg, keyArg)
	fmt.Printf("Config saved to %s\n", configFile)

	// ── 2. Copy binary ──────────────────────────────────────────────────────
	exePath, err := os.Executable()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Cannot determine binary path: %v\n", err)
		os.Exit(1)
	}
	exePath, _ = filepath.EvalSymlinks(exePath)

	if exePath != installBinPath {
		if err := copyFile(exePath, installBinPath, 0755); err != nil {
			fmt.Fprintf(os.Stderr, "Failed to copy binary to %s: %v\n", installBinPath, err)
			os.Exit(1)
		}
		fmt.Printf("Binary installed to %s\n", installBinPath)
	}

	// ── 3. Write rc.d script ────────────────────────────────────────────────
	rcScript := fmt.Sprintf(`#!/bin/sh

# PROVIDE: obliance_agent
# REQUIRE: NETWORKING SERVERS
# KEYWORD: shutdown

. /etc/rc.subr

name="obliance_agent"
rcvar="obliance_agent_enable"
pidfile="/var/run/${name}.pid"

command="%s"
command_args=">> %s 2>&1 & echo \$! > ${pidfile}"

start_cmd="${name}_start"
stop_cmd="${name}_stop"
status_cmd="${name}_status"

obliance_agent_start() {
    if [ -f "${pidfile}" ] && kill -0 "$(cat "${pidfile}")" 2>/dev/null; then
        echo "${name} is already running (pid $(cat "${pidfile}"))."
        return 0
    fi
    echo "Starting ${name}..."
    eval "${command}" ${command_args}
}

obliance_agent_stop() {
    if [ ! -f "${pidfile}" ]; then
        echo "${name} is not running."
        return 0
    fi
    echo "Stopping ${name}..."
    kill "$(cat "${pidfile}")" 2>/dev/null
    rm -f "${pidfile}"
}

obliance_agent_status() {
    if [ -f "${pidfile}" ] && kill -0 "$(cat "${pidfile}")" 2>/dev/null; then
        echo "${name} is running (pid $(cat "${pidfile}"))."
    else
        echo "${name} is not running."
        return 1
    fi
}

load_rc_config $name
: ${obliance_agent_enable:="NO"}
run_rc_command "$1"
`, installBinPath, logFile)

	if err := os.WriteFile(freebsdRCScript, []byte(rcScript), 0755); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to write rc.d script: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("RC script written to %s\n", freebsdRCScript)

	// ── 4. Enable in rc.conf ────────────────────────────────────────────────
	if err := newCmd("sysrc", "obliance_agent_enable=YES").Run(); err != nil {
		log.Printf("Warning: sysrc failed: %v — add obliance_agent_enable=\"YES\" to /etc/rc.conf manually", err)
	}

	// ── 5. Start service ────────────────────────────────────────────────────
	if err := newCmd("service", "obliance_agent", "start").Run(); err != nil {
		fmt.Fprintf(os.Stderr, "service start failed: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("\n✓ Obliance Agent installed and running\n")
	fmt.Printf("  RC script: %s\n", freebsdRCScript)
	fmt.Printf("  Logs:      %s\n", logFile)
	fmt.Println("  To stop:      sudo service obliance_agent stop")
	fmt.Println("  To uninstall: sudo obliance-agent uninstall")
	_ = cfg
}

func uninstallFreeBSDService() {
	fmt.Println("Stopping service…")
	_ = newCmd("service", "obliance_agent", "stop").Run()

	// Disable in rc.conf
	_ = newCmd("sysrc", "-x", "obliance_agent_enable").Run()

	for _, path := range []string{freebsdRCScript, installBinPath} {
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			fmt.Fprintf(os.Stderr, "Warning: could not remove %s: %v\n", path, err)
		} else if err == nil {
			fmt.Printf("Removed %s\n", path)
		}
	}

	fmt.Println("\n✓ Obliance Agent uninstalled.")
	fmt.Println("  Config and logs were kept. Remove manually if needed:")
	fmt.Printf("    sudo rm -rf %s %s\n", configDir, logFile)
}

func copyFile(src, dst string, mode os.FileMode) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		return err
	}

	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, in)
	return err
}
