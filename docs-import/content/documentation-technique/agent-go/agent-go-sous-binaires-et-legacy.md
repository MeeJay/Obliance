Au-dela du binaire principal, `agent/cmd/` regroupe 5 sous-binaires independants, et un module Go 1.20 separe supporte les Windows Server anciens.

## Sous-binaires — agent/cmd/

| Binaire | Role | Notes |
|---|---|---|
| `cmd/tray` | Icone systray (Windows/macOS/Linux) | Via `github.com/getlantern/systray` |
| `cmd/legacy` | Agent Go 1.20 pour Windows Server 2008 R2+ | Module separe, voir plus bas |
| `cmd/diag` | Outil de diagnostic (gopsutil) | S'invoque via `go run ./cmd/diag` |
| `cmd/watchdog` | Sentinelle de redemarrage du service | Sans dependances externes |
| `cmd/wizard` + `cmd/wizard-linux` | Installeur graphique | Windows et Linux |

### Tray icon

`agent/cmd/tray/main.go` lit les memes fichiers d'etat que l'agent principal (`privacy.json`, `remote-session.json`, `airgap.json`, `config.json`) dans le meme `configDir`, grace a un `init()` duplique a l'identique de celui de `agent/main.go` (`agent/cmd/tray/main.go:43-74`) — garantit la coherence des chemins entre les deux binaires sans dependance de code partagee.

5 etats visuels (par priorite decroissante) : Airgap (bleu) > Session ObliReach active (rouge) > Service arrete (gris) > Privacy mode (orange) > Normal (vert). Icones embarquees via `//go:embed`. Mutex nomme `Local\OblianceTrayApp` — scope **par session** (pas global), ce qui permet un fonctionnement correct sur un terminal server multi-sessions ou chaque session utilisateur a sa propre instance de tray.

### Watchdog — cmd/watchdog/main.go

Outil minimal (`agent/cmd/watchdog/main.go:1-59`), sans dependances externes, concu pour etre invoque periodiquement par une Scheduled Task (Windows) ou un timer systemd (Linux). Il :

1. Lit `watchdog.json` (`inhibitUntil`, `restarts[]`)
2. Verifie l'etat du service `OblianceAgent`
3. Le redemarre s'il est arrete — **sauf** si `inhibitUntil > now`

Ce fichier d'etat est ecrit/lu de facon coherente par `agent/watchdog.go` cote agent principal (`readWatchdogState`/`writeWatchdogState`), garantissant que `InhibitWatchdog()` appele avant un update MSI est bien respecte par le processus sentinelle externe.

## Agent legacy — agent/cmd/legacy

### Module separe

`agent/cmd/legacy/go.mod` declare son propre module :

```
module github.com/obliance/agent/cmd/legacy
go 1.20
```

Seule dependance externe : `golang.org/x/sys v0.14.0` — **aucune** dependance a `gopsutil` ni `systray`. C'est un fichier unique de 2611 lignes (`agent/cmd/legacy/main.go:1-135`), avec son propre `loadConfig`/`saveConfig`/`loadConfigFromRegistry` **dupliques**, sans partage de code avec l'agent principal `agent/main.go`.

Build avec le toolchain dedie : `C:\Go1.20\bin\go.exe` (etape 7/7 du script de release, skip si le toolchain n'est pas present sur la machine de build).

### Command types supportes

Comptage direct des `case` de premier niveau dans le switch de dispatch (`agent/cmd/legacy/main.go:951-1005`) :

```
run_script, cancel_script
restart_agent
scan_inventory
reboot, shutdown, sleep
list_processes, kill_process
list_services, restart_service, start_service, stop_service
list_directory, create_directory, rename_file, delete_file
check_compliance
scan_updates, install_update, install_updates
uninstall_agent
list_wts_sessions
disable_privacy_mode
enable_airgap, disable_airgap
open_remote_tunnel, close_remote_tunnel
```

Ce comptage direct donne environ 27-28 entrees selon la maniere de grouper `open_remote_tunnel`/`close_remote_tunnel` (1 ou 2 cases) — chiffre a nuancer par rapport aux "23 commandes" parfois cites pour l'agent legacy ; se referer au switch source (`agent/cmd/legacy/main.go:951-1005`) pour un compte exact et a jour.

**Absent de l'agent legacy** (contrairement a l'agent principal) : pas de tunnels autres que le remote basique, pas de tray, pas d'auto-update spontane, pas de hyperv/veeam, pas de custom sections.

### Deploiement

L'agent legacy est deploye via `obliance-legacy.exe` + `sc create` (pas de MSI, contrairement a l'agent principal qui passe par `msiexec`). C'est l'option "Server 2008 R2" du `GlobalAddAgentModal` cote client, qui utilise `BitsTransfer` pour le telechargement (fix TLS sur ces vieux OS) avant l'enregistrement du service.

## Binaires distribues — agent/dist/

Le dossier `agent/dist/` contient tous les binaires pre-buildes recuperes par le `COPY agent/dist/ ./agent/dist/` du Dockerfile server (aucune compilation Go n'a lieu dans le conteneur) :

```
obliance-agent-{darwin-amd64,darwin-arm64,freebsd-amd64,linux-amd64,linux-arm64}
obliance-agent.exe / .msi (+ variantes x86)
obliance-legacy.exe
obliance-tray.exe (+ x86)
obliance-watchdog.* (5 plateformes)
obliance-installer-wizard.* (Windows + Linux)
oblireach-agent.* (agent separe pour le remote streaming)
vmconsole.zip
```

Les binaires Windows sont builds localement (Go 1.22 + Go 1.20 pour legacy), le binaire macOS via SSH `192.168.1.5` (`agent/build-mac.sh`), le binaire Linux via SSH `10.0.0.152` (`agent/build-linux.sh`) — orchestre par `000-RegularUpdate.bat`.

## Fichiers installeur — agent/installer/

`agent/installer/` contient les templates et scripts d'installation :

```
product.wxs           # Template WiX MSI (x64)
product-x86.wxs        # Template WiX MSI (x86)
install.ps1
install.sh
install-macos.sh
install-freebsd.sh
OblianceService.xml
```