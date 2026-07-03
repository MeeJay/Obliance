# Relais Oblireach et prise en main a distance

Deux services serveur cooperent pour la prise en main a distance : `remote.service.ts` gere le cycle de vie des sessions, `oblireachHub.service.ts` gere le canal de commande WebSocket persistant vers les agents Oblireach.

## RemoteService â€” `server/src/services/remote.service.ts` (386 lignes)

### Creation de session â€” `createSession()`

A la creation d'une session de controle distant :

1. Insertion d'une ligne dans `remote_sessions` avec :
   - `session_token = crypto.randomBytes(32).toString('hex')`
   - `status` initial `'waiting'`
2. Routage de la commande `open_remote_tunnel` vers l'agent, selon le protocole demande.

### Routage par protocole

| Protocole | Livraison | Fallback |
|---|---|---|
| `oblireach` | `oblireachHub.push(device.uuid, orCmd)` â€” instantane si le WS agent est connecte | Colonne `oblireach_devices.pending_command` (JSON), drainee a la reconnexion |
| `vmconsole` (console Hyper-V) | `agentHub.push` en live uniquement | **Aucun** â€” si echec, `status='failed'`, `end_reason='agent_offline'` |
| `rdp` / `ssh` / `shell` | Push WS immediat tente d'abord | `commandService.enqueue()` avec `priority:'urgent'`, `expiresInSeconds:300` |

### Relais WebSocket en memoire (tunneling)

`remote.service.ts` maintient une Map en memoire pour le relais bidirectionnel :

```ts
tunnels: Map<sessionToken, { browser, agent, agentBuffer }>
```

- `registerAgentTunnel()` / `registerBrowserTunnel()` enregistrent chaque cote de la connexion.
- Les frames envoyees par l'agent **avant** que le navigateur ne se connecte sont bufferisees dans `tunnel.agentBuffer`.
- Des que le navigateur se connecte : flush du buffer, puis envoi d'un message `{type: 'paired'}` pour signaler l'appariement complet.

### Keepalive

Ping WS toutes les **15 secondes**, cote agent ET cote navigateur, pour survivre aux timeouts idle des reverse proxies intermediaires (Nginx ~60s, Nginx Proxy Manager ~20s) â€” documente explicitement en commentaire dans le code source.

## ObliReachHubService â€” `server/src/services/oblireachHub.service.ts` (299 lignes)

Distinct du tunnel de streaming : ce service gere le **canal de commande** persistant, pas le flux video/controle lui-meme.

### Structure

```ts
Map<deviceUuid, ObliReachConn { ws, deviceUuid, tenantId }>
```

Une connexion WS persistante par agent Oblireach.

### `register()`

- Remplace toute connexion existante pour le meme `deviceUuid` : `ws.close(1000, 'replaced')`.
- Ecoute les types de messages entrants :
  - `heartbeat`
  - `chat_message` / `chat_event` â€” relayes via Socket.io vers la room `chat:${chatId}`, et persistes en table `chat_messages`.
- Drain automatique de toute `pending_command` en attente au moment de la reconnexion.

### `_handleHeartbeat()` (ligne 197)

A chaque heartbeat recu :

- Met a jour la table `oblireach_devices` : `hostname`, `os`, `arch`, `version`, `sessions` (JSON), `last_seen_at`.
- Respecte le feature flag `app_config.integrated_oblireach_enabled`.
- Declenche un auto-update WS (commande `type: 'update'`) si la version de l'agent est inferieure a celle lue depuis :

```
agent/dist/oblireach-version.txt
```

  Lecture mise en cache 60s, comparaison via une fonction semver simplifiee `isOlderVersion()`.

### API exposee par le hub

| Methode | Portee |
|---|---|
| `push(deviceUuid, cmd)` | Un seul agent |
| `broadcastCommand(cmd)` | Tous les devices, tous tenants confondus â€” utilise pour le chat car il n'existe pas de mapping serveur `device â†’ chatId` ; l'agent ignore les commandes dont il n'est pas proprietaire |
| `broadcastCommandToTenant(tenantId, cmd)` | Tous les devices d'un tenant |

## Routes HTTP associees â€” `server/src/routes/remote.routes.ts`

```
POST /sessions
GET  /sessions
POST /sessions/:id/end
POST /relay/validate-agent
POST /relay/issue-viewer-token
```

> Seule la liste des routes a ete verifiee (grep) ; le detail des handlers `validate-agent` et `issue-viewer-token` (mecanisme d'auth exact) n'est pas documente ici â€” se referer au code source pour l'implementation precise.

## Hors perimetre de cette page

Le protocole cote agent Go (format exact des messages heartbeat / commandes recus, gestion du buffer local) n'a pas ete inspecte dans ce lot â€” seul le cote serveur (`oblireachHub.service.ts`) est couvert ici.
