L'agent Obliance est un binaire Go 1.22 multiplateforme (Windows 10+/macOS/Linux) qui centralise la remontee de metriques, l'execution de commandes admin et l'auto-update du poste supervise.

## Module et versioning

Le module principal est declare dans `agent/go.mod` :

```
module github.com/obliance/agent
go 1.22
```

Dependances cles (`agent/go.mod:1-19`) :

| Dependance | Usage |
|---|---|
| `github.com/creack/pty` | Tunnels PTY (shell distant) |
| `github.com/getlantern/systray` | Icone tray (Windows/macOS/Linux) |
| `github.com/lxn/walk` + `github.com/lxn/win` | UI native Windows |
| `github.com/shirou/gopsutil/v3` | Metriques cross-OS |
| `golang.org/x/crypto`, `golang.org/x/sys` | Primitives systeme/crypto |

Le numero de version vit dans `agent/VERSION` (fichier texte, actuellement `4.5.70`) et est injecte au build via :

```
-ldflags="-X main.agentVersion=x.y.z"
```

Sans injection, `var agentVersion = "dev"` (`agent/main.go:22-25`) sert de valeur par defaut.

## Configuration : config.json

`loadConfig()` / `saveConfig()` (dans `agent/main.go`) lisent/ecrivent :

- Windows : `%PROGRAMDATA%\OblianceAgent\config.json`
- Unix : `/etc/obliance-agent/config.json`

Le chemin (`configDir`) est fixe dans le `init()` du package (`agent/main.go:32-43`). Le meme `init()` est **duplique a l'identique** dans `agent/cmd/tray/main.go:43-74` pour garantir que le tray lit exactement les memes fichiers d'etat que l'agent principal (`privacy.json`, `remote-session.json`, `airgap.json`, `config.json`).

Structure de `Config` (`agent/main.go:47-62`) :

```go
type Config struct {
    ServerURL             string
    APIKey                string
    DeviceUUID            string
    CheckIntervalSeconds  int
    ScanIntervalSeconds   int
    TaskRetrieveDelaySec  int
    RemediationEnabled    bool
    AgentVersion          string
    TlsInsecureSkipVerify bool
    BackoffUntil          // non persiste
}
```

### setupConfig() â€” priorite fichier vs registry

`setupConfig()` (`agent/main.go:92-115`) applique une regle precise : le fichier `config.json` est prioritaire, **sauf** si les valeurs `ServerURL`/`APIKey` presentes dans la registry Windows (ecrites par le MSI lors de l'install) different de celles du fichier â€” auquel cas la registry ecrase le fichier. Ce mecanisme permet a une reinstallation MSI (avec une nouvelle cle API ou un nouveau serveur) de reconfigurer un agent existant sans purge manuelle de `config.json`.

Autre point durci : l'URL serveur n'est **plus jamais** auto-upgradee de `http://` vers `https://` â€” `cfg.ServerURL` est conserve tel quel (`agent/main.go:145-153`), le code porte un commentaire explicite renvoyant a un bug historique corrige (une auto-upgrade silencieuse cassait les installs on-prem en HTTP volontaire).

## Cycle de vie â€” mainLoop()

`mainLoop()` (`agent/main.go:485-644`) demarre sequentiellement, dans cet ordre :

1. `cleanupOrphanedProcesses()`
2. Reset de `remote-session.json`
3. `loadPrivacyState()` / `loadAirgapState()`
4. Bootstrap ACL cible **uniquement** sur `privacy.json`, `airgap.json`, `remote-session.json` â€” pas sur tout `configDir`, pour eviter une fuite de permissions sur `config.json` (contient la cle API). Commentaire de securite explicite dans le code.
5. `ClearWatchdogInhibit()`
6. Goroutine `EnsureWatchdogRegistered(cfg)`
7. `addEvent('machine_boot', nil)`
8. Goroutines : `watchPrivacyFile`, `watchTrayLoop`, `watchSessionLogins`
9. Creation du dispatcher via `NewCommandDispatcher`
10. Goroutine `runCommandChannel` (canal WebSocket persistant)
11. Goroutine `runCommandPoller` (fallback HTTP)
12. Goroutine de scan periodique (toutes les 60s, dispatch conditionnel)
13. Goroutine de collecte des services (30s sur Unix / 90s sur Windows)
14. Boucle infinie : `push(cfg)` + `WaitForNextPushOrPulse`

`runAsService()` (`agent/service_windows.go:94`) detecte si le processus tourne sous controle du SCM Windows et bascule le handoff en consequence ; sur Linux c'est un no-op qui retourne immediatement (commentaire dans `main()`, `agent/main.go:653-656`).

## Auto-update

`applyUpdateIfNewer()` (`agent/main.go:277-428`) gere deux chemins de mise a jour :

- **Windows** : telechargement du MSI complet, arch-aware (`x86/obliance-agent.msi` vs `obliance-agent-x86.msi`)
- **Unix** : telechargement du binaire nu, nomme `obliance-agent-<GOOS>-<GOARCH>`

Dans les deux cas, verification SHA-256 via le header `X-Content-SHA256` avant application.

`applyWindowsMSIUpdate()` (`agent/main.go:430-460`) lance directement :

```
msiexec.exe /i <msi> /quiet /norestart SERVERURL=... APIKEY=... /l*v <log>
```

Aucun script batch intermediaire. L'agent n'appelle pas `os.Exit()` â€” c'est le service Windows Installer (`msiserver`) qui stoppe/redemarre le service `OblianceAgent` via le SCM. Avant le lancement, `InhibitWatchdog(15*time.Minute)` est appele (`agent/main.go:365-368`) pour empecher le watchdog externe de redemarrer le service pendant le cycle stop/replace/start.

Important : l'agent **ne se met plus a jour spontanement**. Les updates sont exclusivement declenchees par la commande admin `update_agent`. `fetchLatestVersion()`/`latestVersion` (`agent/main.go:222-249, 561-566`) ne servent qu'a afficher le badge Â« update available Â» cote client â€” aucune application automatique en tache de fond.