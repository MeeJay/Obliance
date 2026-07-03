Cette page dÃ©crit la construction de l'application Express, l'ordre des middlewares, la configuration de la base de donnÃ©es et la sÃ©quence de dÃ©marrage du serveur Obliance.

## Construction de l'application â€” `createApp()`

Le fichier `server/src/app.ts` exporte `createApp()`, qui assemble l'application Express dans un ordre strict. Cet ordre est documentÃ© par des commentaires explicites dans le code et ne doit pas Ãªtre modifiÃ© sans comprendre les dÃ©pendances entre middlewares.

1. `helmet` â€” configurÃ© avec `frameguard: false` et sans directive CSP `frame-ancestors` (commentaire dans le code : l'application ObliTools desktop embarque Obliance dans une iframe, il ne faut donc pas bloquer le framing). La CSP custom autorise `scriptSrc 'self'` et `connectSrc 'self' wss: ws:` (nÃ©cessaire pour Socket.io). HSTS est activÃ© avec `maxAge` d'un an. (`app.ts:34-56`)
2. `cors({ origin: config.clientOrigin, credentials: true })` â€” une seule origine autorisÃ©e, pilotÃ©e par la variable d'environnement `CLIENT_ORIGIN` (dÃ©faut `http://localhost:5173`, voir `server/src/config.ts:9`). (`app.ts:57-62`)
3. `express.json({ limit: '1mb' })`
4. `cookieParser`
5. `session` (`express-session` + `connect-pg-simple`)
6. `apiLimiter` (rate limiting global)
7. Routes `/auth` (callback OAuth Obligate, hors du prÃ©fixe `/api`)
8. Routes `/api` (voir `server/src/routes/index.ts`)
9. `GET /health`
10. `GET /downloads/:filename`
11. Fichiers statiques du build client (uniquement en production)
12. `errorHandler` â€” dernier middleware, doit toujours Ãªtre en fin de chaÃ®ne (`app.ts:170`)

### Ordre cookieParser â†’ session â†’ apiLimiter

Deux contraintes d'ordre sont explicitement commentÃ©es dans le code :

- `cookieParser` doit prÃ©cÃ©der `session`, car le middleware de session doit lire le cookie dÃ©jÃ  parsÃ© pour retrouver l'identifiant de session. (`app.ts:64-71`)
- `session` doit prÃ©cÃ©der `apiLimiter` : le rate limiter a besoin de lire `req.session.userId` pour exempter les utilisateurs dÃ©jÃ  authentifiÃ©s du comptage de requÃªtes. (`app.ts:116-118`)

### `trust proxy`

`app.set('trust proxy', 1)` est positionnÃ© explicitement (`app.ts:31`) pour que `req.ip` lise l'en-tÃªte `X-Forwarded-For` transmis par le reverse-proxy (Nginx / Nginx Proxy Manager). Sans ce rÃ©glage, le rate-limiting par IP verrait systÃ©matiquement l'IP du proxy et non celle du client final.

## Configuration des cookies de session

Le cookie de session est configurÃ© ainsi (`app.ts:95-114`) :

```ts
{
  httpOnly: true,
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 jours
  secure: NODE_ENV === 'production' ? true : config.forceHttps,
}
```

Le nom du cookie n'est pas surchargÃ© : `logout()` (`server/src/controllers/auth.controller.ts:87-112`) appelle `res.clearCookie('connect.sid')`, confirmant que le nom par dÃ©faut d'`express-session` est conservÃ© en production.

## Garde-fou `SESSION_SECRET`

Au dÃ©marrage, si `NODE_ENV === 'production'` et que `SESSION_SECRET` est absent, Ã©gal Ã  sa valeur par dÃ©faut codÃ©e en dur dans le code (un placeholder non sÃ©curisÃ© destinÃ© Ã  Ãªtre toujours surchargÃ© en production), ou fait moins de 32 caractÃ¨res, l'application appelle `logger.fatal(...)` puis `process.exit(1)` (`app.ts:83-93`). Ce garde-fou ne s'applique pas en dÃ©veloppement.

## Stockage des sessions â€” PostgreSQL

Les sessions sont stockÃ©es en base via `connect-pg-simple` (`app.ts:24, 74-78`) :

```ts
new PgSession({
  conString: config.databaseUrl,
  tableName: 'session',
  createTableIfMissing: false,
})
```

**Point d'attention** : aucune migration Knex crÃ©ant la table `session` n'a Ã©tÃ© localisÃ©e dans `server/src/db/migrations` (recherche de `CREATE TABLE session` infructueuse sur l'ensemble du dÃ©pÃ´t). Avec `createTableIfMissing: false`, cette table doit donc Ãªtre provisionnÃ©e hors du cycle de migrations Knex (script d'installation, init Docker, ou crÃ©ation manuelle en production) â€” le mÃ©canisme exact de provisioning n'a pas pu Ãªtre identifiÃ© dans le code source et reste Ã  vÃ©rifier avant toute dÃ©duction plus prÃ©cise.

## Connexion base de donnÃ©es â€” Knex

`server/src/db/index.ts` exporte `export const db = knex(knexConfig)`, oÃ¹ `knexConfig` provient de `server/knexfile.ts` (racine du package `server`, et non `server/src/db/knexfile`).

ParamÃ¨tres clÃ©s de `server/knexfile.ts` :

| ParamÃ¨tre | Valeur |
|---|---|
| `client` | `'pg'` |
| `connection` | `DATABASE_URL` |
| `pool.min` / `pool.max` | `2` / `25` (commentaire : les push des agents ingÃ¨rent frÃ©quemment, un ancien `max: 10` saturait le pool) |
| `acquireConnectionTimeout` | `20000` ms (fail-fast plutÃ´t que le hang par dÃ©faut de 60s) |
| `migrations.directory` | `server/src/db/migrations`, extension `.ts` en dev / `.js` compilÃ© en build |
| `migrations.schemaName` | `'public'` |

`server/src/db/migrations/` contient **122 fichiers** Ã  la date du 2026-07-02 â€” le chiffre de Â« 52 migrations Â» mentionnÃ© dans le `CLAUDE.md` racine est obsolÃ¨te, le dÃ©pÃ´t ayant grossi depuis.

## SÃ©quence de dÃ©marrage â€” `main()`

`server/src/index.ts` (fonction `main()`) exÃ©cute, dans l'ordre :

1. `await db.migrate.latest()` â€” auto-migration Knex Ã  chaque boot du serveur.
2. `ensureDefaultAdmin()` â€” crÃ©e l'admin par dÃ©faut et le tenant `id=1` (Â« Default Â», slug `default`) s'ils n'existent pas encore. Le mot de passe est hachÃ© avec `bcrypt.hash(password, 12)` (12 rounds), rÃ´le `'admin'`, rattachÃ© au tenant `1` via `user_tenants` (`onConflict` ignorÃ©). Si le mot de passe par dÃ©faut est jugÃ© faible, un avertissement est loggÃ© **sans jamais bloquer le dÃ©marrage** (commentaire explicite `index.ts:337-349`).
3. `createApp()` â€” construction de l'app Express dÃ©crite ci-dessus.
4. `http.createServer(app)` â€” crÃ©ation du serveur HTTP brut.
5. `createSocketServer(server)` â€” attache Socket.io au serveur HTTP (voir la page dÃ©diÃ©e aux canaux temps rÃ©el).
6. Un dispatcher WebSocket manuel bas niveau, branchÃ© sur l'Ã©vÃ©nement `'upgrade'` du serveur HTTP (voir la page dÃ©diÃ©e).

## Routes publiques (`/health`, tÃ©lÃ©chargements)

- `GET /health` : point de contrÃ´le de santÃ©, montÃ© aprÃ¨s les routes `/api`.
- `GET /downloads/:filename` : sert des fichiers de tÃ©lÃ©chargement, montÃ© avant les fichiers statiques du build client.

En production, les fichiers statiques du build client (React/Vite) sont servis aprÃ¨s ces deux routes ; en dÃ©veloppement, ce middleware est absent (le client tourne via son propre serveur Vite sur `CLIENT_ORIGIN`).

## Gestion des erreurs

`server/src/middleware/errorHandler.ts` exporte :

- La classe `AppError(statusCode, message)`, utilisÃ©e dans tout le code mÃ©tier pour lever des erreurs HTTP typÃ©es.
- Le middleware `errorHandler(err, req, res, next)`, montÃ© en tout dernier (`app.ts:170`) :
  - si `err instanceof AppError` â†’ `res.status(err.statusCode).json({ success: false, error: err.message })`
  - sinon â†’ log de l'erreur complÃ¨te cÃ´tÃ© serveur, puis rÃ©ponse gÃ©nÃ©rique `500 'Internal server error'` (aucune fuite de stack trace au client).
