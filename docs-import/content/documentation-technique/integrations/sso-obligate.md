# SSO Obligate

Obliance delegue l'authentification a l'application tierce **Obligate** via un flow OAuth-like avec provisioning local automatique des comptes.

## Fichier et routes

Toutes les routes SSO vivent dans un seul fichier :

```
server/src/routes/obligateCallback.routes.ts   (760 lignes)
```

Monte vraisemblablement sous le prefixe `/auth` (d'apres les commentaires JSDoc du fichier â€” a reverifier dans `app.ts` avant de le citer comme chemin absolu garanti).

| Route | Ligne | Role |
|---|---|---|
| `GET /auth/callback` | 272 | Reception du `code` + `state` retournes par Obligate |
| `GET /auth/sso-redirect` | 328 | Construction de l'URL `/authorize` cote serveur et redirection |
| `GET /auth/app-info` | 388 | Endpoint appele PAR Obligate (reverse auth) |
| `GET /auth/dashboard-stats` | 436 | â€” |
| `GET /auth/sso-config` | 460 | â€” |
| `GET /auth/sso-logout-url` | 473 | â€” |
| `GET /auth/connected-apps` | 494 | â€” |
| `POST /auth/set-password` | 520 | â€” |
| `GET /auth/device-links` | 558 | â€” |
| `POST /auth/sso-desktop-init` | 578 | Init du flow SSO pour l'app Oblireach (desktop) |
| `POST /auth/sso-desktop-complete` | 650 | Completion du flow SSO desktop |
| `POST /auth/sso-user-sync` | 705 | â€” |

## Flow d'authentification navigateur

### 1. `GET /auth/sso-redirect` (ligne 328)

Cote serveur, cet endpoint :

1. Lit la config brute Obligate via `appConfigService.getObligateRaw()` â€” `raw.apiKey` n'est **jamais** expose au navigateur.
2. Verifie que Obligate est joignable : `GET <obligateUrl>/health` avec un timeout de 2s.
3. Empeche une boucle de redirection si `obligate_url` pointe vers l'application elle-meme.
4. Genere un parametre anti-CSRF `state` via `crypto.randomBytes(32)` (conforme RFC 6749 Â§10.12), stocke dans `req.session.oauthState`.
5. Redirige le navigateur vers :

```
{raw.url}/authorize?client_id=...&redirect_uri=...&state=...
```

### 2. `GET /auth/callback` (ligne 272)

A la reponse d'Obligate :

1. Recoit `code` + `state` en query params.
2. Valide `state` contre `req.session.oauthState` â€” usage unique, supprime immediatement apres verification.
3. Reconstruit le `redirect_uri` a partir des headers `x-forwarded-proto` / `x-forwarded-host`.
4. Appelle `obligateService.exchangeCode(code, redirectUri)` pour echanger le `code` contre une `ObligateUserAssertion`.

> Le detail exact de l'echange cote `obligate.service.ts` (endpoint `/token`, duree de vie du code, format precis de l'assertion) n'est pas documente ici â€” se referer directement au fichier source pour ce niveau de detail.

### 3. Provisioning local â€” `provisionObligateUser()`

Fonction locale definie dans `obligateCallback.routes.ts` (environ lignes 30-265). A partir de l'`ObligateUserAssertion` recue :

- Si `assertion.role === 'admin'` â†’ mappe vers l'admin global (god-view, tenant master).
- Sinon, les roles par tenant proviennent de `assertion.tenants[]` et sont synchronises dans la table `user_tenants`.
- Les comptes provisionnes via SSO sont marques **non-editables localement**.

## Reverse auth â€” `GET /auth/app-info` (ligne 388)

Cet endpoint est appele **par Obligate**, pas par le navigateur. Il attend un header `Authorization: Bearer <token>` dont le token doit correspondre exactement a `raw.apiKey` (comparaison stricte cote serveur, sans exposer la valeur elle-meme).

Il sert a Obligate pour decouvrir les teams/tenants Obliance disponibles, utilises dans son UI de mapping de roles.

## Flow SSO desktop (Oblireach)

Pour l'application cliente Oblireach (hors navigateur classique), un flow dedie existe :

- `POST /auth/sso-desktop-init` (ligne 578)
- `POST /auth/sso-desktop-complete` (ligne 650)

Ces deux routes s'appuient sur un store en memoire :

```ts
desktopSsoRequests // Map, TTL 5 minutes
```

Purge automatique via `setInterval(...).unref()` â€” pas de persistance DB pour ces requetes transitoires.

## Points a verifier avant extension

- Le montage exact du prefixe (`/auth`) dans `server/src/app.ts` n'a pas ete confirme explicitement dans ce lot de lecture â€” a valider avant toute documentation externe citant un chemin absolu garanti.
- `server/src/services/obligate.service.ts` (exchangeCode, shape de `ObligateUserAssertion`) et `server/src/services/appConfig.service.ts` (`getObligateRaw`) n'ont pas ete inspectes en detail ici.
- Pour le detail complet de l'integration Obligate cote app tierce, voir `D:\Obligate\CLAUDE.md`.
