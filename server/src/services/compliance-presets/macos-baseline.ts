import type { ComplianceRule } from '@obliance/shared';

const r = (id: string, opts: Omit<ComplianceRule, 'id' | 'autoRemediateScriptId'>): ComplianceRule =>
  ({ id, autoRemediateScriptId: null, ...opts });

export const macosBaselineRules: ComplianceRule[] = [

  // ── INTÉGRITÉ SYSTÈME ET DÉMARRAGE ──────────────────────────────────────────

  r('msb-001', {
    name: 'Intégrité système — SIP (System Integrity Protection) activé',
    category: 'System Integrity',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "csrutil status | grep -q 'enabled' && echo true || echo false",
    expected: 'true',
    operator: 'eq',
    severity: 'critical',
    minOsVersion: 'macOS 12',
  }),

  r('msb-002', {
    name: 'Intégrité système — Gatekeeper activé',
    category: 'System Integrity',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "spctl --status 2>/dev/null | grep -q 'assessments enabled' && echo true || echo false",
    expected: 'true',
    operator: 'eq',
    severity: 'critical',
  }),

  r('msb-003', {
    name: 'Intégrité système — démarrage sécurisé (T2/Apple Silicon)',
    category: 'System Integrity',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "system_profiler SPiBridgeDataType 2>/dev/null | grep -q 'Secure Boot' && echo true || echo false",
    expected: 'true',
    operator: 'eq',
    severity: 'high',
  }),

  r('msb-004', {
    name: 'Chiffrement — FileVault activé',
    category: 'Encryption',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "fdesetup status | grep -q 'FileVault is On' && echo true || echo false",
    expected: 'true',
    operator: 'eq',
    severity: 'critical',
  }),

  r('msb-005', {
    name: 'Intégrité système — statut SIP (valeur brute)',
    category: 'System Integrity',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "csrutil status | awk '{print $NF}'",
    expected: 'enabled.',
    operator: 'eq',
    severity: 'critical',
  }),

  r('msb-006', {
    name: 'Intégrité système — XProtect activé',
    category: 'System Integrity',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "defaults read /Library/Preferences/com.apple.security.XProtect Enabled 2>/dev/null || echo 1",
    expected: '0',
    operator: 'neq',
    severity: 'high',
  }),

  r('msb-007', {
    name: "Intégrité système — quarantaine des fichiers activée",
    category: 'System Integrity',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "defaults read com.apple.LaunchServices LSQuarantine 2>/dev/null || echo 1",
    expected: '0',
    operator: 'neq',
    severity: 'high',
  }),

  r('msb-008', {
    name: 'Intégrité système — MRT (Malware Removal Tool) présent',
    category: 'System Integrity',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "test -d '/Library/Apple/System/Library/CoreServices/MRT.app' && echo true || echo false",
    expected: 'true',
    operator: 'eq',
    severity: 'high',
  }),

  r('msb-009', {
    name: 'Intégrité système — mode hibernation sécurisé (hibernatemode ≥ 25)',
    category: 'System Integrity',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "pmset -g | grep -i 'hibernatemode' | awk '{print $2}'",
    expected: '24',
    operator: 'gt',
    severity: 'moderate',
  }),

  r('msb-010', {
    name: 'Intégrité système — notarisation logicielle requise (Gatekeeper)',
    category: 'System Integrity',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "spctl --status 2>/dev/null | grep -q 'assessments enabled' && echo true || echo false",
    expected: 'true',
    operator: 'eq',
    severity: 'high',
  }),

  // ── PARE-FEU ─────────────────────────────────────────────────────────────────

  r('msb-011', {
    name: "Pare-feu — pare-feu applicatif activé (globalstate ≥ 1)",
    category: 'Firewall',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "defaults read /Library/Preferences/com.apple.alf globalstate 2>/dev/null",
    expected: '0',
    operator: 'neq',
    severity: 'critical',
  }),

  r('msb-012', {
    name: 'Pare-feu — mode furtif activé (stealthenabled)',
    category: 'Firewall',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "defaults read /Library/Preferences/com.apple.alf stealthenabled 2>/dev/null",
    expected: '1',
    operator: 'eq',
    severity: 'high',
  }),

  r('msb-013', {
    name: 'Pare-feu — journalisation activée (loggingenabled)',
    category: 'Firewall',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "defaults read /Library/Preferences/com.apple.alf loggingenabled 2>/dev/null",
    expected: '1',
    operator: 'eq',
    severity: 'moderate',
  }),

  r('msb-014', {
    name: "Pare-feu — applications signées autorisées (allowsignedenabled)",
    category: 'Firewall',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "defaults read /Library/Preferences/com.apple.alf allowsignedenabled 2>/dev/null",
    expected: '1',
    operator: 'eq',
    severity: 'moderate',
  }),

  r('msb-015', {
    name: "Pare-feu — pf (packet filter) actif",
    category: 'Firewall',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "/sbin/pfctl -s info 2>/dev/null | grep -q 'Enabled' && echo true || echo false",
    expected: 'true',
    operator: 'eq',
    severity: 'moderate',
  }),

  r('msb-016', {
    name: 'Accès distant — connexion SSH (Remote Login) désactivée',
    category: 'Firewall',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "systemsetup -getremotelogin 2>/dev/null | grep -q 'Off' && echo true || echo false",
    expected: 'true',
    operator: 'eq',
    severity: 'high',
  }),

  r('msb-017', {
    name: 'Accès distant — Remote Desktop / ARD désactivé',
    category: 'Firewall',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "launchctl list com.apple.RemoteDesktop.agent 2>/dev/null | grep -q 'com.apple' && echo running || echo stopped",
    expected: 'stopped',
    operator: 'eq',
    severity: 'high',
  }),

  r('msb-018', {
    name: "Pare-feu — blocage de tout le trafic entrant (blockall)",
    category: 'Firewall',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "defaults read /Library/Preferences/com.apple.alf blockall 2>/dev/null",
    expected: '0',
    operator: 'neq',
    severity: 'moderate',
  }),

  // ── RÉSEAU ───────────────────────────────────────────────────────────────────

  r('msb-019', {
    name: 'Réseau — réveil sur réseau (Wake on LAN) désactivé',
    category: 'Network',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "pmset -g | grep 'womp' | awk '{print $2}'",
    expected: '0',
    operator: 'eq',
    severity: 'low',
  }),

  r('msb-020', {
    name: 'Réseau — événements Apple distants désactivés',
    category: 'Network',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "systemsetup -getremoteappleevents 2>/dev/null | grep -q 'Off' && echo true || echo false",
    expected: 'true',
    operator: 'eq',
    severity: 'high',
  }),

  r('msb-021', {
    name: 'Réseau — partage de connexion Internet désactivé',
    category: 'Network',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "defaults read /Library/Preferences/SystemConfiguration/com.apple.nat 2>/dev/null | grep -q 'Enabled = 1' && echo false || echo true",
    expected: 'true',
    operator: 'eq',
    severity: 'high',
  }),

  r('msb-022', {
    name: 'Réseau — partage Imprimante désactivé',
    category: 'Network',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "launchctl list com.apple.printingd 2>/dev/null | grep -q 'com.apple.printingd' && echo enabled || echo disabled",
    expected: 'enabled',
    operator: 'neq',
    severity: 'low',
  }),

  r('msb-023', {
    name: 'Réseau — Bluetooth désactivé (si non utilisé)',
    category: 'Network',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "defaults read /Library/Preferences/com.apple.Bluetooth ControllerPowerState 2>/dev/null",
    expected: '0',
    operator: 'eq',
    severity: 'low',
  }),

  r('msb-024', {
    name: 'Réseau — serveur NFS désactivé',
    category: 'Network',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "launchctl list com.apple.nfsd 2>/dev/null | grep -q 'nfsd' && echo running || echo stopped",
    expected: 'stopped',
    operator: 'eq',
    severity: 'high',
  }),

  r('msb-025', {
    name: 'Réseau — partage SMB désactivé (si non requis)',
    category: 'Network',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "launchctl list com.apple.smbd 2>/dev/null | grep -q 'smbd' && echo enabled || echo disabled",
    expected: 'enabled',
    operator: 'neq',
    severity: 'moderate',
  }),

  r('msb-026', {
    name: 'Réseau — AirDrop désactivé (appareils gérés)',
    category: 'Network',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "defaults read com.apple.NetworkBrowser DisableAirDrop 2>/dev/null",
    expected: '1',
    operator: 'eq',
    severity: 'moderate',
  }),

  r('msb-027', {
    name: 'Réseau — Bonjour (mDNS multicast) désactivé',
    category: 'Network',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "defaults read /Library/Preferences/com.apple.mDNSResponder.plist NoMulticastAdvertisements 2>/dev/null",
    expected: '1',
    operator: 'eq',
    severity: 'low',
  }),

  r('msb-028', {
    name: 'Réseau — partage de fichiers AFP/SMB désactivé',
    category: 'Network',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "launchctl list com.apple.AppleFileServer 2>/dev/null | grep -q 'AppleFileServer' && echo enabled || echo disabled",
    expected: 'enabled',
    operator: 'neq',
    severity: 'moderate',
  }),

  // ── COMPTES UTILISATEURS ─────────────────────────────────────────────────────

  r('msb-029', {
    name: 'Comptes — compte Invité désactivé',
    category: 'Accounts',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "defaults read /Library/Preferences/com.apple.loginwindow GuestEnabled 2>/dev/null",
    expected: '0',
    operator: 'eq',
    severity: 'high',
  }),

  r('msb-030', {
    name: 'Comptes — connexion automatique désactivée',
    category: 'Accounts',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "defaults read /Library/Preferences/com.apple.loginwindow autoLoginUser 2>/dev/null && echo enabled || echo disabled",
    expected: 'disabled',
    operator: 'eq',
    severity: 'critical',
  }),

  r('msb-031', {
    name: 'Comptes — compte root désactivé',
    category: 'Accounts',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "dscl . -read /Users/root AuthenticationAuthority 2>/dev/null | grep -q 'DisabledUser' && echo true || echo false",
    expected: 'true',
    operator: 'eq',
    severity: 'critical',
  }),

  r('msb-032', {
    name: "Écran de connexion — affiche nom d'utilisateur et mot de passe (SHOWFULLNAME)",
    category: 'Accounts',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "defaults read /Library/Preferences/com.apple.loginwindow SHOWFULLNAME 2>/dev/null",
    expected: '1',
    operator: 'eq',
    severity: 'moderate',
  }),

  r('msb-033', {
    name: "Comptes — indice de mot de passe désactivé (RetriesUntilHint = 0)",
    category: 'Accounts',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "defaults read /Library/Preferences/com.apple.loginwindow RetriesUntilHint 2>/dev/null",
    expected: '0',
    operator: 'eq',
    severity: 'moderate',
  }),

  r('msb-034', {
    name: "Verrouillage — délai d'inactivité de l'économiseur d'écran ≤ 300 s",
    category: 'Accounts',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "defaults -currentHost read com.apple.screensaver idleTime 2>/dev/null",
    expected: '300',
    operator: 'lt',
    severity: 'high',
  }),

  r('msb-035', {
    name: "Verrouillage — mot de passe requis au réveil de l'économiseur d'écran",
    category: 'Accounts',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "defaults read com.apple.screensaver askForPassword 2>/dev/null",
    expected: '1',
    operator: 'eq',
    severity: 'high',
  }),

  r('msb-036', {
    name: "Verrouillage — délai avant demande de mot de passe ≤ 5 s (askForPasswordDelay)",
    category: 'Accounts',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "defaults read com.apple.screensaver askForPasswordDelay 2>/dev/null",
    expected: '5',
    operator: 'lt',
    severity: 'high',
  }),

  r('msb-037', {
    name: "Comptes — basculement rapide entre utilisateurs désactivé",
    category: 'Accounts',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "defaults read /Library/Preferences/.GlobalPreferences MultipleSessionEnabled 2>/dev/null",
    expected: '0',
    operator: 'eq',
    severity: 'low',
  }),

  r('msb-038', {
    name: 'Comptes — clé de récupération FileVault stockée',
    category: 'Accounts',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "fdesetup hasinstitutionalrecoverykey 2>/dev/null | grep -q 'true' && echo true || (fdesetup haspersonalrecoverykey 2>/dev/null | grep -q 'true' && echo true || echo false)",
    expected: 'true',
    operator: 'eq',
    severity: 'high',
  }),

  // ── MISES À JOUR ─────────────────────────────────────────────────────────────

  r('msb-039', {
    name: 'Mises à jour — vérification automatique activée (AutomaticCheckEnabled)',
    category: 'Updates',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "defaults read /Library/Preferences/com.apple.SoftwareUpdate AutomaticCheckEnabled 2>/dev/null",
    expected: '1',
    operator: 'eq',
    severity: 'high',
  }),

  r('msb-040', {
    name: 'Mises à jour — téléchargement automatique activé (AutomaticDownload)',
    category: 'Updates',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "defaults read /Library/Preferences/com.apple.SoftwareUpdate AutomaticDownload 2>/dev/null",
    expected: '1',
    operator: 'eq',
    severity: 'high',
  }),

  r('msb-041', {
    name: 'Mises à jour — installation automatique des mises à jour de sécurité (CriticalUpdateInstall)',
    category: 'Updates',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "defaults read /Library/Preferences/com.apple.SoftwareUpdate CriticalUpdateInstall 2>/dev/null",
    expected: '1',
    operator: 'eq',
    severity: 'critical',
  }),

  r('msb-042', {
    name: "Mises à jour — mise à jour automatique des apps de l'App Store (AutoUpdate)",
    category: 'Updates',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "defaults read /Library/Preferences/com.apple.commerce AutoUpdate 2>/dev/null",
    expected: '1',
    operator: 'eq',
    severity: 'moderate',
  }),

  r('msb-043', {
    name: 'Mises à jour — installation automatique de macOS activée',
    category: 'Updates',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "defaults read /Library/Preferences/com.apple.SoftwareUpdate AutomaticallyInstallMacOSUpdates 2>/dev/null",
    expected: '1',
    operator: 'eq',
    severity: 'high',
  }),

  // ── CHIFFREMENT ──────────────────────────────────────────────────────────────

  r('msb-044', {
    name: 'Chiffrement — FileVault activé (vérification secondaire)',
    category: 'Encryption',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "fdesetup status | grep -q 'FileVault is On' && echo true || echo false",
    expected: 'true',
    operator: 'eq',
    severity: 'critical',
  }),

  r('msb-045', {
    name: 'Chiffrement — partition de démarrage en APFS chiffré',
    category: 'Encryption',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "diskutil apfs list 2>/dev/null | grep -q 'FileVault:.*Yes' && echo true || echo false",
    expected: 'true',
    operator: 'eq',
    severity: 'critical',
  }),

  r('msb-046', {
    name: 'Chiffrement — trousseau verrouillé après inactivité',
    category: 'Encryption',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "security show-keychain-info login.keychain-db 2>&1 | grep -q 'timeout' && echo true || echo false",
    expected: 'true',
    operator: 'eq',
    severity: 'moderate',
  }),

  r('msb-047', {
    name: 'Chiffrement — trousseau iCloud désactivé',
    category: 'Encryption',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "defaults read com.apple.security.cloudkeychainproxy 2>/dev/null | grep -q 'SecureObjectSync' && echo enabled || echo disabled",
    expected: 'enabled',
    operator: 'neq',
    severity: 'moderate',
  }),

  r('msb-048', {
    name: 'Chiffrement — FileVault en cours de chiffrement terminé',
    category: 'Encryption',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "fdesetup status 2>/dev/null | grep -q 'Encryption in progress' && echo false || echo true",
    expected: 'true',
    operator: 'eq',
    severity: 'high',
  }),

  // ── CONFIDENTIALITÉ / PROTECTION DES DONNÉES ─────────────────────────────────

  r('msb-049', {
    name: 'Confidentialité — suggestions Spotlight (cloud) désactivées',
    category: 'Privacy',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "defaults read com.apple.lookup.shared LookupSuggestionsDisabled 2>/dev/null",
    expected: '1',
    operator: 'eq',
    severity: 'moderate',
  }),

  r('msb-050', {
    name: 'Confidentialité — Siri désactivé (appareils gérés)',
    category: 'Privacy',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "defaults read com.apple.assistant.support 'Assistant Enabled' 2>/dev/null",
    expected: '0',
    operator: 'eq',
    severity: 'moderate',
  }),

  r('msb-051', {
    name: "Confidentialité — envoi automatique de rapports d'analyse désactivé",
    category: 'Privacy',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "defaults read /Library/Preferences/com.apple.SubmitDiagInfo AutoSubmit 2>/dev/null",
    expected: '0',
    operator: 'eq',
    severity: 'moderate',
  }),

  r('msb-052', {
    name: "Confidentialité — partage de diagnostics Apple désactivé (DiagnosticMessages)",
    category: 'Privacy',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "defaults read '/Library/Application Support/CrashReporter/DiagnosticMessagesHistory.plist' AutoSubmit 2>/dev/null",
    expected: '0',
    operator: 'eq',
    severity: 'moderate',
  }),

  r('msb-053', {
    name: 'Confidentialité — iCloud Drive désactivé (NSDocumentSaveNewDocumentsToCloud)',
    category: 'Privacy',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "defaults read NSGlobalDomain NSDocumentSaveNewDocumentsToCloud 2>/dev/null",
    expected: '0',
    operator: 'eq',
    severity: 'high',
  }),

  r('msb-054', {
    name: 'Confidentialité — partage de bureau (Screen Sharing) désactivé',
    category: 'Privacy',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "launchctl list com.apple.screensharing 2>/dev/null | grep -q 'com.apple.screensharing' && echo enabled || echo disabled",
    expected: 'enabled',
    operator: 'neq',
    severity: 'high',
  }),

  r('msb-055', {
    name: 'Confidentialité — accès aux services de localisation contrôlé',
    category: 'Privacy',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "defaults read /var/db/locationd/Library/Preferences/ByHost/com.apple.locationd LocationServicesEnabled 2>/dev/null",
    expected: '1',
    operator: 'eq',
    severity: 'low',
  }),

  r('msb-056', {
    name: 'Confidentialité — iCloud Photos désactivé',
    category: 'Privacy',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "defaults read com.apple.Photos NSUserDefaultsDidMigratePhotoLibraryToiCloud 2>/dev/null && echo enabled || echo disabled",
    expected: 'enabled',
    operator: 'neq',
    severity: 'moderate',
  }),

  r('msb-057', {
    name: 'Confidentialité — accès Full Disk restreint (TCC)',
    category: 'Privacy',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "sqlite3 /Library/Application\\ Support/com.apple.TCC/TCC.db 'SELECT count(*) FROM access WHERE service=\"kTCCServiceSystemPolicyAllFiles\" AND auth_value=2' 2>/dev/null",
    expected: '0',
    operator: 'eq',
    severity: 'high',
  }),

  r('msb-058', {
    name: 'Confidentialité — accès microphone contrôlé (TCC)',
    category: 'Privacy',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "sqlite3 /Library/Application\\ Support/com.apple.TCC/TCC.db 'SELECT count(*) FROM access WHERE service=\"kTCCServiceMicrophone\" AND auth_value=2' 2>/dev/null",
    expected: '0',
    operator: 'gt',
    severity: 'moderate',
  }),

  // ── AUDIT / JOURNALISATION ───────────────────────────────────────────────────

  r('msb-059', {
    name: 'Audit — auditd actif',
    category: 'Audit',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "launchctl list com.apple.auditd 2>/dev/null | grep -q 'auditd' && echo true || echo false",
    expected: 'true',
    operator: 'eq',
    severity: 'critical',
  }),

  r('msb-060', {
    name: "Audit — fichier de journal d'audit courant présent",
    category: 'Audit',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "test -f /var/audit/current && echo true || echo false",
    expected: 'true',
    operator: 'eq',
    severity: 'high',
  }),

  r('msb-061', {
    name: 'Audit — action en cas de disque plein : ahlt (arrêt)',
    category: 'Audit',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "grep -Ei 'ahlt' /etc/security/audit_control && echo true || echo false",
    expected: 'true',
    operator: 'eq',
    severity: 'high',
  }),

  r('msb-062', {
    name: "Audit — indicateurs de connexion/déconnexion actifs (flags: lo)",
    category: 'Audit',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "grep -Ei 'flags:' /etc/security/audit_control | grep -q 'lo' && echo true || echo false",
    expected: 'true',
    operator: 'eq',
    severity: 'high',
  }),

  r('msb-063', {
    name: "Audit — indicateurs d'administration (flags: aa, ad) actifs",
    category: 'Audit',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "grep -Ei 'flags:' /etc/security/audit_control | grep -qE 'aa|ad' && echo true || echo false",
    expected: 'true',
    operator: 'eq',
    severity: 'high',
  }),

  r('msb-064', {
    name: 'Audit — espace libre minimum configuré (minfree)',
    category: 'Audit',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "grep -Ei 'minfree' /etc/security/audit_control | grep -oP '\\d+'",
    expected: '5',
    operator: 'gt',
    severity: 'moderate',
  }),

  r('msb-065', {
    name: 'Journalisation — syslogd actif',
    category: 'Audit',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "launchctl list com.apple.syslogd 2>/dev/null | grep -q 'syslogd' && echo true || echo false",
    expected: 'true',
    operator: 'eq',
    severity: 'high',
  }),

  r('msb-066', {
    name: "Journalisation — accès à la console restreint (DisableConsoleAccess)",
    category: 'Audit',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "defaults read /Library/Preferences/com.apple.loginwindow DisableConsoleAccess 2>/dev/null",
    expected: '1',
    operator: 'eq',
    severity: 'moderate',
  }),

  r('msb-067', {
    name: "Audit — indicateurs d'accès fichiers (flags: fd, fm) actifs",
    category: 'Audit',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "grep -Ei 'flags:' /etc/security/audit_control | grep -qE 'fd|fm' && echo true || echo false",
    expected: 'true',
    operator: 'eq',
    severity: 'moderate',
  }),

  // ── SSH (SI ACTIVÉ) ──────────────────────────────────────────────────────────

  r('msb-068', {
    name: 'SSH — connexion root interdite (PermitRootLogin no)',
    category: 'SSH',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "sudo sshd -T 2>/dev/null | grep -i 'permitrootlogin' | awk '{print $2}'",
    expected: 'no',
    operator: 'eq',
    severity: 'critical',
  }),

  r('msb-069', {
    name: "SSH — authentification par mot de passe désactivée",
    category: 'SSH',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "sudo sshd -T 2>/dev/null | grep -i 'passwordauthentication' | awk '{print $2}'",
    expected: 'no',
    operator: 'eq',
    severity: 'critical',
  }),

  r('msb-070', {
    name: 'SSH — nombre maximal de tentatives ≤ 4 (MaxAuthTries)',
    category: 'SSH',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "sudo sshd -T 2>/dev/null | grep -i 'maxauthtries' | awk '{print $2}'",
    expected: '4',
    operator: 'lt',
    severity: 'high',
  }),

  r('msb-071', {
    name: 'SSH — intervalle de maintien de connexion ≤ 300 s (ClientAliveInterval)',
    category: 'SSH',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "sudo sshd -T 2>/dev/null | grep -i 'clientaliveinterval' | awk '{print $2}'",
    expected: '300',
    operator: 'lt',
    severity: 'moderate',
  }),

  r('msb-072', {
    name: 'SSH — fichiers .rhosts ignorés (IgnoreRhosts yes)',
    category: 'SSH',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "sudo sshd -T 2>/dev/null | grep -i 'ignorerhosts' | awk '{print $2}'",
    expected: 'yes',
    operator: 'eq',
    severity: 'high',
  }),

  r('msb-073', {
    name: 'SSH — authentification basée hôte désactivée (HostbasedAuthentication no)',
    category: 'SSH',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "sudo sshd -T 2>/dev/null | grep -i 'hostbasedauthentication' | awk '{print $2}'",
    expected: 'no',
    operator: 'eq',
    severity: 'high',
  }),

  r('msb-074', {
    name: 'SSH — transfert TCP désactivé (AllowTcpForwarding no)',
    category: 'SSH',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "sudo sshd -T 2>/dev/null | grep -i 'allowtcpforwarding' | awk '{print $2}'",
    expected: 'no',
    operator: 'eq',
    severity: 'high',
  }),

  r('msb-075', {
    name: 'SSH — redirection X11 désactivée (X11Forwarding no)',
    category: 'SSH',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "sudo sshd -T 2>/dev/null | grep -i 'x11forwarding' | awk '{print $2}'",
    expected: 'no',
    operator: 'eq',
    severity: 'high',
  }),

  // ── PARAMÈTRES SYSTÈME ───────────────────────────────────────────────────────

  r('msb-076', {
    name: "Verrouillage — délai total de l'économiseur d'écran ≤ 600 s",
    category: 'System Settings',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "defaults -currentHost read com.apple.screensaver idleTime 2>/dev/null",
    expected: '600',
    operator: 'lt',
    severity: 'high',
  }),

  r('msb-077', {
    name: "Bannière — texte de connexion (LoginwindowText) configuré",
    category: 'System Settings',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "defaults read /Library/Preferences/com.apple.loginwindow LoginwindowText 2>/dev/null | wc -c | tr -d ' '",
    expected: '0',
    operator: 'gt',
    severity: 'moderate',
  }),

  r('msb-078', {
    name: 'Synchronisation — serveur NTP configuré',
    category: 'System Settings',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "systemsetup -getnetworktimeserver 2>/dev/null | grep -q '\\.' && echo true || echo false",
    expected: 'true',
    operator: 'eq',
    severity: 'moderate',
  }),

  r('msb-079', {
    name: 'Synchronisation — heure réseau activée',
    category: 'System Settings',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "systemsetup -getusingnetworktime 2>/dev/null | grep -q 'On' && echo true || echo false",
    expected: 'true',
    operator: 'eq',
    severity: 'moderate',
  }),

  r('msb-080', {
    name: 'Sandboxing — applications App Store signées requises (notarisation)',
    category: 'System Settings',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "spctl --status 2>/dev/null | grep -q 'assessments enabled' && echo true || echo false",
    expected: 'true',
    operator: 'eq',
    severity: 'high',
  }),

  r('msb-081', {
    name: 'Énergie — mise en veille disque dur activée',
    category: 'System Settings',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "pmset -g | grep 'disksleep' | awk '{print $2}'",
    expected: '0',
    operator: 'neq',
    severity: 'low',
  }),

  r('msb-082', {
    name: 'Accès réseau — FTP désactivé',
    category: 'System Settings',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "launchctl list com.apple.ftpd 2>/dev/null | grep -q 'ftpd' && echo running || echo stopped",
    expected: 'stopped',
    operator: 'eq',
    severity: 'critical',
  }),

  r('msb-083', {
    name: 'Accès réseau — Telnet désactivé',
    category: 'System Settings',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "launchctl list com.apple.telnetd 2>/dev/null | grep -q 'telnetd' && echo running || echo stopped",
    expected: 'stopped',
    operator: 'eq',
    severity: 'critical',
  }),

  r('msb-084', {
    name: "Mise en veille — affichage du contenu des notifications sur écran verrouillé désactivé",
    category: 'System Settings',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "defaults read com.apple.ncprefs content_visibility 2>/dev/null",
    expected: '2',
    operator: 'eq',
    severity: 'moderate',
  }),

  r('msb-085', {
    name: "Comptes — liste des administrateurs masquée à l'écran de connexion",
    category: 'System Settings',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "defaults read /Library/Preferences/com.apple.loginwindow HideAdminUsers 2>/dev/null",
    expected: '1',
    operator: 'eq',
    severity: 'low',
  }),

  // ── SÉCURITÉ DES APPLICATIONS ─────────────────────────────────────────────────

  r('msb-086', {
    name: 'Safari — navigation sécurisée activée (WarnAboutFraudulentWebsites)',
    category: 'Application Security',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "defaults read com.apple.Safari WarnAboutFraudulentWebsites 2>/dev/null",
    expected: '1',
    operator: 'eq',
    severity: 'high',
  }),

  r('msb-087', {
    name: 'Safari — prévention du suivi inter-sites activée',
    category: 'Application Security',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "defaults read com.apple.Safari WebKitPreferences.storageBlockingPolicy 2>/dev/null",
    expected: '0',
    operator: 'neq',
    severity: 'moderate',
  }),

  r('msb-088', {
    name: 'Safari — Java désactivé (WebKitJavaEnabled)',
    category: 'Application Security',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "defaults read com.apple.Safari WebKitJavaEnabled 2>/dev/null",
    expected: '0',
    operator: 'eq',
    severity: 'high',
  }),

  r('msb-089', {
    name: 'Applications — Adobe Flash Player non installé',
    category: 'Application Security',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "test ! -d '/Library/Internet Plug-Ins/Flash Player.plugin' && echo true || echo false",
    expected: 'true',
    operator: 'eq',
    severity: 'critical',
  }),

  r('msb-090', {
    name: 'Applications — notarisation Apple requise (Gatekeeper)',
    category: 'Application Security',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "spctl --status 2>/dev/null | grep -q 'assessments enabled' && echo true || echo false",
    expected: 'true',
    operator: 'eq',
    severity: 'critical',
  }),

  r('msb-091', {
    name: "Safari — ouverture automatique des téléchargements 'sûrs' désactivée",
    category: 'Application Security',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "defaults read com.apple.Safari AutoOpenSafeDownloads 2>/dev/null",
    expected: '0',
    operator: 'eq',
    severity: 'moderate',
  }),

  r('msb-092', {
    name: 'Safari — JavaScript activé (vérification de présence)',
    category: 'Application Security',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "defaults read com.apple.Safari WebKitJavaScriptEnabled 2>/dev/null",
    expected: '0',
    operator: 'neq',
    severity: 'low',
  }),

  // ── RÈGLES COMPLÉMENTAIRES ───────────────────────────────────────────────────

  r('msb-093', {
    name: 'Réseau — handoff (Apple Handoff) désactivé (appareils gérés)',
    category: 'Privacy',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "defaults read com.apple.coreduetd ActivityAdvertisingAllowed 2>/dev/null",
    expected: '0',
    operator: 'eq',
    severity: 'low',
  }),

  r('msb-094', {
    name: 'Réseau — Universal Clipboard désactivé (appareils gérés)',
    category: 'Privacy',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "defaults read com.apple.coreduetd ActivityReceivingAllowed 2>/dev/null",
    expected: '0',
    operator: 'eq',
    severity: 'low',
  }),

  r('msb-095', {
    name: 'Intégrité système — mise à jour XProtect récente (moins de 30 jours)',
    category: 'System Integrity',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "find /Library/Apple/System/Library/CoreServices/XProtect.bundle -maxdepth 0 -mtime -30 2>/dev/null && echo true || echo false",
    expected: 'true',
    operator: 'eq',
    severity: 'high',
  }),

  r('msb-096', {
    name: "Comptes — expiration de session (ScreenSaverDelay) configurée",
    category: 'Accounts',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "defaults read /Library/Preferences/com.apple.screensaver loginWindowIdleTime 2>/dev/null",
    expected: '0',
    operator: 'gt',
    severity: 'moderate',
  }),

  r('msb-097', {
    name: "Réseau — IPv6 désactivé sur toutes les interfaces (si non requis)",
    category: 'Network',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "networksetup -listallnetworkservices 2>/dev/null | grep -v '\\*' | while read svc; do networksetup -getinfo \"$svc\" 2>/dev/null | grep -i 'ipv6' | grep -v 'none\\|off'; done | wc -l | tr -d ' '",
    expected: '0',
    operator: 'eq',
    severity: 'low',
  }),

  r('msb-098', {
    name: 'Audit — indicateurs de changements de droits (flags: fm) actifs',
    category: 'Audit',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "grep -Ei 'flags:' /etc/security/audit_control | grep -q 'fm' && echo true || echo false",
    expected: 'true',
    operator: 'eq',
    severity: 'moderate',
  }),

  r('msb-099', {
    name: "Réseau — partage Bluetooth désactivé",
    category: 'Network',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "launchctl list com.apple.bluetoothd 2>/dev/null | grep -q 'bluetoothd' && defaults read com.apple.Bluetooth PrefKeyServicesEnabled 2>/dev/null | grep -q '1' && echo enabled || echo disabled",
    expected: 'enabled',
    operator: 'neq',
    severity: 'moderate',
  }),

  r('msb-100', {
    name: 'Sécurité — protection contre les attaques physiques (DestroyFVKeyOnStandby)',
    category: 'Encryption',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "pmset -g | grep 'DestroyFVKeyOnStandby' | awk '{print $2}'",
    expected: '1',
    operator: 'eq',
    severity: 'high',
  }),

  r('msb-101', {
    name: 'Réseau — DNS over HTTPS ou DNS sécurisé configuré',
    category: 'Network',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "networksetup -getdnsservers Wi-Fi 2>/dev/null | grep -qE '^[0-9]' && echo true || echo false",
    expected: 'true',
    operator: 'eq',
    severity: 'low',
  }),

  r('msb-102', {
    name: "Comptes — nombre de comptes administrateurs (recommandé : 1 seul)",
    category: 'Accounts',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "dscl . -list /Users | while read u; do dsmemberutil checkmembership -U \"$u\" -G admin 2>/dev/null | grep -q 'is a member' && echo \"$u\"; done | wc -l | tr -d ' '",
    expected: '1',
    operator: 'eq',
    severity: 'moderate',
  }),

  r('msb-103', {
    name: "Applications — accès à l'emplacement restreint aux applications autorisées",
    category: 'Privacy',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "sqlite3 /Library/Application\\ Support/com.apple.TCC/TCC.db 'SELECT count(*) FROM access WHERE service=\"kTCCServiceLocation\" AND auth_value=2' 2>/dev/null",
    expected: '0',
    operator: 'gt',
    severity: 'moderate',
  }),

  r('msb-104', {
    name: "Intégrité système — version macOS à jour (12 ou supérieure)",
    category: 'System Integrity',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "sw_vers -productVersion | cut -d'.' -f1",
    expected: '11',
    operator: 'gt',
    severity: 'critical',
    minOsVersion: 'macOS 12',
  }),

  r('msb-105', {
    name: "Réseau — Thunderbolt Bridge désactivé (si non nécessaire)",
    category: 'Network',
    checkType: 'command',
    targetPlatform: 'macos',
    target: "networksetup -listallnetworkservices 2>/dev/null | grep -qi 'thunderbolt bridge' && echo enabled || echo disabled",
    expected: 'enabled',
    operator: 'neq',
    severity: 'low',
  }),

];
