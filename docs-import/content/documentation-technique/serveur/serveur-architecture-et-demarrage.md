Cette page décrit la construction de l'application Express, l'ordre des middlewares, la configuration de la base de données et la séquence de démarrage du serveur Obliance.

## Construction de l'application — `createApp()`

Le fichier `server/src/app.ts` exporte `createApp()`, qui assemble l'application Express dans un ordre strict. Cet ordre est documenté par des commentaires explicites dans le code et ne doit pas être modifié sans comprendre les dépendances entre middlewares.

1. `helmet` — configuré avec `frameguard: false` et sans directive CSP `frame-ancestors` (commentaire dans le code : l'application ObliTools desktop embarque Obliance dans une iframe, il ne faut donc pas bloquer le framing). La CSP custom autorise `scriptSrc 'self'` et `connectSrc 'self' wss: ws:` (nécessaire pour Socket.io). HSTS est activé avec `maxAge` d'un an. (`app.ts:34-56`)
2. `cors({ origin: config.clientOrigin, credentials: true })` — une seule origine autorisée, pilotée par la variable d'environnement `CLIENT_ORIGIN` (défaut `http://localhost:5173`, voir `server/src/config.ts:9`). (`app.ts:57-62`)
3. `express.json({ limit: '1mb' })`
4. `cookieParser`
5. `session` (`express-session` + `connect-pg-simple`)
6. `apiLimiter` (rate limiting global)
7. Routes `/auth` (callback OAuth Obligate, hors du préfixe `/api`)
8. Routes `/api` (voir `server/src/routes/index.ts`)
9. `GET /health`
10. `GET /downloads/:filename`
11. Fichiers statiques du build client (uniquement en production)
12. `errorHandler` — dernier middleware, doit toujours être en fin de chaîne (`app.ts:170`)

### Ordre cookieParser → session → apiLimiter

Deux contraintes d'ordre sont explicitement commentées dans le code :

- `cookieParser` doit précéder `session`, car le middleware de session doit lire le cookie déjà parsé pour retrouver l'identifiant de session. (`app.ts:64-71`)
- `session` doit précéder `apiLimiter` : le rate limiter a besoin de lire `req.session.userId` pour exempter les utilisateurs déjà authentifiés du comptage de requêtes. (`app.ts:116-118`)

### `trust proxy`

`app.set('trust proxy', 1)` est positionné explicitement (`app.ts:31`) pour que `req.ip` lise l'en-tête `X-Forwarded-For` transmis par le reverse-proxy (Nginx / Nginx Proxy Manager). Sans ce réglage, le rate-limiting par IP verrait systématiquement l'IP du proxy et non celle du client final.

## Configuration des cookies de session

Le cookie de session est configuré ainsi (`app.ts:95-114`) :

```ts
{
  httpOnly: true,
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 jours
  secure: NODE_ENV === 'production' ? true : config.forceHttps,
}
```

Le nom du cookie n'est pas surchargé : `logout()` (`server/src/controllers/auth.controller.ts:87-112`) appelle `res.clearCookie('connect.sid')`, confirmant que le nom par défaut d'`express-session` est conservé en production.

## Garde-fou `SESSION_SECRET`

Au démarrage, si `NODE_ENV === 'production'` et que `SESSION_SECRET` est absent, égal à sa valeur par défaut codée en dur dans le code (un placeholder non sécurisé destiné à être toujours surchargé en production), ou fait moins de 32 caractères, l'application appelle `logger.fatal(...)` puis `process.exit(1)` (`app.ts:83-93`). Ce garde-fou ne s'applique pas en développement.

## Stockage des sessions — PostgreSQL

Les sessions sont stockées en base via `connect-pg-simple` (`app.ts:24, 74-78`) :

```ts
new PgSession({
  conString: config.databaseUrl,
  tableName: 'session',
  createTableIfMissing: false,
})
```

**Point d'attention** : aucune migration Knex créant la table `session` n'a été localisée dans `server/src/db/migrations` (recherche de `CREATE TABLE session` infructueuse sur l'ensemble du dépôt). Avec `createTableIfMissing: false`, cette table doit donc être provisionnée hors du cycle de migrations Knex (script d'installation, init Docker, ou création manuelle en production) — le mécanisme exact de provisioning n'a pas pu être identifié dans le code source et reste à vérifier avant toute déduction plus précise.

## Connexion base de données — Knex

`server/src/db/index.ts` exporte `export const db = knex(knexConfig)`, où `knexConfig` provient de `server/knexfile.ts` (racine du package `server`, et non `server/src/db/knexfile`).

Paramètres clés de `server/knexfile.ts` :

| Paramètre | Valeur |
|---|---|
| `client` | `'pg'` |
| `connection` | `DATABASE_URL` |
| `pool.min` / `pool.max` | `2` / `25` (commentaire : les push des agents ingèrent fréquemment, un ancien `max: 10` saturait le pool) |
| `acquireConnectionTimeout` | `20000` ms (fail-fast plutôt que le hang par défaut de 60s) |
| `migrations.directory` | `server/src/db/migrations`, extension `.ts` en dev / `.js` compilé en build |
| `migrations.schemaName` | `'public'` |

`server/src/db/migrations/` contient **122 fichiers** à la date du 2026-07-02 — le chiffre de « 52 migrations » mentionné dans le `CLAUDE.md` racine est obsolète, le dépôt ayant grossi depuis.

## Séquence de démarrage — `main()`

`server/src/index.ts` (fonction `main()`) exécute, dans l'ordre :

1. `await db.migrate.latest()` — auto-migration Knex à chaque boot du serveur.
2. `ensureDefaultAdmin()` — crée l'admin par défaut et le tenant `id=1` (« Default », slug `default`) s'ils n'existent pas encore. Le mot de passe est haché avec `bcrypt.hash(password, 12)` (12 rounds), rôle `'admin'`, rattaché au tenant `1` via `user_tenants` (`onConflict` ignoré). Si le mot de passe par défaut est jugé faible, un avertissement est loggé **sans jamais bloquer le démarrage** (commentaire explicite `index.ts:337-349`).
3. `createApp()` — construction de l'app Express décrite ci-dessus.
4. `http.createServer(app)` — création du serveur HTTP brut.
5. `createSocketServer(server)` — attache Socket.io au serveur HTTP (voir la page dédiée aux canaux temps réel).
6. Un dispatcher WebSocket manuel bas niveau, branché sur l'événement `'upgrade'` du serveur HTTP (voir la page dédiée).

## Routes publiques (`/health`, téléchargements)

- `GET /health` : point de contrôle de santé, monté après les routes `/api`.
- `GET /downloads/:filename` : sert des fichiers de téléchargement, monté avant les fichiers statiques du build client.

En production, les fichiers statiques du build client (React/Vite) sont servis après ces deux routes ; en développement, ce middleware est absent (le client tourne via son propre serveur Vite sur `CLIENT_ORIGIN`).

## Gestion des erreurs

`server/src/middleware/errorHandler.ts` exporte :

- La classe `AppError(statusCode, message)`, utilisée dans tout le code métier pour lever des erreurs HTTP typées.
- Le middleware `errorHandler(err, req, res, next)`, monté en tout dernier (`app.ts:170`) :
  - si `err instanceof AppError` → `res.status(err.statusCode).json({ success: false, error: err.message })`
  - sinon → log de l'erreur complète côté serveur, puis réponse générique `500 'Internal server error'` (aucune fuite de stack trace au client).
