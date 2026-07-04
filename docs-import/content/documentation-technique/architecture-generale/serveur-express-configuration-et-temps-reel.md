Cette page detaille le demarrage du serveur, la configuration Express/session/securite, et le routage bas niveau des connexions WebSocket.

## Sequence de demarrage — server/src/index.ts

La fonction `main()` de `D:\Obliance\server\src\index.ts` execute, dans cet ordre strict :

1. `db.migrate.latest()` (Knex) — applique toutes les migrations en attente avant d'accepter du trafic
2. `ensureDefaultAdmin()` — cree le compte admin par defaut si absent
3. `createApp()` (voir `app.ts`) puis `http.createServer()` sur l'app Express

## Double serveur WebSocket sur le meme port

Point d'architecture central : le meme serveur HTTP Node porte **deux mecanismes WebSocket distincts** :

- **Socket.io** : `io = createSocketServer(server)` (voir `server/src/socket.ts`)
- **`ws` brut**, en mode `noServer: true`

`server/src/index.ts` intercepte **manuellement tous les evenements `upgrade`** HTTP et route selon le `pathname` de la requete :

```
/api/remote/tunnel/<token>          -> tunnel navigateur (remote session)
/api/remote/agent-tunnel/<token>    -> tunnel agent (RDP / SSH / CMD relay)
/api/agent/ws                       -> command_channel agent (push WS persistant)
/api/oblireach/ws                   -> hub oblireach (ObliReachHub)
```

Les listeners `upgrade` d'origine installes par Socket.io sont **captures puis rappeles en fallback** si aucun des patterns ci-dessus ne matche, afin de ne pas casser le fonctionnement natif de Socket.io.

## server/src/app.ts — createApp()

Configuration Express, dans l'ordre logique observe :

| Element | Detail |
|---|---|
| `helmet` | CSP stricte ; `frameguard` **desactive volontairement** pour permettre l'embed en iframe par l'app desktop ObliTools |
| CORS | `origin: config.clientOrigin`, `credentials: true` |
| Session | `express-session` backee par `connect-pg-simple` (table `session`, `createTableIfMissing: false` — la table doit exister via migration) |
| Rate limiting | `apiLimiter` applique **apres** le middleware de session, pour exclure les utilisateurs deja authentifies du throttling agressif |
| Garde-fou production | Si `SESSION_SECRET` est absent, vaut une valeur par defaut, ou fait moins de 32 caracteres : `process.exit(1)` en `NODE_ENV=production` |
| Route SSO | `/auth` (hors `/api`) — callback Obligate SSO |
| Routes API | toutes montees sous `/api` |
| `GET /health` | endpoint public, retourne `{ status, version, timestamp }` — `version` lu depuis `package.json` **au runtime** |
| `GET /downloads/:filename` | endpoint public avec whitelist, pour l'app desktop ObliTools |
| Statique | en production, sert le build client (`express.static`) avec fallback SPA |

## server/src/config.ts

Variables d'environnement lues :

```
PORT (defaut 3001)
NODE_ENV
DATABASE_URL
SESSION_SECRET
CLIENT_ORIGIN
FORCE_HTTPS
APP_NAME
APP_URL
DEFAULT_ADMIN_USERNAME
DEFAULT_ADMIN_PASSWORD
DISABLE_2FA_FORCE
MIN_PUSH_INTERVAL
CUSTOM_DIR
```

## server/knexfile.ts

```ts
client: 'pg',
pool: { min: 2, max: 25 },  // commentaire dans le code : max:10 saturait le pool sous charge reelle de push agents
acquireConnectionTimeout: 20000,  // fail-fast plutot que de rester bloque
migrations: { directory: 'src/db/migrations' },  // .ts en dev / .js compile en prod
seeds: { directory: 'src/db/seeds' }
```

Le pool `max: 25` (au lieu de 10 historiquement) est directement lie a la charge generee par les push periodiques des agents deployes (metriques + ACK de commandes) — un point a garder en tete pour tout dimensionnement futur de l'infrastructure PostgreSQL.

## server/src/socket.ts — Socket.io

Configuration observee :

- `cors: { origin: true }` — reflect de l'origin plutot qu'une valeur fixe, car les origins avec port different (dev, proxy nginx) cassent un CORS a valeur figee derriere le reverse proxy
- `transports: ['websocket', 'polling']`
- `maxHttpBufferSize: 150MB` — necessaire pour l'upload de fichiers en base64 via le file explorer distant
- Middleware `io.use()` d'authentification : lit `socket.handshake.auth = { userId, tenantId }`, verifie l'utilisateur contre la table `users`, puis verifie l'appartenance au tenant via `user_tenants` — **sauf** pour `role === 'admin'`, qui bypasse cette verification (coherent avec le comportement god-view du tenant master decrit pour le reste de l'application)

## Isolation multi-tenant — constante partagee

La constante `MASTER_TENANT_ID = 1` est definie une seule fois dans `shared/src/tenants.ts` et exportee via `@obliance/shared` :

```ts
// shared/src/tenants.ts, ligne 11
export const MASTER_TENANT_ID = 1;
// lignes 16-17
export function isMasterTenant(tenantId: number): boolean {
  return tenantId === MASTER_TENANT_ID;
}
```

Cette meme fonction `isMasterTenant()` est utilisee cote server pour les verifications de scope tenant dans les services et controllers, garantissant une source de verite unique pour la logique god-view du tenant `id=1`.

## Elements non explores en detail

Pour completude, deux zones du serveur n'ont pas ete auditees au-dela de leur usage direct et meriteraient un chapitre dedie si le sujet temps-reel/WebSocket doit etre approfondi :

- `server/src/db/` (contenu complet de la config Knex partagee et des seeds, au-dela de `knexfile.ts`)
- `server/src/socket.ts` au-dela de la configuration d'ouverture — la liste complete des evenements `io.on(...)` emis/recus n'a pas ete cataloguee ici.