L'agent communique avec le serveur Obliance via trois canaux complementaires : un WebSocket persistant pour les commandes push, un fallback HTTP en polling, et un endpoint de push periodique pour les metriques.

## Canal WebSocket persistant â€” command_channel.go

`agent/command_channel.go` implemente une connexion WebSocket persistante vers `/api/agent/ws`, avec conversion automatique du schema (`https://` â†’ `wss://`, `http://` â†’ `ws://`) et authentification par headers `X-Api-Key` / `X-Device-UUID` (`agent/command_channel.go:100-121`).

### Protocole

Message serveur â†’ agent (texte JSON) :

```json
{ "type": "command", "id": "...", "commandType": "...", "payload": {} }
```

Reponse agent â†’ serveur :

```json
{
  "type": "ack",
  "id": "...",
  "commandType": "...",
  "success": true,
  "result": {},
  "sessionToken": "...",
  "error": null
}
```

(`agent/command_channel.go:9-16, 31-46`)

### Reconnexion

Backoff automatique de 10s en cas de coupure, **sauf** si le serveur ferme la connexion avec le code WS `4004` ("Device not found") â€” cas typique d'une installation fraiche avant le tout premier push HTTP â€” auquel cas le backoff passe a 60s (`agent/command_channel.go:80-95`).

### Dispatch et porte privacy mode

`dispatchHubCommand()` applique une verification de privacy mode **avant** tout dispatch : `isBlockedByPrivacy(...)` + `CheckUnlockToken(...)` (`agent/command_channel.go:211-224`). Le code porte un commentaire explicite : cette porte doit rester strictement identique a celle utilisee dans `executeCommand`/`ExecuteSync`, afin que tous les chemins d'execution (WS, poller HTTP, appels synchrones) partagent une seule source de verite pour le blocage privacy.

Routing special pour 4 command types traites de facon asynchrone directement sur le canal WS : `open_remote_tunnel`, `close_remote_tunnel`, `open_vm_console`, `close_vm_console`. Tous les autres command types passent par `d.ExecuteSync(cmd)` (`agent/command_channel.go:226-241`).

## Fallback HTTP â€” command_poller.go

`agent/command_poller.go` interroge `GET /api/agent/commands` toutes les `cfg.TaskRetrieveDelaySec` secondes (defaut 10s, configurable par l'admin cote serveur). C'est le filet de secours quand le canal WebSocket est temporairement indisponible (proxy bloquant les upgrades WS, coupure reseau, etc.). Le serveur peut retourner un `nextDelaySeconds` different pour ajuster dynamiquement la cadence de polling (`agent/command_poller.go:1-98`).

## Push periodique â€” push.go

`POST /api/agent/push` envoie un payload complet a chaque cycle (`agent/push.go:54-77`) :

```
deviceUuid, hostname, agentVersion, osInfo, metrics, acks,
ipLocal, macAddress, privacyMode, airgapMode, lastLoggedInUser,
distroFamily, events, watchdogRestartCount, watchdogLastRestartAt,
virtualizationHost ("hyperv"), backupHost ("veeam")
```

`detectDistroFamily()` (`agent/push.go:121-183`) normalise les familles Linux (`debian`, `rhel`, `fedora`, `arch`, `suse`) a partir du champ `ID=` de `/etc/os-release`.

### Gestion des codes retour

`push()` (`agent/push.go:251-365`) traite trois cas principaux :

| Code HTTP | Comportement |
|---|---|
| `200` | OK â€” met a jour les intervalles depuis `result.Config`/`nextPollIn`, dispatch les commandes recues, gere la commande legacy `uninstall` |
| `202` | Device en attente d'approbation admin â€” peut neanmoins recevoir des commandes |
| `401` | Backoff exponentiel via `backoffSteps = [5, 10, 30, 60]` minutes, `backoffLevel` incremente, `cfg.BackoffUntil` persiste en memoire |

Point d'attention documente directement dans le code : le status `updating` est **explicitement preserve** pendant le cycle de push â€” le champ `LatestVersion` n'est plus auto-applique cote agent (`agent/push.go:318-321`), coherent avec la regle serveur qui ne flip pas le statut vers `online` tant que la version n'a pas reellement change post-MSI.

## Vue d'ensemble des trois canaux

| Canal | Fichier | Frequence | Role |
|---|---|---|---|
| WebSocket push | `agent/command_channel.go` | Persistant | Commandes temps reel (remote, scripts...) |
| Poller HTTP | `agent/command_poller.go` | `TaskRetrieveDelaySec` (defaut 10s) | Fallback si WS down |
| Push metriques | `agent/push.go` | Cycle principal `mainLoop` | Metriques + ACKs + events + config sync |