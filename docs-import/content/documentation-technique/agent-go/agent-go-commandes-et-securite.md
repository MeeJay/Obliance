Le dispatcher de commandes est le point d'entree unique pour l'execution des actions admin sur le poste ; il applique aussi les portes de securite (privacy mode) communes a tous les canaux de transport.

## CommandDispatcher â€” command_handler.go

`agent/command_handler.go` (82 Ko) definit `CommandDispatcher`, structure portant `deviceUUID`, `apiKey`, `serverURL`, `remediationEnabled`, `tlsInsecureSkipVerify`, avec les methodes `HandleCommand`, `executeCommand`, `ExecuteSync`.

Le switch principal comporte environ 28 command types (`agent/command_handler.go:24-395`) :

```
run_script, cancel_script
install_update, install_updates
check_compliance, remediate_rule
open_remote_tunnel, close_remote_tunnel
reboot, shutdown, sleep
start_custom_section, resize_custom_section, stop_custom_section
set_privacy_password, change_privacy_password, remove_privacy_password, verify_privacy_password
restart_agent, update_agent, uninstall_agent
install_oblireach
list_wts_sessions
list_processes, kill_process
list_service, restart_service, start_service, stop_service
list_directory, create_directory
rename_file, delete_file, download_file, upload_file
scan_network
check_software_compliance, install_software_compliance, uninstall_software_compliance
enable_privacy_mode, disable_privacy_mode
live_metrics
enable_airgap, disable_airgap
hyperv_list_vms, hyperv_control, hyperv_console_thumbnail
veeam_list_jobs, veeam_control
```

## Privacy mode â€” porte de securite commune

`isBlockedByPrivacy()` (`agent/command_handler.go:101-113`) definit la liste des commandes bloquees quand le privacy mode est actif :

- `open_remote_tunnel`
- `run_script`
- `list_wts_sessions`
- `list_processes`, `kill_process`
- Toutes les commandes file explorer (`list_directory`, `create_directory`, `rename_file`, etc.)

Cette meme fonction `isBlockedByPrivacy` est invoquee a l'identique par `dispatchHubCommand()` (canal WebSocket, `agent/command_channel.go:211-224`) et par `executeCommand`/`ExecuteSync` â€” garantissant qu'aucun chemin d'execution ne contourne la porte privacy, quel que soit le canal de transport utilise (WS temps reel ou poller HTTP synchrone).

## Compliance checks

`handleCheckCompliance` / `evaluateComplianceRule` (`agent/command_handler.go:909-1315`) supportent 5 types de check :

| Type | Description |
|---|---|
| `registry` | Lecture d'une cle registry Windows |
| `file` | Existence/contenu d'un fichier |
| `command` | Sortie d'une commande shell |
| `service` | Etat d'un service systeme |
| `process` | Presence/absence d'un processus |
| `event_log` | Recherche dans le journal d'evenements |

Operateurs disponibles : `eq`, `neq`, `contains`, `not_contains`, `exists`, `not_exists`, `gt`, `lt`, `regex`.

## Watchdog â€” agent/watchdog.go

Cote agent principal, `agent/watchdog.go` (`agent/watchdog.go:1-153`) expose :

```
readWatchdogState / writeWatchdogState
drainWatchdogRestarts / restoreWatchdogRestarts
InhibitWatchdog / ClearWatchdogInhibit
EnsureWatchdogRegistered
```

Ce module maintient un fichier d'etat (`watchdog.json`) coherent avec celui lu independamment par le binaire sentinelle `agent/cmd/watchdog/main.go`. `InhibitWatchdog` est notamment appele avant tout cycle d'auto-update MSI (voir page Architecture generale) pour eviter qu'un redemarrage externe n'interrompe le remplacement du service en cours.

## Build tags â€” portabilite cross-plateforme

Le pattern `//go:build <tag>` est utilise systematiquement pour isoler le code specifique a chaque OS, avec triplet Windows/Linux/autre-generalement-stub :

```
machine_uuid_windows.go / _linux.go / _darwin.go / _freebsd.go / _stub.go
  (garde !windows && !linux && !darwin && !freebsd)
airgap_windows.go / _linux.go / _other.go
cmd/tray/cmd_windows.go (//go:build windows) vs cmd_other.go (//go:build !windows)
tunnel_shell_windows.go vs tunnel_shell_unix.go
privacy_gate_{windows,linux,darwin,stub}.go
service_{windows,darwin,freebsd,stub}.go
```

Ce decoupage permet un seul module Go (`github.com/obliance/agent`) compile pour plusieurs cibles (Windows/macOS/Linux, amd64/arm64/x86) sans branches runtime couteuses â€” le compilateur elague le code non pertinent a la compilation.