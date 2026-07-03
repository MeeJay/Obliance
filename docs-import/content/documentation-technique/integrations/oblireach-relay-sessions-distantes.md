# Oblireach â€” Relais WebSocket et sessions distantes

Obliance multiplexe plusieurs canaux WebSocket sur le meme port HTTP pour piloter les agents RMM et les sessions de prise en main a distance (Oblireach).

## Interception des upgrades HTTP

`server/src/index.ts` (lignes 37-201) intercepte **tous** les evenements `upgrade` du serveur HTTP. Socket.io/engine.io enregistre normalement son propre listener `upgrade` â€” pour cohabiter sans que Socket.io ne consomme les upgrades destines aux autres canaux, le code capture puis retire les listeners `upgrade` que Socket.io vient d'enregistrer, puis les remplace par un listener unique qui route par `pathname` via regex vers l'un des 4 handlers ci-dessous, et **re-appelle les listeners Socket.io captures en fallback** si aucune regex ne matche.

### Table de routing

| Path | Consommateur | Handler |
|---|---|---|
| `/api/remote/tunnel/<token>` | Navigateur (viewer) | `remoteService.registerBrowserTunnel()` |
| `/api/remote/agent-tunnel/<token>` | Agent (RDP/SSH/CMD/PowerShell) | `remoteService.registerAgentTunnel()` |
| `/api/agent/ws` | Agent RMM classique (canal de commandes) | `agentHub` |
| `/api/oblireach/ws` | Agent Oblireach (canal de commandes) | `oblireachHub.register()` |

Le `<token>` des deux premiers paths est un `session_token` hexadecimal, coherent avec un `session_token` genere via `crypto.randomBytes(32).toString('hex')` (32 octets â†’ 64 caracteres hexadecimaux).

Pour `/api/oblireach/ws` (lignes 177-195) : le serveur verifie `X-Api-Key` contre `agent_api_keys`, lit le param de query `uuid`, puis appelle :

```ts
await oblireachHub.register(devUuid, keyRow.tenant_id, ws);
```

## oblireachHub.service.ts â€” canal de commandes Oblireach

`server/src/services/oblireachHub.service.ts` maintient une `Map<deviceUuid, ObliReachConn>` **en memoire** (pas de persistance des connexions actives â€” un redemarrage serveur force toutes les reconnexions).

### Ping serveur

Un ping WS est envoye a chaque connexion toutes les **15 secondes** (lignes 70-78) pour detecter les connexions mortes et survivre aux timeouts de reverse proxy.

### Methodes cles

| Methode | Role |
|---|---|
| `register()` | Enregistre une connexion agent Oblireach dans la Map |
| `push(deviceUuid, cmd)` | Envoie une commande ; retourne `false` si l'agent est offline (lignes 249-259) â€” pas d'exception |
| `broadcastCommand` / `broadcastCommandToTenant` | Diffusion a tous les agents / a un tenant |
| `isConnected()` | Verifie la presence dans la Map |

### Traitement des messages entrants

Sur reception d'un message WS depuis l'agent Oblireach, `oblireachHub` distingue 3 types de payload :

1. **`heartbeat`** â€” upsert dans la table `oblireach_devices`. Si la version rapportee est inferieure a la derniere version connue (lue depuis le fichier `agent/dist/oblireach-version.txt`), une commande d'auto-update est injectee automatiquement.
2. **`chat_message`** â€” persiste dans la table `chat_messages`, puis relaie sur la room Socket.io `chat:<chatId>`.
3. **`chat_event`** â€” actions `user_closed` / `typing` / `allow_remote` / `deny_remote`, relayees en Socket.io sans persistance.

## remote.service.ts â€” orchestration des sessions

`server/src/services/remote.service.ts` gere le cycle de vie complet d'une session distante.

### Creation de session

`createSession()` cree une ligne `remote_sessions` avec :

```ts
session_token = crypto.randomBytes(32).toString('hex')
```

Le routing du push de commande vers l'agent depend du protocole :

| Protocole | Canal | Fallback si offline |
|---|---|---|
| `oblireach` | `oblireachHub.push()` | DB â€” colonne `oblireach_devices.pending_command` |
| `vmconsole` (Hyper-V) | `agentHub.push()` | **aucun** â€” live-only, echoue si l'agent RMM n'est pas connecte |
| RDP / SSH / Shell | `agentHub.push()` | `commandService.enqueue()` â€” priorite `urgent`, expiration 300s |

### Relais bidirectionnel bas niveau

`registerAgentTunnel()` et `registerBrowserTunnel()` implementent le pont WS <-> WS :

- **Bufferisation** : tant que le navigateur n'est pas encore connecte, les frames WS envoyees par l'agent sont accumulees dans `agentBuffer` puis flush a la connexion du viewer.
- **Preservation du flag `isBinary`** : necessaire pour distinguer les frames JSON de controle (resize, ack, etc.) du flux binaire brut (video/clavier/souris).
- **Keepalive** : ping toutes les **15 secondes** de chaque cote (agent et navigateur) pour survivre aux timeouts des reverse proxies intermediaires.

## remote.routes.ts â€” endpoints HTTP

### `POST /sessions` (lignes 9-57)

Route definie dans `remote.routes.ts` :

1. Verifie la capability `remote` via `permissionService` (skip si admin).
2. Bloque avec **409** si `devices.agent_flavor === 'legacy'` â€” l'agent legacy (Go 1.20, Windows Server 2008 R2+) n'implemente pas de tunnel.
3. Passe par `applyRestriction` avec la action key `remote.session_start` (garde-fou de policy).
4. Appelle `remoteService.createSession()`.

### Relais Oblireach standalone â€” authentification externe

Deux endpoints authentifient un composant relay externe, distinct du flux applicatif habituel â€” leur implementation n'est pas localisee dans ce depot, seul le mecanisme d'authentification cote serveur qui les protege est documente ici.

#### `POST /relay/validate-agent` (lignes 97-134)

Protege par un secret partage, **pas** par le middleware d'auth standard :

```
Header requis : X-Internal-Secret
Valeur attendue : process.env.OBLIREACH_SECRET (cote serveur)
```

Verifie, via une jointure des tables `remote_sessions` et `agent_api_keys`, qu'un agent connectant est bien autorise pour la session donnee. Utilise par le relay standalone pour confirmer cette autorisation avant d'accepter la connexion d'un agent.

#### `POST /relay/issue-viewer-token` (lignes 136-162)

Minte un token HMAC-SHA256 pour le viewer, au format :

```
<sessionToken>.<expireUnix>.<hmac-hex>
```

Signe via `process.env.OBLIREACH_SECRET`. Ce token est concu pour permettre au relay standalone de valider un viewer sans round-trip systematique vers le serveur Obliance.

## Points d'attention

- Le middleware d'upgrade unique dans `index.ts` est un point critique : toute nouvelle route WS doit ajouter sa propre regex dans cette meme fonction (pas de router WS separe) â€” sinon la requete risque de ne pas etre routee correctement et retombe dans le fallback Socket.io.
- `oblireachHub` et `agentHub` (canal `/api/agent/ws`, non detaille ici) sont deux services **distincts** avec des Map de connexions separees â€” un agent RMM classique et un agent Oblireach sur la meme machine ont deux connexions WS independantes.
- Le fallback DB pour `oblireach` (`pending_command`) n'existe pas pour `vmconsole` : une session console Hyper-V echoue immediatement si l'agent est offline, elle ne se met pas en attente.
- `OBLIREACH_SECRET` est une variable d'environnement serveur qui doit etre definie explicitement en production, avec une valeur forte et unique par installation, pour securiser `/relay/validate-agent` et `/relay/issue-viewer-token` â€” a verifier systematiquement avant toute mise en production.