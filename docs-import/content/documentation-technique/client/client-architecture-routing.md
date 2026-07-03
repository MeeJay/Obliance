Cette page decrit l'organisation du SPA React (`client/`) et le systeme de routing/protection des routes.

## Stack et build

Le client est un workspace npm (`client/package.json`, version `5.1.75`) construit avec Vite.

```
client/vite.config.ts
```

Points cles de `vite.config.ts` :

- Plugin `@vitejs/plugin-react`
- Alias `'@'` -> `src`
- Alias `'@obliance/shared'` -> `../shared/src` (le workspace `shared` est consomme en **source directe**, sans etape de build intermediaire)
- `define.__APP_VERSION__` injecte au build depuis la valeur `version` de `client/package.json`
- `build.target = 'esnext'`
- Dev server sur le port `5173`, avec proxy `/api` et `/socket.io` vers `http://localhost:3001` (`ws: true` pour supporter les tunnels remote via WebSocket)

Dependances cles (`client/package.json`) : `react` 18.3.1, `react-router-dom` 6.22, `zustand` 4.5, `axios` 1.6.7, `i18next` 23.10 + `react-i18next` 14.1, `socket.io-client` 4.7.4, `@xyflow/react` 12.4 (canvas des scenarios), `recharts` 2.12, `xterm` 5.3 + `xterm-addon-fit` (tunnels shell), `@dnd-kit/*` (drag & drop), `lucide-react` (icones), `clsx` / `tailwind-merge`.

Script de build : `tsc -b && vite build`.

## Routing â€” `App.tsx`

Le fichier `client/src/App.tsx` (lignes 1-124) monte le routing via `react-router-dom` v6 (`BrowserRouter` / `Routes` / `Route`). Trois groupes de routes :

1. **Routes publiques** : `/login`, `/forgot-password`, `/reset-password`
2. **Routes protegees standard** : encapsulees dans `<ProtectedRoute />` puis rendues sous `<AppLayout />`
3. **Routes admin-only** : un second `<ProtectedRoute requiredRole="admin">`
4. **Routes a capacite** : un groupe `<ProtectedRoute requiredCapabilities={[...]}>` pour Supervision et les onglets "Agent config"

### Alias / redirections legacy

`App.tsx:58-60` redirige `/schedules` vers `/automations` (via un `Navigate replace` de react-router-dom).

`/workspace` est le renommage courant de `/admin/tenants` ; l'ancienne URL `/admin/tenants` reste servie en alias (`App.tsx:75-80`) pour ne pas casser les liens/bookmarks existants.

### Elements globaux montes dans `App.tsx`

- `App.tsx:110-117` â€” `<Toaster />` global (`react-hot-toast`), position `top-right`, `className` personnalisee (`bg-bg-secondary` / `text-text-primary`) pour suivre le theme courant.
- `App.tsx:121` â€” `<TwoFactorGate />`, singleton monte au niveau `App`. Il affiche automatiquement une popup de saisie de code lorsque le serveur repond `401` avec `twoFactorRequired: true` (voir aussi l'interceptor axios dans `client.ts`).
- `App.tsx:36-41` â€” `useEffect` qui appelle `checkSession()` de `authStore` au montage, pour restaurer la session courante (cookie ou token ObliTools) avant le premier rendu des routes protegees.

## `ProtectedRoute.tsx`

Fichier : `client/src/components/layout/ProtectedRoute.tsx`. Il gere quatre niveaux de garde, evalues dans cet ordre :

| Niveau | Condition | Effet |
|---|---|---|
| Authentification | pas de session valide | redirect `/login` |
| Enrollment | `user.enrollmentVersion < REQUIRED_ENROLLMENT_VERSION` (constante = `1`) | redirect `/enroll`, **sauf** si `user.foreignSource === 'obligate'` (utilisateurs SSO Obligate exemptes) |
| Role | `requiredRole` fourni | egalite stricte avec le role de l'utilisateur (`'admin'` ou `'user'`) |
| Capabilities | `requiredCapabilities` fourni | les admins bypassent systematiquement ; pour un non-admin, intersection avec `permissions.tenantCapabilities` |

Ce composant est le point d'entree unique de garde d'acces cote client â€” toute nouvelle route sensible doit passer par lui plutot que par une verification ad hoc dans la page.

## Layout applicatif

Dossier `client/src/components/layout/` (11 fichiers) :

```
AppLayout.tsx
Sidebar.tsx
Header.tsx
ProtectedRoute.tsx
TenantSwitcher.tsx
NotificationCenter.tsx
LiveAlerts.tsx
GlobalChatPanel.tsx
GlobalShellPanel.tsx
GlobalAddAgentModal.tsx
DesktopUpdateBanner.tsx
```

`AppLayout` encapsule les routes protegees standard (sidebar + header + zone de contenu). Le detail interne de `AppLayout.tsx` et `Header.tsx` n'a pas ete relu ligne par ligne dans cette verification â€” se referer au code source avant de documenter leur comportement precis.

â†’ Build a lancer : **client**