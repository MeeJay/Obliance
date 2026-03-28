import type { ComplianceRule } from '@obliance/shared';

const r = (id: string, opts: Omit<ComplianceRule, 'id' | 'autoRemediateScriptId'>): ComplianceRule =>
  ({ id, autoRemediateScriptId: null, ...opts });

export const freebsdBaselineRules: ComplianceRule[] = [

  // ── FILESYSTEM / PARTITIONS ──────────────────────────────────────────────────

  r('fsb-001', {
    name: 'Système de fichiers — /tmp monté avec noexec',
    category: 'Filesystem',
    checkType: 'command',
    targetPlatform: 'freebsd',
    target: "mount | grep ' /tmp ' | grep -q noexec && echo true || echo false",
    expected: 'true',
    operator: 'eq',
    severity: 'high',
    remediationScript: "mount -o noexec /tmp && echo 'tmpfs /tmp tmpfs rw,noexec,nosuid 0 0' >> /etc/fstab",
  }),

  r('fsb-002', {
    name: 'Système de fichiers — /tmp monté avec nosuid',
    category: 'Filesystem',
    checkType: 'command',
    targetPlatform: 'freebsd',
    target: "mount | grep ' /tmp ' | grep -q nosuid && echo true || echo false",
    expected: 'true',
    operator: 'eq',
    severity: 'high',
    remediationScript: "mount -o nosuid /tmp",
  }),

  r('fsb-003', {
    name: 'Système de fichiers — bit sticky sur les répertoires accessibles en écriture par tous',
    category: 'Filesystem',
    checkType: 'command',
    targetPlatform: 'freebsd',
    target: 'find / -xdev -type d -perm -0002 -not -perm -1000 2>/dev/null | wc -l',
    expected: '0',
    operator: 'eq',
    severity: 'high',
    remediationScript: "find / -xdev -type d -perm -0002 -not -perm -1000 -exec chmod +t {} \\;",
  }),

  r('fsb-004', {
    name: 'Système de fichiers — /var/tmp monté avec noexec, nosuid et nodev',
    category: 'Filesystem',
    checkType: 'command',
    targetPlatform: 'freebsd',
    target: "mount | grep ' /var/tmp ' | grep -qE 'noexec' && mount | grep ' /var/tmp ' | grep -qE 'nosuid' && mount | grep ' /var/tmp ' | grep -qE 'nodev' && echo true || echo false",
    expected: 'true',
    operator: 'eq',
    severity: 'high',
    remediationScript: "mount -o noexec,nosuid,nodev /var/tmp",
  }),

  r('fsb-005', {
    name: 'Système de fichiers — fdescfs/procfs restreints (procfs non monté)',
    category: 'Filesystem',
    checkType: 'command',
    targetPlatform: 'freebsd',
    target: "mount | grep -c procfs || echo 0",
    expected: '0',
    operator: 'eq',
    severity: 'moderate',
    remediationScript: "umount /proc 2>/dev/null; sed -i '' '/procfs/d' /etc/fstab",
  }),

  // ── AUTHENTICATION ───────────────────────────────────────────────────────────

  r('fsb-006', {
    name: 'Authentification — compte root verrouillé pour connexion directe',
    category: 'Authentication',
    checkType: 'command',
    targetPlatform: 'freebsd',
    target: "pw usershow root | cut -d: -f7 | grep -qE '(/usr/sbin/nologin|\\*LOCKED\\*)' && echo true || echo false",
    expected: 'true',
    operator: 'eq',
    severity: 'critical',
    remediationScript: "pw lock root",
  }),

  r('fsb-007', {
    name: 'Authentification — expiration des mots de passe configurée',
    category: 'Authentication',
    checkType: 'command',
    targetPlatform: 'freebsd',
    target: "pw usershow root | cut -d: -f6",
    expected: '0',
    operator: 'neq',
    severity: 'moderate',
    remediationScript: "pw usermod root -p 90d",
  }),

  r('fsb-008', {
    name: 'Authentification — SSH PermitRootLogin désactivé',
    category: 'Authentication',
    checkType: 'command',
    targetPlatform: 'freebsd',
    target: "sshd -T 2>/dev/null | grep -i permitrootlogin | awk '{print $2}'",
    expected: 'no',
    operator: 'eq',
    severity: 'critical',
    remediationScript: "sed -i '' 's/^#*PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config && service sshd reload",
  }),

  r('fsb-009', {
    name: 'Authentification — SSH PasswordAuthentication désactivé',
    category: 'Authentication',
    checkType: 'command',
    targetPlatform: 'freebsd',
    target: "sshd -T 2>/dev/null | grep -i passwordauthentication | awk '{print $2}'",
    expected: 'no',
    operator: 'eq',
    severity: 'high',
    remediationScript: "sed -i '' 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config && service sshd reload",
  }),

  r('fsb-010', {
    name: 'Authentification — SSH Protocol 2 uniquement',
    category: 'Authentication',
    checkType: 'command',
    targetPlatform: 'freebsd',
    target: "sshd -T 2>/dev/null | grep -i protocol | awk '{print $2}' || echo 2",
    expected: '2',
    operator: 'eq',
    severity: 'critical',
    remediationScript: "sed -i '' 's/^#*Protocol.*/Protocol 2/' /etc/ssh/sshd_config && service sshd reload",
  }),

  // ── NETWORK ──────────────────────────────────────────────────────────────────

  r('fsb-011', {
    name: 'Réseau — pare-feu PF activé',
    category: 'Network',
    checkType: 'command',
    targetPlatform: 'freebsd',
    target: "pfctl -s info 2>/dev/null | grep -q 'Status: Enabled' && echo true || echo false",
    expected: 'true',
    operator: 'eq',
    severity: 'critical',
    remediationScript: "sysrc pf_enable=YES && service pf start",
  }),

  r('fsb-012', {
    name: 'Réseau — forwarding IP désactivé',
    category: 'Network',
    checkType: 'command',
    targetPlatform: 'freebsd',
    target: "sysctl -n net.inet.ip.forwarding",
    expected: '0',
    operator: 'eq',
    severity: 'high',
    remediationScript: "sysctl net.inet.ip.forwarding=0 && echo 'net.inet.ip.forwarding=0' >> /etc/sysctl.conf",
  }),

  r('fsb-013', {
    name: 'Réseau — redirection ICMP désactivée',
    category: 'Network',
    checkType: 'command',
    targetPlatform: 'freebsd',
    target: "sysctl -n net.inet.icmp.drop_redirect",
    expected: '1',
    operator: 'eq',
    severity: 'high',
    remediationScript: "sysctl net.inet.icmp.drop_redirect=1 && echo 'net.inet.icmp.drop_redirect=1' >> /etc/sysctl.conf",
  }),

  r('fsb-014', {
    name: 'Réseau — SYN cookies TCP activés',
    category: 'Network',
    checkType: 'command',
    targetPlatform: 'freebsd',
    target: "sysctl -n net.inet.tcp.syncookies",
    expected: '1',
    operator: 'eq',
    severity: 'high',
    remediationScript: "sysctl net.inet.tcp.syncookies=1 && echo 'net.inet.tcp.syncookies=1' >> /etc/sysctl.conf",
  }),

  r('fsb-015', {
    name: 'Réseau — pas de SNMP avec community string par défaut',
    category: 'Network',
    checkType: 'command',
    targetPlatform: 'freebsd',
    target: "grep -rE '^\\s*community\\s+(public|private)' /usr/local/etc/snmpd.conf /etc/snmpd.conf 2>/dev/null | wc -l | tr -d ' '",
    expected: '0',
    operator: 'eq',
    severity: 'critical',
    remediationScript: null,
  }),

  // ── SERVICES ─────────────────────────────────────────────────────────────────

  r('fsb-016', {
    name: 'Services — NTP (ntpd ou chronyd) actif',
    category: 'Services',
    checkType: 'command',
    targetPlatform: 'freebsd',
    target: "service ntpd status >/dev/null 2>&1 || service chronyd status >/dev/null 2>&1 && echo true || echo false",
    expected: 'true',
    operator: 'eq',
    severity: 'high',
    remediationScript: "sysrc ntpd_enable=YES && service ntpd start",
  }),

  r('fsb-017', {
    name: 'Services — syslogd actif',
    category: 'Services',
    checkType: 'command',
    targetPlatform: 'freebsd',
    target: "service syslogd status >/dev/null 2>&1 && echo true || echo false",
    expected: 'true',
    operator: 'eq',
    severity: 'high',
    remediationScript: "sysrc syslogd_enable=YES && service syslogd start",
  }),

  r('fsb-018', {
    name: 'Services — pas de services inetd inutiles',
    category: 'Services',
    checkType: 'command',
    targetPlatform: 'freebsd',
    target: "grep -cE '^[^#]' /etc/inetd.conf 2>/dev/null || echo 0",
    expected: '0',
    operator: 'eq',
    severity: 'moderate',
    remediationScript: "sed -i '' 's/^[^#]/#&/' /etc/inetd.conf 2>/dev/null; sysrc inetd_enable=NO; service inetd stop 2>/dev/null; true",
  }),

  r('fsb-019', {
    name: 'Services — sendmail désactivé si non nécessaire',
    category: 'Services',
    checkType: 'command',
    targetPlatform: 'freebsd',
    target: "sysrc -n sendmail_enable 2>/dev/null || echo NONE",
    expected: 'NONE',
    operator: 'eq',
    severity: 'moderate',
    remediationScript: "sysrc sendmail_enable=NONE && sysrc sendmail_submit_enable=NO && sysrc sendmail_outbound_enable=NO && sysrc sendmail_msp_queue_enable=NO && service sendmail stop 2>/dev/null; true",
  }),

  // ── PERMISSIONS ──────────────────────────────────────────────────────────────

  r('fsb-020', {
    name: 'Permissions — /etc/master.passwd accessible uniquement par root (600)',
    category: 'Permissions',
    checkType: 'command',
    targetPlatform: 'freebsd',
    target: "stat -f '%Lp' /etc/master.passwd",
    expected: '600',
    operator: 'eq',
    severity: 'critical',
    remediationScript: "chmod 600 /etc/master.passwd && chown root:wheel /etc/master.passwd",
  }),

  r('fsb-021', {
    name: 'Permissions — /etc/passwd en lecture seule pour tous (644)',
    category: 'Permissions',
    checkType: 'command',
    targetPlatform: 'freebsd',
    target: "stat -f '%Lp' /etc/passwd",
    expected: '644',
    operator: 'eq',
    severity: 'high',
    remediationScript: "chmod 644 /etc/passwd && chown root:wheel /etc/passwd",
  }),

  r('fsb-022', {
    name: 'Permissions — répertoires cron restreints (700)',
    category: 'Permissions',
    checkType: 'command',
    targetPlatform: 'freebsd',
    target: "stat -f '%Lp' /var/cron 2>/dev/null | grep -q '700' && echo true || echo false",
    expected: 'true',
    operator: 'eq',
    severity: 'high',
    remediationScript: "chmod 700 /var/cron",
  }),

  r('fsb-023', {
    name: 'Permissions — audit des fichiers SUID/SGID',
    category: 'Permissions',
    checkType: 'command',
    targetPlatform: 'freebsd',
    target: "find / -xdev \\( -perm -4000 -o -perm -2000 \\) -type f 2>/dev/null | wc -l | tr -d ' '",
    expected: '50',
    operator: 'lte',
    severity: 'moderate',
    remediationScript: null,
  }),

  // ── UPDATES ──────────────────────────────────────────────────────────────────

  r('fsb-024', {
    name: 'Mises à jour — aucune vulnérabilité connue dans les paquets installés',
    category: 'Updates',
    checkType: 'command',
    targetPlatform: 'freebsd',
    target: "pkg audit -F 2>/dev/null | grep -c 'is affected' || echo 0",
    expected: '0',
    operator: 'eq',
    severity: 'critical',
    remediationScript: "pkg upgrade -y",
  }),

  r('fsb-025', {
    name: 'Mises à jour — correctifs de sécurité FreeBSD appliqués',
    category: 'Updates',
    checkType: 'command',
    targetPlatform: 'freebsd',
    target: "freebsd-update IDS 2>/dev/null | wc -l | tr -d ' '",
    expected: '0',
    operator: 'eq',
    severity: 'high',
    remediationScript: "freebsd-update fetch install",
  }),

];
