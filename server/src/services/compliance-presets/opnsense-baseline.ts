import type { ComplianceRule } from '@obliance/shared';

const r = (id: string, opts: Omit<ComplianceRule, 'id' | 'autoRemediateScriptId'>): ComplianceRule =>
  ({ id, autoRemediateScriptId: null, ...opts });

export const opnsenseBaselineRules: ComplianceRule[] = [

  // ── SYSTEM SECURITY ─────────────────────────────────────────────────────────

  r('opn-001', {
    name: 'Syst\u00e8me \u2014 Interface Web GUI en HTTPS',
    category: 'System Security',
    checkType: 'command',
    targetPlatform: 'freebsd',
    target: "grep -c 'protocol.*https' /conf/config.xml",
    expected: '0',
    operator: 'gt',
    severity: 'critical',
    remediationScript: null,
  }),

  r('opn-002', {
    name: 'Syst\u00e8me \u2014 Port Web GUI modifi\u00e9 (non par d\u00e9faut 80)',
    category: 'System Security',
    checkType: 'command',
    targetPlatform: 'freebsd',
    target: "grep '<port>' /conf/config.xml | grep -cv '>80<'",
    expected: '0',
    operator: 'gt',
    severity: 'moderate',
    remediationScript: null,
  }),

  r('opn-003', {
    name: 'Syst\u00e8me \u2014 R\u00e8gle anti-lockout pr\u00e9sente',
    category: 'System Security',
    checkType: 'command',
    targetPlatform: 'freebsd',
    target: "grep -c 'anti-lockout' /conf/config.xml",
    expected: '0',
    operator: 'gt',
    severity: 'high',
    remediationScript: null,
  }),

  r('opn-004', {
    name: 'Syst\u00e8me \u2014 Menu console actif et prot\u00e9g\u00e9 par mot de passe',
    category: 'System Security',
    checkType: 'command',
    targetPlatform: 'freebsd',
    target: "grep -c '<disableconsolemenu/>' /conf/config.xml",
    expected: '0',
    operator: 'eq',
    severity: 'high',
    remediationScript: null,
  }),

  r('opn-005', {
    name: 'Syst\u00e8me \u2014 SSH activ\u00e9 avec authentification par cl\u00e9 uniquement',
    category: 'System Security',
    checkType: 'command',
    targetPlatform: 'freebsd',
    target: "grep -c '<ssh>.*<nopasswordlogin>1</nopasswordlogin>' /conf/config.xml || grep '<ssh>' /conf/config.xml | grep -c 'nopasswordlogin'",
    expected: '0',
    operator: 'gt',
    severity: 'high',
    remediationScript: null,
  }),

  // ── FIREWALL ────────────────────────────────────────────────────────────────

  r('opn-010', {
    name: 'Pare-feu \u2014 R\u00e8gle de blocage par d\u00e9faut sur WAN',
    category: 'Firewall',
    checkType: 'command',
    targetPlatform: 'freebsd',
    target: "pfctl -sr | head -5 | grep -c 'block'",
    expected: '0',
    operator: 'gt',
    severity: 'critical',
    remediationScript: null,
  }),

  r('opn-011', {
    name: 'Pare-feu \u2014 R\u00e9seaux bogons bloqu\u00e9s sur les interfaces WAN',
    category: 'Firewall',
    checkType: 'command',
    targetPlatform: 'freebsd',
    target: "grep -c 'blockbogons' /conf/config.xml",
    expected: '0',
    operator: 'gt',
    severity: 'high',
    remediationScript: null,
  }),

  r('opn-012', {
    name: 'Pare-feu \u2014 RFC 1918 bloqu\u00e9 sur WAN',
    category: 'Firewall',
    checkType: 'command',
    targetPlatform: 'freebsd',
    target: "grep -c 'blockpriv' /conf/config.xml",
    expected: '0',
    operator: 'gt',
    severity: 'high',
    remediationScript: null,
  }),

  r('opn-013', {
    name: 'Pare-feu \u2014 Journalisation activ\u00e9e sur les r\u00e8gles de blocage',
    category: 'Firewall',
    checkType: 'command',
    targetPlatform: 'freebsd',
    target: "grep -c '<log/>' /conf/config.xml",
    expected: '0',
    operator: 'gt',
    severity: 'moderate',
    remediationScript: null,
  }),

  r('opn-014', {
    name: 'Pare-feu \u2014 Aucune r\u00e8gle "allow all" sur WAN',
    category: 'Firewall',
    checkType: 'command',
    targetPlatform: 'freebsd',
    target: "pfctl -sr | grep -c 'pass.*all.*on.*wan'",
    expected: '0',
    operator: 'eq',
    severity: 'critical',
    remediationScript: null,
  }),

  // ── UPDATES & PACKAGES ──────────────────────────────────────────────────────

  r('opn-020', {
    name: 'Mises \u00e0 jour \u2014 Firmware OPNsense \u00e0 jour',
    category: 'Updates',
    checkType: 'command',
    targetPlatform: 'freebsd',
    target: "opnsense-update -c > /dev/null 2>&1 && echo true || echo false",
    expected: 'true',
    operator: 'eq',
    severity: 'critical',
    remediationScript: 'opnsense-update && configctl firmware reload',
  }),

  r('opn-021', {
    name: 'Mises \u00e0 jour \u2014 Aucun paquet vuln\u00e9rable install\u00e9',
    category: 'Updates',
    checkType: 'command',
    targetPlatform: 'freebsd',
    target: "pkg audit -F 2>/dev/null | grep -c 'is affected'",
    expected: '0',
    operator: 'eq',
    severity: 'high',
    remediationScript: 'pkg audit -F',
  }),

  r('opn-022', {
    name: 'Mises \u00e0 jour \u2014 D\u00e9p\u00f4ts officiels OPNsense uniquement',
    category: 'Updates',
    checkType: 'command',
    targetPlatform: 'freebsd',
    target: "pkg -vv 2>/dev/null | grep -c 'opnsense' | awk '{print ($1>0)?\"true\":\"false\"}'",
    expected: 'true',
    operator: 'eq',
    severity: 'moderate',
    remediationScript: null,
  }),

  // ── SERVICES ────────────────────────────────────────────────────────────────

  r('opn-030', {
    name: 'Services \u2014 NTP activ\u00e9 et synchronis\u00e9',
    category: 'Services',
    checkType: 'command',
    targetPlatform: 'freebsd',
    target: "ntpq -p 2>/dev/null | grep -c '\\*' || chronyc tracking 2>/dev/null | grep -c 'Leap status.*Normal'",
    expected: '0',
    operator: 'gt',
    severity: 'high',
    remediationScript: 'service ntpd restart',
  }),

  r('opn-031', {
    name: 'Services \u2014 R\u00e9solveur DNS Unbound en cours d\u2019ex\u00e9cution',
    category: 'Services',
    checkType: 'command',
    targetPlatform: 'freebsd',
    target: "pgrep -x unbound > /dev/null && echo true || echo false",
    expected: 'true',
    operator: 'eq',
    severity: 'high',
    remediationScript: 'configctl unbound restart',
  }),

  r('opn-032', {
    name: 'Services \u2014 Syslog configur\u00e9 (local ou distant)',
    category: 'Services',
    checkType: 'command',
    targetPlatform: 'freebsd',
    target: "grep -c '<syslog>' /conf/config.xml",
    expected: '0',
    operator: 'gt',
    severity: 'moderate',
    remediationScript: 'configctl syslog restart',
  }),

  r('opn-033', {
    name: 'Services \u2014 IDS/IPS (Suricata) activ\u00e9',
    category: 'Services',
    checkType: 'command',
    targetPlatform: 'freebsd',
    target: "grep -c '<ids>' /conf/config.xml",
    expected: '0',
    operator: 'gt',
    severity: 'moderate',
    remediationScript: null,
  }),

  // ── AUTHENTICATION ──────────────────────────────────────────────────────────

  r('opn-040', {
    name: 'Authentification \u2014 Mot de passe admin modifi\u00e9 (non par d\u00e9faut)',
    category: 'Authentication',
    checkType: 'command',
    targetPlatform: 'freebsd',
    target: "grep '<user>' /conf/config.xml | grep -c 'admin' && grep 'password' /conf/config.xml | head -1 | grep -cv '$2b$.*opnsense'",
    expected: '0',
    operator: 'gt',
    severity: 'critical',
    remediationScript: null,
  }),

  r('opn-041', {
    name: 'Authentification \u2014 TOTP / 2FA configur\u00e9 pour le GUI admin',
    category: 'Authentication',
    checkType: 'command',
    targetPlatform: 'freebsd',
    target: "grep -c 'totp' /conf/config.xml",
    expected: '0',
    operator: 'gt',
    severity: 'high',
    remediationScript: null,
  }),

  r('opn-042', {
    name: 'Authentification \u2014 D\u00e9lai d\u2019expiration de session configur\u00e9',
    category: 'Authentication',
    checkType: 'command',
    targetPlatform: 'freebsd',
    target: "grep '<session_timeout>' /conf/config.xml | grep -cv '>0<'",
    expected: '0',
    operator: 'gt',
    severity: 'moderate',
    remediationScript: null,
  }),

  r('opn-043', {
    name: 'Authentification \u2014 Backend LDAP ou RADIUS configur\u00e9',
    category: 'Authentication',
    checkType: 'command',
    targetPlatform: 'freebsd',
    target: "grep -cE '<(ldap|radius)>' /conf/config.xml",
    expected: '0',
    operator: 'gt',
    severity: 'moderate',
    remediationScript: null,
  }),

  // ── BACKUP ──────────────────────────────────────────────────────────────────

  r('opn-050', {
    name: 'Sauvegarde \u2014 Sauvegarde automatique de la configuration activ\u00e9e',
    category: 'Backup',
    checkType: 'command',
    targetPlatform: 'freebsd',
    target: "grep -c '<backupcount>' /conf/config.xml",
    expected: '0',
    operator: 'gt',
    severity: 'high',
    remediationScript: null,
  }),

  r('opn-051', {
    name: 'Sauvegarde \u2014 R\u00e9tention de l\u2019historique de configuration > 0',
    category: 'Backup',
    checkType: 'command',
    targetPlatform: 'freebsd',
    target: "grep '<backupcount>' /conf/config.xml | grep -oP '>\\K[0-9]+'",
    expected: '0',
    operator: 'gt',
    severity: 'moderate',
    remediationScript: null,
  }),

  r('opn-052', {
    name: 'Sauvegarde \u2014 Sauvegarde distante configur\u00e9e (Google Drive / NextCloud)',
    category: 'Backup',
    checkType: 'command',
    targetPlatform: 'freebsd',
    target: "grep -cE '<(GDrive|Nextcloud|WebDAV)>' /conf/config.xml",
    expected: '0',
    operator: 'gt',
    severity: 'moderate',
    remediationScript: null,
  }),

];
