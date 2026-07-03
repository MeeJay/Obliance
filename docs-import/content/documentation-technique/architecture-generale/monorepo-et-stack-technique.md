Cette page decrit l'organisation du monorepo Obliance et les responsabilites de chaque workspace npm.

## Workspaces npm

Le fichier racine `D:\Obliance\package.json` declare quatre workspaces npm :

```json
"workspaces": ["shared", "server", "client", "agent"]
```

`agent` est liste comme workspace npm bien qu'il s'agisse de code Go â€” aucun script npm ne s'y execute reellement, c'est uniquement pour la coherence du monorepo (un seul `git clone`, une seule racine).

Scripts racine notables :

```json
"dev": "docker compose -f docker-compose.build.yml -f docker-compose.dev.yml up --build",
"build": "npm run build:shared && npm run build:server && npm run build:client",
"docker:up": "...",
"docker:down": "...",
"docker:logs": "...",
"docker:build": "..."
```

Le `build` racine est **sequentiel et explicite** : `shared` doit etre compile avant `server` et `client`, car les deux consomment potentiellement le `dist/` de `shared`.

## shared/ â€” types partages

`shared/package.json` : package `@obliance/shared` en version `0.1.0`, `main: dist/index.js`, `types: dist/index.d.ts`, compile via `tsc`. Aucune dependance runtime, uniquement `typescript` en devDependency.

Contenu de `shared/src/` (5 fichiers) :

```
shared/src/
â”œâ”€â”€ index.ts            # barrel export
â”œâ”€â”€ types.ts             # ~2358 lignes â€” types metier (Device, Scenario, etc.)
â”œâ”€â”€ settingsDefaults.ts
â”œâ”€â”€ socketEvents.ts
â””â”€â”€ tenants.ts           # MASTER_TENANT_ID, isMasterTenant()
```

`shared/src/tenants.ts` :

```ts
export const MASTER_TENANT_ID = 1;
// ligne 16-17
export function isMasterTenant(tenantId: number): boolean {
  return tenantId === MASTER_TENANT_ID;
}
```

### Resolution asymetrique client vs server

Point d'architecture important, source d'un piege classique en dev :

- **`client/vite.config.ts`** alias `@obliance/shared` directement vers `path.resolve(__dirname, '../shared/src')` â€” le client importe les **sources TypeScript** du package shared. Consequence : le client n'a pas besoin que `npm run build:shared` ait tourne pour voir un changement de type.
- **`server`** resout `@obliance/shared` via `node_modules` (workspace npm standard, `main: dist/index.js`) â€” donc il consomme le **JS compile**. Un changement dans `shared/src/types.ts` n'est visible cote server qu'apres un rebuild de `shared` (sauf particularites du mode watch `tsx`).

## server/ â€” API

`server/package.json` : package `@obliance/server` en version `5.1.79`, `main: dist/src/index.js`.

Dependances cles :

| Domaine | Librairie |
|---|---|
| HTTP | express 4.18 |
| Temps reel | socket.io 4.7 + ws 8.18 (deuxieme serveur WS brut) |
| DB | knex 3.1, pg 8.12 |
| Session | express-session + connect-pg-simple |
| Securite | helmet, zod, bcryptjs, otpauth (2FA) |
| Ordonnancement | node-cron |
| Divers | playwright-chromium, ssh2 |

## client/ â€” SPA

`client/package.json` : package `@obliance/client` en version `5.1.75`, `type: module`.

Dependances cles : react 18.3, react-router-dom 6.22, vite 5.1, socket.io-client 4.7, `@xyflow/react` 12.4 (canvas des scenarios), zustand 4.5, i18next + react-i18next, recharts, xterm, `@novnc/novnc` (VNC), `@dnd-kit`.

`client/vite.config.ts` injecte `__APP_VERSION__` a partir de `client/package.json.version` au build, et configure le proxy de dev :

```
/api        -> http://localhost:3001   (ws: true, pour les tunnels)
/socket.io  -> http://localhost:3001   (ws: true)
```

## agent/ â€” client Go

Deux modules Go distincts dans le meme repertoire `agent/` :

```
agent/go.mod              # module github.com/obliance/agent, go 1.22
agent/cmd/legacy/go.mod   # module github.com/obliance/agent/cmd/legacy, go 1.20
```

Dependances de l'agent principal (`agent/go.mod`, Go 1.22) : `creack/pty`, `getlantern/systray`, `lxn/walk` (GUI Windows), `shirou/gopsutil/v3`, `golang.org/x/crypto`.

L'agent legacy (`agent/cmd/legacy/go.mod`, Go 1.20, pour Windows Server 2008 R2+) n'a qu'une seule dependance : `golang.org/x/sys v0.14.0`.

`agent/VERSION` contient actuellement `4.5.70` (fichier texte brut, source de verite pour la version affichee et poussee lors de l'auto-update).

### Sous-dossiers de agent/cmd/

La structure reelle constatee sur le filesystem comporte **6** sous-dossiers, alors que la documentation de reference (CLAUDE.md) n'en mentionne que 3 (`tray`, `legacy`, `diag`) :

```
agent/cmd/
â”œâ”€â”€ diag/
â”œâ”€â”€ legacy/
â”œâ”€â”€ tray/
â”œâ”€â”€ watchdog/     # non decrit dans la doc de reference
â”œâ”€â”€ wizard/       # non decrit dans la doc de reference
â””â”€â”€ wizard-linux/ # non decrit dans la doc de reference
```

Le role exact de `watchdog/`, `wizard/` et `wizard-linux/` n'a pas ete audite en detail (contenu de leur `main.go`) â€” a explorer avant documentation approfondie si necessaire.

### Cross-plateforme par suffixe de fichier

Le package racine `agent/` compte environ 90 fichiers `.go`, organises par suffixe de build constraint plutot que par sous-dossier :

```
airgap_windows.go   airgap_linux.go   airgap_other.go
machine_uuid_windows.go  machine_uuid_darwin.go  machine_uuid_freebsd.go  machine_uuid_linux.go  machine_uuid_stub.go
privacy_gate_*.go
service_windows.go  service_darwin.go  service_freebsd.go
tunnel_shell_windows.go  tunnel_shell_unix.go
```

Ce pattern (`_windows`, `_linux`, `_darwin`, `_freebsd`, `_unix`, `_stub`, `_other`) est la convention Go standard de compilation conditionnelle par nom de fichier, utilisee systematiquement dans ce package plutot que des sous-packages par OS.

## Ecart de comptage documentation vs realite

Les chiffres suivants, donnes comme minorants dans la documentation de reference, sont perimes par rapport a l'etat actuel du filesystem :

| Repertoire | Doc de reference | Constate |
|---|---|---|
| `server/src/routes/` | 37+ fichiers | 51 fichiers `.ts` |
| `server/src/services/` | 40+ fichiers | 78 fichiers `.ts` |
| `server/src/db/migrations/` | 52 migrations | 122 fichiers `.ts` (plus haute numerotation : 114) |

A traiter comme ordre de grandeur indicatif plutot que chiffre fige lors de toute redaction future.

## i18n

`client/src/i18n/locales/` contient bien 18 dossiers de langue avec chacun un `translation.json` : `ar`, `cs`, `da`, `de`, `en`, `es`, `fr`, `it`, `ja`, `ko`, `nl`, `pl`, `pt-BR`, `ru`, `sv`, `tr`, `uk`, `zh-CN`.

## Absence de README racine

Aucun `README.md` n'existe a la racine du depot (seuls des `README.md` presents dans `node_modules/`). Les noms des images Docker Hub (`meejay/obliance-server`, `meejay/obliance-client`) ne sont documentes que dans les fichiers `docker-compose*.yml` et dans CLAUDE.md â€” il n'y a pas de point d'entree documentaire alternatif pour un nouvel arrivant.