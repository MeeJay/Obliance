Cette page décrit les deux mécanismes temps réel coexistant sur le même serveur HTTP Obliance : Socket.io pour le client web, et un dispatcher WebSocket bas niveau pour les canaux agents/tunnels.

## Deux mécanismes distincts sur le même port

Le serveur HTTP créé dans `server/src/index.ts` (`http.createServer(app)`) sert de support à deux systèmes temps réel différents, avec des schémas d'authentification différents :

1. **Socket.io** (`server/src/socket.ts`) — utilisé par le client React (dashboard, notifications, etc.).
2. **Un dispatcher WebSocket manuel** branché sur l'événement `'upgrade'` du serveur HTTP — utilisé pour les canaux agents Go, les tunnels de sessions distantes et ObliReach.

## Socket.io — `createSocketServer()`

`server/src/socket.ts` exporte `createSocketServer()` et `getIO()`.

### Authentification — particularité architecturale

Socket.io **n'utilise pas** le cookie de session `express-session` pour authentifier la connexion. Le middleware `io.use()` (`socket.ts:32-56`) lit à la place des identifiants envoyés explicitement par le client dans le handshake :

```ts
socket.handshake.auth.{ userId, tenantId }
```

Ces valeurs sont ensuite vérifiées côté serveur :

- Existence et activité de l'utilisateur : `db('users').where({ id: userId, is_active: true })`
- Appartenance au tenant : `db('user_tenants')` — sauf si `role === 'admin'`, auquel cas la vérification de membership est **bypassée**.

C'est donc un mécanisme d'authentification entièrement distinct de celui des routes REST (qui repose sur le cookie de session `connect.sid`). Un client qui se connecte en Socket.io doit transmettre explicitement `userId`/`tenantId` obtenus au préalable via l'API REST authentifiée.

### Rooms rejointes à la connexion

À chaque connexion réussie, le socket rejoint (`socket.ts:63-80`) :

- `user:<id>`
- `tenant:<tenantId>`
- `tenant:<tenantId>:notifications`
- Si `role === 'admin'` : `tenant:<tenantId>:admin` + `role:admin`
- `'general'`
- Une room de notifications **pour chaque tenant** dont l'utilisateur est membre (cas des utilisateurs multi-tenant, en dehors du tenant courant)

## Dispatcher WebSocket manuel — `index.ts:37-201`

Après la création de Socket.io, `index.ts` réalise une manœuvre explicite pour partager le même serveur HTTP entre Socket.io et des connexions WebSocket brutes :

1. Capture des listeners `'upgrade'` déjà enregistrés par Socket.io : `server.rawListeners('upgrade')`
2. Suppression de tous les listeners existants : `server.removeAllListeners('upgrade')`
3. Ré-enregistrement d'un listener `'upgrade'` unique qui route manuellement selon le `pathname` de la requête :

| Pathname | Usage | Authentification |
|---|---|---|
| `/api/remote/tunnel/<64 hex>` | Tunnel navigateur (session distante côté viewer) | — |
| `/api/remote/agent-tunnel/<64 hex>` | Tunnel agent (session distante côté agent Go) | `X-Api-Key` |
| `/api/agent/ws` | Canal de commandes principal agent (push WebSocket persistant) | `X-Api-Key` + `X-Device-Uuid`, avec auto-enregistrement du device si absent en base |
| `/api/oblireach/ws` | Canal de commandes ObliReach | `X-Api-Key` + paramètre de requête `uuid` |
| tout le reste | — | Reforward vers les listeners `'upgrade'` d'origine de Socket.io (capturés à l'étape 1) |

### Canal de commandes agent — `/api/agent/ws`

L'auto-enregistrement du device (mentionné dans le tableau ci-dessus) signifie qu'un agent se connectant pour la première fois avec une clé API valide mais un `X-Device-Uuid` inconnu en base déclenche la création de l'enregistrement `devices` correspondant côté serveur. Le détail exact de ce mécanisme d'auto-enregistrement (fichiers agent Go impliqués, statut initial exact du device créé) n'a pas été audité plus finement dans cette investigation et n'est donc pas décrit ici.

### Canal ObliReach — `/api/oblireach/ws`

Distinct du canal de commandes principal (`/api/agent/ws`), ce canal ObliReach est authentifié par `X-Api-Key` et le paramètre de requête `uuid` (voir tableau ci-dessus). Les services serveur exacts qui le relaient n'ont pas été audités dans le détail dans cette investigation et ne sont donc pas listés ici.

## Résumé des deux plans d'authentification temps réel

| Canal | Transport | Authentification |
|---|---|---|
| Client web (dashboard) | Socket.io | `socket.handshake.auth.{userId, tenantId}`, vérifiés en base à chaque connexion |
| Agents Go (commandes) | WebSocket brut, dispatcher manuel | En-têtes `X-Api-Key` + `X-Device-Uuid` |
| Tunnels distants (agent) | WebSocket brut, dispatcher manuel | En-tête `X-Api-Key` |
| Tunnels distants (navigateur) | WebSocket brut, dispatcher manuel | Token dans le path (`<64 hex>`) |
| ObliReach | WebSocket brut, dispatcher manuel | `X-Api-Key` + paramètre `uuid` |

Aucun de ces canaux WebSocket bruts ne repose sur le cookie de session `express-session` utilisé par les routes REST classiques — seul Socket.io s'appuie (indirectement, via des identifiants transmis dans le handshake) sur un état d'authentification préalablement obtenu côté client par l'API REST.
