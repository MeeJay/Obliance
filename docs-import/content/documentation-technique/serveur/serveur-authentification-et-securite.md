Cette page dÃ©taille le modÃ¨le de session, les middlewares de sÃ©curitÃ© (`auth`, `tenant`, `rbac`, `agentAuth`, `validate`, `rateLimiter`) et le flux de login/logout cÃ´tÃ© serveur Obliance.

## Extension du type `SessionData`

`server/src/middleware/auth.ts` (lignes 5-19) Ã©tend le module `express-session` :

```ts
declare module 'express-session' {
  interface SessionData {
    userId?: number;
    username?: string;
    role?: UserRole;
    currentTenantId?: number;
    oauthState?: string;
    pendingMfaLinkToken?: string;
    pendingEmailOtp?: string;
    requestedTenantSlug?: string;
  }
}
```

**Point d'attention (typage incohÃ©rent)** : `server/src/controllers/auth.controller.ts` assigne Ã©galement `req.session.pendingMfaUserId = user.id` (ligne 33) lors d'un login nÃ©cessitant une double authentification, alors que ce champ **n'apparaÃ®t pas** dans l'augmentation de type ci-dessus. Soit ce champ est dÃ©clarÃ© dans un autre fichier (non localisÃ©, potentiellement `twoFactor.routes.ts`), soit il s'agit d'une incohÃ©rence de typage TypeScript Ã  corriger. Le flux MFA complet (vÃ©rification TOTP/OTP email, promotion de `pendingMfaUserId` vers une session pleine) n'a pas Ã©tÃ© auditÃ© en dÃ©tail â€” ne pas dÃ©crire ce flux avec prÃ©cision sans vÃ©rification complÃ©mentaire du controller dÃ©diÃ© au 2FA (non auditÃ© dans cette investigation).

## Middleware `requireAuth`

`server/src/middleware/auth.ts:21-27` :

```ts
export function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    throw new AppError(401, 'Authentication required');
  }
  next();
}
```

VÃ©rifie uniquement la prÃ©sence de `req.session.userId` â€” aucune vÃ©rification de tenant Ã  ce niveau.

## Middleware `requireTenant`

`server/src/middleware/tenant.ts:17-25` :

```ts
export function requireTenant(req, res, next) {
  if (!req.session?.currentTenantId) {
    throw new AppError(400, 'No tenant selected');
  }
  req.tenantId = req.session.currentTenantId;
  next();
}
```

`req.tenantId` est dÃ©clarÃ© via `declare global { namespace Express { interface Request { tenantId: number } } }`. Ce middleware **doit toujours Ãªtre appliquÃ© aprÃ¨s `requireAuth`** (commentaire explicite dans le code, `tenant.ts:15`), puisqu'il dÃ©pend de `req.session` dÃ©jÃ  validÃ©e.

## Assemblage des routes â€” `server/src/routes/index.ts`

Le fichier construit un sous-routeur `tenantRouter` :

```ts
tenantRouter.use(requireAuth, requireTenant); // ligne 79
```

Puis monte dessus **30+ routes** mÃ©tier nÃ©cessitant Ã  la fois une session et un tenant actif : `devices`, `commands`, `scripts`, `schedules`, `scenarios`, `compliance`, `groups`, `teams`, `users`, `custom-sections`, `cves`, `hyperv`, `veeam`, etc. (`index.ts:81-118`). Ce `tenantRouter` est ensuite montÃ© sur `/` (`index.ts:120`).

Sont dÃ©clarÃ©es **avant** ce `tenantRouter` (`index.ts:60-75`) :

- Les routes publiques / dÃ©diÃ©es aux agents (sans session utilisateur) : `/auth`, `/agent`, `/oblireach`, `/oblireach-desktop`, `/obliance`, `/system`.
- Les routes authentifiÃ©es mais **sans tenant obligatoire**, montÃ©es avec `requireAuth` seul : `/profile`, `/tenants`, `/tenant`, `/live-alerts`.

**Chiffre Ã  jour** : `server/src/routes/` contient **51 fichiers** (dont `index.ts` lui-mÃªme, soit 50 fichiers de routes effectivement montÃ©s) Ã  la date du 2026-07-02 â€” le chiffre Â« 37+ Â» du `CLAUDE.md` racine est obsolÃ¨te.

## Middleware `rbac.ts` â€” contrÃ´le des rÃ´les et permissions

`server/src/middleware/rbac.ts` expose plusieurs middlewares, tous construits sur le mÃªme pattern de bypass admin :

```ts
if (req.session.role === 'admin') return next(); // bypass total
```

| Middleware | Ligne | RÃ´le |
|---|---|---|
| `requireRole(...roles)` | `rbac.ts:6-20` | VÃ©rifie `req.session.role` contre une liste blanche de `UserRole` (`'admin'` \| `'user'`). Ne vÃ©rifie **pas** `req.tenantId` lui-mÃªme. |
| `requireDeviceWrite()` | `rbac.ts:26-39` | DÃ©lÃ¨gue Ã  `permissionService.canWriteDevice` |
| `requireGroupWrite()` | `rbac.ts:44-57` | DÃ©lÃ¨gue Ã  `permissionService.canWriteGroup` |
| `requireDeviceRead(paramName='id')` | `rbac.ts:70-83` | DÃ©lÃ¨gue Ã  `permissionService.canReadDevice` |
| `requireDeviceWriteParam(paramName='id')` | `rbac.ts:89-102` | Variante paramÃ©trÃ©e de `requireDeviceWrite` |
| `requireTenantCapability(capability)` | `rbac.ts:110-123` | DÃ©lÃ¨gue Ã  `permissionService.userHasTenantCapability` |
| `requireAnyTenantCapability(...capabilities)` | `rbac.ts:133-149` | Variante OR de la prÃ©cÃ©dente |
| `requireCanCreate()` | `rbac.ts:154-165` | DÃ©lÃ¨gue Ã  `permissionService.canCreate` |

### `permissionService` â€” modÃ¨le Teams â†’ Scopes â†’ Levels

`server/src/services/permission.service.ts` implÃ©mente le modÃ¨le : `Teams` â†’ `team_permissions` (colonnes `scope: 'device'|'group'`, `scope_id`, `level`) â†’ `team_memberships`.

`getVisibleDeviceIds` (ligne 220) rÃ©sout les devices visibles pour un utilisateur non-admin via des jointures sur `device_group_closure` (table de fermeture transitive des groupes, gÃ¨re les sous-groupes rÃ©cursivement) plus un scope spÃ©cial `'ungrouped'` (ligne 263) pour les devices sans groupe.

Ce niveau de dÃ©tail a Ã©tÃ© vÃ©rifiÃ© par recherche textuelle sur le fichier (pas une lecture complÃ¨te ligne Ã  ligne) â€” se rÃ©fÃ©rer directement au fichier pour la logique exacte de `canReadDevice` / `canWriteDevice` si un niveau de prÃ©cision supÃ©rieur est requis.

## Authentification des agents â€” `agentAuth`

`server/src/middleware/agentAuth.ts` authentifie les agents Go via l'en-tÃªte `X-Api-Key` :

```ts
const key = await db('agent_api_keys').where({ key: apiKey }).first();
if (!key || key.is_active === false) {
  throw new AppError(401, 'Invalid API key');
}
```

Le message d'erreur est **identique** (`'Invalid API key'`) que la clÃ© soit absente ou rÃ©voquÃ©e (`is_active === false`) â€” choix dÃ©libÃ©rÃ© commentÃ© dans le code (`agentAuth.ts:21-24`) pour ne pas rÃ©vÃ©ler Ã  un attaquant l'existence d'une clÃ© rÃ©voquÃ©e.

En cas de succÃ¨s, le middleware attache `req.agentApiKeyId` et `req.agentTenantId` (dÃ©clarÃ©s via `declare global` sur `Express.Request`, `agentAuth.ts:5-12`), puis met Ã  jour `last_used_at` en fire-and-forget (sans `await` bloquant, lignes 29-33).

## Validation des payloads â€” `validate.ts`

`server/src/middleware/validate.ts` expose :

```ts
validate(schema: ZodSchema, source: 'body' | 'query' | 'params' = 'body')
```

- ExÃ©cute `schema.safeParse(req[source])`.
- Ã‰chec â†’ `HTTP 400` avec un message aplati `'path: message'` concatÃ©nÃ©, plus `details: fieldErrors`.
- SuccÃ¨s â†’ **rÃ©assigne** `req[source] = result.data`, donc les valeurs en aval du middleware sont normalisÃ©es/coercÃ©es par Zod (types convertis, valeurs par dÃ©faut appliquÃ©es).

Seulement **8 fichiers** de schÃ©mas Zod existent dans `server/src/validators/` (`auth.schema.ts`, `group.schema.ts`, `monitor.schema.ts`, `notification.schema.ts`, `profile.schema.ts`, `settings.schema.ts`, `team.schema.ts`, `user.schema.ts`) â€” au regard des 50 fichiers de routes, la validation Zod via `validate()` n'est donc **pas systÃ©matique** sur l'ensemble des endpoints.

## Rate limiting â€” `rateLimiter.ts`

`server/src/middleware/rateLimiter.ts` expose trois limiters `express-rate-limit` :

| Limiter | FenÃªtre | ClÃ© | Exemptions |
|---|---|---|---|
| `apiLimiter` | 500 req / 5 min | IP | `skip()` exempte : sessions authentifiÃ©es, `/health`, `/api/auth/me`, tout `/api/agent/*`, `/api/oblireach/*`, `/api/heartbeat/*`, `POST /api/auth/login`, `POST /api/auth/logout` |
| `mfaLimiter` | 50 / 15 min | IP seule | `skipSuccessfulRequests` |
| `authLimiter` | 20 Ã©checs / 5 min | IP + username (via `keyGenerator`) | `skipSuccessfulRequests` |

## Flux login / logout â€” `auth.controller.ts`

`server/src/controllers/auth.controller.ts` :

- `login()` : construit la session complÃ¨te (`req.session.userId`, `username`, `role` + `setSessionTenant()`) **uniquement si** l'utilisateur n'a pas de MFA actif (`hasMfa = user.totpEnabled || user.emailOtpEnabled`). Si un MFA est actif, seul `req.session.pendingMfaUserId` est posÃ© (session Â« partielle Â» en attente de vÃ©rification 2FA) â€” le flux complet est dÃ©lÃ©guÃ© Ã  `routes/twoFactor.routes.ts` (non auditÃ© en dÃ©tail).
- `setSessionTenant(req, userId)` (lignes 14-17) rÃ©sout le premier tenant accessible via `tenantService.getFirstTenantForUser(userId)`, avec repli sur `tenantId = 1` si aucun tenant n'est trouvÃ©. ConsÃ©quence : `req.session.currentTenantId` est **toujours** posÃ© aprÃ¨s un login rÃ©ussi (ou rÃ©parÃ© lors de l'appel Ã  `/auth/me` si absent, ligne 130-133).
- `logout()` (lignes 87-112) : `req.session.destroy()` puis `res.clearCookie('connect.sid')`.

Le contenu dÃ©taillÃ© de `auth.service.ts` (comparaison bcrypt, Ã©ventuel lockout aprÃ¨s Ã©checs rÃ©pÃ©tÃ©s) et de `tenant.service.ts` (`getFirstTenantForUser`) n'a pas Ã©tÃ© auditÃ© â€” ces services ne sont rÃ©fÃ©rencÃ©s ici que via leur usage observÃ© dans `auth.controller.ts`.
