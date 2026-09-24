# Obli Mobile — contrat commun (shell Android + client web responsive)

Ce document est la référence partagée par la coquille Android (`mobile/android`) et le
client web. Il est écrit pour Obliance, mais tout ici est **générique à la suite Obli** :
une autre app Obli adopte le même shell (une *flavor* de plus) et les mêmes primitives.

---

## 1. Principes

- L'app Android est une **coquille native** qui charge le client web **depuis le serveur**
  (`https://<serveur>/`). Le SPA n'est jamais embarqué dans l'APK : CORS, cookie
  `SameSite=Lax` et CSP supposent la même origine que l'API.
- Le SSO Obligate se déroule **dans la WebView** (les redirections serveur → Obligate →
  `/auth/callback` doivent rester dans la même WebView, sinon `state mismatch`).
- Le client web reste **identique sur desktop** : toute adaptation mobile est conditionnée
  par la taille d'écran, le type de pointeur, ou la présence du pont natif. Aucune
  régression visuelle ou fonctionnelle desktop n'est acceptable.
- HTTPS obligatoire (cookie `secure` en production).

## 2. Détection côté web

Le shell injecte **au démarrage du document**, uniquement pour l'origine du serveur
configuré :

```js
window.__obli_native = {
  platform: 'android',
  app: 'obliance',          // id de flavor
  appVersion: '1.0.0',      // versionName
  versionCode: 1,
  bridgeVersion: 1,
  capabilities: ['saveFile','downloadUrl','openExternal','clipboard','share',
                 'notify','settings','back','systemBars','update'],
};
```

**Ne jamais** réutiliser `__obliance_is_native_app` / `__obliview_is_native_app` : ils
désignent le shell desktop ObliTools (barre d'onglets tenant native, mode X-Auth-Token,
pas de redirection /login sur 401). Sur Android, le TenantSwitcher React reste affiché.

Côté client : `client/src/native/bridge.ts` expose `isAndroidApp()`, `nativeInfo()`,
`hasCapability(c)` et un objet typé `native` (voir §3). Tout accès au pont passe par ce
module, jamais par `window.ObliNative` directement dans les pages.

## 3. Pont `window.ObliNative` (bridgeVersion 1)

Toutes les méthodes renvoient une **Promise**. Transport : `WebViewCompat.addWebMessageListener`
(objet JS `__obliBridge`, origines autorisées = origine du serveur) ; requête
`{id, method, params}` en JSON, réponse `{id, ok, result}` ou `{id, ok:false, error}`.
Le wrapper `ObliNative` est injecté par `addDocumentStartJavaScript` (mêmes origines).

| Méthode | Paramètres | Effet |
|---|---|---|
| `saveFile(filename, mime, base64)` | nom, type MIME, contenu base64 | Écrit dans Téléchargements (MediaStore), notification « Téléchargement terminé » ouvrable. Résout `{uri}`. |
| `downloadUrl(url, filename?)` | URL **même origine** (relative ou absolue) | `DownloadManager` avec le cookie de session + User-Agent. Pour les routes serveur authentifiées (`Content-Disposition: attachment`). |
| `openExternal(url)` | http(s), mailto:, tel:, otpauth: | http(s) → Custom Tab ; autres schémas → Intent. |
| `copyText(text)` | texte | `ClipboardManager`. |
| `readClipboard()` | — | Résout le texte du presse-papiers (ou `''`). |
| `share(text, title?)` | texte | Feuille de partage Android. |
| `notify(title, body, navigateTo?)` | | Notification locale (canal « alertes »). |
| `openSettings()` | — | Ouvre l'écran natif de réglages de l'app. |
| `setSystemBars(colorHex, lightIcons)` | ex. `'#0f1220'`, `false` | Couleur des barres système (suivre le thème). |
| `requestNotificationPermission()` | — | Résout `'granted'` ou `'denied'`. |
| `checkForUpdate()` | — | Résout `{available, versionName, versionCode}`. |
| `getInfo()` | — | Résout `{app, appVersion, versionCode, webViewVersion, serverUrl}`. |

### Événements natif → web
- **Retour Android** : le shell appelle `window.__obliHandleBack()` (défini par le client).
  Elle renvoie `true` si le web a consommé l'appui (fermeture d'un tiroir, d'une modale,
  d'une feuille), sinon le shell fait `webView.goBack()` ou quitte l'app.
  Côté client : `useNativeBack(handler, active)` empile les gestionnaires (le plus récent
  gagne) ; `Modal`, `Drawer` et `ConfirmDialog` s'y abonnent automatiquement.
- `window.dispatchEvent(new CustomEvent('obli:resume'))` / `'obli:pause'` au retour et à la
  mise en arrière-plan de l'app.

### Téléchargements côté web (obligatoire)
- **Jamais** `URL.createObjectURL` + `<a download>` directement dans une page : utiliser
  `saveBlob(blob, filename)` / `saveText(text, filename, mime)` de `utils/download.ts`
  (pont natif si présent, sinon l'ancre classique, révocation différée).
- Route serveur authentifiée : `downloadUrl(url, filename)` (pont `downloadUrl` si présent,
  sinon navigation/`<a href download>` classique).
- Lien externe : `openExternal(url)` de `utils/openExternal.ts`.
- Presse-papiers : `copyText(text)` de `utils/clipboard.ts` (API Clipboard → repli
  `execCommand` → pont natif), avec toast succès/échec.
- `window.print()` n'existe pas dans la WebView : proposer un export fichier à la place.

## 4. Points de rupture et modes de mise en page

Breakpoints Tailwind **par défaut** (sm 640 · md 768 · lg 1024 · xl 1280), plus des
variantes ajoutées dans `tailwind.config.ts` :

| Variante | Media query | Usage |
|---|---|---|
| `coarse:` | `(pointer: coarse)` | Cibles tactiles agrandies |
| `can-hover:` | `(hover: hover) and (pointer: fine)` | Ce qui ne doit exister qu'avec une souris |
| `future.hoverOnlyWhenSupported` | — | Les `hover:` ne restent plus « collés » après un tap |

`useLayoutMode()` (`hooks/useMediaQuery.ts`) renvoie `'phone' | 'tablet' | 'desktop'` :

| Mode | Largeur | Sidebar | Header |
|---|---|---|---|
| phone | < 768 | Tiroir hors-canevas (bouton hamburger), fermé par défaut, fermé à chaque navigation / Échap / retour Android | Hamburger · logo seul · tenant tronqué · cloche · avatar (menu : apps, SSH, réglages app, déconnexion) |
| tablet | 768–1023 | Tiroir hors-canevas (hamburger), comme phone | Pastilles d'apps en points seuls, badge utilisateur réduit à l'avatar |
| desktop | ≥ 1024 | Comportement actuel (épinglé / replié / flottant, redimensionnable) ; sur pointeur tactile : flottant et redimensionnement désactivés | Actuel ; < 1280 : libellés des pastilles masqués |

Règle : un état **forcé** par le mode (tiroir, désactivation du flottant) n'est **jamais
écrit** dans `localStorage` (les préférences desktop sont synchronisées entre apps).

## 5. Règles tactiles (toutes les pages)

1. **Aucune action uniquement au survol.** `opacity-0 group-hover:opacity-100` devient
   `can-hover:opacity-0 can-hover:group-hover:opacity-100` (visible par défaut au toucher),
   ou l'action passe dans un menu « ⋯ ».
2. **Aucune information uniquement dans `title=`** quand elle est utile : `Tip`/`InfoTip`
   (tap = popover) ou texte d'aide visible.
3. **Pas de double-clic, clic droit ou glisser-déposer comme unique chemin** : toujours un
   équivalent au tap (bouton, menu, feuille d'actions). dnd-kit : `useDndSensors()`
   (souris + tactile avec appui long + clavier).
4. **Cibles** ≥ 40 px sur pointeur tactile : `IconButton` (`coarse:min-h-10 coarse:min-w-10`).
5. **Modales** : `Modal` commun — plein écran (feuille) sous `sm`, centrée au-dessus,
   `max-h` en `dvh`, corps défilant, pied d'actions collant, zones sûres, fermeture par
   Échap et par le retour Android.
6. **Confirmations** : `useConfirm()` / `usePrompt()` (`ConfirmDialog`) au lieu de
   `window.confirm` / `window.prompt`.
7. **Tableaux** : `TableScroll` (défilement horizontal, `overscroll-x-contain`, première
   colonne collante optionnelle) au minimum ; jamais de colonnes rendues inaccessibles
   (`hidden md:table-cell`) sans autre moyen d'y accéder (ligne dépliable ou fiche).
8. **Maître/détail** : côte à côte à partir de `lg`, un seul panneau en dessous (liste →
   détail avec bouton retour).
9. **Barres d'outils** : elles doivent pouvoir passer à la ligne (`flex-wrap`, pas de
   `shrink-0` sur un groupe entier) ou déborder dans un menu « ⋯ ».
10. **Champs** : `font-size: 16px` sur téléphone tactile (réglé globalement dans
    `index.css`) ; `autoCapitalize="off" autoCorrect="off" spellCheck={false}` sur les
    champs de code, d'identifiants, d'IP, de chemins.
11. **Hauteurs** : `dvh` au lieu de `vh`/`h-screen` pour tout ce qui occupe l'écran.
12. **i18n** : tout nouveau libellé passe par `t('clé') || 'repli'` (règle du projet).

## 6. Distribution de l'APK

- `GET /api/mobile/android/version` (public) → `{app, packageName, version, versionCode,
  minSupportedVersionCode, sha256, sizeBytes, signerSha256, builtAt, available,
  downloadUrl, releaseNotes}` lu depuis `mobile/release/manifest.json`.
- `GET /api/mobile/android/download` → l'APK signé (`mobile/release/obliance.apk`,
  `Content-Disposition: attachment`, Range supporté).
- Le shell compare `versionCode`, télécharge, vérifie le SHA-256 **et** l'empreinte du
  certificat signataire, puis lance l'installateur Android.
- Le même contrat (`/api/mobile/android/*`) sera repris tel quel par les autres apps Obli.

## 7. Notifications

- Premier plan : temps réel via le socket du client web (inchangé).
- Arrière-plan (v1) : tâche WorkManager périodique (~15 min) sur
  `GET /api/live-alerts/all` avec le cookie de session de la WebView, dédoublonnée par id ;
  tap → ouvre l'app sur `navigateTo`. Si la session a expiré, une seule notification
  « Reconnectez-vous ».
- v2 (prévu) : UnifiedPush (distributeur ntfy) pour du temps réel sans Google.

## 8. Primitives web

Couche commune livrée dans `client/src` : les pages l'adoptent au lieu de
réécrire overlays, menus, téléchargements, etc. Toutes les primitives sont
**identiques à l'existant sur desktop** (mêmes classes que les modales / barres
d'onglets / boutons icône écrits à la main) et ne changent que sous les points
de rupture ou sur pointeur tactile.

### 8.1 Plateforme (`native/bridge.ts`, `hooks/*`)

```ts
import { isAndroidApp, nativeInfo, hasCapability, canUseNative, native,
         isTouchDevice, onNativeLifecycle, registerBackHandler,
         NativeUnavailableError } from '@/native/bridge';

isAndroidApp();                  // true dans le shell Android (window.__obli_native.platform === 'android')
nativeInfo();                    // ObliNativeInfo | null ({app, appVersion, versionCode, bridgeVersion, capabilities})
hasCapability('share');          // capacité annoncée par le shell (false dans un navigateur)
canUseNative('saveFile');        // shell présent + méthode injectée + capacité annoncée
await native.share(text, title); // toutes les méthodes du §3 ; rejette NativeUnavailableError si absent (jamais de throw synchrone)
isTouchDevice();                 // matchMedia('(pointer: coarse)') — non réactif
const off = onNativeLifecycle('resume', () => refetch());   // 'resume' | 'pause' ; renvoie la désinscription
```

`main.tsx` appelle `initNativeBridge()` au démarrage : installe
`window.__obliHandleBack`, le répartiteur global d'Échap, `data-native="android"`
sur `<html>` (dans le shell) et synchronise `setSystemBars(couleur, clair)` +
`<meta name="theme-color">` sur la couleur du header du thème courant
(`--c-bg-secondary`, suivie via `data-theme`). Second argument de
`setSystemBars` : `true` uniquement sur un thème clair (= icônes sombres,
`isAppearanceLightStatusBars`), comme l'exemple `('#0f1220', false)` du §3.

```ts
import { useMediaQuery, useLayoutMode, useIsCoarsePointer, useCanHover,
         getLayoutMode, matchesMedia, MEDIA, BREAKPOINTS } from '@/hooks/useMediaQuery';

const mode = useLayoutMode();          // 'phone' (<768) | 'tablet' (768–1023) | 'desktop' (≥1024)
const wide = useMediaQuery(MEDIA.lg);  // MEDIA = { sm, md, lg, xl, coarse, canHover } (chaînes de media query)
const touch = useIsCoarsePointer();    // = variante coarse:
const hover = useCanHover();           // = variante can-hover:
getLayoutMode(); matchesMedia(MEDIA.md); // lectures non réactives
```
Un seul `MediaQueryList` partagé par requête ; sans `matchMedia`, tout vaut
`false` et `useLayoutMode()` renvoie `'desktop'`.

```ts
import { useNativeBack } from '@/hooks/useNativeBack';
useNativeBack(handler, active = true, { escape?: boolean });
```
- Empile `handler` tant que `active` est vrai ; le plus récemment activé passe
  en premier. `handler(source: 'back' | 'escape')` ; renvoyer `false` laisse
  passer au gestionnaire précédent (puis `webView.goBack()` côté shell), toute
  autre valeur (y compris `undefined`) consomme l'appui. Le handler peut
  changer à chaque rendu : seul `active` (dés)inscrit.
- `escape: true` : reçoit aussi Échap (seules les entrées `escape` sont
  visitées, de la plus haute à la plus basse → les overlays empilés se ferment
  un par un ; un Échap déjà `preventDefault()` par un champ / combobox est
  ignoré). Par défaut `false` : un gestionnaire de page (ex. « fermer l'éditeur
  de graphe ») ne réagit pas à Échap.
- `Modal`, `Drawer`, `ConfirmDialog`, `ActionMenu` (popover et feuille),
  `MasterDetail` et `Tip` s'y abonnent seuls : ne pas en rajouter pour eux.
- Hors React : `registerBackHandler(handler, { escape })` renvoie la
  fonction de désinscription.

```ts
import { useDndSensors } from '@/hooks/useDndSensors';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
const sensors = useDndSensors({ coordinateGetter: sortableKeyboardCoordinates });
// options : coordinateGetter?, mouseDistance = 5, touchDelay = 250, touchTolerance = 5
<DndContext sensors={sensors} …>
```
Remplace `useSensors(useSensor(PointerSensor, …))` (ne jamais combiner avec
PointerSensor). Souris : glisser après 5 px ; tactile : appui long 250 ms (un
balayage fait défiler la page) ; clavier : espace + flèches.

```ts
import { useClickOutside } from '@/hooks/useClickOutside';
useClickOutside(ref | [ref1, ref2], (e: PointerEvent) => close(), active = true);
```
`pointerdown` en phase de capture (souris, tactile, stylet). Remplace les
écouteurs `document 'mousedown'` et les calques `fixed inset-0 z-10 onClick`.

### 8.2 Fichiers, liens, presse-papiers (`utils/*`)

Aucune de ces fonctions ne rejette : elles résolvent `true` / `false`
(l'échec est déjà journalisé en console) — l'appelant affiche le toast.

```ts
import { saveBlob, saveText, saveJson, downloadUrl, blobToBase64 } from '@/utils/download';
await saveBlob(blob, 'export.xlsx', mime?);                 // mime écrase blob.type
await saveText(csv, 'audit.csv', 'text/csv;charset=utf-8'); // mime par défaut text/plain;charset=utf-8
await saveJson(scenarioBundle, 'scenario.json');            // JSON indenté (2 espaces)
await downloadUrl(`/api/reports/outputs/${id}/download`, 'report.pdf'); // route serveur MÊME ORIGINE
```
Shell : `saveFile` (base64 lu par `FileReader`, sûr pour des blobs de plusieurs
Mo) / `downloadUrl` (DownloadManager + cookie, URL rendue absolue).
Navigateur : ancre `download` avec `revokeObjectURL` différé de 60 s.
Remplace tout `createObjectURL` + `a.download` et tout
`window.open(url, '_blank')` vers une route de téléchargement.

```ts
import { openExternal } from '@/utils/openExternal';
openExternal('https://nvd.nist.gov/vuln/detail/' + cve);  // http(s) → Custom Tab / nouvel onglet (noopener)
openExternal('otpauth://totp/…');                         // mailto:, tel:, otpauth: → Intent / navigation
```
Pour un lien `<a target="_blank">` qui quitte l'origine :
`<a href={url} onClick={(e) => { e.preventDefault(); openExternal(url); }}>`.
Tout autre schéma est refusé (`false`).

```ts
import { copyText, readClipboardText } from '@/utils/clipboard';
const ok = await copyText(value);        // Clipboard API → execCommand('copy') → pont natif
ok ? toast.success(t('common.copied')) : toast.error(t('common.error'));
const text = await readClipboardText();  // pont natif → navigator.clipboard.readText ; null si impossible
```

### 8.3 Composants (`components/common/*`)

Conventions : rendu en portail dans `<body>` ; z-index **Modal / Drawer
`z-[200]`**, **ActionMenu `z-[260]`**, **ConfirmDialog `z-[400]`**, **Tip
`z-[450]`** (les overlays « à la main » existants vont de `z-50` à `z-[300]`).
Libellés internes : `common.close|cancel|confirm|delete|back` (existants) et
`ui.moreActions`, `ui.moreInfo`, `ui.confirm.typeToConfirm` (nouveaux).

#### `Modal`
```tsx
import { Modal } from '@/components/common/Modal';

<Modal
  open={open}
  onClose={() => setOpen(false)}
  title={t('hyperv.editTitle', 'Edit VM')}
  icon={<Cpu className="w-4 h-4 text-accent" />}
  size="md"      // 'sm' 28rem | 'md' 32rem (défaut) | 'lg' 42rem | 'xl' 48rem | '2xl' 56rem | 'full'
  footer={<>
    <Button variant="ghost" onClick={close}>{t('common.cancel')}</Button>
    <Button onClick={save} loading={saving}>{t('common.save')}</Button>
  </>}
>
  …formulaire…
</Modal>
```
Props : `open`, `onClose`, `title?`, `icon?`, `headerExtra?` (à droite du
titre), `size?`, `children`, `footer?` (barre collante sous le corps,
`justify-end`, passe à la ligne), `closeOnBackdrop?` (défaut `true`),
`closeOnEscape?` (défaut `true` ; `false` quand le corps possède Échap :
terminal, éditeur), `dismissible?` (défaut `true` ; `false` = modale
bloquante : pas de ×, Échap / retour / fond avalés sans fermer),
`showCloseButton?` (défaut = `dismissible`), `phoneLayout?` (sous `sm` :
`'fullscreen'` défaut | `'sheet'` feuille du bas | `'center'` carte compacte),
`className?` (panneau), `bodyClassName?` (défaut `px-4 py-3`),
`footerClassName?`, `overlayClassName?` (ex. autre z-index), `ariaLabel?`
(sans titre visible), `data-testid?`. Rien n'est rendu quand `open` est faux
(état interne remis à zéro à chaque ouverture).

Aspect : fond `bg-black/60 backdrop-blur-sm`, panneau `bg-bg-secondary
rounded-xl shadow-2xl`, en-tête `px-4 py-3` titre `text-sm font-semibold`
(le style dominant actuel). `sm+` : centré, `max-h-[calc(100dvh-2rem)]`,
corps défilant (`overscroll-contain`). Sous `sm` : plein écran `h-dvh` avec
zones sûres. Verrouillage du scroll, focus piégé (Tab), focus restauré à la
fermeture, `autoFocus` d'un champ respecté. Ne pas ajouter de second calque
`fixed inset-0` ni de `stopPropagation` dans le contenu.

#### `Drawer`
```tsx
import { Drawer } from '@/components/common/Drawer';
<Drawer open={open} onClose={close} side="left" bodyClassName="p-0">…sidebar…</Drawer>
<Drawer open={!!vm} onClose={close} side="right" size="lg" title={vm?.name} footer={…}>…</Drawer>
<Drawer open={open} onClose={close} side="bottom" title={t('x.filters')}>…</Drawer>
```
Props : `open`, `onClose`, `side?` (`'left'` | `'right'` défaut | `'bottom'`),
`size?` (gauche/droite : `sm` = min(85vw, 320px) défaut, `md` = min(90vw,
420px), `lg` = min(95vw, 560px), `full` ; bas : hauteur max `sm` 50dvh, `md`
70dvh, `lg` 85dvh défaut, `full`), `title?`, `icon?`, `headerExtra?`,
`footer?`, `closeOnBackdrop?`, `closeOnEscape?`, `dismissible?`,
`showCloseButton?` (défaut : si `title` et `dismissible`), `showHandle?`
(poignée, défaut sur `bottom`), `className?`, `bodyClassName?` (défaut
`px-4 py-3`), `footerClassName?`, `overlayClassName?`, `ariaLabel?`. Mêmes
comportements que `Modal` (portail, Échap, retour Android, scroll, focus).

#### `ConfirmDialog` — `useConfirm()` / `usePrompt()`
`<ConfirmProvider />` est monté une fois dans `App.tsx` (ne pas le remonter).
```tsx
import { useConfirm, usePrompt, confirmDialog, promptDialog } from '@/components/common/ConfirmDialog';

const confirm = useConfirm();
if (!(await confirm({ message: t('scripts.deleteConfirm', { name }), danger: true }))) return;
if (!(await confirm(t('x.simpleQuestion')))) return;          // forme courte : string = message
await confirm({ title: t('audit.clearTitle'), message: t('audit.clearMsg'),
                danger: true, requireText: 'DELETE', confirmLabel: t('audit.clear') });

const prompt = usePrompt();
const name = await prompt({ title: t('hyperv.checkpointName'), defaultValue: 'Checkpoint 1', required: true });
if (name === null) return;                                    // annulé

// Hors composant (store, util, callback non-React) :
const ok = await confirmDialog({ message: '…' });
const value = await promptDialog({ message: '…' });
```
`ConfirmOptions` : `{ title?, message, confirmLabel?, cancelLabel?, danger?,
requireText? }` — `danger` : bouton rouge, icône d'alerte, focus initial sur
Annuler, libellé par défaut `common.delete` ; sinon focus sur Confirmer
(Entrée = OK comme `window.confirm`) ; `requireText` : bouton désactivé tant
que le texte saisi n'est pas identique. `PromptOptions` : `{ title?, message?,
defaultValue?, placeholder?, confirmLabel?, cancelLabel?, multiline?,
required?, inputType?, plain? }` — `multiline` : textarea, Ctrl/Cmd+Entrée
valide ; `required` : bouton désactivé si vide ; `inputType` : `'text'`
défaut | `'number'` | `'email'` | `'url'` | `'password'` ; `plain` (défaut
`true`) : `autoCapitalize/autoCorrect/spellCheck/autoComplete` désactivés.
Résolutions : confirm → `boolean`, prompt → `string | null`. Demandes
simultanées mises en file (FIFO). Feuille du bas sur téléphone (boutons
pleine largeur), boutons ≥ 44 px au toucher. Sans provider monté : repli sur
`window.confirm` / `window.prompt`. `message` accepte du JSX ; une chaîne
garde ses retours à la ligne.

#### `IconButton`
```tsx
import { IconButton } from '@/components/common/IconButton';
<IconButton label={t('common.delete')} icon={<Trash2 className="w-4 h-4" />} variant="danger" onClick={remove} />
<IconButton label={t('common.edit')} icon={<Pencil className="w-3.5 h-3.5" />} size="sm" touchTarget="overlay" />
```
Props (+ tous les attributs `<button>`, `ref` transmis) : `label`
(**requis** : `aria-label` toujours, `title` seulement sur appareil
`can-hover` ; un `title` explicite reste prioritaire), `icon` ou `children`
(taille de l'icône fixée par l'appelant), `size?` (`xs` = `p-0.5`, `sm` =
`p-1`, `md` = `p-1.5` défaut, `lg` = `p-2`), `variant?` (`ghost` défaut :
muted → primary + `hover:bg-bg-hover` ; `plain` : sans fond ; `danger` : →
`red-400` + `bg-red-400/10` ; `accent` : muted → accent + teinte ; `primary` :
texte accent ; `solid` : `bg-bg-tertiary`), `active?` (état enfoncé +
`aria-pressed`), `touchTarget?` (`'grow'` défaut : `coarse:min-h-10
coarse:min-w-10` ; `'overlay'` : zone de tap invisible 40×40 sans bouger la
mise en page — lignes denses ; `'none'`), `showTooltip?` (défaut `true`).
`type="button"` par défaut. Remplace `<button className="p-1.5
text-text-muted hover:text-text-primary …" title="…">`.

#### `TableScroll`
```tsx
import { TableScroll } from '@/components/common/TableScroll';
<TableScroll className="bg-bg-secondary rounded-xl" stickyFirstCol>
  <table className="w-full min-w-[720px]">…</table>
</TableScroll>
```
Remplace `<div className="bg-bg-secondary rounded-xl overflow-hidden"><table>`.
Props (+ attributs `<div>`, `ref` transmis) : `className?` (conteneur extérieur
arrondi qui coupe, défaut `rounded-xl` ; y mettre le fond de carte),
`innerClassName?` (défileur `overflow-x-auto overscroll-x-contain`),
`stickyFirstCol?` (première cellule de chaque ligne collante), `stickyBg?`
(couleur CSS de cette colonne, défaut `rgb(var(--c-bg-secondary))`). Donner
un `min-w-[…]` à la table pour que les colonnes défilent au lieu de s'écraser.

#### `SegmentedTabs`
```tsx
import { SegmentedTabs, type SegmentedTab } from '@/components/common/SegmentedTabs';
const tabs: SegmentedTab<Tab>[] = [
  { id: 'updates', label: t('policies.tabUpdates'), icon: <RefreshCw size={16} /> },
  { id: 'cves', label: 'CVE', icon: <Bug size={16} />, hidden: !canSeeCves },
];
<SegmentedTabs tabs={tabs} value={tab} onChange={setTab} />
```
Props : `tabs` (`{ id, label, icon?, badge?, disabled?, hidden? }[]`),
`value`, `onChange(id)`, `fill?` (défaut `true` : `flex-1` comme
aujourd'hui), `size?` (`'md'` défaut = `px-4 py-2 text-sm` ; `'sm'` =
`px-3 py-1.5 text-xs`), `className?`, `tabClassName?`, `ariaLabel?`. Même
rendu desktop que les barres de PoliciesPage / UpdatesPage / CompliancePage /
SoftwareCompliancePage ; quand ça ne tient pas : défilement horizontal (snap,
sans barre), onglet actif gardé visible, flèches / Home / End au clavier
(`role="tablist"`).

#### `Tip` / `InfoTip`
```tsx
import { Tip, InfoTip } from '@/components/common/Tip';
<Tip content={t('devices.privacyHint')}><Shield className="w-3.5 h-3.5" /></Tip>
<Tip content={unsupportedReason}><span><button disabled>…</button></span></Tip>
<InfoTip content={t('schedules.bypassPrivacyHelp')} />   // bouton (i) 14 px, zone de tap 40 px
```
Props : `content` (rien si vide), `children?` (déclencheur ; absent = bouton
(i)), `placement?` (`'top'` défaut | `'bottom'`, bascule si pas de place),
`align?` (`'center'` défaut | `'start'` | `'end'`), `label?` (aria-label du
(i), défaut `ui.moreInfo`), `className?` (span déclencheur), `contentClassName?`
(bulle, défaut `max-w-xs`), `delay?` (survol, 150 ms), `disabled?`. Souris :
survol / focus. Tactile : le tap bascule un popover ; tap ailleurs, Échap ou
retour Android ferment. N'envelopper que du contenu **non interactif** ou un
contrôle **désactivé** (le tap sur l'enveloppe bascule la bulle ; les enfants
directs `:disabled` reçoivent `pointer-events: none`).

#### `ActionMenu`
```tsx
import { ActionMenu } from '@/components/common/ActionMenu';
<ActionMenu
  items={[
    { icon: <Play className="w-4 h-4" />, label: t('scenarios.run'), onClick: run },
    { icon: <History className="w-4 h-4" />, label: t('scenarios.history'), onClick: openHistory },
    { icon: <Download className="w-4 h-4" />, label: t('common.export'), onClick: exp, hidden: !canExport },
    { icon: <Trash2 className="w-4 h-4" />, label: t('common.delete'), onClick: remove, danger: true, separator: true },
  ]}
/>
<ActionMenu items={items} trigger={(p) => <button {...p} className="…">{t('devices.batch.actions')}</button>} />
```
Items : `{ key?, icon?, label, description?, onClick, danger?, disabled?,
hidden?, separator? }` — `onClick` est appelé de façon synchrone juste après
la fermeture (garde l'activation utilisateur pour `window.open`,
presse-papiers, sélecteur de fichier ; un `confirm()` / `Modal` peut s'ouvrir
directement). Props : `items`, `label?` (aria du « ⋯ », défaut
`ui.moreActions`), `sheetTitle?` (titre de la feuille téléphone), `trigger?`
(render prop recevant `{ ref, onClick, 'aria-haspopup', 'aria-expanded' }` à
étaler sur votre bouton), `triggerSize?` / `triggerVariant?` /
`triggerClassName?` (IconButton « ⋯ » par défaut), `align?` (`'end'` défaut |
`'start'`), `placement?` (`'bottom'` défaut | `'top'`), `menuClassName?`
(défaut `w-56`), `disabled?`, `mode?` (`'auto'` défaut = feuille du bas sur
téléphone < 768 px, popover sinon | `'popover'` | `'sheet'`). Popover en
`position: fixed`, recalé dans la fenêtre (bascule haut/bas, défilement
interne), flèches / Home / End ; lignes de 48 px dans la feuille.

Motif recommandé pour les actions de ligne : les actions principales en
`IconButton` visibles à partir de `md` (`hidden md:inline-flex`) et
**toutes** les actions dans un `ActionMenu` (`md:hidden`) — ou un
`ActionMenu` seul.

#### `MasterDetail`
```tsx
import { MasterDetail } from '@/components/common/MasterDetail';
<MasterDetail
  master={<ScriptList selectedId={id} onSelect={setId} />}
  detail={selected ? <ScriptEditor script={selected} /> : null}
  detailTitle={selected?.name}
  onBack={() => setId(null)}
  emptyDetail={<EmptyState text={t('scripts.selectOne')} />}
/>
```
Props : `master`, `detail?`, `hasDetail?` (défaut `detail != null`), `onBack`
(bouton retour + retour Android sous `lg`), `detailTitle?`, `backLabel?`
(défaut `common.back`), `emptyDetail?` (affiché à `lg+` sans sélection),
`narrowMode?` (`'stack'` défaut : un seul panneau, les deux restent montés —
la liste garde son scroll et son état ; `'drawer'` : le détail s'ouvre dans
un `Drawer` droit), `className?`, `masterClassName?` (défaut `lg:w-72
lg:shrink-0`), `detailClassName?`. Côte à côte à partir de `lg`
(`lg:flex lg:items-start lg:gap-4`).

#### `PageContainer`
```tsx
import { PageContainer } from '@/components/common/PageContainer';
<PageContainer className="space-y-6">…</PageContainer>                     // p-3 sm:p-4 lg:p-6 (= p-6 actuel sur desktop)
<PageContainer embedded={embedded} className="space-y-4">…</PageContainer> // embedded : sans padding
```
Remplace le `p-6` codé en dur à la racine des pages (`min-w-0` inclus, `ref`
et attributs `<div>` transmis).

### 8.4 CSS et variantes

- Variantes Tailwind (plugin dans `tailwind.config.ts`) : `coarse:` =
  `@media (pointer: coarse)`, `can-hover:` = `@media (hover: hover) and
  (pointer: fine)`. Déclarées via `addVariant` (et non en `screens` objet) :
  les variantes `max-sm:` / `max-md:` / `min-[…]:` restent utilisables.
- `future.hoverOnlyWhenSupported` : `hover:` et `group-hover:` n'existent plus
  au toucher. Conséquence : `opacity-0 group-hover:opacity-100` devient
  **invisible pour toujours** au toucher → écrire
  `can-hover:opacity-0 can-hover:group-hover:opacity-100` (§5.1).
- Hauteurs : `h-dvh`, `max-h-dvh`, `min-h-dvh` (Tailwind 3.4) ou
  `h-[calc(100dvh-…)]` au lieu de `h-screen` / `vh`.
- Zones sûres : variables `--safe-top|right|bottom|left` et utilitaires
  `pt-safe`, `pr-safe`, `pb-safe`, `pl-safe`, `px-safe`, `py-safe` (acceptent
  les variantes : `sm:pb-safe`).
- `scrollbar-none` : bande défilante sans barre visible.
- `touch-none-canvas` : surface à entrée brute (canvas distant, graphe) :
  `touch-action: none`, pas de sélection, pas de menu d'appui long.
- `table-sticky-first` (utilisé par `TableScroll stickyFirstCol`) ; fond via
  la variable `--table-sticky-bg`.
- Champs sur téléphone tactile (< 768 px) : `font-size: 16px !important`
  global ; exclusion par la classe `keep-font-size` (et automatiquement
  `.xterm-helper-textarea`, cases à cocher, radios, range, color, file).
- Animations opt-in : `animate-obli-slide-in-left|right|up`,
  `animate-obli-fade-in`.
