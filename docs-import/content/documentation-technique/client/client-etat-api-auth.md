Cette page couvre la gestion d'etat (Zustand), la couche d'appels API centralisee et le flux d'authentification/session.

## Stores Zustand

Dossier `client/src/store/`, 11 stores crees via `create()` **sans middleware `persist`** visible :

```
authStore.ts
tenantStore.ts
deviceStore.ts
groupStore.ts
liveAlertsStore.ts
scriptStore.ts
socketStore.ts
chatStore.ts
uiStore.ts
remoteShellStore.ts
commandStore.ts
```

Seuls `authStore.ts` et `tenantStore.ts` sont documentes en detail ci-dessous (lecture integrale verifiee) ; les 9 autres (`deviceStore.ts`, `groupStore.ts`, `scriptStore.ts`, `commandStore.ts`, `remoteShellStore.ts`, `chatStore.ts`, `uiStore.ts`, `liveAlertsStore.ts`, `socketStore.ts`) suivent le meme pattern general mais leur contenu precis n'a pas ete relu ligne par ligne — a verifier au besoin avant de documenter leur API en detail.

### `authStore.ts`

State expose :

```ts
user
permissions: UserPermissions // { canCreate, permissions: Record<string,'ro'|'rw'>, tenantCapabilities? }
requires2faSetup
isLoading
isInitialized
```

Actions : `login`, `logout`, `checkSession`, `refreshPermissions`, plus des helpers de lecture — `isAdmin()`, `canCreate()`, `canWriteDevice()`, `canWriteGroup()`, `getDevicePermission()`, `getGroupPermission()` — tous avec **bypass systematique pour les admins**.

Flux de `login()` (`authStore.ts:69-96`) :

1. Si la reponse serveur indique `requires2fa`, le store **ne set pas** `user` (attend la saisie du code via `TwoFactorGate`).
2. Sinon : `set(user)` + `connectSocket(user.id)` + `tenantStore.fetchTenants()` + `liveAlertsStore.fetchAlerts()`.
3. En parallele, un appel asynchrone `authApi.me()` charge `permissions` / `tenantId` **sans bloquer le rendu UI** (le premier rendu utilise le `user` deja connu, les permissions arrivent en second temps).

`syncPreferencesToStore()` (`authStore.ts:21-39`) applique le theme (`obli-operator` / `modern` / `neon`, whitelist stricte — toute autre valeur est ignoree) et la langue depuis `user.preferences` / `user.preferredLanguage`. Le theme est **possede par Obligate** (SSO) et arrive via `user.preferences.preferredTheme`.

### `tenantStore.ts`

Particularite : **pas de middleware Zustand**, et surtout **`fetch()` natif** (pas `apiClient`) vers `/api/tenants` et `/api/tenant/switch`.

State : `currentTenantId`, `tenants: TenantWithRole[]`.

## Couche API — `client.ts`

Fichier : `client/src/api/client.ts`. Expose un module axios central `apiClient` :

- `baseURL: '/api'`
- `withCredentials: true`

### Detection ObliTools et injection de token

`client.ts` detecte si l'app tourne dans un iframe ObliTools : `window !== window.top` OU presence d'un flag `__obliview_is_native_app`. Dans ce cas, il injecte un header `X-Auth-Token` lu depuis `sessionStorage` (cle `OBLITOOLS_TOKEN_KEY = 'oblitools_auth_token'`), car les **iframes cross-site bloquent les cookies** de session classiques.

### Interceptor de reponse (`client.ts:44-119`)

Trois comportements geres :

1. **401 avec `twoFactorRequired`** — appelle `awaitTwoFactorCode()` puis retente la requete une seule fois (flag interne `_tfaRetried` pour eviter une boucle infinie).
2. **401 simple hors contexte ObliTools** — redirection vers `/login`.
3. **401 / 403 / 423 sur requetes non-GET** — surface un `toast.error(...)` avec le `body.error` du serveur. L'import de `react-hot-toast` est fait en **lazy import** dans l'interceptor pour eviter un import circulaire.

### Modules API par domaine

Dossier `client/src/api/` : 33 modules (`device.api.ts`, `groups.api.ts`, `scenario.api.ts`, `compliance.api.ts`, `script.api.ts`, `remote.api.ts`, etc.). Chaque module importe `apiClient` depuis `./client` et les types partages depuis `@obliance/shared`. Pattern a suivre pour tout nouveau domaine metier plutot que d'appeler `apiClient` directement depuis un composant.

## Socket.io

Fichier unique : `client/src/socket/socketClient.ts`, qui gere toute la connexion socket.io via `connectSocket` / `disconnectSocket` / `getSocket`. Ces fonctions sont referencees depuis `authStore.ts` (connexion au login) et `Sidebar.tsx` (ecoute d'evenements temps reel, ex. badge d'approbations).

## Sidebar et changement de tenant

Fichier : `client/src/components/layout/Sidebar.tsx`.

- `Sidebar.tsx:403,420-426` — un `useEffect` avec pour dependances `[loadDeviceData, currentTenantId]` (lu via `useTenantStore`) **reset** `devices` / `groupTree` et recharge via `deviceApi.listPaginated` + `groupsApi.tree()`, avec un `setInterval` de 30s pour le refresh periodique. Ce comportement confirme la regle : la sidebar recharge automatiquement les devices au changement de tenant, sans necessiter un F5.
- `Sidebar.tsx:428-455` — badge "pending approvals" (admin uniquement), charge via **import dynamique** de `approval.api`, mis a jour via les evenements socket `APPROVAL_CREATED` / `APPROVAL_UPDATED`, avec un polling de secours toutes les 60s.

→ Build a lancer : **client**