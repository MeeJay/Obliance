Cette page dÃ©crit les deux mÃ©canismes temps rÃ©el coexistant sur le mÃªme serveur HTTP Obliance : Socket.io pour le client web, et un dispatcher WebSocket bas niveau pour les canaux agents/tunnels.

## Deux mÃ©canismes distincts sur le mÃªme port

Le serveur HTTP crÃ©Ã© dans `server/src/index.ts` (`http.createServer(app)`) sert de support Ã  deux systÃ¨mes temps rÃ©el diffÃ©rents, avec des schÃ©mas d'authentification diffÃ©rents :

1. **Socket.io** (`server/src/socket.ts`) â€” utilisÃ© par le client React (dashboard, notifications, etc.).
2. **Un dispatcher WebSocket manuel** branchÃ© sur l'Ã©vÃ©nement `'upgrade'` du serveur HTTP â€” utilisÃ© pour les canaux agents Go, les tunnels de sessions distantes et ObliReach.

## Socket.io â€” `createSocketServer()`

`server/src/socket.ts` exporte `createSocketServer()` et `getIO()`.

### Authentification â€” particularitÃ© architecturale

Socket.io **n'utilise pas** le cookie de session `express-session` pour authentifier la connexion. Le middleware `io.use()` (`socket.ts:32-56`) lit Ã  la place des identifiants envoyÃ©s explicitement par le client dans le handshake :

```ts
socket.handshake.auth.{ userId, tenantId }
```

Ces valeurs sont ensuite vÃ©rifiÃ©es cÃ´tÃ© serveur :

- Existence et activitÃ© de l'utilisateur : `db('users').where({ id: userId, is_active: true })`
- Appartenance au tenant : `db('user_tenants')` â€” sauf si `role === 'admin'`, auquel cas la vÃ©rification de membership est **bypassÃ©e**.

C'est donc un mÃ©canisme d'authentification entiÃ¨rement distinct de celui des routes REST (qui repose sur le cookie de session `connect.sid`). Un client qui se connecte en Socket.io doit transmettre explicitement `userId`/`tenantId` obtenus au prÃ©alable via l'API REST authentifiÃ©e.

### Rooms rejointes Ã  la connexion

Ã€ chaque connexion rÃ©ussie, le socket rejoint (`socket.ts:63-80`) :

- `user:<id>`
- `tenant:<tenantId>`
- `tenant:<tenantId>:notifications`
- Si `role === 'admin'` : `tenant:<tenantId>:admin` + `role:admin`
- `'general'`
- Une room de notifications **pour chaque tenant** dont l'utilisateur est membre (cas des utilisateurs multi-tenant, en dehors du tenant courant)

## Dispatcher WebSocket manuel â€” `index.ts:37-201`

AprÃ¨s la crÃ©ation de Socket.io, `index.ts` rÃ©alise une manÅ“uvre explicite pour partager le mÃªme serveur HTTP entre Socket.io et des connexions WebSocket brutes :

1. Capture des listeners `'upgrade'` dÃ©jÃ  enregistrÃ©s par Socket.io : `server.rawListeners('upgrade')`
2. Suppression de tous les listeners existants : `server.removeAllListeners('upgrade')`
3. RÃ©-enregistrement d'un listener `'upgrade'` unique qui route manuellement selon le `pathname` de la requÃªte :

| Pathname | Usage | Authentification |
|---|---|---|
| `/api/remote/tunnel/<64 hex>` | Tunnel navigateur (session distante cÃ´tÃ© viewer) | â€” |
| `/api/remote/agent-tunnel/<64 hex>` | Tunnel agent (session distante cÃ´tÃ© agent Go) | `X-Api-Key` |
| `/api/agent/ws` | Canal de commandes principal agent (push WebSocket persistant) | `X-Api-Key` + `X-Device-Uuid`, avec auto-enregistrement du device si absent en base |
| `/api/oblireach/ws` | Canal de commandes ObliReach | `X-Api-Key` + paramÃ¨tre de requÃªte `uuid` |
| tout le reste | â€” | Reforward vers les listeners `'upgrade'` d'origine de Socket.io (capturÃ©s Ã  l'Ã©tape 1) |

### Canal de commandes agent â€” `/api/agent/ws`

L'auto-enregistrement du device (mentionnÃ© dans le tableau ci-dessus) signifie qu'un agent se connectant pour la premiÃ¨re fois avec une clÃ© API valide mais un `X-Device-Uuid` inconnu en base dÃ©clenche la crÃ©ation de l'enregistrement `devices` correspondant cÃ´tÃ© serveur. Le dÃ©tail exact de ce mÃ©canisme d'auto-enregistrement (fichiers agent Go impliquÃ©s, statut initial exact du device crÃ©Ã©) n'a pas Ã©tÃ© auditÃ© plus finement dans cette investigation et n'est donc pas dÃ©crit ici.

### Canal ObliReach â€” `/api/oblireach/ws`

Distinct du canal de commandes principal (`/api/agent/ws`), ce canal ObliReach est authentifiÃ© par `X-Api-Key` et le paramÃ¨tre de requÃªte `uuid` (voir tableau ci-dessus). Les services serveur exacts qui le relaient n'ont pas Ã©tÃ© auditÃ©s dans le dÃ©tail dans cette investigation et ne sont donc pas listÃ©s ici.

## RÃ©sumÃ© des deux plans d'authentification temps rÃ©el

| Canal | Transport | Authentification |
|---|---|---|
| Client web (dashboard) | Socket.io | `socket.handshake.auth.{userId, tenantId}`, vÃ©rifiÃ©s en base Ã  chaque connexion |
| Agents Go (commandes) | WebSocket brut, dispatcher manuel | En-tÃªtes `X-Api-Key` + `X-Device-Uuid` |
| Tunnels distants (agent) | WebSocket brut, dispatcher manuel | En-tÃªte `X-Api-Key` |
| Tunnels distants (navigateur) | WebSocket brut, dispatcher manuel | Token dans le path (`<64 hex>`) |
| ObliReach | WebSocket brut, dispatcher manuel | `X-Api-Key` + paramÃ¨tre `uuid` |

Aucun de ces canaux WebSocket bruts ne repose sur le cookie de session `express-session` utilisÃ© par les routes REST classiques â€” seul Socket.io s'appuie (indirectement, via des identifiants transmis dans le handshake) sur un Ã©tat d'authentification prÃ©alablement obtenu cÃ´tÃ© client par l'API REST.
