Cette page couvre l'internationalisation du client et le pattern de pages a onglets qui composent plusieurs pages originales.

## i18n — `client/src/i18n/index.ts`

18 locales sont importees **statiquement** (pas de lazy-load) : `ar`, `cs`, `da`, `de`, `en`, `es`, `fr`, `it`, `ja`, `ko`, `nl`, `pl`, `pt-BR`, `ru`, `sv`, `tr`, `uk`, `zh-CN`.

Un tableau `SUPPORTED_LANGUAGES` contient, pour chaque langue, `code` / `name` / `nativeName` / `dir` (`ar` est la seule en `rtl`).

### Detection de la langue initiale

Ordre de priorite :

1. `localStorage['i18n_language']`
2. `navigator.language`
3. fallback `'en'`

Configuration i18next : `fallbackLng: 'en'`, `interpolation.escapeValue: false`.

`setLanguage()` persiste le choix dans `localStorage` et met a jour `document.lang` / `document.dir` (pour le support RTL de l'arabe).

### Structure des fichiers de traduction

```
client/src/i18n/locales/<code>/translation.json
```

Un seul namespace `translation` par langue (pas de split par domaine fonctionnel). 18 dossiers de locale confirmes.

### Regle d'ecriture (rappel)

Tout texte UI visible doit passer par `t('namespace.key')` des l'ecriture, avec fallback inline :

```tsx
{t('discovery.deployScript.button', { count: n }) || `Generate deploy script (${n})`}
```

Seules les cles `en/` et `fr/` sont obligatoires a la livraison ; les 16 autres locales retombent automatiquement sur l'anglais via i18next, puis sur le fallback inline si meme l'anglais est absent.

## Pattern de pages composites ("embedded")

Plusieurs pages de `client/src/pages/` (41 fichiers au total, un ecart par rapport aux "34+ pages" mentionnees comme reference generale s'explique par des pages utilisees uniquement comme sous-composants embedded et non routees directement dans `App.tsx`) sont des **wrappers a onglets** qui importent des pages originales avec une prop `embedded`.

Quatre wrappers verifies en detail :

### `SchedulesPage.tsx` (route `/automations`)

Onglets : `schedules` | `scenarios` | `scripts` | `run` | `history`, qui rendent respectivement `ScriptSchedulesPage` / `ScenariosPage` / `ScriptLibraryPage` / `ScriptRunPage` / `ScriptHistoryPage` avec `embedded={true}`.

`SchedulesPage.tsx:12,18` — le tab actif est initialise depuis `useSearchParams()` (parametre `?tab=`), avec une **whitelist stricte** `['scenarios', 'scripts', 'run', 'history']` ; toute autre valeur retombe sur l'onglet par defaut `schedules`.

### `PoliciesPage.tsx` (route `/policies`)

Onglets : `updates` | `compliance` | `software` | `cves` | `notifications`, qui rendent `UpdatesPage` / `CompliancePage` / `SoftwareCompliancePage` / `CvesPage` / `NotificationsPage` en mode `embedded`.

### `AdminDevicesPage.tsx` (route `/admin/devices`)

Onglets : `keys` | `custom-sections` | `discovery`, qui rendent `CustomSectionsPage` / `NetworkDiscoveryPage` en mode `embedded`. Contient egalement un **alias legacy** pour l'onglet `agents` (compatibilite d'anciens liens/bookmarks).

### `SupervisionPage.tsx` (route `/admin/supervision`)

Documente dans `CLAUDE.md` avec le meme pattern (onglets Sessions distantes | Historique | Rapports rendant `RemoteSessionsPage` / `HistoryPage` / `ReportsPage`), mais le fichier n'a pas ete relu en detail dans cette verification — le detail exact des noms d'onglets et de la logique de `useSearchParams` associee est a confirmer directement dans le fichier avant documentation exhaustive.

## A verifier avant extension de cette documentation

- `AdminUsersPage.tsx` (pattern Users + Teams + `NotificationsPage`) n'a pas ete relu en detail.
- L'usage reel de la dependance `@novnc/novnc` (presente dans `client/package.json`) n'a pas ete trace dans le code — ne pas affirmer son role exact (VNC remote ou autre) sans verification prealable.
- Le contenu detaille de `AppLayout.tsx` et `Header.tsx` n'a pas ete inspecte ligne par ligne.

→ Build a lancer : **client**