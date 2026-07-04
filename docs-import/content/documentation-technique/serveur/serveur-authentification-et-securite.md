Cette page détaille le modèle de session, les middlewares de sécurité (`auth`, `tenant`, `rbac`, `agentAuth`, `validate`, `rateLimiter`) et le flux de login/logout côté serveur Obliance.

## Extension du type `SessionData`

`server/src/middleware/auth.ts` (lignes 5-19) étend le module `express-session` :

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

**Point d'attention (typage incohérent)** : `server/src/controllers/auth.controller.ts` assigne également `req.session.pendingMfaUserId = user.id` (ligne 33) lors d'un login nécessitant une double authentification, alors que ce champ **n'apparaît pas** dans l'augmentation de type ci-dessus. Soit ce champ est déclaré dans un autre fichier (non localisé, potentiellement `twoFactor.routes.ts`), soit il s'agit d'une incohérence de typage TypeScript à corriger. Le flux MFA complet (vérification TOTP/OTP email, promotion de `pendingMfaUserId` vers une session pleine) n'a pas été audité en détail — ne pas décrire ce flux avec précision sans vérification complémentaire du controller dédié au 2FA (non audité dans cette investigation).

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

Vérifie uniquement la présence de `req.session.userId` — aucune vérification de tenant à ce niveau.

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

`req.tenantId` est déclaré via `declare global { namespace Express { interface Request { tenantId: number } } }`. Ce middleware **doit toujours être appliqué après `requireAuth`** (commentaire explicite dans le code, `tenant.ts:15`), puisqu'il dépend de `req.session` déjà validée.

## Assemblage des routes — `server/src/routes/index.ts`

Le fichier construit un sous-routeur `tenantRouter` :

```ts
tenantRouter.use(requireAuth, requireTenant); // ligne 79
```

Puis monte dessus **30+ routes** métier nécessitant à la fois une session et un tenant actif : `devices`, `commands`, `scripts`, `schedules`, `scenarios`, `compliance`, `groups`, `teams`, `users`, `custom-sections`, `cves`, `hyperv`, `veeam`, etc. (`index.ts:81-118`). Ce `tenantRouter` est ensuite monté sur `/` (`index.ts:120`).

Sont déclarées **avant** ce `tenantRouter` (`index.ts:60-75`) :

- Les routes publiques / dédiées aux agents (sans session utilisateur) : `/auth`, `/agent`, `/oblireach`, `/oblireach-desktop`, `/obliance`, `/system`.
- Les routes authentifiées mais **sans tenant obligatoire**, montées avec `requireAuth` seul : `/profile`, `/tenants`, `/tenant`, `/live-alerts`.

**Chiffre à jour** : `server/src/routes/` contient **51 fichiers** (dont `index.ts` lui-même, soit 50 fichiers de routes effectivement montés) à la date du 2026-07-02 — le chiffre « 37+ » du `CLAUDE.md` racine est obsolète.

## Middleware `rbac.ts` — contrôle des rôles et permissions

`server/src/middleware/rbac.ts` expose plusieurs middlewares, tous construits sur le même pattern de bypass admin :

```ts
if (req.session.role === 'admin') return next(); // bypass total
```

| Middleware | Ligne | Rôle |
|---|---|---|
| `requireRole(...roles)` | `rbac.ts:6-20` | Vérifie `req.session.role` contre une liste blanche de `UserRole` (`'admin'` \| `'user'`). Ne vérifie **pas** `req.tenantId` lui-même. |
| `requireDeviceWrite()` | `rbac.ts:26-39` | Délègue à `permissionService.canWriteDevice` |
| `requireGroupWrite()` | `rbac.ts:44-57` | Délègue à `permissionService.canWriteGroup` |
| `requireDeviceRead(paramName='id')` | `rbac.ts:70-83` | Délègue à `permissionService.canReadDevice` |
| `requireDeviceWriteParam(paramName='id')` | `rbac.ts:89-102` | Variante paramétrée de `requireDeviceWrite` |
| `requireTenantCapability(capability)` | `rbac.ts:110-123` | Délègue à `permissionService.userHasTenantCapability` |
| `requireAnyTenantCapability(...capabilities)` | `rbac.ts:133-149` | Variante OR de la précédente |
| `requireCanCreate()` | `rbac.ts:154-165` | Délègue à `permissionService.canCreate` |

### `permissionService` — modèle Teams → Scopes → Levels

`server/src/services/permission.service.ts` implémente le modèle : `Teams` → `team_permissions` (colonnes `scope: 'device'|'group'`, `scope_id`, `level`) → `team_memberships`.

`getVisibleDeviceIds` (ligne 220) résout les devices visibles pour un utilisateur non-admin via des jointures sur `device_group_closure` (table de fermeture transitive des groupes, gère les sous-groupes récursivement) plus un scope spécial `'ungrouped'` (ligne 263) pour les devices sans groupe.

Ce niveau de détail a été vérifié par recherche textuelle sur le fichier (pas une lecture complète ligne à ligne) — se référer directement au fichier pour la logique exacte de `canReadDevice` / `canWriteDevice` si un niveau de précision supérieur est requis.

## Authentification des agents — `agentAuth`

`server/src/middleware/agentAuth.ts` authentifie les agents Go via l'en-tête `X-Api-Key` :

```ts
const key = await db('agent_api_keys').where({ key: apiKey }).first();
if (!key || key.is_active === false) {
  throw new AppError(401, 'Invalid API key');
}
```

Le message d'erreur est **identique** (`'Invalid API key'`) que la clé soit absente ou révoquée (`is_active === false`) — choix délibéré commenté dans le code (`agentAuth.ts:21-24`) pour ne pas révéler à un attaquant l'existence d'une clé révoquée.

En cas de succès, le middleware attache `req.agentApiKeyId` et `req.agentTenantId` (déclarés via `declare global` sur `Express.Request`, `agentAuth.ts:5-12`), puis met à jour `last_used_at` en fire-and-forget (sans `await` bloquant, lignes 29-33).

## Validation des payloads — `validate.ts`

`server/src/middleware/validate.ts` expose :

```ts
validate(schema: ZodSchema, source: 'body' | 'query' | 'params' = 'body')
```

- Exécute `schema.safeParse(req[source])`.
- Échec → `HTTP 400` avec un message aplati `'path: message'` concaténé, plus `details: fieldErrors`.
- Succès → **réassigne** `req[source] = result.data`, donc les valeurs en aval du middleware sont normalisées/coercées par Zod (types convertis, valeurs par défaut appliquées).

Seulement **8 fichiers** de schémas Zod existent dans `server/src/validators/` (`auth.schema.ts`, `group.schema.ts`, `monitor.schema.ts`, `notification.schema.ts`, `profile.schema.ts`, `settings.schema.ts`, `team.schema.ts`, `user.schema.ts`) — au regard des 50 fichiers de routes, la validation Zod via `validate()` n'est donc **pas systématique** sur l'ensemble des endpoints.

## Rate limiting — `rateLimiter.ts`

`server/src/middleware/rateLimiter.ts` expose trois limiters `express-rate-limit` :

| Limiter | Fenêtre | Clé | Exemptions |
|---|---|---|---|
| `apiLimiter` | 500 req / 5 min | IP | `skip()` exempte : sessions authentifiées, `/health`, `/api/auth/me`, tout `/api/agent/*`, `/api/oblireach/*`, `/api/heartbeat/*`, `POST /api/auth/login`, `POST /api/auth/logout` |
| `mfaLimiter` | 50 / 15 min | IP seule | `skipSuccessfulRequests` |
| `authLimiter` | 20 échecs / 5 min | IP + username (via `keyGenerator`) | `skipSuccessfulRequests` |

## Flux login / logout — `auth.controller.ts`

`server/src/controllers/auth.controller.ts` :

- `login()` : construit la session complète (`req.session.userId`, `username`, `role` + `setSessionTenant()`) **uniquement si** l'utilisateur n'a pas de MFA actif (`hasMfa = user.totpEnabled || user.emailOtpEnabled`). Si un MFA est actif, seul `req.session.pendingMfaUserId` est posé (session « partielle » en attente de vérification 2FA) — le flux complet est délégué à `routes/twoFactor.routes.ts` (non audité en détail).
- `setSessionTenant(req, userId)` (lignes 14-17) résout le premier tenant accessible via `tenantService.getFirstTenantForUser(userId)`, avec repli sur `tenantId = 1` si aucun tenant n'est trouvé. Conséquence : `req.session.currentTenantId` est **toujours** posé après un login réussi (ou réparé lors de l'appel à `/auth/me` si absent, ligne 130-133).
- `logout()` (lignes 87-112) : `req.session.destroy()` puis `res.clearCookie('connect.sid')`.

Le contenu détaillé de `auth.service.ts` (comparaison bcrypt, éventuel lockout après échecs répétés) et de `tenant.service.ts` (`getFirstTenantForUser`) n'a pas été audité — ces services ne sont référencés ici que via leur usage observé dans `auth.controller.ts`.
