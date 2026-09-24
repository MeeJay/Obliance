//go:build linux

package main

// sshjump_linux.go — T1 native ProxyJump for the Obliance SSH bastion.
//
// `ssh -J you@bastion obli@MACHINE` reaches the machine's REAL sshd through the
// agent tunnel (protocol "sshjump" = TCP relay to the local sshd). For that
// sshd to accept the user's key, the server asks the agent (root) to install a
// ONE-TIME authorized_keys line for the dedicated `obli` account:
//
//   from="127.0.0.1,::1"[,expiry-time="YYYYMMDDHHMM"] <type> <base64> obliance-grant:<id>:<unix-expiry>
//
// Guarantees:
//   - sshd_config is NEVER modified (works from OpenSSH 4.x to current);
//   - the `obli` account has no usable password ('*'), and its authorized_keys
//     is root-owned and empty at rest;
//   - from=loopback: a line only works through the agent relay;
//   - every line expires: removed on revoke, by the janitor at expiry (crash /
//     lost revoke), and by sshd itself via expiry-time on OpenSSH >= 7.6;
//   - an existing `obli` account NOT created by Obliance is never touched.

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"log"
	"net"
	"os"
	"os/exec"
	"os/user"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	sshJumpUser    = "obli"
	sshJumpGecos   = "Obliance bastion (ProxyJump)"
	sshJumpSudoers = "/etc/sudoers.d/obliance-obli"
	sshJumpMarker  = "obliance-grant:"
	sshJumpMaxTTL  = 15 * time.Minute
)

var (
	sshJumpMu      sync.Mutex // serializes every authorized_keys / account change
	sshJumpGrantRe = regexp.MustCompile(`^[0-9a-fA-F-]{8,64}$`)
	sshJumpB64Re   = regexp.MustCompile(`^[A-Za-z0-9+/]+={0,2}$`)
	sshJumpTypes   = map[string]bool{
		"ssh-ed25519": true, "ssh-rsa": true,
		"ecdsa-sha2-nistp256": true, "ecdsa-sha2-nistp384": true, "ecdsa-sha2-nistp521": true,
	}

	sshJumpAddrMu   sync.Mutex
	sshJumpLastAddr string // sshd address that answered at the last grant

	sshJumpInfoMu sync.Mutex
	sshJumpInfo   *sshdInfo
	sshJumpInfoAt time.Time

	sshJumpKeyFilesMu sync.Mutex
	sshJumpKeyFiles   = map[string]bool{} // key files that received a grant (janitor scope)
)

type sshdInfo struct {
	ports        []int
	listen       []string
	keyFiles     []string // AuthorizedKeysFile entries (raw, with %tokens)
	allowUsers   []string
	allowGroups  []string
	denyUsers    []string
	denyGroups   []string
	pubkeyAuth   string
	major, minor int
}

// ── sshd discovery (read-only) ───────────────────────────────────────────────

func runQuiet(timeout time.Duration, name string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	return newCmdContext(ctx, name, args...).CombinedOutput()
}

func sshdBinary() string {
	for _, p := range []string{"/usr/sbin/sshd", "/usr/local/sbin/sshd", "/sbin/sshd"} {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	if p, err := exec.LookPath("sshd"); err == nil {
		return p
	}
	return ""
}

func parseSshdConfigLines(lines []string, info *sshdInfo, stopAtMatch bool) {
	for _, raw := range lines {
		line := strings.TrimSpace(raw)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		fields := strings.Fields(line)
		key := strings.ToLower(fields[0])
		// sshd_config also accepts "Key=value".
		if i := strings.Index(key, "="); i > 0 {
			fields = append([]string{key[:i], key[i+1:]}, fields[1:]...)
			key = key[:i]
		}
		if stopAtMatch && key == "match" {
			return // conditional blocks: only the global section is reliable here
		}
		vals := fields[1:]
		switch key {
		case "port":
			for _, v := range vals {
				if p, err := strconv.Atoi(v); err == nil && p > 0 && p < 65536 {
					info.ports = append(info.ports, p)
				}
			}
		case "listenaddress":
			info.listen = append(info.listen, vals...)
		case "authorizedkeysfile":
			info.keyFiles = vals
		case "allowusers":
			info.allowUsers = append(info.allowUsers, vals...)
		case "allowgroups":
			info.allowGroups = append(info.allowGroups, vals...)
		case "denyusers":
			info.denyUsers = append(info.denyUsers, vals...)
		case "denygroups":
			info.denyGroups = append(info.denyGroups, vals...)
		case "pubkeyauthentication":
			if len(vals) > 0 {
				info.pubkeyAuth = strings.ToLower(vals[0])
			}
		}
	}
}

func readSshdInfo() *sshdInfo {
	sshJumpInfoMu.Lock()
	defer sshJumpInfoMu.Unlock()
	if sshJumpInfo != nil && time.Since(sshJumpInfoAt) < 10*time.Minute {
		return sshJumpInfo
	}
	info := &sshdInfo{}
	parsed := false
	if bin := sshdBinary(); bin != "" {
		// Effective config for `obli` coming from loopback (Match blocks
		// evaluated) — then plain -T for older sshd without -C.
		for _, args := range [][]string{
			{"-T", "-C", "user=" + sshJumpUser + ",host=localhost,addr=127.0.0.1"},
			{"-T"},
		} {
			out, err := runQuiet(10*time.Second, bin, args...)
			if err == nil && len(out) > 0 {
				parseSshdConfigLines(strings.Split(string(out), "\n"), info, false)
				parsed = true
				break
			}
		}
	}
	if !parsed { // OpenSSH < 5.1 has no -T: read the global section of the file
		if data, err := os.ReadFile("/etc/ssh/sshd_config"); err == nil {
			parseSshdConfigLines(strings.Split(string(data), "\n"), info, true)
		}
	}
	if len(info.ports) == 0 {
		info.ports = []int{22}
	}
	if len(info.keyFiles) == 0 {
		info.keyFiles = []string{".ssh/authorized_keys"}
	}
	if info.pubkeyAuth == "" {
		info.pubkeyAuth = "yes"
	}
	// Client and server ship in the same package: `ssh -V` gives the version.
	if out, err := runQuiet(5*time.Second, "ssh", "-V"); err == nil || len(out) > 0 {
		if m := regexp.MustCompile(`OpenSSH_(\d+)\.(\d+)`).FindStringSubmatch(string(out)); m != nil {
			info.major, _ = strconv.Atoi(m[1])
			info.minor, _ = strconv.Atoi(m[2])
		}
	}
	sshJumpInfo = info
	sshJumpInfoAt = time.Now()
	return info
}

func (i *sshdInfo) supportsExpiryTime() bool {
	return i.major > 7 || (i.major == 7 && i.minor >= 6)
}

func globAny(patterns []string, name string) bool {
	for _, p := range patterns {
		if at := strings.Index(p, "@"); at >= 0 {
			p = p[:at] // USER@HOST: the host part is loopback here, match the user part
		}
		if ok, _ := path.Match(p, name); ok {
			return true
		}
	}
	return false
}

// Refuses up front (with a clear reason) when the sshd configuration would
// reject `obli` anyway — the agent never edits sshd_config to "fix" it.
func (i *sshdInfo) checkObliAllowed() error {
	if i.pubkeyAuth == "no" {
		return fmt.Errorf("PubkeyAuthentication is disabled in sshd_config")
	}
	if globAny(i.denyUsers, sshJumpUser) || globAny(i.denyGroups, sshJumpUser) {
		return fmt.Errorf("sshd_config DenyUsers/DenyGroups excludes the '%s' account", sshJumpUser)
	}
	if len(i.allowUsers) > 0 && !globAny(i.allowUsers, sshJumpUser) {
		return fmt.Errorf("sshd_config AllowUsers does not include '%s' (add it to allow ProxyJump)", sshJumpUser)
	}
	if len(i.allowGroups) > 0 && !globAny(i.allowGroups, sshJumpUser) {
		return fmt.Errorf("sshd_config AllowGroups does not include the '%s' group (add it to allow ProxyJump)", sshJumpUser)
	}
	return nil
}

// ── Account ──────────────────────────────────────────────────────────────────

func gecosOf(name string) string {
	f, err := os.Open("/etc/passwd")
	if err != nil {
		return ""
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		parts := strings.Split(sc.Text(), ":")
		if len(parts) >= 5 && parts[0] == name {
			return parts[4]
		}
	}
	return ""
}

func ensureObliAccount() (*user.User, []string, error) {
	var warnings []string
	u, err := user.Lookup(sshJumpUser)
	if err == nil {
		// Never hijack a pre-existing account someone else created.
		if !strings.Contains(gecosOf(sshJumpUser), "Obliance") {
			return nil, nil, fmt.Errorf("a local account '%s' already exists and is not managed by Obliance", sshJumpUser)
		}
	} else {
		shell := "/bin/bash"
		if _, err := os.Stat(shell); err != nil {
			shell = "/bin/sh"
		}
		var out []byte
		var cerr error
		if _, lerr := exec.LookPath("useradd"); lerr == nil {
			out, cerr = runQuiet(30*time.Second, "useradd", "-m", "-s", shell, "-c", sshJumpGecos, sshJumpUser)
		} else {
			// BusyBox (Alpine): adduser -D = no password.
			out, cerr = runQuiet(30*time.Second, "adduser", "-D", "-s", shell, "-g", sshJumpGecos, sshJumpUser)
		}
		if cerr != nil {
			return nil, nil, fmt.Errorf("create account '%s': %v — %s", sshJumpUser, cerr, strings.TrimSpace(string(out)))
		}
		if u, err = user.Lookup(sshJumpUser); err != nil {
			return nil, nil, fmt.Errorf("account '%s' not found after creation: %v", sshJumpUser, err)
		}
		log.Printf("[sshjump] created account %s", sshJumpUser)
	}

	// No usable password, but NOT a '!' lock: with UsePAM=no, sshd refuses
	// even public-key logins to a '!'-locked account. '*' matches no password.
	if _, lerr := exec.LookPath("usermod"); lerr == nil {
		if out, err := runQuiet(15*time.Second, "usermod", "-p", "*", sshJumpUser); err != nil {
			warnings = append(warnings, "usermod -p: "+strings.TrimSpace(string(out)))
		}
	} else {
		warnings = append(warnings, "usermod not available: password field left as created")
	}

	if u.HomeDir != "" {
		if _, err := os.Stat(u.HomeDir); os.IsNotExist(err) {
			uid, _ := strconv.Atoi(u.Uid)
			gid, _ := strconv.Atoi(u.Gid)
			if err := os.MkdirAll(u.HomeDir, 0o750); err == nil {
				_ = os.Chown(u.HomeDir, uid, gid)
			}
		}
	}

	if w := ensureObliSudoers(); w != "" {
		warnings = append(warnings, w)
	}
	return u, warnings, nil
}

// NOPASSWD sudo for `obli` via a drop-in (validated by visudo). /etc/sudoers
// itself is never edited: without an includedir, sudo is simply unavailable.
func ensureObliSudoers() string {
	main, err := os.ReadFile("/etc/sudoers")
	if err != nil {
		return "sudo not configured (no /etc/sudoers)"
	}
	if !regexp.MustCompile(`(?m)^[#@]includedir\s+/etc/sudoers\.d`).Match(main) {
		return "sudo not configured (/etc/sudoers has no includedir /etc/sudoers.d)"
	}
	content := "# Managed by Obliance — SSH bastion ProxyJump account. Do not edit.\n" +
		sshJumpUser + " ALL=(ALL) NOPASSWD: ALL\n" +
		"Defaults:" + sshJumpUser + " !requiretty\n"
	if cur, err := os.ReadFile(sshJumpSudoers); err == nil && string(cur) == content {
		return ""
	}
	_ = os.MkdirAll("/etc/sudoers.d", 0o750)
	tmp := sshJumpSudoers + ".tmp"
	if err := os.WriteFile(tmp, []byte(content), 0o440); err != nil {
		return "sudo drop-in write failed: " + err.Error()
	}
	if _, lerr := exec.LookPath("visudo"); lerr == nil {
		if out, err := runQuiet(10*time.Second, "visudo", "-cf", tmp); err != nil {
			_ = os.Remove(tmp)
			return "sudo drop-in rejected by visudo: " + strings.TrimSpace(string(out))
		}
	}
	_ = os.Chown(tmp, 0, 0)
	if err := os.Rename(tmp, sshJumpSudoers); err != nil {
		_ = os.Remove(tmp)
		return "sudo drop-in install failed: " + err.Error()
	}
	return ""
}

// ── authorized_keys ──────────────────────────────────────────────────────────

func expandKeyFile(entry string, u *user.User) string {
	r := strings.NewReplacer("%%", "%", "%h", u.HomeDir, "%u", u.Username, "%U", u.Uid)
	p := r.Replace(entry)
	if !filepath.IsAbs(p) {
		p = filepath.Join(u.HomeDir, p)
	}
	return filepath.Clean(p)
}

// Rewrites a key file atomically, root-owned 0644 (sshd StrictModes accepts
// root or the user as owner; root ownership keeps `obli` from editing it).
func rewriteKeyFile(file string, edit func([]string) []string) error {
	var lines []string
	if data, err := os.ReadFile(file); err == nil {
		for _, l := range strings.Split(string(data), "\n") {
			if strings.TrimSpace(l) != "" {
				lines = append(lines, l)
			}
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	exists := lines != nil
	orig := append([]string(nil), lines...) // edit() may filter in place
	next := edit(lines)
	if exists && len(next) == len(orig) {
		same := true
		for i := range next {
			if next[i] != orig[i] {
				same = false
				break
			}
		}
		if same {
			return nil // nothing to change: no rewrite, no restorecon
		}
	}
	dir := filepath.Dir(file)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	_ = os.Chown(dir, 0, 0)
	_ = os.Chmod(dir, 0o755)
	tmp := file + ".obliance-tmp"
	body := strings.Join(next, "\n")
	if body != "" {
		body += "\n"
	}
	if err := os.WriteFile(tmp, []byte(body), 0o644); err != nil {
		return err
	}
	_ = os.Chown(tmp, 0, 0)
	if err := os.Rename(tmp, file); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	// SELinux: sshd may only read ssh_home_t — restore the default context.
	if _, lerr := exec.LookPath("restorecon"); lerr == nil {
		_, _ = runQuiet(10*time.Second, "restorecon", "-R", dir)
	}
	return nil
}

// grantExpiry returns the unix expiry carried by one of our lines, or -1.
func grantExpiry(line string) (string, int64) {
	i := strings.Index(line, sshJumpMarker)
	if i < 0 {
		return "", -1
	}
	rest := strings.Fields(line[i+len(sshJumpMarker):])
	if len(rest) == 0 {
		return "", -1
	}
	parts := strings.SplitN(rest[0], ":", 2)
	if len(parts) != 2 {
		return parts[0], 0 // malformed = expired
	}
	exp, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil {
		return parts[0], 0
	}
	return parts[0], exp
}

func validateKeyLine(line string) (string, string, error) {
	f := strings.Fields(line)
	if len(f) != 2 || !sshJumpTypes[f[0]] || !sshJumpB64Re.MatchString(f[1]) {
		return "", "", fmt.Errorf("invalid public key")
	}
	blob, err := base64.StdEncoding.DecodeString(f[1])
	if err != nil || len(blob) < 4 {
		return "", "", fmt.Errorf("invalid public key data")
	}
	n := binary.BigEndian.Uint32(blob[:4])
	if n > 64 || int(4+n) > len(blob) || string(blob[4:4+n]) != f[0] {
		return "", "", fmt.Errorf("public key type mismatch")
	}
	return f[0], f[1], nil
}

// ── sshd address ─────────────────────────────────────────────────────────────

func detectSshdAddr(info *sshdInfo) (string, string, error) {
	var cands []string
	for _, p := range info.ports {
		cands = append(cands, net.JoinHostPort("127.0.0.1", strconv.Itoa(p)), net.JoinHostPort("::1", strconv.Itoa(p)))
	}
	// sshd bound to a specific address only (no loopback listener).
	for _, la := range info.listen {
		host, port, err := net.SplitHostPort(la)
		if err != nil {
			host, port = strings.Trim(la, "[]"), strconv.Itoa(info.ports[0])
		}
		if host == "" || host == "0.0.0.0" || host == "::" {
			continue
		}
		cands = append(cands, net.JoinHostPort(host, port))
	}
	for _, c := range cands {
		conn, err := net.DialTimeout("tcp", c, 2*time.Second)
		if err == nil {
			conn.Close()
			host, _, _ := net.SplitHostPort(c)
			return c, host, nil
		}
	}
	return "", "", fmt.Errorf("no local sshd answered (tried %s)", strings.Join(cands, ", "))
}

// sshJumpTargetAddr is used by the "sshjump" tunnel: the address validated at
// the last grant, re-detected if unknown. Only local sshd addresses — never a
// server-supplied destination.
func sshJumpTargetAddr() (string, error) {
	sshJumpAddrMu.Lock()
	addr := sshJumpLastAddr
	sshJumpAddrMu.Unlock()
	if addr != "" {
		return addr, nil
	}
	a, _, err := detectSshdAddr(readSshdInfo())
	return a, err
}

// ── Commands ─────────────────────────────────────────────────────────────────

func (d *CommandDispatcher) handleSshJumpGrant(cmd AgentCommand) (interface{}, error) {
	grantID := payloadString(cmd.Payload, "grantId")
	if !sshJumpGrantRe.MatchString(grantID) {
		return nil, fmt.Errorf("ssh_jump_grant: invalid grantId")
	}
	keyType, keyB64, err := validateKeyLine(payloadString(cmd.Payload, "publicKey"))
	if err != nil {
		return nil, fmt.Errorf("ssh_jump_grant: %w", err)
	}
	expF, _ := cmd.Payload["expiresAt"].(float64)
	exp := time.Unix(int64(expF), 0)
	now := time.Now()
	if exp.Before(now.Add(30 * time.Second)) {
		return nil, fmt.Errorf("ssh_jump_grant: expiry too short or in the past (clock skew?)")
	}
	if exp.After(now.Add(sshJumpMaxTTL)) {
		exp = now.Add(sshJumpMaxTTL)
	}

	sshJumpMu.Lock()
	defer sshJumpMu.Unlock()

	info := readSshdInfo()
	if err := info.checkObliAllowed(); err != nil {
		return nil, err
	}
	u, warnings, err := ensureObliAccount()
	if err != nil {
		return nil, err
	}
	addr, host, err := detectSshdAddr(info)
	if err != nil {
		return nil, err
	}
	sshJumpAddrMu.Lock()
	sshJumpLastAddr = addr
	sshJumpAddrMu.Unlock()

	if len(info.keyFiles) == 0 || strings.EqualFold(info.keyFiles[0], "none") {
		return nil, fmt.Errorf("sshd AuthorizedKeysFile is 'none': key authentication from files is disabled")
	}
	keyFile := expandKeyFile(info.keyFiles[0], u)

	from := "127.0.0.1,::1"
	if host != "127.0.0.1" && host != "::1" {
		from += "," + host // relay dials a non-loopback listener: that is the source address
	}
	// no-agent-forwarding: root on the target must never get a handle on the
	// user's ssh-agent — with it, a compromised machine could authenticate to
	// the BASTION as the user (from an allow-listed LAN IP) and pivot to every
	// other machine. X11 closed for the same reason. Port forwarding stays
	// (VS Code Remote, -L), and it is always initiated by the client.
	opts := `from="` + from + `",no-agent-forwarding,no-X11-forwarding`
	if info.supportsExpiryTime() {
		// sshd reads expiry-time in the machine's local time; +1 min so the
		// minute granularity never cuts the TTL short.
		opts += `,expiry-time="` + exp.Add(time.Minute).Local().Format("200601021504") + `"`
	}
	entry := fmt.Sprintf("%s %s %s %s%s:%d", opts, keyType, keyB64, sshJumpMarker, grantID, exp.Unix())

	nowUnix := now.Unix()
	if err := rewriteKeyFile(keyFile, func(lines []string) []string {
		out := lines[:0]
		for _, l := range lines {
			id, e := grantExpiry(l)
			if e >= 0 && (e <= nowUnix || id == grantID) {
				continue // drop expired grants and any previous line of this grant
			}
			out = append(out, l)
		}
		return append(out, entry)
	}); err != nil {
		return nil, fmt.Errorf("ssh_jump_grant: write %s: %w", keyFile, err)
	}
	sshJumpKeyFilesMu.Lock()
	sshJumpKeyFiles[keyFile] = true
	sshJumpKeyFilesMu.Unlock()

	log.Printf("[sshjump] grant %s installed (%s, expires %s, sshd %s)", grantID, keyFile, exp.Format(time.RFC3339), addr)
	return map[string]interface{}{
		"user": sshJumpUser, "sshdAddr": addr,
		"expiryOption": info.supportsExpiryTime(), "warnings": warnings,
	}, nil
}

// Removing access is always allowed (not privacy-gated): it only ever reduces access.
func (d *CommandDispatcher) handleSshJumpRevoke(cmd AgentCommand) (interface{}, error) {
	grantID := payloadString(cmd.Payload, "grantId")
	if !sshJumpGrantRe.MatchString(grantID) {
		return nil, fmt.Errorf("ssh_jump_revoke: invalid grantId")
	}
	sshJumpMu.Lock()
	defer sshJumpMu.Unlock()
	removed := 0
	for _, f := range sshJumpKnownKeyFiles() {
		_ = rewriteIfPresent(f, func(lines []string) []string {
			out := lines[:0]
			for _, l := range lines {
				if id, e := grantExpiry(l); e >= 0 && id == grantID {
					removed++
					continue
				}
				out = append(out, l)
			}
			return out
		})
	}
	return map[string]interface{}{"removed": removed}, nil
}

func rewriteIfPresent(file string, edit func([]string) []string) error {
	if _, err := os.Stat(file); err != nil {
		return nil
	}
	return rewriteKeyFile(file, edit)
}

// Key files to sweep: those that received a grant in this process, plus the
// current sshd-configured file for `obli` (covers grants from before a restart).
func sshJumpKnownKeyFiles() []string {
	set := map[string]bool{}
	sshJumpKeyFilesMu.Lock()
	for f := range sshJumpKeyFiles {
		set[f] = true
	}
	sshJumpKeyFilesMu.Unlock()
	if u, err := user.Lookup(sshJumpUser); err == nil {
		for _, e := range readSshdInfo().keyFiles {
			if !strings.EqualFold(e, "none") {
				set[expandKeyFile(e, u)] = true
			}
		}
	}
	out := make([]string, 0, len(set))
	for f := range set {
		out = append(out, f)
	}
	return out
}

// startSshJumpJanitor removes expired grant lines every minute and at start
// (a line outlives its session only if the agent crashed or a revoke was lost).
func startSshJumpJanitor() {
	sweep := func() {
		if _, err := user.Lookup(sshJumpUser); err != nil {
			return // account never provisioned: nothing to sweep
		}
		sshJumpMu.Lock()
		defer sshJumpMu.Unlock()
		now := time.Now().Unix()
		for _, f := range sshJumpKnownKeyFiles() {
			_ = rewriteIfPresent(f, func(lines []string) []string {
				out := lines[:0]
				for _, l := range lines {
					if _, e := grantExpiry(l); e >= 0 && e <= now {
						continue
					}
					out = append(out, l)
				}
				return out
			})
		}
	}
	go func() {
		sweep()
		t := time.NewTicker(time.Minute)
		defer t.Stop()
		for range t.C {
			sweep()
		}
	}()
}
