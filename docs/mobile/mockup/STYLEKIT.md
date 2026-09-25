# Obliance Android — STYLE KIT (mockups)

Source of truth for every artboard of the Obliance Android mockup. Everything here follows `D:/Obliance/docs/obliance-mobile-design.md` §8 (theme **Operator**, dark) and `mockup-format.md`. Copy the snippets verbatim, then change only copy/data. All UI copy is French with *vouvoiement*; sample data comes only from the design doc §4.

Reference artboard: `project/Kit.dc.html` (390 × 11904) renders every snippet below.

## 0. Rules of thumb (read first)

- **Inline styles only.** The helmet below is the only `<style>` allowed. No CSS classes, no variables: use the literal hex values from §2.
- **Fonts** (literal `font:` shorthands used everywhere):
  - Inter → `font:<w> <size>px/<lh>px Inter,system-ui,sans-serif`
  - Rajdhani → `font:600 24px/28px Rajdhani,Inter,sans-serif;letter-spacing:.025em` (**never below 24px**)
  - JetBrains Mono → `font:400 12px/16px 'JetBrains Mono',ui-monospace,monospace` (single quotes inside the double-quoted style attribute)
- **Overline** (surtitre, used for section labels, KPI labels, card kickers), copy exactly:
  `font:400 11px/14px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:#828CAF`
- **No borders** on cards, pills, buttons, chips, fields. Depth = surface steps + shadows. The only 1px line allowed is `border-top:1px solid #2A3048` on the device action bar.
- **Red discipline.** Brand red (#E03A3A logo, #C83232 filled primary buttons/FAB, #FF6868 active nav + tonal "Agir" + focus ring + snackbar action) lives in chrome only. **Inside content, red = critical and nothing else.** Links and info = #60A5FA. Unread marker = #60A5FA dot. Selection = #222740, never red. Toggles/checkboxes "on" = #4F7BFF. Never put a filled red primary button next to a critical card: use the tonal button.
- **Danger** (#DC2626 + `triangle-alert`) only inside a confirmation sheet, never the default focus. Outside confirmations, danger = #F87171 text in a menu/sheet item.
- **State is never color-only**: pill = dot + label; critical = `circle-alert` + "CRITIQUE"; warning = `triangle-alert`.
- **Pulse** (`animation:obliPulse 2s ease-in-out infinite`) only on status dots of warning / critical / updating / pending_uninstall (and the reconnecting avatar ring). Never on chrome otherwise.
- **Touch targets ≥ 44px** (48 preferred). Visual chips of 36px sit inside 44px buttons (see chips). Icon buttons are 48×48.
- **French micro-typography**: narrow no-break space `&#8239;` before `%`, units, `?`, `!` (`97&#8239;%`, `16&#8239;Go`, `(BASH)&#8239;?`); guillemets with `&nbsp;`: `«&nbsp;Vérif sauvegarde&nbsp;»`; group paths with `›` (`BASH › Siège › Serveurs`); separators `·`; ellipsis `…`; em dash `—`. Times 24h `03:12`; relative `il y a 4 min`.
- **Links between artboards**: style the `<a href="X.dc.html">` itself as the row/button. Never put a `<button>` inside an `<a>`. Non-navigating controls are `<button type="button">`.
- **SVG ids must be unique per artboard**: the logo and the calm-line gradient carry an id suffix (`obm-a-a`, `calm-line-1`); change the suffix if you place a second copy.
- Device names inside sentences never break at their hyphens: wrap them as `<span style="white-space:nowrap">PC-COMPTA-03 (BASH)</span>`.
- Numbers use `font-variant-numeric:tabular-nums` (set on body).

## 1. Helmet (exact)

Replace the helmet of the format skeleton with this one (adds JetBrains Mono 500, placeholder color and the three keyframes used by the kit):

```html
<helmet>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Rajdhani:wght@600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
body{margin:0;font-family:Inter,system-ui,sans-serif;background:#0b0d1a;color:#f0f4fc;-webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums}
a{color:inherit;text-decoration:none}a:hover{color:inherit}
::placeholder{color:#828caf;opacity:1}
@keyframes obliPulse{0%,100%{opacity:1}50%{opacity:.5}}
@keyframes obliSpin{to{transform:rotate(360deg)}}
@keyframes obliSkeleton{0%,100%{opacity:.55}50%{opacity:1}}
</style>
</helmet>
```

## 2. Tokens

### 2.1 Surfaces and text (Operator)

| Token | Hex | Use |
|---|---|---|
| bg | `#0B0D1A` | Page background, list backgrounds |
| chrome | `#0F1220` | Top bar, bottom nav, rail, action bar, key bar |
| surface1 | `#131728` | Cards, sheets, dialogs, list groups, segmented track |
| surface2 | `#181C30` | Nested cards, text/search fields, chips (unselected), terminal keys, skeletons |
| hover | `#1D2238` | Tenant chip, icon tiles, secondary buttons, session pill, quick actions |
| active | `#222740` | Selected row / chip / segment, live-update flash (600 ms), snackbar |
| divider | `#2A3048` | Only separator (above the device action bar); avatar fill; switch-off track |
| text | `#F0F4FC` | Primary text |
| text2 | `#B4BCD7` | Secondary text, secondary icons |
| textMuted | `#828CAF` | Metadata, overlines, inactive nav (5.8:1 on bg; avoid on #222740) |
| textFaint | `#4B5273` | Disabled only (+ sheet handle) |

### 2.2 Accent (brand, chrome only)

| Token | Hex | Use |
|---|---|---|
| brand | `#E03A3A` | Logo, brand icons. Never a button fill with white text |
| accentFill | `#C83232` | Filled primary buttons, FAB (white 5.3:1) |
| accentFillPressed | `#B41E1E` | Pressed primary |
| accent2 | `#FF6868` | Active nav icon+label, tonal button label, focus ring (2px), tab indicator, terminal cursor, snackbar action, filter dot on tenant chip |
| accentTonal | `rgba(255,104,104,.12)` (≈ `#2C1B2A`) | Active nav indicator, tonal buttons ("Agir"), swipe-reveal |

### 2.3 Device status (pill = 12% tint + colored label + 8px dot)

| Status | FR label | Dot / text | Tint (12%) | Pulse |
|---|---|---|---|---|
| online | En ligne | `#4ADE80` | `rgba(74,222,128,.12)` | no |
| offline | Hors ligne | `#9CA3AF` | `rgba(156,163,175,.12)` | no |
| warning | Attention | `#FACC15` | `rgba(250,204,21,.12)` | yes |
| critical | Critique | `#F87171` | `rgba(248,113,113,.12)` | yes |
| pending | En attente | `#60A5FA` | `rgba(96,165,250,.12)` | no |
| updating | Mise à jour | `#60A5FA` | `rgba(96,165,250,.12)` | yes |
| maintenance | Maintenance | `#FB7185` | `rgba(251,113,133,.12)` | no |
| suspended | Suspendu | dot `#6B7280`, text `#A1A8B5` | `rgba(107,114,128,.12)` | no |
| pending_uninstall | Désinstallation en cours | `#FB923C` | `rgba(251,146,60,.12)` | yes |
| update_error | Erreur de mise à jour | `#FB923C` | `rgba(251,146,60,.12)` | no |

### 2.4 Alert severity (3px card bar / label)

| Severity | Bar | Label on surface1 | Chip label (on 12% tint) | Icon |
|---|---|---|---|---|
| critique | `#DC2626` | `#EF4444` | `#F87171` (tint `rgba(220,38,38,.12)`) | `circle-alert` |
| attention | `#F59E0B` | `#FBBF24` | `#FBBF24` (tint `rgba(245,158,11,.12)`) | `triangle-alert` |
| info | `#3B82F6` | `#60A5FA` | `#60A5FA` (tint `rgba(59,130,246,.12)`) | `info` |
| rétablissement | `#22C55E` | `#4ADE80` | `#4ADE80` (tint `rgba(34,197,94,.12)`) | `circle-check` |

(#EF4444 on a red tint drops to 4.4:1, hence #F87171 inside chips.)

### 2.5 Other colors

| Use | Value |
|---|---|
| Danger button | `#DC2626` fill, white text (4.8:1), pressed `#EF4444`; danger menu text `#F87171` |
| Links / info text | `#60A5FA` (hover/emphasis `#93C5FD`) |
| Toggle / checkbox on | `#4F7BFF` track/fill, white thumb |
| Deltas | better `#4ADE80`, worse `#FACC15`, neutral `#828CAF`, always with `arrow-up` / `arrow-down`; never brand red |
| Metric fill | normal `#4ADE80` (value in text/text2), attention `#FACC15`, critique `#F87171` — follow the device's metric state (PC-COMPTA-03 CPU 98 % = critique, BOB01 / 94 % = attention) |
| Bar/ring track | `rgba(255,255,255,.06)` |
| Charts | online line `#1EDD8A` (area 12–0 %), amber `#F5A623`, blue `#4F7BFF`, offline dashed `#828CAF` (`stroke-dasharray="4 4"`), grid `rgba(255,255,255,.05)` |
| Scrim | `rgba(5,6,12,.64)` |
| Obli apps dots | Obliview `#2BC4BD`, Obliguard `#F5A623` |
| Terminal | bg `#080A14`, text `#D6DCEB`, cursor block `#FF6868`, selection `rgba(255,104,104,.30)`; ANSI black `#5A6285`/`#7C86A8`, red `#F87171`/`#FF8A8A`, green `#4ADE80`/`#86EFAC`, yellow `#FACC15`/`#FDE68A`, blue `#60A5FA`/`#93C5FD`, magenta `#C084FC`/`#D8B4FE`, cyan `#22D3EE`/`#67E8F9`, white `#B4BCD7`/`#F0F4FC` |

### 2.6 Type scale

| Role | Style |
|---|---|
| KPI featured | `font:600 48px/48px Rajdhani,Inter,sans-serif` |
| KPI | `font:600 36px/40px Rajdhani,Inter,sans-serif` |
| Screen title / device name | `font:600 24px/28px Rajdhani,Inter,sans-serif;letter-spacing:.025em` |
| Dialog / sheet title | `font:600 20px/28px Inter,system-ui,sans-serif` |
| Card title | `font:600 16px/24px Inter,system-ui,sans-serif` |
| Row title | `font:600 16px/22px Inter,system-ui,sans-serif` (compact `font:600 14px/20px Inter,system-ui,sans-serif`) |
| List item label (settings, sheet items) | `font:500 16px/22px Inter,system-ui,sans-serif` |
| Body | `font:400 14px/20px Inter,system-ui,sans-serif`; in fields `font:400 16px/24px Inter,system-ui,sans-serif` |
| Label (buttons, tabs, pills, nav) | `font:500 14px/20px Inter,system-ui,sans-serif` / `font:500 12px/16px Inter,system-ui,sans-serif` (active nav/tab/segment: 600) |
| Overline | `font:400 11px/14px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:#828CAF` |
| Mono caption (IP, versions, PID, times, deltas) | `font:400 12px/16px 'JetBrains Mono',ui-monospace,monospace;color:#828CAF` |
| Terminal / output | `font:400 13px/19px 'JetBrains Mono',ui-monospace,monospace;color:#D6DCEB` |
| BitLocker key | `font:500 28px/36px 'JetBrains Mono',ui-monospace,monospace` |
| 2FA code | `font:500 24px/32px 'JetBrains Mono',ui-monospace,monospace` |

Floor for Inter: 12px. Never Rajdhani below 24px.

### 2.7 Shape, spacing, elevation

- Radius: 6 (fields, icon tiles, menu items) · 8 (chips, buttons, compact cards, segmented track, snackbar) · 12 (cards, dialogs) · 14 (featured card) · 16 (sheet top corners, FAB) · 999 (pills, dots, avatar).
- Spacing scale: 4 / 6 / 8 / 10 / 12 / 14 / 18 / 20 / 24 / 32. Phone gutter **16**, tablet gutter 24. Card padding 16 (featured 20). Gap between cards 12, between sections 18. Content above the device action bar: bottom padding 88.
- Rows: device 72 (comfort, phone) / 56 (compact, tablet); settings rows 64–72; tree rows 40 in 48 zones.
- Elevation (box-shadow):
  - E1 cards: `box-shadow:0 6px 24px -8px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.03)`
  - E2 sheets, menus, floating pills, snackbar: `box-shadow:0 -8px 32px -8px rgba(0,0,0,.55)`
  - E3 dialogs: `box-shadow:0 12px 40px -12px rgba(0,0,0,.6)`
  - Featured card: E1 + `0 0 24px -4px rgba(224,58,58,.20)` and background `linear-gradient(135deg,rgba(224,58,58,.10) 0%,rgba(224,58,58,0) 55%),#131728`
- Icon sizes: 24 nav, 20–22 bars, 16–18 buttons/tabs, 12–14 inline. Icon colors: `#828CAF` inactive, `#B4BCD7` secondary, `#FF6868` active (chrome).

## 3. Screen skeletons

Phone top-level screen (root fixed 390×844; lists scroll inside `flex:1`):

```html
<div style="position:relative;width:390px;height:844px;box-sizing:border-box;display:flex;flex-direction:column;background:#0B0D1A;overflow:hidden">
  <!-- topbar-root -->
  <main style="flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column;gap:12px;padding:12px 0 0"> … </main>
  <!-- bottom-nav -->
  <!-- optional: session-pill wrapper (bottom:88px), fab-extended (bottom:96px, or 148px when the session pill is shown), snackbar wrapper (bottom:96px) -->
</div>
```

Phone pushed screen (device detail, script setup): `topbar-detail` + content (`padding-bottom:88px` if content could reach the bar) + `action-bar` (64px) — **no bottom nav**.

Tablet landscape 1280×800: `display:flex` row → `nav-rail` (80) | list pane 360–380 (bg) | detail pane `flex:1` (bg, cards on surface1, gutter 24). Compact device rows (56) in tablet lists.

Overlays (sheet, snackbar, FAB, session pill) need `position:relative` on the root and go last in the root.

## 4. Snippets

### 4.1 Top app bar
#### `topbar-root` — top-level screens (À traiter, Appareils, Activité, Flotte, Plus). Row 1: tenant chip · search · avatar with realtime ring. Row 2: Rajdhani title + freshness stamp. Height 96.
```html
<header style="flex:none;background:#0F1220;padding:0 4px 12px 16px">
  <div style="display:flex;align-items:center;gap:4px;height:56px">
    <a href="TenantSwitch.dc.html" aria-label="Périmètre : Default, vue globale" style="display:flex;align-items:center;height:48px;min-width:0"><span style="display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 10px;border-radius:8px;background:#1D2238;color:#F0F4FC;white-space:nowrap"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#B4BCD7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"></path><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"></path><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"></path><path d="M10 6h4"></path><path d="M10 10h4"></path><path d="M10 14h4"></path><path d="M10 18h4"></path></svg><span style="font:500 14px/20px Inter,system-ui,sans-serif">Default</span><span style="font:400 11px/14px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;color:#B4BCD7;background:#2A3048;border-radius:4px;padding:1px 5px">Vue globale</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#828CAF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="m6 9 6 6 6-6"></path></svg></span></a>
    <span style="flex:1"></span>
    <button type="button" aria-label="Rechercher" style="display:flex;align-items:center;justify-content:center;width:48px;height:48px;padding:0;border:0;border-radius:24px;background:transparent;color:#B4BCD7;cursor:pointer"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg></button>
    <a href="More.dc.html" aria-label="Compte de Karim Benali — temps réel connecté" style="display:flex;align-items:center;justify-content:center;width:48px;height:48px;border-radius:24px"><span style="display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;background:#2A3048;color:#F0F4FC;font:600 13px/16px Inter,system-ui,sans-serif;box-shadow:0 0 0 2px #0F1220,0 0 0 4px #4ADE80">KB</span></a>
  </div>
  <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding-right:12px">
    <h1 style="margin:0;font:600 24px/28px Rajdhani,Inter,sans-serif;letter-spacing:.025em;color:#F0F4FC">À traiter</h1>
    <span style="display:inline-flex;align-items:center;gap:6px;font:400 12px/16px 'JetBrains Mono',ui-monospace,monospace;color:#B4BCD7;white-space:nowrap"><span style="flex:none;width:6px;height:6px;border-radius:50%;background:#4ADE80"></span>En direct</span>
  </div>
</header>
```

#### `topbar-detail` — pushed screens: back · name (Rajdhani 24) + "tenant · group path" · star (Surveiller) · ⋮. Height 64.
```html
<header style="flex:none;display:flex;align-items:center;gap:4px;height:64px;padding:0 4px;background:#0F1220">
  <a href="Triage.dc.html" aria-label="Retour" style="display:flex;align-items:center;justify-content:center;width:48px;height:48px;border-radius:24px;color:#F0F4FC"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="m12 19-7-7 7-7"></path><path d="M19 12H5"></path></svg></a>
  <div style="flex:1;min-width:0;display:flex;flex-direction:column">
    <span style="font:600 24px/28px Rajdhani,Inter,sans-serif;letter-spacing:.025em;color:#F0F4FC;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">PC-COMPTA-03</span>
    <span style="font:400 12px/16px Inter,system-ui,sans-serif;color:#828CAF;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">BASH · Siège › Comptabilité</span>
  </div>
  <button type="button" aria-label="Surveiller PC-COMPTA-03" style="display:flex;align-items:center;justify-content:center;width:48px;height:48px;padding:0;border:0;border-radius:24px;background:transparent;color:#B4BCD7;cursor:pointer"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg></button>
  <button type="button" aria-label="Plus d'options" style="display:flex;align-items:center;justify-content:center;width:48px;height:48px;padding:0;border:0;border-radius:24px;background:transparent;color:#B4BCD7;cursor:pointer"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg></button>
</header>
```

#### `tenant-chip-master` — session on Default (global view)
```html
<a href="TenantSwitch.dc.html" aria-label="Périmètre : Default, vue globale" style="display:flex;align-items:center;height:48px;min-width:0"><span style="display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 10px;border-radius:8px;background:#1D2238;color:#F0F4FC;white-space:nowrap"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#B4BCD7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"></path><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"></path><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"></path><path d="M10 6h4"></path><path d="M10 10h4"></path><path d="M10 14h4"></path><path d="M10 18h4"></path></svg><span style="font:500 14px/20px Inter,system-ui,sans-serif">Default</span><span style="font:400 11px/14px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;color:#B4BCD7;background:#2A3048;border-radius:4px;padding:1px 5px">Vue globale</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#828CAF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="m6 9 6 6 6-6"></path></svg></span></a>
```

#### `tenant-chip-filter` — global view filtered on a tenant (6px #FF6868 dot)
```html
<a href="TenantSwitch.dc.html" aria-label="Périmètre : vue globale filtrée sur BASH" style="display:flex;align-items:center;height:48px;min-width:0"><span style="display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 10px;border-radius:8px;background:#1D2238;color:#F0F4FC;white-space:nowrap"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#B4BCD7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"></path><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"></path><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"></path><path d="M10 6h4"></path><path d="M10 10h4"></path><path d="M10 14h4"></path><path d="M10 18h4"></path></svg><span style="font:500 14px/20px Inter,system-ui,sans-serif">BASH · filtre</span><span style="flex:none;width:6px;height:6px;border-radius:50%;background:#FF6868"></span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#828CAF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="m6 9 6 6 6-6"></path></svg></span></a>
```

#### `tenant-chip-client` — working inside a tenant
```html
<a href="TenantSwitch.dc.html" aria-label="Périmètre : BASH" style="display:flex;align-items:center;height:48px;min-width:0"><span style="display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 10px;border-radius:8px;background:#1D2238;color:#F0F4FC;white-space:nowrap"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#B4BCD7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"></path><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"></path><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"></path><path d="M10 6h4"></path><path d="M10 10h4"></path><path d="M10 14h4"></path><path d="M10 18h4"></path></svg><span style="font:500 14px/20px Inter,system-ui,sans-serif">BASH</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#828CAF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="m6 9 6 6 6-6"></path></svg></span></a>
```

#### `avatar-live` — realtime connected (ring #4ADE80)
```html
<span style="display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;background:#2A3048;color:#F0F4FC;font:600 13px/16px Inter,system-ui,sans-serif;box-shadow:0 0 0 2px #0F1220,0 0 0 4px #4ADE80">KB</span>
```

#### `avatar-reconnecting` — reconnecting (amber ring, pulsing)
```html
<span style="display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;background:#2A3048;color:#F0F4FC;font:600 13px/16px Inter,system-ui,sans-serif;box-shadow:0 0 0 2px #0F1220,0 0 0 4px #FACC15;animation:obliPulse 2s ease-in-out infinite">KB</span>
```

#### `avatar-offline` — disconnected (grey ring)
```html
<span style="display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;background:#2A3048;color:#F0F4FC;font:600 13px/16px Inter,system-ui,sans-serif;box-shadow:0 0 0 2px #0F1220,0 0 0 4px #9CA3AF">KB</span>
```

#### `freshness-live`
```html
<span style="display:inline-flex;align-items:center;gap:6px;font:400 12px/16px 'JetBrains Mono',ui-monospace,monospace;color:#B4BCD7;white-space:nowrap"><span style="flex:none;width:6px;height:6px;border-radius:50%;background:#4ADE80"></span>En direct</span>
```

#### `freshness-updated`
```html
<span style="display:inline-flex;align-items:center;gap:6px;font:400 12px/16px 'JetBrains Mono',ui-monospace,monospace;color:#828CAF;white-space:nowrap"><span style="flex:none;width:6px;height:6px;border-radius:50%;background:#828CAF"></span>Mis à jour à 03:14</span>
```

#### `freshness-stale`
```html
<span style="display:inline-flex;align-items:center;gap:6px;font:400 12px/16px 'JetBrains Mono',ui-monospace,monospace;color:#FACC15;white-space:nowrap"><span style="flex:none;width:6px;height:6px;border-radius:50%;background:#FACC15"></span>Données de 03:02</span>
```

### 4.2 Navigation
#### `bottom-nav` — phone. Active item: `aria-current="page"`, color #FF6868, 64×32 tonal indicator, label 600. Inactive: #828CAF, transparent indicator, label 500. Move `aria-current`, the colors and the indicator background to the destination of the current artboard. Badges: À traiter = red count (#DC2626, white), Activité = info count (#60A5FA, dark text), Plus = 8px #60A5FA dot.
```html
<nav aria-label="Navigation principale" style="flex:none;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));height:80px;padding:0 4px;background:#0F1220">
  <a href="Triage.dc.html" aria-current="page" aria-label="À traiter, 5 à traiter" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-width:0;color:#FF6868"><span style="position:relative;display:flex;align-items:center;justify-content:center;width:64px;height:32px;border-radius:16px;background:rgba(255,104,104,.12)"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M7 18v-6a5 5 0 1 1 10 0v6"></path><path d="M5 21a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2z"></path><path d="M21 12h1"></path><path d="M18.5 4.5 18 5"></path><path d="M2 12h1"></path><path d="M12 2v1"></path><path d="m4.929 4.929.707.707"></path><path d="M12 12v6"></path></svg><span style="position:absolute;top:0;left:36px;min-width:18px;height:18px;padding:0 5px;box-sizing:border-box;border-radius:9px;background:#DC2626;color:#FFFFFF;font:600 12px/18px Inter,system-ui,sans-serif;text-align:center;box-shadow:0 0 0 2px #0F1220">5</span></span><span style="font:600 12px/16px Inter,system-ui,sans-serif;white-space:nowrap">À traiter</span></a>
  <a href="DeviceList.dc.html" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-width:0;color:#828CAF"><span style="position:relative;display:flex;align-items:center;justify-content:center;width:64px;height:32px;border-radius:16px;background:transparent"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><rect width="20" height="14" x="2" y="3" rx="2"></rect><line x1="8" x2="16" y1="21" y2="21"></line><line x1="12" x2="12" y1="17" y2="21"></line></svg></span><span style="font:500 12px/16px Inter,system-ui,sans-serif;white-space:nowrap">Appareils</span></a>
  <a href="Activity.dc.html" aria-label="Activité, 2 en cours" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-width:0;color:#828CAF"><span style="position:relative;display:flex;align-items:center;justify-content:center;width:64px;height:32px;border-radius:16px;background:transparent"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M22 12h-4l-3 9L9 3l-3 9H2"></path></svg><span style="position:absolute;top:0;left:36px;min-width:18px;height:18px;padding:0 5px;box-sizing:border-box;border-radius:9px;background:#60A5FA;color:#0B0D1A;font:600 12px/18px Inter,system-ui,sans-serif;text-align:center;box-shadow:0 0 0 2px #0F1220">2</span></span><span style="font:500 12px/16px Inter,system-ui,sans-serif;white-space:nowrap">Activité</span></a>
  <a href="Fleet.dc.html" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-width:0;color:#828CAF"><span style="position:relative;display:flex;align-items:center;justify-content:center;width:64px;height:32px;border-radius:16px;background:transparent"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><rect width="7" height="9" x="3" y="3" rx="1"></rect><rect width="7" height="5" x="14" y="3" rx="1"></rect><rect width="7" height="9" x="14" y="12" rx="1"></rect><rect width="7" height="5" x="3" y="16" rx="1"></rect></svg></span><span style="font:500 12px/16px Inter,system-ui,sans-serif;white-space:nowrap">Flotte</span></a>
  <a href="More.dc.html" aria-label="Plus, mise à jour disponible" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-width:0;color:#828CAF"><span style="position:relative;display:flex;align-items:center;justify-content:center;width:64px;height:32px;border-radius:16px;background:transparent"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><line x1="4" x2="20" y1="12" y2="12"></line><line x1="4" x2="20" y1="6" y2="6"></line><line x1="4" x2="20" y1="18" y2="18"></line></svg><span style="position:absolute;top:4px;left:40px;width:8px;height:8px;border-radius:50%;background:#60A5FA;box-shadow:0 0 0 2px #0F1220"></span></span><span style="font:500 12px/16px Inter,system-ui,sans-serif;white-space:nowrap">Plus</span></a>
</nav>
```

#### `nav-rail` — tablet, width 80, full height. Logo 28 · tenant button · 5 destinations (56×32 indicator) · avatar at the bottom. Active item here = Appareils.
```html
<nav aria-label="Navigation principale" style="flex:none;display:flex;flex-direction:column;align-items:center;gap:4px;width:80px;height:100%;padding:12px 0 16px;box-sizing:border-box;background:#0F1220">
  <span style="display:flex;align-items:center;justify-content:center;height:48px"><svg width="28" height="28" viewBox="0 0 122.88 122.88" role="img" aria-label="Obliance" style="display:block;flex:none"><defs><linearGradient id="obm-a-rail" x1="100.79" y1="22.04" x2="51.77" y2="110.5" gradientUnits="userSpaceOnUse"><stop offset=".11" stop-color="#c2001b"></stop><stop offset=".56" stop-color="#d28c7f"></stop><stop offset=".65" stop-color="#c0695f"></stop><stop offset=".87" stop-color="#941210"></stop><stop offset=".91" stop-color="#8b0000"></stop></linearGradient><linearGradient id="obm-b-rail" x1="20.66" y1="114.33" x2="63.21" y2="-2.64" gradientUnits="userSpaceOnUse"><stop offset=".08" stop-color="#c2001b"></stop><stop offset=".17" stop-color="#c41328"></stop><stop offset=".34" stop-color="#c9444b"></stop><stop offset=".56" stop-color="#d28c7f"></stop><stop offset=".59" stop-color="#cc8175"></stop><stop offset=".87" stop-color="#9d2421"></stop><stop offset="1" stop-color="#8b0000"></stop></linearGradient></defs><path fill="url(#obm-a-rail)" d="M122.88,61.44c0,33.93-27.51,61.44-61.44,61.44h-.08c-20.87-10.92-35.66-31.91-37.87-56.52,2.47,19.24,19.25,33.99,39.34,33.23,19.73-.75,35.83-16.78,36.66-36.5.65-15.47-7.91-29.02-20.65-35.6-.33-.17-.66-.34-1-.49-.66-.33-1.33-.62-2.02-.91-4.46-1.82-9.35-2.83-14.47-2.83-1.13,0-2.25.05-3.36.15-2.6.22-5.13.72-7.56,1.44-.17.05-.35.1-.51.16-.17.05-.35.1-.51.16t.03-.03s.02-.02.03-.03c.02-.02.03-.03.05-.05.04-.04.09-.09.16-.16.06-.06.13-.13.21-.2.16-.15.35-.33.58-.53,0,0,.03-.02.03-.03.23-.2.49-.43.79-.69.78-.66,1.78-1.46,2.98-2.32.97-.68,2.06-1.41,3.28-2.15.6-.36,1.25-.72,1.92-1.09.25-.13.51-.27.77-.4.39-.2.78-.4,1.19-.6.41-.19.82-.39,1.24-.58.4-.17.8-.35,1.22-.51.22-.09.43-.17.66-.26.27-.1.53-.21.8-.3.18-.07.37-.14.56-.2.4-.14.8-.28,1.22-.41.03-.02.06-.03.09-.03.53-.16,1.07-.32,1.61-.47.4-.11.79-.21,1.2-.3,1.01-.24,2.05-.45,3.12-.61.39-.06.78-.11,1.18-.16.08,0,.16-.02.23-.03.44-.05.89-.09,1.34-.13h0c4.18-.13,10.67.22,17.98,2.89,8.65,3.17,14.03,8.44,17.36,12.27,1.29,1.48,2.69,2.96,3.74,4.61,1.92,3.02,4.1,6.91,5.49,11.72,0,0,2.4,8.34,2.4,17.04Z"></path><path fill="url(#obm-b-rail)" d="M23.2,60.34c-.02.36-.03.73-.03,1.1,0,1.65.1,3.27.31,4.86,0,.02,0,.03,0,.05v.04c2.23,24.59,17.01,45.57,37.87,56.48-15.23-.02-29.16-5.58-39.89-14.78C8.19,96.72-.17,79.76,0,60.84.3,29.35,24.71,3.31,55.45.3h0c1.98-.21,3.99-.3,6.01-.3,9.64,0,18.77,2.23,26.89,6.19-3.38-.85-21.87-5.11-39.49,6.12-12.5,7.97-16.61,22.22-18.35,26.59-4.42,6.03-7.1,13.4-7.32,21.39v.04Z"></path></svg></span>
  <a href="TenantSwitch.dc.html" aria-label="Périmètre : Default, vue globale" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;width:60px;height:56px;margin:4px 0 12px;border-radius:12px;background:#1D2238;color:#F0F4FC"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#B4BCD7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"></path><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"></path><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"></path><path d="M10 6h4"></path><path d="M10 10h4"></path><path d="M10 14h4"></path><path d="M10 18h4"></path></svg><span style="font:500 11px/14px 'JetBrains Mono',ui-monospace,monospace">Default</span></a>
  <a href="Triage.dc.html" aria-label="À traiter, 5 à traiter" style="display:flex;flex-direction:column;align-items:center;gap:4px;width:80px;padding:4px 0 8px;color:#828CAF"><span style="position:relative;display:flex;align-items:center;justify-content:center;width:56px;height:32px;border-radius:16px;background:transparent"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M7 18v-6a5 5 0 1 1 10 0v6"></path><path d="M5 21a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2z"></path><path d="M21 12h1"></path><path d="M18.5 4.5 18 5"></path><path d="M2 12h1"></path><path d="M12 2v1"></path><path d="m4.929 4.929.707.707"></path><path d="M12 12v6"></path></svg><span style="position:absolute;top:0;left:30px;min-width:18px;height:18px;padding:0 5px;box-sizing:border-box;border-radius:9px;background:#DC2626;color:#FFFFFF;font:600 12px/18px Inter,system-ui,sans-serif;text-align:center;box-shadow:0 0 0 2px #0F1220">5</span></span><span style="font:500 12px/16px Inter,system-ui,sans-serif;white-space:nowrap">À traiter</span></a>
  <a href="TabletDeviceListDetail.dc.html" aria-current="page" style="display:flex;flex-direction:column;align-items:center;gap:4px;width:80px;padding:4px 0 8px;color:#FF6868"><span style="position:relative;display:flex;align-items:center;justify-content:center;width:56px;height:32px;border-radius:16px;background:rgba(255,104,104,.12)"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><rect width="20" height="14" x="2" y="3" rx="2"></rect><line x1="8" x2="16" y1="21" y2="21"></line><line x1="12" x2="12" y1="17" y2="21"></line></svg></span><span style="font:600 12px/16px Inter,system-ui,sans-serif;white-space:nowrap">Appareils</span></a>
  <a href="Activity.dc.html" aria-label="Activité, 2 en cours" style="display:flex;flex-direction:column;align-items:center;gap:4px;width:80px;padding:4px 0 8px;color:#828CAF"><span style="position:relative;display:flex;align-items:center;justify-content:center;width:56px;height:32px;border-radius:16px;background:transparent"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M22 12h-4l-3 9L9 3l-3 9H2"></path></svg><span style="position:absolute;top:0;left:30px;min-width:18px;height:18px;padding:0 5px;box-sizing:border-box;border-radius:9px;background:#60A5FA;color:#0B0D1A;font:600 12px/18px Inter,system-ui,sans-serif;text-align:center;box-shadow:0 0 0 2px #0F1220">2</span></span><span style="font:500 12px/16px Inter,system-ui,sans-serif;white-space:nowrap">Activité</span></a>
  <a href="TabletFleetDashboard.dc.html" style="display:flex;flex-direction:column;align-items:center;gap:4px;width:80px;padding:4px 0 8px;color:#828CAF"><span style="position:relative;display:flex;align-items:center;justify-content:center;width:56px;height:32px;border-radius:16px;background:transparent"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><rect width="7" height="9" x="3" y="3" rx="1"></rect><rect width="7" height="5" x="14" y="3" rx="1"></rect><rect width="7" height="9" x="14" y="12" rx="1"></rect><rect width="7" height="5" x="3" y="16" rx="1"></rect></svg></span><span style="font:500 12px/16px Inter,system-ui,sans-serif;white-space:nowrap">Flotte</span></a>
  <a href="More.dc.html" aria-label="Plus, mise à jour disponible" style="display:flex;flex-direction:column;align-items:center;gap:4px;width:80px;padding:4px 0 8px;color:#828CAF"><span style="position:relative;display:flex;align-items:center;justify-content:center;width:56px;height:32px;border-radius:16px;background:transparent"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><line x1="4" x2="20" y1="12" y2="12"></line><line x1="4" x2="20" y1="6" y2="6"></line><line x1="4" x2="20" y1="18" y2="18"></line></svg><span style="position:absolute;top:4px;left:34px;width:8px;height:8px;border-radius:50%;background:#60A5FA;box-shadow:0 0 0 2px #0F1220"></span></span><span style="font:500 12px/16px Inter,system-ui,sans-serif;white-space:nowrap">Plus</span></a>
  <span style="flex:1"></span>
  <a href="More.dc.html" aria-label="Compte de Karim Benali — temps réel connecté" style="display:flex;align-items:center;justify-content:center;width:48px;height:48px"><span style="display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;background:#2A3048;color:#F0F4FC;font:600 13px/16px Inter,system-ui,sans-serif;box-shadow:0 0 0 2px #0F1220,0 0 0 4px #4ADE80">KB</span></a>
</nav>
```

### 4.3 Status and severity
#### `status-pill-online`
```html
<span style="flex:none;display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px 0 8px;border-radius:999px;background:rgba(74,222,128,.12);color:#4ADE80;font:500 12px/16px Inter,system-ui,sans-serif;white-space:nowrap"><span style="flex:none;width:8px;height:8px;border-radius:50%;background:#4ADE80"></span>En ligne</span>
```

#### `status-pill-offline`
```html
<span style="flex:none;display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px 0 8px;border-radius:999px;background:rgba(156,163,175,.12);color:#9CA3AF;font:500 12px/16px Inter,system-ui,sans-serif;white-space:nowrap"><span style="flex:none;width:8px;height:8px;border-radius:50%;background:#9CA3AF"></span>Hors ligne</span>
```

#### `status-pill-warning`
```html
<span style="flex:none;display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px 0 8px;border-radius:999px;background:rgba(250,204,21,.12);color:#FACC15;font:500 12px/16px Inter,system-ui,sans-serif;white-space:nowrap"><span style="flex:none;width:8px;height:8px;border-radius:50%;background:#FACC15;animation:obliPulse 2s ease-in-out infinite"></span>Attention</span>
```

#### `status-pill-critical`
```html
<span style="flex:none;display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px 0 8px;border-radius:999px;background:rgba(248,113,113,.12);color:#F87171;font:500 12px/16px Inter,system-ui,sans-serif;white-space:nowrap"><span style="flex:none;width:8px;height:8px;border-radius:50%;background:#F87171;animation:obliPulse 2s ease-in-out infinite"></span>Critique</span>
```

#### `status-pill-pending`
```html
<span style="flex:none;display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px 0 8px;border-radius:999px;background:rgba(96,165,250,.12);color:#60A5FA;font:500 12px/16px Inter,system-ui,sans-serif;white-space:nowrap"><span style="flex:none;width:8px;height:8px;border-radius:50%;background:#60A5FA"></span>En attente</span>
```

#### `status-pill-updating`
```html
<span style="flex:none;display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px 0 8px;border-radius:999px;background:rgba(96,165,250,.12);color:#60A5FA;font:500 12px/16px Inter,system-ui,sans-serif;white-space:nowrap"><span style="flex:none;width:8px;height:8px;border-radius:50%;background:#60A5FA;animation:obliPulse 2s ease-in-out infinite"></span>Mise à jour</span>
```

#### `status-pill-maintenance`
```html
<span style="flex:none;display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px 0 8px;border-radius:999px;background:rgba(251,113,133,.12);color:#FB7185;font:500 12px/16px Inter,system-ui,sans-serif;white-space:nowrap"><span style="flex:none;width:8px;height:8px;border-radius:50%;background:#FB7185"></span>Maintenance</span>
```

#### `status-pill-suspended`
```html
<span style="flex:none;display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px 0 8px;border-radius:999px;background:rgba(107,114,128,.12);color:#A1A8B5;font:500 12px/16px Inter,system-ui,sans-serif;white-space:nowrap"><span style="flex:none;width:8px;height:8px;border-radius:50%;background:#6B7280"></span>Suspendu</span>
```

#### `status-pill-pending_uninstall`
```html
<span style="flex:none;display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px 0 8px;border-radius:999px;background:rgba(251,146,60,.12);color:#FB923C;font:500 12px/16px Inter,system-ui,sans-serif;white-space:nowrap"><span style="flex:none;width:8px;height:8px;border-radius:50%;background:#FB923C;animation:obliPulse 2s ease-in-out infinite"></span>Désinstallation en cours</span>
```

#### `status-pill-update_error`
```html
<span style="flex:none;display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px 0 8px;border-radius:999px;background:rgba(251,146,60,.12);color:#FB923C;font:500 12px/16px Inter,system-ui,sans-serif;white-space:nowrap"><span style="flex:none;width:8px;height:8px;border-radius:50%;background:#FB923C"></span>Erreur de mise à jour</span>
```

#### `status-pill-compact` — compact (20px, 6px dot) for rows, tablet lists, headers. Same colors as above.
```html
<span style="flex:none;display:inline-flex;align-items:center;gap:5px;height:20px;padding:0 8px 0 6px;border-radius:999px;background:rgba(248,113,113,.12);color:#F87171;font:500 12px/16px Inter,system-ui,sans-serif;white-space:nowrap"><span style="flex:none;width:6px;height:6px;border-radius:50%;background:#F87171;animation:obliPulse 2s ease-in-out infinite"></span>Critique</span>
```

#### `severity-chip-critical`
```html
<span style="flex:none;display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px 0 6px;border-radius:6px;background:rgba(220,38,38,.12);color:#F87171;font:500 11px/14px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;white-space:nowrap"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><circle cx="12" cy="12" r="10"></circle><line x1="12" x2="12" y1="8" y2="12"></line><line x1="12" x2="12.01" y1="16" y2="16"></line></svg>Critique</span>
```

#### `severity-chip-warning`
```html
<span style="flex:none;display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px 0 6px;border-radius:6px;background:rgba(245,158,11,.12);color:#FBBF24;font:500 11px/14px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;white-space:nowrap"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path></svg>Attention</span>
```

#### `severity-chip-info`
```html
<span style="flex:none;display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px 0 6px;border-radius:6px;background:rgba(59,130,246,.12);color:#60A5FA;font:500 11px/14px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;white-space:nowrap"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path></svg>Info</span>
```

#### `severity-chip-recovery`
```html
<span style="flex:none;display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px 0 6px;border-radius:6px;background:rgba(34,197,94,.12);color:#4ADE80;font:500 11px/14px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;white-space:nowrap"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><circle cx="12" cy="12" r="10"></circle><path d="m9 12 2 2 4-4"></path></svg>Rétabli</span>
```

### 4.4 Metrics
#### `metric-bar` — one bar (label overline, value Inter 600 14, 6px bar). Width = value %.
```html
<div style="display:flex;flex-direction:column;gap:6px;min-width:0">
  <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px"><span style="font:400 11px/14px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:#828CAF">CPU</span><span style="font:600 14px/20px Inter,system-ui,sans-serif;color:#F87171">97&#8239;%</span></div>
  <div style="height:6px;border-radius:3px;background:rgba(255,255,255,.06);overflow:hidden"><div style="width:97%;height:100%;border-radius:3px;background:#F87171"></div></div>
</div>
```

#### `metric-band` — S30 header band: CPU / RAM / main disk in a 3-col grid.
```html
<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px">
  <div style="display:flex;flex-direction:column;gap:6px;min-width:0">
  <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px"><span style="font:400 11px/14px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:#828CAF">CPU</span><span style="font:600 14px/20px Inter,system-ui,sans-serif;color:#F87171">97&#8239;%</span></div>
  <div style="height:6px;border-radius:3px;background:rgba(255,255,255,.06);overflow:hidden"><div style="width:97%;height:100%;border-radius:3px;background:#F87171"></div></div>
</div>
  <div style="display:flex;flex-direction:column;gap:6px;min-width:0">
  <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px"><span style="font:400 11px/14px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:#828CAF">RAM</span><span style="font:600 14px/20px Inter,system-ui,sans-serif;color:#F0F4FC">71&#8239;%</span></div>
  <div style="height:6px;border-radius:3px;background:rgba(255,255,255,.06);overflow:hidden"><div style="width:71%;height:100%;border-radius:3px;background:#4ADE80"></div></div>
</div>
  <div style="display:flex;flex-direction:column;gap:6px;min-width:0">
  <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px"><span style="font:400 11px/14px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:#828CAF">C:</span><span style="font:600 14px/20px Inter,system-ui,sans-serif;color:#F0F4FC">64&#8239;%</span></div>
  <div style="height:6px;border-radius:3px;background:rgba(255,255,255,.06);overflow:hidden"><div style="width:64%;height:100%;border-radius:3px;background:#4ADE80"></div></div>
</div>
</div>
```

#### `metric-band-offline` — offline device: greyed bars + "Valeurs au …" stamp.
```html
<div style="display:flex;flex-direction:column;gap:8px">
  <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px">
    <div style="display:flex;flex-direction:column;gap:6px;min-width:0">
  <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px"><span style="font:400 11px/14px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:#828CAF">CPU</span><span style="font:600 14px/20px Inter,system-ui,sans-serif;color:#828CAF">3&#8239;%</span></div>
  <div style="height:6px;border-radius:3px;background:rgba(255,255,255,.06);overflow:hidden"><div style="width:3%;height:100%;border-radius:3px;background:#4B5273"></div></div>
</div>
    <div style="display:flex;flex-direction:column;gap:6px;min-width:0">
  <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px"><span style="font:400 11px/14px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:#828CAF">RAM</span><span style="font:600 14px/20px Inter,system-ui,sans-serif;color:#828CAF">41&#8239;%</span></div>
  <div style="height:6px;border-radius:3px;background:rgba(255,255,255,.06);overflow:hidden"><div style="width:41%;height:100%;border-radius:3px;background:#4B5273"></div></div>
</div>
    <div style="display:flex;flex-direction:column;gap:6px;min-width:0">
  <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px"><span style="font:400 11px/14px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:#828CAF">C:</span><span style="font:600 14px/20px Inter,system-ui,sans-serif;color:#828CAF">58&#8239;%</span></div>
  <div style="height:6px;border-radius:3px;background:rgba(255,255,255,.06);overflow:hidden"><div style="width:58%;height:100%;border-radius:3px;background:#4B5273"></div></div>
</div>
  </div>
  <span style="font:400 12px/16px 'JetBrains Mono',ui-monospace,monospace;color:#828CAF">Valeurs au 25/09 03:08</span>
</div>
```

#### `mini-bars` — device-row line 3: 3 × (label + 40×4 bar + value). Normal values in #B4BCD7, attention/critique in their color.
```html
<span style="display:flex;align-items:center;gap:10px;min-width:0;overflow:hidden"><span style="display:inline-flex;align-items:center;gap:5px;font:400 11px/14px 'JetBrains Mono',ui-monospace,monospace;color:#828CAF;white-space:nowrap">CPU<span style="flex:none;width:40px;height:4px;border-radius:2px;background:rgba(255,255,255,.06);overflow:hidden"><span style="display:block;width:98%;height:100%;border-radius:2px;background:#F87171"></span></span><span style="color:#F87171">98&#8239;%</span></span><span style="display:inline-flex;align-items:center;gap:5px;font:400 11px/14px 'JetBrains Mono',ui-monospace,monospace;color:#828CAF;white-space:nowrap">RAM<span style="flex:none;width:40px;height:4px;border-radius:2px;background:rgba(255,255,255,.06);overflow:hidden"><span style="display:block;width:71%;height:100%;border-radius:2px;background:#4ADE80"></span></span><span style="color:#B4BCD7">71&#8239;%</span></span><span style="display:inline-flex;align-items:center;gap:5px;font:400 11px/14px 'JetBrains Mono',ui-monospace,monospace;color:#828CAF;white-space:nowrap">C:<span style="flex:none;width:40px;height:4px;border-radius:2px;background:rgba(255,255,255,.06);overflow:hidden"><span style="display:block;width:64%;height:100%;border-radius:2px;background:#4ADE80"></span></span><span style="color:#B4BCD7">64&#8239;%</span></span></span>
```

### 4.5 Section headers
#### `section-header` — plain overline section (list sections, sheet groups). Sticky in lists: keep `background:#0B0D1A`.
```html
<div style="display:flex;align-items:center;min-height:40px;padding:0 16px;background:#0B0D1A"><h2 style="margin:0;font:400 11px/14px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:#828CAF">Non lues</h2></div>
```

#### `section-header-status` — device list sections with status dot: CRITIQUE · 1 / ATTENTION · 5 / HORS LIGNE · 16 / EN LIGNE · 289.
```html
<div style="display:flex;align-items:center;min-height:40px;padding:0 16px;background:#0B0D1A"><h2 style="margin:0;display:flex;align-items:center;gap:8px;font:400 11px/14px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:#828CAF"><span style="flex:none;width:6px;height:6px;border-radius:50%;background:#F87171"></span>Critique · 1</h2></div>
```

#### `section-header-action` — with trailing link (blue).
```html
<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:44px;padding:0 16px"><h2 style="margin:0;font:400 11px/14px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:#828CAF">Attention requise</h2><a href="DeviceList.dc.html" style="display:flex;align-items:center;gap:2px;min-height:44px;font:500 14px/20px Inter,system-ui,sans-serif;color:#60A5FA">Voir tout<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="m9 18 6-6-6-6"></path></svg></a></div>
```

### 4.6 Lists
#### `device-row` — DeviceRow 72px: OS tile 36 (monitor = Windows, terminal = Linux, apple = macOS) with status dot · name 600 16 + tenant tag (global view) + mode icons · compact pill · mono line "IP · OS · agent" · mini-bars.
```html
<a href="DeviceOverview.dc.html" style="display:flex;align-items:center;gap:12px;height:72px;padding:0 16px;box-sizing:border-box;background:transparent">
  <span style="position:relative;flex:none;display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:6px;background:#1D2238;color:#B4BCD7"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><rect width="20" height="14" x="2" y="3" rx="2"></rect><line x1="8" x2="16" y1="21" y2="21"></line><line x1="12" x2="12" y1="17" y2="21"></line></svg><span style="position:absolute;right:-3px;bottom:-3px;width:10px;height:10px;border-radius:50%;background:#F87171;box-shadow:0 0 0 2px #0B0D1A;animation:obliPulse 2s ease-in-out infinite"></span></span>
  <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px">
    <span style="display:flex;align-items:center;gap:8px;min-width:0"><span style="flex:1;min-width:0;display:flex;align-items:center;gap:6px"><span style="min-width:0;font:600 16px/22px Inter,system-ui,sans-serif;color:#F0F4FC;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">PC-COMPTA-03</span><span style="flex:none;font:500 11px/14px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.06em;color:#B4BCD7;background:#1D2238;border-radius:4px;padding:1px 5px">BASH</span></span><span style="flex:none;display:inline-flex;align-items:center;gap:5px;height:20px;padding:0 8px 0 6px;border-radius:999px;background:rgba(248,113,113,.12);color:#F87171;font:500 12px/16px Inter,system-ui,sans-serif;white-space:nowrap"><span style="flex:none;width:6px;height:6px;border-radius:50%;background:#F87171;animation:obliPulse 2s ease-in-out infinite"></span>Critique</span></span>
    <span style="font:400 12px/16px 'JetBrains Mono',ui-monospace,monospace;color:#828CAF;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">10.0.12.43 · Windows 11 Pro 23H2 · 4.5.79</span>
    <span style="display:flex;align-items:center;gap:10px;min-width:0;overflow:hidden"><span style="display:inline-flex;align-items:center;gap:5px;font:400 11px/14px 'JetBrains Mono',ui-monospace,monospace;color:#828CAF;white-space:nowrap">CPU<span style="flex:none;width:40px;height:4px;border-radius:2px;background:rgba(255,255,255,.06);overflow:hidden"><span style="display:block;width:98%;height:100%;border-radius:2px;background:#F87171"></span></span><span style="color:#F87171">98&#8239;%</span></span><span style="display:inline-flex;align-items:center;gap:5px;font:400 11px/14px 'JetBrains Mono',ui-monospace,monospace;color:#828CAF;white-space:nowrap">RAM<span style="flex:none;width:40px;height:4px;border-radius:2px;background:rgba(255,255,255,.06);overflow:hidden"><span style="display:block;width:71%;height:100%;border-radius:2px;background:#4ADE80"></span></span><span style="color:#B4BCD7">71&#8239;%</span></span><span style="display:inline-flex;align-items:center;gap:5px;font:400 11px/14px 'JetBrains Mono',ui-monospace,monospace;color:#828CAF;white-space:nowrap">C:<span style="flex:none;width:40px;height:4px;border-radius:2px;background:rgba(255,255,255,.06);overflow:hidden"><span style="display:block;width:64%;height:100%;border-radius:2px;background:#4ADE80"></span></span><span style="color:#B4BCD7">64&#8239;%</span></span></span>
  </span>
</a>
```

#### `device-row-offline` — line 3 becomes "Hors ligne depuis …".
```html
<a href="AlertDetail.dc.html" style="display:flex;align-items:center;gap:12px;height:72px;padding:0 16px;box-sizing:border-box;background:transparent">
  <span style="position:relative;flex:none;display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:6px;background:#1D2238;color:#B4BCD7"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><rect width="20" height="14" x="2" y="3" rx="2"></rect><line x1="8" x2="16" y1="21" y2="21"></line><line x1="12" x2="12" y1="17" y2="21"></line></svg><span style="position:absolute;right:-3px;bottom:-3px;width:10px;height:10px;border-radius:50%;background:#9CA3AF;box-shadow:0 0 0 2px #0B0D1A"></span></span>
  <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px">
    <span style="display:flex;align-items:center;gap:8px;min-width:0"><span style="flex:1;min-width:0;display:flex;align-items:center;gap:6px"><span style="min-width:0;font:600 16px/22px Inter,system-ui,sans-serif;color:#F0F4FC;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">SRV-AD2</span><span style="flex:none;font:500 11px/14px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.06em;color:#B4BCD7;background:#1D2238;border-radius:4px;padding:1px 5px">BASH</span></span><span style="flex:none;display:inline-flex;align-items:center;gap:5px;height:20px;padding:0 8px 0 6px;border-radius:999px;background:rgba(156,163,175,.12);color:#9CA3AF;font:500 12px/16px Inter,system-ui,sans-serif;white-space:nowrap"><span style="flex:none;width:6px;height:6px;border-radius:50%;background:#9CA3AF"></span>Hors ligne</span></span>
    <span style="font:400 12px/16px 'JetBrains Mono',ui-monospace,monospace;color:#828CAF;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">10.0.0.12 · Windows Server 2022 · 4.5.79</span>
    <span style="display:flex;align-items:center;gap:6px;font:400 12px/16px Inter,system-ui,sans-serif;color:#9CA3AF"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>Hors ligne depuis 03:08 (14 min)</span>
  </span>
</a>
```

#### `device-row-pending`
```html
<a href="Triage.dc.html" style="display:flex;align-items:center;gap:12px;height:72px;padding:0 16px;box-sizing:border-box;background:transparent">
  <span style="position:relative;flex:none;display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:6px;background:#1D2238;color:#B4BCD7"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><rect width="20" height="14" x="2" y="3" rx="2"></rect><line x1="8" x2="16" y1="21" y2="21"></line><line x1="12" x2="12" y1="17" y2="21"></line></svg><span style="position:absolute;right:-3px;bottom:-3px;width:10px;height:10px;border-radius:50%;background:#60A5FA;box-shadow:0 0 0 2px #0B0D1A"></span></span>
  <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px">
    <span style="display:flex;align-items:center;gap:8px;min-width:0"><span style="flex:1;min-width:0;display:flex;align-items:center;gap:6px"><span style="min-width:0;font:600 16px/22px Inter,system-ui,sans-serif;color:#F0F4FC;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">KIOSK-ACCUEIL-02</span><span style="flex:none;font:500 11px/14px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.06em;color:#B4BCD7;background:#1D2238;border-radius:4px;padding:1px 5px">BASH</span></span><span style="flex:none;display:inline-flex;align-items:center;gap:5px;height:20px;padding:0 8px 0 6px;border-radius:999px;background:rgba(96,165,250,.12);color:#60A5FA;font:500 12px/16px Inter,system-ui,sans-serif;white-space:nowrap"><span style="flex:none;width:6px;height:6px;border-radius:50%;background:#60A5FA"></span>En attente</span></span>
    <span style="font:400 12px/16px 'JetBrains Mono',ui-monospace,monospace;color:#828CAF;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">10.0.3.41 · Windows 11 IoT Enterprise</span>
    <span style="display:flex;align-items:center;gap:6px;font:400 12px/16px Inter,system-ui,sans-serif;color:#60A5FA"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><line x1="19" x2="19" y1="8" y2="14"></line><line x1="22" x2="16" y1="11" y2="11"></line></svg>En attente d'approbation</span>
  </span>
</a>
```

#### `device-row-modes` — mode icons after the name: privacy `shield` #FB923C, isolation `wifi-off` #60A5FA, agent update `arrow-up` #60A5FA, legacy = mono tag "legacy" (same style as the tenant tag).
```html
<a href="DeviceList.dc.html" style="display:flex;align-items:center;gap:12px;height:72px;padding:0 16px;box-sizing:border-box;background:transparent">
  <span style="position:relative;flex:none;display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:6px;background:#1D2238;color:#B4BCD7"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M12 20.94c1.5 0 2.75 1.06 4 1.06 3 0 6-8 6-12.22A4.91 4.91 0 0 0 17 5c-2.22 0-4 1.44-5 2-1-.56-2.78-2-5-2a4.9 4.9 0 0 0-5 4.78C2 14 5 22 8 22c1.25 0 2.5-1.06 4-1.06Z"></path><path d="M10 2c1 .5 2 2 2 5"></path></svg><span style="position:absolute;right:-3px;bottom:-3px;width:10px;height:10px;border-radius:50%;background:#4ADE80;box-shadow:0 0 0 2px #0B0D1A"></span></span>
  <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px">
    <span style="display:flex;align-items:center;gap:8px;min-width:0"><span style="flex:1;min-width:0;display:flex;align-items:center;gap:6px"><span style="min-width:0;font:600 16px/22px Inter,system-ui,sans-serif;color:#F0F4FC;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">MAC-DIRECTION</span><span style="flex:none;font:500 11px/14px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.06em;color:#B4BCD7;background:#1D2238;border-radius:4px;padding:1px 5px">BASH</span><span role="img" aria-label="Mode confidentialité actif" style="flex:none;color:#FB923C"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"></path></svg></span></span><span style="flex:none;display:inline-flex;align-items:center;gap:5px;height:20px;padding:0 8px 0 6px;border-radius:999px;background:rgba(74,222,128,.12);color:#4ADE80;font:500 12px/16px Inter,system-ui,sans-serif;white-space:nowrap"><span style="flex:none;width:6px;height:6px;border-radius:50%;background:#4ADE80"></span>En ligne</span></span>
    <span style="font:400 12px/16px 'JetBrains Mono',ui-monospace,monospace;color:#828CAF;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">10.0.12.20 · macOS 14.6 Sonoma · 4.5.79</span>
    <span style="display:flex;align-items:center;gap:10px;min-width:0;overflow:hidden"><span style="display:inline-flex;align-items:center;gap:5px;font:400 11px/14px 'JetBrains Mono',ui-monospace,monospace;color:#828CAF;white-space:nowrap">CPU<span style="flex:none;width:40px;height:4px;border-radius:2px;background:rgba(255,255,255,.06);overflow:hidden"><span style="display:block;width:8%;height:100%;border-radius:2px;background:#4ADE80"></span></span><span style="color:#B4BCD7">8&#8239;%</span></span><span style="display:inline-flex;align-items:center;gap:5px;font:400 11px/14px 'JetBrains Mono',ui-monospace,monospace;color:#828CAF;white-space:nowrap">RAM<span style="flex:none;width:40px;height:4px;border-radius:2px;background:rgba(255,255,255,.06);overflow:hidden"><span style="display:block;width:47%;height:100%;border-radius:2px;background:#4ADE80"></span></span><span style="color:#B4BCD7">47&#8239;%</span></span><span style="display:inline-flex;align-items:center;gap:5px;font:400 11px/14px 'JetBrains Mono',ui-monospace,monospace;color:#828CAF;white-space:nowrap">/<span style="flex:none;width:40px;height:4px;border-radius:2px;background:rgba(255,255,255,.06);overflow:hidden"><span style="display:block;width:52%;height:100%;border-radius:2px;background:#4ADE80"></span></span><span style="color:#B4BCD7">52&#8239;%</span></span></span>
  </span>
</a>
```

#### `device-row-compact` — 56px tablet row, shown selected (#222740, radius 8 inside a 8px-padded list).
```html
<a href="TabletDeviceListDetail.dc.html" style="display:flex;align-items:center;gap:12px;height:56px;padding:0 10px 0 12px;box-sizing:border-box;border-radius:8px;background:#222740">
  <span style="position:relative;flex:none;display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:6px;background:#1D2238;color:#B4BCD7"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><rect width="20" height="14" x="2" y="3" rx="2"></rect><line x1="8" x2="16" y1="21" y2="21"></line><line x1="12" x2="12" y1="17" y2="21"></line></svg><span style="position:absolute;right:-3px;bottom:-3px;width:8px;height:8px;border-radius:50%;background:#F87171;box-shadow:0 0 0 2px #222740;animation:obliPulse 2s ease-in-out infinite"></span></span>
  <span style="flex:1;min-width:0;display:flex;flex-direction:column">
    <span style="display:flex;align-items:center;gap:8px;min-width:0"><span style="flex:1;min-width:0;font:600 14px/20px Inter,system-ui,sans-serif;color:#F0F4FC;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">PC-COMPTA-03</span><span style="flex:none;display:inline-flex;align-items:center;gap:5px;height:20px;padding:0 8px 0 6px;border-radius:999px;background:rgba(248,113,113,.12);color:#F87171;font:500 12px/16px Inter,system-ui,sans-serif;white-space:nowrap"><span style="flex:none;width:6px;height:6px;border-radius:50%;background:#F87171;animation:obliPulse 2s ease-in-out infinite"></span>Critique</span></span>
    <span style="font:400 12px/16px 'JetBrains Mono',ui-monospace,monospace;color:#B4BCD7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">10.0.12.43 · CPU 98&#8239;%</span>
  </span>
</a>
```

#### `device-row-swipe` — row swiped left revealing "Agir" (tonal). Opens the action sheet, never executes.
```html
<div style="position:relative;height:72px;overflow:hidden">
  <a href="ActionSheet.dc.html" aria-label="Agir sur BOB01" style="position:absolute;inset:0;display:flex;justify-content:flex-end;background:rgba(255,104,104,.12)"><span style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;width:96px;color:#FF6868"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg><span style="font:600 12px/16px Inter,system-ui,sans-serif">Agir</span></span></a>
  <a href="DeviceList.dc.html" style="position:absolute;top:0;bottom:0;left:-96px;width:100%;display:flex;align-items:center;gap:12px;padding:0 16px;box-sizing:border-box;background:#0B0D1A;box-shadow:12px 0 24px -12px rgba(0,0,0,.7)">
    <span style="position:relative;flex:none;display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:6px;background:#1D2238;color:#B4BCD7"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" x2="20" y1="19" y2="19"></line></svg><span style="position:absolute;right:-3px;bottom:-3px;width:10px;height:10px;border-radius:50%;background:#FACC15;box-shadow:0 0 0 2px #0B0D1A;animation:obliPulse 2s ease-in-out infinite"></span></span>
    <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px">
      <span style="display:flex;align-items:center;gap:8px;min-width:0"><span style="flex:1;min-width:0;display:flex;align-items:center;gap:6px"><span style="min-width:0;font:600 16px/22px Inter,system-ui,sans-serif;color:#F0F4FC;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">BOB01</span><span style="flex:none;font:500 11px/14px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.06em;color:#B4BCD7;background:#1D2238;border-radius:4px;padding:1px 5px">Default</span><span role="img" aria-label="Mise à jour d'agent disponible" style="flex:none;color:#60A5FA"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="m5 12 7-7 7 7"></path><path d="M12 19V5"></path></svg></span></span><span style="flex:none;display:inline-flex;align-items:center;gap:5px;height:20px;padding:0 8px 0 6px;border-radius:999px;background:rgba(250,204,21,.12);color:#FACC15;font:500 12px/16px Inter,system-ui,sans-serif;white-space:nowrap"><span style="flex:none;width:6px;height:6px;border-radius:50%;background:#FACC15;animation:obliPulse 2s ease-in-out infinite"></span>Attention</span></span>
      <span style="font:400 12px/16px 'JetBrains Mono',ui-monospace,monospace;color:#828CAF;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">10.20.0.15 · Ubuntu 22.04.4 LTS · 4.5.61</span>
      <span style="display:flex;align-items:center;gap:10px;min-width:0;overflow:hidden"><span style="display:inline-flex;align-items:center;gap:5px;font:400 11px/14px 'JetBrains Mono',ui-monospace,monospace;color:#828CAF;white-space:nowrap">CPU<span style="flex:none;width:40px;height:4px;border-radius:2px;background:rgba(255,255,255,.06);overflow:hidden"><span style="display:block;width:6%;height:100%;border-radius:2px;background:#4ADE80"></span></span><span style="color:#B4BCD7">6&#8239;%</span></span><span style="display:inline-flex;align-items:center;gap:5px;font:400 11px/14px 'JetBrains Mono',ui-monospace,monospace;color:#828CAF;white-space:nowrap">RAM<span style="flex:none;width:40px;height:4px;border-radius:2px;background:rgba(255,255,255,.06);overflow:hidden"><span style="display:block;width:38%;height:100%;border-radius:2px;background:#4ADE80"></span></span><span style="color:#B4BCD7">38&#8239;%</span></span><span style="display:inline-flex;align-items:center;gap:5px;font:400 11px/14px 'JetBrains Mono',ui-monospace,monospace;color:#828CAF;white-space:nowrap">/<span style="flex:none;width:40px;height:4px;border-radius:2px;background:rgba(255,255,255,.06);overflow:hidden"><span style="display:block;width:94%;height:100%;border-radius:2px;background:#FACC15"></span></span><span style="color:#FACC15">94&#8239;%</span></span></span>
    </span>
  </a>
</div>
```

#### `list-row` — generic navigation row (Plus, Réglages).
```html
<a href="AppSettings.dc.html" style="display:flex;align-items:center;gap:14px;min-height:64px;padding:8px 12px 8px 16px;box-sizing:border-box">
    <span style="flex:none;display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:6px;background:#1D2238;color:#B4BCD7"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg></span>
    <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px"><span style="font:500 16px/22px Inter,system-ui,sans-serif;color:#F0F4FC">Réglages de l'application</span><span style="font:400 14px/20px Inter,system-ui,sans-serif;color:#828CAF">Sécurité, apparence, langue</span></span>
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#828CAF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="m9 18 6-6-6-6"></path></svg>
  </a>
```

#### `list-row-web` — row that opens the embedded web view: trailing "VUE WEB" tag with `globe`.
```html
<a href="More.dc.html" style="display:flex;align-items:center;gap:14px;min-height:64px;padding:8px 12px 8px 16px;box-sizing:border-box">
    <span style="flex:none;display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:6px;background:#1D2238;color:#B4BCD7"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg></span>
    <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px"><span style="font:500 16px/22px Inter,system-ui,sans-serif;color:#F0F4FC">Utilisateurs et équipes</span></span>
    <span style="flex:none;display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 6px;border-radius:4px;background:#1D2238;font:400 11px/14px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;color:#B4BCD7"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><circle cx="12" cy="12" r="10"></circle><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"></path><path d="M2 12h20"></path></svg>Vue web</span>
  </a>
```

#### `list-group` — rows grouped on a surface1 card (Plus, Réglages).
```html
<div style="display:flex;flex-direction:column;padding:4px 0;border-radius:12px;background:#131728;box-shadow:0 6px 24px -8px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.03)">
  <a href="AppSettings.dc.html" style="display:flex;align-items:center;gap:14px;min-height:64px;padding:8px 12px 8px 16px;box-sizing:border-box">
    <span style="flex:none;display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:6px;background:#1D2238;color:#B4BCD7"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg></span>
    <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px"><span style="font:500 16px/22px Inter,system-ui,sans-serif;color:#F0F4FC">Réglages de l'application</span><span style="font:400 14px/20px Inter,system-ui,sans-serif;color:#828CAF">Sécurité, apparence, langue</span></span>
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#828CAF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="m9 18 6-6-6-6"></path></svg>
  </a>
  <a href="More.dc.html" style="display:flex;align-items:center;gap:14px;min-height:64px;padding:8px 12px 8px 16px;box-sizing:border-box">
    <span style="flex:none;display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:6px;background:#1D2238;color:#B4BCD7"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"></path><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"></path></svg></span>
    <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px"><span style="font:500 16px/22px Inter,system-ui,sans-serif;color:#F0F4FC">Notifications et astreinte</span><span style="font:400 14px/20px Inter,system-ui,sans-serif;color:#828CAF">Astreinte active · 19:00–08:00</span></span>
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#828CAF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="m9 18 6-6-6-6"></path></svg>
  </a>
  <a href="More.dc.html" style="display:flex;align-items:center;gap:14px;min-height:64px;padding:8px 12px 8px 16px;box-sizing:border-box">
    <span style="flex:none;display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:6px;background:#1D2238;color:#B4BCD7"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg></span>
    <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px"><span style="font:500 16px/22px Inter,system-ui,sans-serif;color:#F0F4FC">Utilisateurs et équipes</span></span>
    <span style="flex:none;display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 6px;border-radius:4px;background:#1D2238;font:400 11px/14px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;color:#B4BCD7"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><circle cx="12" cy="12" r="10"></circle><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"></path><path d="M2 12h20"></path></svg>Vue web</span>
  </a>
</div>
```

#### `settings-row-switch` — settings row with a switch.
```html
<div style="display:flex;align-items:center;gap:14px;min-height:72px;padding:8px 8px 8px 16px;box-sizing:border-box">
  <span style="flex:none;display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:6px;background:#1D2238;color:#B4BCD7"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M2 12C2 6.5 6.5 2 12 2a10 10 0 0 1 8 4"></path><path d="M5 19.5C5.5 18 6 15 6 12c0-.7.12-1.37.34-2"></path><path d="M17.29 21.02c.12-.6.43-2.3.5-3.02"></path><path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"></path><path d="M8.65 22c.21-.66.45-1.32.57-2"></path><path d="M14 13.12c0 2.38 0 6.38-1 8.88"></path><path d="M2 16h.01"></path><path d="M21.8 16c.2-2 .131-5.354 0-6"></path><path d="M9 6.8a6 6 0 0 1 9 5.2c0 .47 0 1.17-.02 2"></path></svg></span>
  <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px"><span style="font:500 16px/22px Inter,system-ui,sans-serif;color:#F0F4FC">Verrou biométrique</span><span style="font:400 14px/20px Inter,system-ui,sans-serif;color:#828CAF">Au démarrage et après 5&#8239;min en arrière-plan</span></span>
  <button type="button" role="switch" aria-checked="true" aria-label="Verrou biométrique" style="flex:none;display:flex;align-items:center;justify-content:center;width:60px;height:48px;padding:0;border:0;background:transparent;cursor:pointer"><span style="position:relative;display:block;width:52px;height:32px;border-radius:16px;background:#4F7BFF"><span style="position:absolute;top:4px;left:24px;display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:#FFFFFF;color:#4F7BFF;box-shadow:0 1px 3px rgba(0,0,0,.4)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M20 6 9 17l-5-5"></path></svg></span></span></button>
</div>
```

#### `skeleton-row` — loading placeholder at the final shape (72px row), 1.2s pulse.
```html
<div aria-hidden="true" style="display:flex;align-items:center;gap:12px;height:72px;padding:0 16px;box-sizing:border-box">
  <span style="display:block;width:36px;height:36px;border-radius:6px;background:#181C30;animation:obliSkeleton 1.2s ease-in-out infinite"></span>
  <span style="flex:1;display:flex;flex-direction:column;gap:8px"><span style="display:block;width:46%;height:14px;border-radius:4px;background:#181C30;animation:obliSkeleton 1.2s ease-in-out infinite"></span><span style="display:block;width:78%;height:10px;border-radius:4px;background:#181C30;animation:obliSkeleton 1.2s ease-in-out infinite"></span><span style="display:block;width:62%;height:8px;border-radius:4px;background:#181C30;animation:obliSkeleton 1.2s ease-in-out infinite"></span></span>
</div>
```

### 4.7 Cards
#### `card` — ObliCard: surface1, radius 12, padding 16, E1. Header = overline + title + optional blue link.
```html
<section style="display:flex;flex-direction:column;gap:12px;padding:16px;border-radius:12px;background:#131728;box-shadow:0 6px 24px -8px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.03)">
  <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
    <div style="display:flex;flex-direction:column;gap:2px;min-width:0"><span style="font:400 11px/14px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:#828CAF">Maintenant</span><h3 style="margin:0;font:600 16px/24px Inter,system-ui,sans-serif;color:#F0F4FC">Processeur</h3></div>
    <a href="DeviceOverview.dc.html" style="flex:none;display:flex;align-items:center;min-height:44px;margin-top:-10px;font:500 14px/20px Inter,system-ui,sans-serif;color:#60A5FA">Voir les processus</a>
  </div>
  <div style="display:flex;align-items:baseline;gap:10px"><span style="font:600 36px/40px Rajdhani,Inter,sans-serif;color:#F87171">97&#8239;%</span><span style="font:400 14px/20px Inter,system-ui,sans-serif;color:#B4BCD7">6 cœurs / 12 threads</span></div>
  <p style="margin:0;font:400 12px/16px 'JetBrains Mono',ui-monospace,monospace;color:#828CAF">Intel Core i5-12500 · Pic 99&#8239;% depuis 02:58</p>
</section>
```

#### `card-nested` — nested card (surface2, radius 8) inside a card.
```html
<div style="display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:8px;background:#181C30">
  <span style="flex:none;display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:6px;background:#1D2238;color:#B4BCD7"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><line x1="22" x2="2" y1="12" y2="12"></line><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path><line x1="6" x2="6.01" y1="16" y2="16"></line><line x1="10" x2="10.01" y1="16" y2="16"></line></svg></span>
  <span style="flex:1;min-width:0;display:flex;flex-direction:column"><span style="font:600 14px/20px Inter,system-ui,sans-serif;color:#F0F4FC">Disque 0 · Samsung PM9A1</span><span style="font:400 12px/16px 'JetBrains Mono',ui-monospace,monospace;color:#828CAF">512&#8239;Go · NVMe · 38&#8239;°C · usure 4&#8239;%</span></span>
  <span style="flex:none;display:inline-flex;align-items:center;gap:5px;height:20px;padding:0 8px 0 6px;border-radius:999px;background:rgba(74,222,128,.12);color:#4ADE80;font:500 12px/16px Inter,system-ui,sans-serif;white-space:nowrap"><span style="flex:none;width:6px;height:6px;border-radius:50%;background:#4ADE80"></span>Bon</span>
</div>
```

#### `featured-card` — Fleet featured card: 312 appareils, delta, health ribbon, legend chips (the tap targets).
```html
<section style="display:flex;flex-direction:column;gap:14px;padding:20px;border-radius:14px;background:linear-gradient(135deg,rgba(224,58,58,.10) 0%,rgba(224,58,58,0) 55%),#131728;box-shadow:0 6px 24px -8px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.03),0 0 24px -4px rgba(224,58,58,.20)">
  <div style="display:flex;align-items:center;justify-content:space-between;gap:12px"><span style="font:400 11px/14px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:#828CAF">Appareils</span><span style="display:inline-flex;align-items:center;gap:4px;font:400 12px/16px 'JetBrains Mono',ui-monospace,monospace;color:#828CAF"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="m5 12 7-7 7 7"></path><path d="M12 19V5"></path></svg>3 vs hier</span></div>
  <a href="DeviceList.dc.html" style="display:flex;align-items:baseline;gap:12px"><span style="font:600 48px/48px Rajdhani,Inter,sans-serif;color:#F0F4FC">312</span><span style="font:400 14px/20px Inter,system-ui,sans-serif;color:#B4BCD7">296 connectés · 16 hors ligne</span></a>
  <div role="img" aria-label="312 appareils : 1 critique, 5 attention, 1 en mise à jour, 289 en ligne, 16 hors ligne, 3 en attente" style="display:flex;gap:2px;height:10px;border-radius:5px;overflow:hidden"><span style="flex:1 0 6px;background:#F87171"></span><span style="flex:5 0 6px;background:#FACC15"></span><span style="flex:1 0 6px;background:#60A5FA"></span><span style="flex:289 0 6px;background:#4ADE80"></span><span style="flex:16 0 6px;background:#9CA3AF"></span><span style="flex:3 0 6px;background:rgba(96,165,250,.55)"></span></div>
  <div style="display:flex;flex-wrap:wrap;column-gap:8px;margin:-6px 0 -8px"><a href="DeviceList.dc.html" style="display:inline-flex;align-items:center;height:44px"><span style="display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 10px;border-radius:8px;background:#181C30;font:500 12px/16px Inter,system-ui,sans-serif;color:#B4BCD7;white-space:nowrap"><span style="flex:none;width:6px;height:6px;border-radius:50%;background:#F87171"></span>Critique<span style="font:500 12px/16px 'JetBrains Mono',ui-monospace,monospace;color:#F0F4FC">1</span></span></a><a href="DeviceList.dc.html" style="display:inline-flex;align-items:center;height:44px"><span style="display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 10px;border-radius:8px;background:#181C30;font:500 12px/16px Inter,system-ui,sans-serif;color:#B4BCD7;white-space:nowrap"><span style="flex:none;width:6px;height:6px;border-radius:50%;background:#FACC15"></span>Attention<span style="font:500 12px/16px 'JetBrains Mono',ui-monospace,monospace;color:#F0F4FC">5</span></span></a><a href="DeviceList.dc.html" style="display:inline-flex;align-items:center;height:44px"><span style="display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 10px;border-radius:8px;background:#181C30;font:500 12px/16px Inter,system-ui,sans-serif;color:#B4BCD7;white-space:nowrap"><span style="flex:none;width:6px;height:6px;border-radius:50%;background:#9CA3AF"></span>Hors ligne<span style="font:500 12px/16px 'JetBrains Mono',ui-monospace,monospace;color:#F0F4FC">16</span></span></a><a href="DeviceList.dc.html" style="display:inline-flex;align-items:center;height:44px"><span style="display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 10px;border-radius:8px;background:#181C30;font:500 12px/16px Inter,system-ui,sans-serif;color:#B4BCD7;white-space:nowrap"><span style="flex:none;width:6px;height:6px;border-radius:50%;background:#60A5FA"></span>En attente<span style="font:500 12px/16px 'JetBrains Mono',ui-monospace,monospace;color:#F0F4FC">3</span></span></a></div>
</section>
```

#### `health-ribbon` — 10px segmented ribbon, 2px gaps, flex-grow = count (min 6px). Order: critique, attention, mise à jour, en ligne, hors ligne, en attente.
```html
<div role="img" aria-label="312 appareils : 1 critique, 5 attention, 1 en mise à jour, 289 en ligne, 16 hors ligne, 3 en attente" style="display:flex;gap:2px;height:10px;border-radius:5px;overflow:hidden"><span style="flex:1 0 6px;background:#F87171"></span><span style="flex:5 0 6px;background:#FACC15"></span><span style="flex:1 0 6px;background:#60A5FA"></span><span style="flex:289 0 6px;background:#4ADE80"></span><span style="flex:16 0 6px;background:#9CA3AF"></span><span style="flex:3 0 6px;background:rgba(96,165,250,.55)"></span></div>
```

#### `kpi-tile` — KPI tile: overline, Rajdhani 36 value colored by state, mono delta with arrow, 4px ratio bar.
```html
<a href="DeviceList.dc.html" style="display:flex;flex-direction:column;gap:6px;padding:16px;border-radius:12px;background:#131728;box-shadow:0 6px 24px -8px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.03);min-width:0">
  <span style="font:400 11px/14px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:#828CAF">Hors ligne</span>
  <span style="font:600 36px/40px Rajdhani,Inter,sans-serif;color:#9CA3AF">16</span>
  <span style="display:inline-flex;align-items:center;gap:4px;min-height:16px;font:400 12px/16px 'JetBrains Mono',ui-monospace,monospace;color:#FACC15;white-space:nowrap"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="m5 12 7-7 7 7"></path><path d="M12 19V5"></path></svg>5 vs hier</span>
  <span style="height:4px;border-radius:2px;background:rgba(255,255,255,.06);overflow:hidden"><span style="display:block;width:5.1%;height:100%;border-radius:2px;background:#9CA3AF"></span></span>
</a>
```

#### `kpi-grid` — 2-column KPI grid (gap 12).
```html
<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px">
  <a href="DeviceList.dc.html" style="display:flex;flex-direction:column;gap:6px;padding:16px;border-radius:12px;background:#131728;box-shadow:0 6px 24px -8px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.03);min-width:0">
  <span style="font:400 11px/14px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:#828CAF">En ligne</span>
  <span style="font:600 36px/40px Rajdhani,Inter,sans-serif;color:#4ADE80">289</span>
  <span style="display:inline-flex;align-items:center;gap:4px;min-height:16px;font:400 12px/16px 'JetBrains Mono',ui-monospace,monospace;color:#4ADE80;white-space:nowrap"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="m5 12 7-7 7 7"></path><path d="M12 19V5"></path></svg>2 vs hier</span>
  <span style="height:4px;border-radius:2px;background:rgba(255,255,255,.06);overflow:hidden"><span style="display:block;width:92.6%;height:100%;border-radius:2px;background:#4ADE80"></span></span>
</a>
  <a href="DeviceList.dc.html" style="display:flex;flex-direction:column;gap:6px;padding:16px;border-radius:12px;background:#131728;box-shadow:0 6px 24px -8px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.03);min-width:0">
  <span style="font:400 11px/14px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:#828CAF">Hors ligne</span>
  <span style="font:600 36px/40px Rajdhani,Inter,sans-serif;color:#9CA3AF">16</span>
  <span style="display:inline-flex;align-items:center;gap:4px;min-height:16px;font:400 12px/16px 'JetBrains Mono',ui-monospace,monospace;color:#FACC15;white-space:nowrap"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="m5 12 7-7 7 7"></path><path d="M12 19V5"></path></svg>5 vs hier</span>
  <span style="height:4px;border-radius:2px;background:rgba(255,255,255,.06);overflow:hidden"><span style="display:block;width:5.1%;height:100%;border-radius:2px;background:#9CA3AF"></span></span>
</a>
  <a href="DeviceList.dc.html" style="display:flex;flex-direction:column;gap:6px;padding:16px;border-radius:12px;background:#131728;box-shadow:0 6px 24px -8px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.03);min-width:0">
  <span style="font:400 11px/14px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:#828CAF">Critique</span>
  <span style="font:600 36px/40px Rajdhani,Inter,sans-serif;color:#F87171">1</span>
  <span style="display:inline-flex;align-items:center;gap:4px;min-height:16px;font:400 12px/16px 'JetBrains Mono',ui-monospace,monospace;color:#828CAF;white-space:nowrap">—</span>
  <span style="height:4px;border-radius:2px;background:rgba(255,255,255,.06);overflow:hidden"><span style="display:block;width:0.3%;height:100%;border-radius:2px;background:#F87171"></span></span>
</a>
  <a href="DeviceList.dc.html" style="display:flex;flex-direction:column;gap:6px;padding:16px;border-radius:12px;background:#131728;box-shadow:0 6px 24px -8px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.03);min-width:0">
  <span style="font:400 11px/14px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:#828CAF">MAJ en attente</span>
  <span style="font:600 36px/40px Rajdhani,Inter,sans-serif;color:#F0F4FC">47</span>
  <span style="display:inline-flex;align-items:center;gap:4px;min-height:16px;font:400 12px/16px 'JetBrains Mono',ui-monospace,monospace;color:#4ADE80;white-space:nowrap"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M12 5v14"></path><path d="m19 12-7 7-7-7"></path></svg>12 vs semaine</span>
  <span style="height:4px;border-radius:2px;background:rgba(255,255,255,.06);overflow:hidden"><span style="display:block;width:15.1%;height:100%;border-radius:2px;background:#F0F4FC"></span></span>
</a>
</div>
```

#### `incident-card` — IncidentCard (signature): 3px severity bar, overline "CRITIQUE · tenant · time · age", title "DEVICE — Catégorie", server message, live state line (pulsing), one contextual quick action (Surveiller `circle-dot` / Processus `list` / Scripts `play` / Disques `hard-drive`), unread dot #60A5FA.
```html
<div style="position:relative;overflow:hidden;border-radius:12px;background:#131728;box-shadow:0 6px 24px -8px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.03)">
  <span style="position:absolute;left:0;top:0;bottom:0;width:3px;background:#DC2626"></span>
  <span role="img" aria-label="Non lue" style="position:absolute;top:40px;right:16px;width:8px;height:8px;border-radius:50%;background:#60A5FA"></span>
  <a href="AlertDetail.dc.html" style="display:flex;flex-direction:column;gap:4px;padding:14px 16px 0 18px">
    <span style="display:flex;align-items:center;gap:6px;font:400 11px/14px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:#828CAF;white-space:nowrap;overflow:hidden"><span style="flex:none;display:inline-flex;align-items:center;gap:4px;color:#EF4444"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><circle cx="12" cy="12" r="10"></circle><line x1="12" x2="12" y1="8" y2="12"></line><line x1="12" x2="12.01" y1="16" y2="16"></line></svg>Critique</span>· BASH · 03:12 · il y a 4 min</span>
    <span style="padding-right:18px;font:600 16px/22px Inter,system-ui,sans-serif;color:#F0F4FC">SRV-AD2 — Hors ligne</span>
    <span style="font:400 14px/20px Inter,system-ui,sans-serif;color:#B4BCD7">Aucun push reçu depuis 4 min.</span>
  </a>
  <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:6px 12px 12px 18px">
    <span style="display:inline-flex;align-items:center;gap:6px;font:500 12px/16px Inter,system-ui,sans-serif;color:#9CA3AF"><span style="flex:none;width:8px;height:8px;border-radius:50%;background:#9CA3AF;animation:obliPulse 2s ease-in-out infinite"></span>Toujours hors ligne</span>
    <a href="Activity.dc.html" aria-label="Surveiller SRV-AD2" style="flex:none;display:inline-flex;align-items:center;gap:8px;height:44px;padding:0 14px 0 12px;box-sizing:border-box;border-radius:8px;background:#1D2238;color:#F0F4FC;font:500 14px/20px Inter,system-ui,sans-serif"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#B4BCD7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="1"></circle></svg>Surveiller</a>
  </div>
</div>
```

#### `incident-card-metric`
```html
<div style="position:relative;overflow:hidden;border-radius:12px;background:#131728;box-shadow:0 6px 24px -8px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.03)">
  <span style="position:absolute;left:0;top:0;bottom:0;width:3px;background:#DC2626"></span>
  <span role="img" aria-label="Non lue" style="position:absolute;top:40px;right:16px;width:8px;height:8px;border-radius:50%;background:#60A5FA"></span>
  <a href="DeviceOverview.dc.html" style="display:flex;flex-direction:column;gap:4px;padding:14px 16px 0 18px">
    <span style="display:flex;align-items:center;gap:6px;font:400 11px/14px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:#828CAF;white-space:nowrap;overflow:hidden"><span style="flex:none;display:inline-flex;align-items:center;gap:4px;color:#EF4444"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><circle cx="12" cy="12" r="10"></circle><line x1="12" x2="12" y1="8" y2="12"></line><line x1="12" x2="12.01" y1="16" y2="16"></line></svg>Critique</span>· BASH · 03:05</span>
    <span style="padding-right:18px;font:600 16px/22px Inter,system-ui,sans-serif;color:#F0F4FC">PC-COMPTA-03 — Métrique critique</span>
    <span style="font:400 14px/20px Inter,system-ui,sans-serif;color:#B4BCD7">CPU 98&#8239;% (seuil 90&#8239;%)</span>
  </a>
  <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:6px 12px 12px 18px">
    <span style="display:inline-flex;align-items:center;gap:6px;font:500 12px/16px Inter,system-ui,sans-serif;color:#F87171"><span style="flex:none;width:8px;height:8px;border-radius:50%;background:#F87171;animation:obliPulse 2s ease-in-out infinite"></span>Critique · 97&#8239;% en direct</span>
    <a href="DeviceOverview.dc.html" aria-label="Processus de PC-COMPTA-03" style="flex:none;display:inline-flex;align-items:center;gap:8px;height:44px;padding:0 14px 0 12px;box-sizing:border-box;border-radius:8px;background:#1D2238;color:#F0F4FC;font:500 14px/20px Inter,system-ui,sans-serif"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#B4BCD7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><line x1="8" x2="21" y1="6" y2="6"></line><line x1="8" x2="21" y1="12" y2="12"></line><line x1="8" x2="21" y1="18" y2="18"></line><line x1="3" x2="3.01" y1="6" y2="6"></line><line x1="3" x2="3.01" y1="12" y2="12"></line><line x1="3" x2="3.01" y1="18" y2="18"></line></svg>Processus</a>
  </div>
</div>
```

#### `incident-card-recovered` — recovery: green bar, no quick action, no unread dot.
```html
<div style="position:relative;overflow:hidden;border-radius:12px;background:#131728;box-shadow:0 6px 24px -8px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.03)">
  <span style="position:absolute;left:0;top:0;bottom:0;width:3px;background:#22C55E"></span>
  
  <a href="DeviceList.dc.html" style="display:flex;flex-direction:column;gap:4px;padding:14px 16px 0 18px">
    <span style="display:flex;align-items:center;gap:6px;font:400 11px/14px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:#828CAF;white-space:nowrap;overflow:hidden"><span style="flex:none;display:inline-flex;align-items:center;gap:4px;color:#4ADE80"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><circle cx="12" cy="12" r="10"></circle><path d="m9 12 2 2 4-4"></path></svg>Rétabli</span>· Default · 00:58</span>
    <span style="padding-right:18px;font:600 16px/22px Inter,system-ui,sans-serif;color:#F0F4FC">140 — De retour en ligne</span>
    <span style="font:400 14px/20px Inter,system-ui,sans-serif;color:#B4BCD7">Hors ligne pendant 6 min.</span>
  </a>
  <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:6px 12px 12px 18px">
    <span style="display:inline-flex;align-items:center;gap:6px;font:500 12px/16px Inter,system-ui,sans-serif;color:#4ADE80"><span style="flex:none;width:8px;height:8px;border-radius:50%;background:#4ADE80"></span>En ligne</span>
    
  </div>
</div>
```

#### `context-card` — ContextCard (surface2) with up to 4 tappable facts. Icons: `network` neighbours, `git-commit` recent change, `wrench` maintenance, `rotate-ccw` pending reboot, `calendar-clock` failed schedule.
```html
<div style="display:flex;flex-direction:column;padding:12px 14px 4px;border-radius:8px;background:#181C30">
  <span style="font:400 11px/14px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:#828CAF;margin-bottom:2px">Contexte</span>
  <a href="DeviceList.dc.html" style="display:flex;align-items:center;gap:12px;min-height:44px">
    <span style="flex:none;color:#B4BCD7"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><rect x="16" y="16" width="6" height="6" rx="1"></rect><rect x="2" y="16" width="6" height="6" rx="1"></rect><rect x="9" y="2" width="6" height="6" rx="1"></rect><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"></path><path d="M12 12V8"></path></svg></span>
    <span style="flex:1;min-width:0;font:400 14px/20px Inter,system-ui,sans-serif;color:#F0F4FC">4 autres appareils de Siège › Serveurs hors ligne depuis 03:07</span>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#828CAF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="m9 18 6-6-6-6"></path></svg>
  </a>
  <a href="Activity.dc.html" style="display:flex;align-items:center;gap:12px;min-height:44px">
    <span style="flex:none;color:#B4BCD7"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5"></path><path d="M16 2v4"></path><path d="M8 2v4"></path><path d="M3 10h5"></path><path d="M17.5 17.5 16 16.3V14"></path><circle cx="16" cy="16" r="6"></circle></svg></span>
    <span style="flex:1;min-width:0;font:400 14px/20px Inter,system-ui,sans-serif;color:#F0F4FC">Planification «&nbsp;Vérif sauvegarde&nbsp;» en échec à 02:00 (code 1)</span>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#828CAF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="m9 18 6-6-6-6"></path></svg>
  </a>
  <a href="AlertDetail.dc.html" style="display:flex;align-items:center;gap:12px;min-height:44px">
    <span style="flex:none;color:#828CAF"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg></span>
    <span style="flex:1;min-width:0;font:400 14px/20px Inter,system-ui,sans-serif;color:#828CAF">Aucune maintenance en cours</span>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#828CAF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="m9 18 6-6-6-6"></path></svg>
  </a>
</div>
```

#### `expiry-ring` — approval countdown: blue > 10 min, #FACC15 ≤ 10 min, #F87171 ≤ 3 min. Dash = remaining / 30 min × 150.8.
```html
<span role="img" aria-label="Expire dans 27 minutes" style="position:relative;flex:none;display:inline-flex;width:56px;height:56px">
  <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true" style="display:block;transform:rotate(-90deg)"><circle cx="28" cy="28" r="24" fill="none" stroke="rgba(255,255,255,.06)" stroke-width="4"></circle><circle cx="28" cy="28" r="24" fill="none" stroke="#60A5FA" stroke-width="4" stroke-linecap="round" stroke-dasharray="136.9 150.8"></circle></svg>
  <span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:500 12px/16px 'JetBrains Mono',ui-monospace,monospace;color:#F0F4FC">27:14</span>
</span>
```

#### `progress-ring` — batch progress: one arc per device (success #4ADE80, failure #F87171, running #60A5FA, queued rgba(255,255,255,.12)).
```html
<span role="img" aria-label="2 réussis, 1 échec sur 3" style="position:relative;flex:none;display:inline-flex;width:48px;height:48px">
  <svg width="48" height="48" viewBox="0 0 48 48" aria-hidden="true" style="display:block;transform:rotate(-90deg)"><circle cx="24" cy="24" r="20" fill="none" stroke="#4ADE80" stroke-width="4" stroke-dasharray="37.89 87.78" stroke-dashoffset="0.00"></circle><circle cx="24" cy="24" r="20" fill="none" stroke="#4ADE80" stroke-width="4" stroke-dasharray="37.89 87.78" stroke-dashoffset="-41.89"></circle><circle cx="24" cy="24" r="20" fill="none" stroke="#F87171" stroke-width="4" stroke-dasharray="37.89 87.78" stroke-dashoffset="-83.78"></circle></svg>
  <span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:500 12px/16px 'JetBrains Mono',ui-monospace,monospace;color:#F0F4FC">2/3</span>
</span>
```

#### `command-tracker` — inline command states (Envoyé / En cours / Terminé / En attente d'approbation).
```html
<span style="display:inline-flex;align-items:center;gap:8px;height:32px;font:500 12px/16px Inter,system-ui,sans-serif;color:#60A5FA;white-space:nowrap"><span style="display:inline-flex;gap:3px"><span style="width:6px;height:6px;border-radius:50%;background:#60A5FA"></span><span style="width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,.12)"></span><span style="width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,.12)"></span></span>Envoyé</span>
<span style="display:inline-flex;align-items:center;gap:8px;height:32px;font:500 12px/16px Inter,system-ui,sans-serif;color:#60A5FA;white-space:nowrap"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none;animation:obliSpin 1s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>En cours…</span>
<span style="display:inline-flex;align-items:center;gap:8px;height:32px;font:500 12px/16px Inter,system-ui,sans-serif;color:#4ADE80;white-space:nowrap"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><circle cx="12" cy="12" r="10"></circle><path d="m9 12 2 2 4-4"></path></svg>Redémarré (1,8&#8239;s)</span>
<span style="display:inline-flex;align-items:center;gap:8px;height:32px;font:500 12px/16px Inter,system-ui,sans-serif;color:#FACC15;white-space:nowrap"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M5 22h14"></path><path d="M5 2h14"></path><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"></path><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"></path></svg>En attente d'approbation</span>
```

### 4.8 Banners
#### `banner-privacy`
```html
<div role="note" style="display:flex;align-items:center;gap:12px;min-height:52px;padding:8px 8px 8px 16px;box-sizing:border-box;background:rgba(251,146,60,.10)">
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FB923C" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"></path></svg>
  <span style="flex:1;min-width:0;font:400 14px/20px Inter,system-ui,sans-serif;color:#B4BCD7"><span style="font-weight:600;color:#FB923C">Mode confidentialité actif</span> — scripts, accès distant, processus et fichiers verrouillés</span>
  <a href="DeviceOverview.dc.html" style="flex:none;display:flex;align-items:center;height:44px;padding:0 10px;border-radius:6px;font:600 14px/20px Inter,system-ui,sans-serif;color:#FB923C">Déverrouiller</a>
</div>
```

#### `banner-isolation`
```html
<div role="note" style="display:flex;align-items:center;gap:12px;min-height:52px;padding:8px 8px 8px 16px;box-sizing:border-box;background:rgba(96,165,250,.10)">
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#60A5FA" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M12 20h.01"></path><path d="M8.5 16.429a5 5 0 0 1 7 0"></path><path d="M5 12.859a10 10 0 0 1 5.17-2.69"></path><path d="M19 12.859a10 10 0 0 0-2.007-1.523"></path><path d="M2 8.82a15 15 0 0 1 4.177-2.643"></path><path d="M22 8.82a15 15 0 0 0-11.288-3.764"></path><path d="m2 2 20 20"></path></svg>
  <span style="flex:1;min-width:0;font:400 14px/20px Inter,system-ui,sans-serif;color:#B4BCD7"><span style="font-weight:600;color:#60A5FA">Réseau isolé depuis 03:30</span> — seul Obliance reste joignable</span>
  
</div>
```

#### `banner-uninstall`
```html
<div role="note" style="display:flex;align-items:center;gap:12px;min-height:52px;padding:8px 8px 8px 16px;box-sizing:border-box;background:rgba(251,146,60,.10)">
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FB923C" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
  <span style="flex:1;min-width:0;font:400 14px/20px Inter,system-ui,sans-serif;color:#B4BCD7"><span style="font-weight:600;color:#FB923C">Désinstallation dans 8:42</span></span>
  <a href="DeviceOverview.dc.html" style="flex:none;display:flex;align-items:center;height:44px;padding:0 10px;border-radius:6px;font:600 14px/20px Inter,system-ui,sans-serif;color:#FB923C">Annuler</a>
</div>
```

#### `banner-note`
```html
<div role="note" style="display:flex;align-items:center;gap:12px;min-height:52px;padding:8px 8px 8px 16px;box-sizing:border-box;background:rgba(156,163,175,.10)">
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#B4BCD7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path></svg>
  <span style="flex:1;min-width:0;font:400 14px/20px Inter,system-ui,sans-serif;color:#B4BCD7"><span style="font-weight:600;color:#B4BCD7">Note</span> — Intervention en cours — ne pas redémarrer (Karim)</span>
  
</div>
```

#### `realtime-strip` — thin amber strip under the top bar after 10 s without socket.
```html
<div role="status" style="display:flex;align-items:center;gap:8px;height:28px;padding:0 16px;background:rgba(250,204,21,.10);font:400 12px/16px 'JetBrains Mono',ui-monospace,monospace;color:#FACC15"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none;animation:obliSpin 1s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>Temps réel interrompu — reconnexion…</div>
```

#### `offline-banner`
```html
<div role="status" style="display:flex;align-items:center;gap:10px;min-height:40px;padding:8px 16px;box-sizing:border-box;background:#1D2238;font:400 14px/20px Inter,system-ui,sans-serif;color:#B4BCD7"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FACC15" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="m2 2 20 20"></path><path d="M5.782 5.782A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.307-.193"></path><path d="M21.532 16.5A4.5 4.5 0 0 0 17.5 10h-1.79A7.008 7.008 0 0 0 10 5.07"></path></svg>Hors ligne — données de 03:02</div>
```

### 4.9 Buttons
#### `btn-primary` — filled primary (#C83232). Height 48, radius 8, Inter 500 14. Pressed #B41E1E. Use `<a href>` with the same style (and `display:flex`) when it links to another artboard.
```html
<button type="button" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:48px;padding:0 20px;box-sizing:border-box;border:0;border-radius:8px;white-space:nowrap;cursor:pointer;font:500 14px/20px Inter,system-ui,sans-serif;background:#C83232;color:#FFFFFF;box-shadow:inset 0 1px 0 rgba(255,255,255,.10)">Se connecter avec Obligate</button>
```

#### `btn-full` — full-width primary in a bottom bar (52px).
```html
<a href="RunLive.dc.html" style="display:flex;align-items:center;justify-content:center;gap:8px;height:48px;padding:0 20px;box-sizing:border-box;border:0;border-radius:8px;white-space:nowrap;cursor:pointer;font:500 14px/20px Inter,system-ui,sans-serif;width:100%;height:52px;background:#C83232;color:#FFFFFF;box-shadow:inset 0 1px 0 rgba(255,255,255,.10)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>Exécuter sur 3 appareils</a>
```

#### `btn-secondary` — neutral (#1D2238). Cancel / secondary choices.
```html
<button type="button" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:48px;padding:0 20px;box-sizing:border-box;border:0;border-radius:8px;white-space:nowrap;cursor:pointer;font:500 14px/20px Inter,system-ui,sans-serif;background:#1D2238;color:#F0F4FC">Annuler</button>
```

#### `btn-tonal` — accent tonal: "Agir", "Refuser" on approvals, actions next to a critical card.
```html
<button type="button" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:48px;padding:0 20px;box-sizing:border-box;border:0;border-radius:8px;white-space:nowrap;cursor:pointer;font:500 14px/20px Inter,system-ui,sans-serif;background:rgba(255,104,104,.12);color:#FF6868"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>Agir</button>
```

#### `btn-danger` — only inside confirmation sheets (T2/T3), never focused by default.
```html
<button type="button" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:48px;padding:0 20px;box-sizing:border-box;border:0;border-radius:8px;white-space:nowrap;cursor:pointer;font:500 14px/20px Inter,system-ui,sans-serif;background:#DC2626;color:#FFFFFF"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path></svg>Éteindre SRV-AD2</button>
```

#### `btn-biometric` — T2 confirmation.
```html
<button type="button" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:48px;padding:0 20px;box-sizing:border-box;border:0;border-radius:8px;white-space:nowrap;cursor:pointer;font:500 14px/20px Inter,system-ui,sans-serif;background:#C83232;color:#FFFFFF;box-shadow:inset 0 1px 0 rgba(255,255,255,.10)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M2 12C2 6.5 6.5 2 12 2a10 10 0 0 1 8 4"></path><path d="M5 19.5C5.5 18 6 15 6 12c0-.7.12-1.37.34-2"></path><path d="M17.29 21.02c.12-.6.43-2.3.5-3.02"></path><path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"></path><path d="M8.65 22c.21-.66.45-1.32.57-2"></path><path d="M14 13.12c0 2.38 0 6.38-1 8.88"></path><path d="M2 16h.01"></path><path d="M21.8 16c.2-2 .131-5.354 0-6"></path><path d="M9 6.8a6 6 0 0 1 9 5.2c0 .47 0 1.17-.02 2"></path></svg>Confirmer par empreinte</button>
```

#### `btn-text` — low emphasis.
```html
<button type="button" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:48px;padding:0 20px;box-sizing:border-box;border:0;border-radius:8px;white-space:nowrap;cursor:pointer;font:500 14px/20px Inter,system-ui,sans-serif;padding:0 12px;background:transparent;color:#B4BCD7">Plus tard</button>
```

#### `btn-link` — blue text link-button (content links).
```html
<a href="DeviceList.dc.html" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:48px;padding:0 20px;box-sizing:border-box;border:0;border-radius:8px;white-space:nowrap;cursor:pointer;font:500 14px/20px Inter,system-ui,sans-serif;padding:0 12px;background:transparent;color:#60A5FA">Voir les 5<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="m9 18 6-6-6-6"></path></svg></a>
```

#### `btn-disabled` — disabled with its reason underneath (always say why).
```html
<div style="display:flex;flex-direction:column;gap:6px;align-items:flex-start">
  <button type="button" disabled style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:48px;padding:0 20px;box-sizing:border-box;border:0;border-radius:8px;white-space:nowrap;cursor:pointer;font:500 14px/20px Inter,system-ui,sans-serif;background:#181C30;color:#4B5273;cursor:default"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="m7 11 2-2-2-2"></path><path d="M11 13h4"></path><rect width="18" height="18" x="3" y="3" rx="2" ry="2"></rect></svg>Terminal</button>
  <span style="display:inline-flex;align-items:center;gap:6px;font:400 12px/16px Inter,system-ui,sans-serif;color:#828CAF"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path></svg>L'appareil est hors ligne</span>
</div>
```

#### `btn-icon` — 48×48 icon button; always an aria-label.
```html
<button type="button" aria-label="Copier le numéro de série" style="display:flex;align-items:center;justify-content:center;width:48px;height:48px;padding:0;border:0;border-radius:24px;background:transparent;color:#B4BCD7;cursor:pointer"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg></button>
```

Compact variant: `height:44px;padding:0 14px` (never below 44).

#### `fab-extended` — single extended FAB ("Exécuter un script" in Activité; "Exécuter sur 3" in selection mode). `bottom:96px` above the nav; `bottom:148px` when the session pill is shown.
```html
<a href="RunScriptSetup.dc.html" style="position:absolute;right:16px;bottom:96px;display:inline-flex;align-items:center;gap:10px;height:56px;padding:0 20px 0 16px;box-sizing:border-box;border-radius:16px;background:#C83232;color:#FFFFFF;font:500 14px/20px Inter,system-ui,sans-serif;white-space:nowrap;box-shadow:0 8px 24px -6px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.10)"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>Exécuter un script</a>
```

### 4.10 Device action bar and tabs
#### `action-bar` — S30 bottom action bar (64px, chrome, the only divider line). Slot 4 "Agir" tonal. Offline: Surveiller (`circle-dot`) · Historique (`history`) · Tâches (`list-checks`) · Agir. Linux/macOS: Terminal · Script · Services (`settings`) · Agir.
```html
<nav aria-label="Actions sur PC-COMPTA-03" style="flex:none;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));align-items:center;gap:4px;height:64px;padding:0 8px;box-sizing:border-box;background:#0F1220;border-top:1px solid #2A3048">
  <a href="Terminal.dc.html" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;height:52px;border-radius:12px;background:transparent;color:#B4BCD7"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="m7 11 2-2-2-2"></path><path d="M11 13h4"></path><rect width="18" height="18" x="3" y="3" rx="2" ry="2"></rect></svg><span style="font:500 12px/16px Inter,system-ui,sans-serif;white-space:nowrap">Terminal</span></a>
  <a href="RunScriptSetup.dc.html" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;height:52px;border-radius:12px;background:transparent;color:#B4BCD7"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg><span style="font:500 12px/16px Inter,system-ui,sans-serif;white-space:nowrap">Script</span></a>
  <a href="DeviceOverview.dc.html" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;height:52px;border-radius:12px;background:transparent;color:#B4BCD7"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><line x1="8" x2="21" y1="6" y2="6"></line><line x1="8" x2="21" y1="12" y2="12"></line><line x1="8" x2="21" y1="18" y2="18"></line><line x1="3" x2="3.01" y1="6" y2="6"></line><line x1="3" x2="3.01" y1="12" y2="12"></line><line x1="3" x2="3.01" y1="18" y2="18"></line></svg><span style="font:500 12px/16px Inter,system-ui,sans-serif;white-space:nowrap">Processus</span></a>
  <a href="ActionSheet.dc.html" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;height:52px;border-radius:12px;background:rgba(255,104,104,.12);color:#FF6868"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg><span style="font:600 12px/16px Inter,system-ui,sans-serif;white-space:nowrap">Agir</span></a>
</nav>
```

#### `tabs` — scrollable sticky tabs (S30). Active: #F0F4FC 600 + 3px #FF6868 indicator. Locked tab: prepend `lock` 14.
```html
<div role="tablist" aria-label="Sections de l'appareil" style="flex:none;display:flex;height:48px;padding:0 4px;overflow:hidden;background:#0B0D1A">
  <a href="DeviceOverview.dc.html" role="tab" aria-selected="true" style="position:relative;flex:none;display:flex;align-items:center;gap:6px;height:48px;padding:0 12px;color:#F0F4FC;font:600 14px/20px Inter,system-ui,sans-serif;white-space:nowrap">Aperçu<span style="position:absolute;left:12px;right:12px;bottom:0;height:3px;border-radius:3px 3px 0 0;background:#FF6868"></span></a><a href="DeviceOverview.dc.html" role="tab" aria-selected="false" style="position:relative;flex:none;display:flex;align-items:center;gap:6px;height:48px;padding:0 12px;color:#828CAF;font:500 14px/20px Inter,system-ui,sans-serif;white-space:nowrap">Services</a><a href="DeviceOverview.dc.html" role="tab" aria-selected="false" style="position:relative;flex:none;display:flex;align-items:center;gap:6px;height:48px;padding:0 12px;color:#828CAF;font:500 14px/20px Inter,system-ui,sans-serif;white-space:nowrap">Processus</a><a href="DeviceOverview.dc.html" role="tab" aria-selected="false" style="position:relative;flex:none;display:flex;align-items:center;gap:6px;height:48px;padding:0 12px;color:#828CAF;font:500 14px/20px Inter,system-ui,sans-serif;white-space:nowrap">Scripts</a><a href="DeviceOverview.dc.html" role="tab" aria-selected="false" style="position:relative;flex:none;display:flex;align-items:center;gap:6px;height:48px;padding:0 12px;color:#828CAF;font:500 14px/20px Inter,system-ui,sans-serif;white-space:nowrap">Distant</a><a href="DeviceOverview.dc.html" role="tab" aria-selected="false" style="position:relative;flex:none;display:flex;align-items:center;gap:6px;height:48px;padding:0 12px;color:#828CAF;font:500 14px/20px Inter,system-ui,sans-serif;white-space:nowrap">Tâches</a><a href="DeviceInventory.dc.html" role="tab" aria-selected="false" style="position:relative;flex:none;display:flex;align-items:center;gap:6px;height:48px;padding:0 12px;color:#828CAF;font:500 14px/20px Inter,system-ui,sans-serif;white-space:nowrap">Inventaire</a>
</div>
```

### 4.11 Sheets
#### `sheet-scrim` — place first, then the sheet; root must be position:relative.
```html
<div aria-hidden="true" style="position:absolute;inset:0;background:rgba(5,6,12,.64)"></div>
```

#### `bottom-sheet` — modal bottom sheet: surface1, top radius 16, E2, handle 32×4 #4B5273. Example = T1 confirmation (names action + device + tenant, mono context line, consequence, Annuler + primary).
```html
<section role="dialog" aria-modal="true" aria-label="Confirmer le redémarrage du service" style="position:absolute;left:0;right:0;bottom:0;display:flex;flex-direction:column;gap:16px;padding:0 16px 24px;border-radius:16px 16px 0 0;background:#131728;box-shadow:0 -8px 32px -8px rgba(0,0,0,.55)">
  <div style="display:flex;justify-content:center;padding-top:10px"><span style="width:32px;height:4px;border-radius:2px;background:#4B5273"></span></div>
  <div style="display:flex;flex-direction:column;gap:6px">
    <h2 style="margin:0;font:600 20px/28px Inter,system-ui,sans-serif;color:#F0F4FC">Redémarrer «&nbsp;Spouleur d'impression&nbsp;» sur <span style="white-space:nowrap">PC-COMPTA-03 (BASH)&#8239;?</span></h2>
    <span style="font:400 12px/16px 'JetBrains Mono',ui-monospace,monospace;color:#828CAF">BASH · Windows 11 Pro 23H2 · 10.0.12.43</span>
  </div>
  <p style="margin:0;font:400 14px/20px Inter,system-ui,sans-serif;color:#B4BCD7">Les impressions en cours seront interrompues.</p>
  <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px">
    <a href="DeviceOverview.dc.html" style="display:flex;align-items:center;justify-content:center;gap:8px;height:48px;padding:0 20px;box-sizing:border-box;border:0;border-radius:8px;white-space:nowrap;cursor:pointer;font:500 14px/20px Inter,system-ui,sans-serif;background:#1D2238;color:#F0F4FC">Annuler</a>
    <a href="DeviceOverview.dc.html" style="display:flex;align-items:center;justify-content:center;gap:8px;height:48px;padding:0 20px;box-sizing:border-box;border:0;border-radius:8px;white-space:nowrap;cursor:pointer;font:500 14px/20px Inter,system-ui,sans-serif;background:#C83232;color:#FFFFFF;box-shadow:inset 0 1px 0 rgba(255,255,255,.10)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path></svg>Redémarrer</a>
  </div>
</section>
```

#### `sheet-group-header` — group overline in the "Agir" sheet (RÉPARER, ACCÉDER, ANALYSER, ALIMENTATION, AGENT, MAINTENANCE, ZONE SENSIBLE).
```html
<h3 style="margin:0;padding:14px 8px 4px;font:400 11px/14px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:#828CAF">Accéder</h3>
```

#### `sheet-action-item` — icon tile + label + one-line consequence.
```html
<a href="Terminal.dc.html" style="display:flex;align-items:center;gap:14px;min-height:56px;padding:6px 8px;box-sizing:border-box;border-radius:8px">
  <span style="flex:none;display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:6px;background:#1D2238;color:#B4BCD7"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="m7 11 2-2-2-2"></path><path d="M11 13h4"></path><rect width="18" height="18" x="3" y="3" rx="2" ry="2"></rect></svg></span>
  <span style="flex:1;min-width:0;display:flex;flex-direction:column"><span style="font:500 16px/22px Inter,system-ui,sans-serif;color:#F0F4FC">Terminal PowerShell</span><span style="font:400 12px/16px Inter,system-ui,sans-serif;color:#828CAF">Session SYSTÈME · clavier complet</span></span>
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#828CAF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="m9 18 6-6-6-6"></path></svg>
</a>
```

#### `sheet-action-item-disabled` — visible but disabled with the reason.
```html
<div aria-disabled="true" style="display:flex;align-items:center;gap:14px;min-height:56px;padding:6px 8px;box-sizing:border-box;border-radius:8px">
  <span style="flex:none;display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:6px;background:#181C30;color:#4B5273"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M12 2v10"></path><path d="M18.4 6.6a9 9 0 1 1-12.77.04"></path></svg></span>
  <span style="flex:1;min-width:0;display:flex;flex-direction:column"><span style="font:500 16px/22px Inter,system-ui,sans-serif;color:#4B5273">Redémarrer</span><span style="font:400 12px/16px Inter,system-ui,sans-serif;color:#828CAF">Votre équipe n'a pas le droit «&nbsp;Alimentation&nbsp;» sur cet appareil.</span></span>
</div>
```

#### `sheet-action-item-danger` — ZONE SENSIBLE items: #F87171 label, red-tinted tile.
```html
<a href="ActionSheet.dc.html" style="display:flex;align-items:center;gap:14px;min-height:56px;padding:6px 8px;box-sizing:border-box;border-radius:8px">
  <span style="flex:none;display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:6px;background:rgba(248,113,113,.10);color:#F87171"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M12 20h.01"></path><path d="M8.5 16.429a5 5 0 0 1 7 0"></path><path d="M5 12.859a10 10 0 0 1 5.17-2.69"></path><path d="M19 12.859a10 10 0 0 0-2.007-1.523"></path><path d="M2 8.82a15 15 0 0 1 4.177-2.643"></path><path d="M22 8.82a15 15 0 0 0-11.288-3.764"></path><path d="m2 2 20 20"></path></svg></span>
  <span style="flex:1;min-width:0;display:flex;flex-direction:column"><span style="font:500 16px/22px Inter,system-ui,sans-serif;color:#F87171">Isoler du réseau</span><span style="font:400 12px/16px Inter,system-ui,sans-serif;color:#828CAF">Seul le serveur Obliance restera joignable</span></span>
</a>
```

### 4.12 Inputs
#### `segmented` — segmented control (track surface1 on bg; use #0F1220 track when on a surface1 card). Selected #222740 + 600. Counts mono.
```html
<div role="tablist" aria-label="Contenu à traiter" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;height:44px;padding:3px;box-sizing:border-box;border-radius:8px;background:#131728">
  <button type="button" role="tab" aria-selected="true" style="display:flex;align-items:center;justify-content:center;gap:6px;min-width:0;padding:0 4px;border:0;border-radius:6px;background:#222740;color:#F0F4FC;font:600 14px/20px Inter,system-ui,sans-serif;white-space:nowrap;cursor:pointer;box-shadow:0 1px 2px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.04)">Alertes<span style="font:500 12px/16px 'JetBrains Mono',ui-monospace,monospace;color:#B4BCD7">5</span></button>
  <button type="button" role="tab" aria-selected="false" style="display:flex;align-items:center;justify-content:center;gap:6px;min-width:0;padding:0 4px;border:0;border-radius:6px;background:transparent;color:#828CAF;font:500 14px/20px Inter,system-ui,sans-serif;white-space:nowrap;cursor:pointer">Approbations<span style="font:500 12px/16px 'JetBrains Mono',ui-monospace,monospace;color:#828CAF">1</span></button>
  <button type="button" role="tab" aria-selected="false" style="display:flex;align-items:center;justify-content:center;gap:6px;min-width:0;padding:0 4px;border:0;border-radius:6px;background:transparent;color:#828CAF;font:500 14px/20px Inter,system-ui,sans-serif;white-space:nowrap;cursor:pointer">Enrôlements<span style="font:500 12px/16px 'JetBrains Mono',ui-monospace,monospace;color:#828CAF">1</span></button>
</div>
```

#### `segmented-mono` — period switch (24 h / 7 j / 30 j) inside cards.
```html
<div role="tablist" aria-label="Période" style="display:inline-grid;grid-template-columns:repeat(3,56px);gap:4px;height:44px;padding:3px;box-sizing:border-box;border-radius:8px;background:#181C30">
  <button type="button" role="tab" aria-selected="true" style="display:flex;align-items:center;justify-content:center;gap:6px;min-width:0;padding:0 4px;border:0;border-radius:6px;background:#222740;color:#F0F4FC;font:500 12px/16px 'JetBrains Mono',ui-monospace,monospace;white-space:nowrap;cursor:pointer;box-shadow:0 1px 2px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.04)">24 h</button>
  <button type="button" role="tab" aria-selected="false" style="display:flex;align-items:center;justify-content:center;gap:6px;min-width:0;padding:0 4px;border:0;border-radius:6px;background:transparent;color:#828CAF;font:500 12px/16px 'JetBrains Mono',ui-monospace,monospace;white-space:nowrap;cursor:pointer">7 j</button>
  <button type="button" role="tab" aria-selected="false" style="display:flex;align-items:center;justify-content:center;gap:6px;min-width:0;padding:0 4px;border:0;border-radius:6px;background:transparent;color:#828CAF;font:500 12px/16px 'JetBrains Mono',ui-monospace,monospace;white-space:nowrap;cursor:pointer">30 j</button>
</div>
```

#### `search-field` — search bar (full radius). The placeholder color comes from the helmet.
```html
<div style="display:flex;align-items:center;height:48px;padding:0 4px 0 16px;box-sizing:border-box;border-radius:24px;background:#181C30">
  <label style="flex:1;min-width:0;display:flex;align-items:center;gap:12px;height:100%">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#828CAF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg>
    <span style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap">Rechercher un appareil</span>
    <input type="text" placeholder="Nom, IP, MAC, utilisateur…" style="flex:1;min-width:0;height:100%;padding:0;border:0;outline:none;background:transparent;color:#F0F4FC;font:400 16px/24px Inter,system-ui,sans-serif">
  </label>
  <button type="button" aria-label="Scanner un QR code" style="display:flex;align-items:center;justify-content:center;width:48px;height:48px;padding:0;border:0;border-radius:24px;background:transparent;color:#B4BCD7;cursor:pointer;width:44px;height:44px"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><rect width="5" height="5" x="3" y="3" rx="1"></rect><rect width="5" height="5" x="16" y="3" rx="1"></rect><rect width="5" height="5" x="3" y="16" rx="1"></rect><path d="M21 16h-3a2 2 0 0 0-2 2v3"></path><path d="M21 21v.01"></path><path d="M12 7v3a2 2 0 0 1-2 2H7"></path><path d="M3 12h.01"></path><path d="M12 3h.01"></path><path d="M12 16v.01"></path><path d="M16 12h1"></path><path d="M21 12v.01"></path><path d="M12 21v-1"></path></svg></button>
</div>
```

#### `chip-filter` — unselected filter chip (36px visual in a 44px button), optional status dot + mono count.
```html
<button type="button" aria-pressed="false" style="flex:none;display:inline-flex;align-items:center;height:44px;padding:0;border:0;background:transparent;cursor:pointer"><span style="display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 12px;border-radius:8px;background:#181C30;color:#B4BCD7;font:500 14px/20px Inter,system-ui,sans-serif;white-space:nowrap"><span style="flex:none;width:6px;height:6px;border-radius:50%;background:#9CA3AF"></span>Hors ligne<span style="font:500 12px/16px 'JetBrains Mono',ui-monospace,monospace;color:#828CAF">16</span></span></button>
```

#### `chip-filter-selected` — selected: #222740 + check + 600 (never red).
```html
<button type="button" aria-pressed="true" style="flex:none;display:inline-flex;align-items:center;height:44px;padding:0;border:0;background:transparent;cursor:pointer"><span style="display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 12px;border-radius:8px;background:#222740;color:#F0F4FC;font:600 14px/20px Inter,system-ui,sans-serif;white-space:nowrap"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M20 6 9 17l-5-5"></path></svg>Problèmes d'abord</span></button>
```

#### `chip-dropdown` — dropdown chip (tenant scope, group).
```html
<button type="button" aria-haspopup="listbox" style="flex:none;display:inline-flex;align-items:center;height:44px;padding:0;border:0;background:transparent;cursor:pointer"><span style="display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 8px 0 12px;border-radius:8px;background:#181C30;color:#B4BCD7;font:500 14px/20px Inter,system-ui,sans-serif;white-space:nowrap">Tous les tenants<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#828CAF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="m6 9 6 6 6-6"></path></svg></span></button>
```

#### `chip-row` — horizontal chip row with 16px gutter (overflow hidden = scrollable).
```html
<div style="display:flex;gap:8px;padding:0 16px;overflow:hidden">
  <button type="button" aria-pressed="true" style="flex:none;display:inline-flex;align-items:center;height:44px;padding:0;border:0;background:transparent;cursor:pointer"><span style="display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 12px;border-radius:8px;background:#222740;color:#F0F4FC;font:600 14px/20px Inter,system-ui,sans-serif;white-space:nowrap"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M20 6 9 17l-5-5"></path></svg>Problèmes d'abord</span></button>
  <button type="button" aria-pressed="false" style="flex:none;display:inline-flex;align-items:center;height:44px;padding:0;border:0;background:transparent;cursor:pointer"><span style="display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 12px;border-radius:8px;background:#181C30;color:#B4BCD7;font:500 14px/20px Inter,system-ui,sans-serif;white-space:nowrap"><span style="flex:none;width:6px;height:6px;border-radius:50%;background:#9CA3AF"></span>Hors ligne<span style="font:500 12px/16px 'JetBrains Mono',ui-monospace,monospace;color:#828CAF">16</span></span></button>
  <button type="button" aria-pressed="false" style="flex:none;display:inline-flex;align-items:center;height:44px;padding:0;border:0;background:transparent;cursor:pointer"><span style="display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 12px;border-radius:8px;background:#181C30;color:#B4BCD7;font:500 14px/20px Inter,system-ui,sans-serif;white-space:nowrap"><span style="flex:none;width:6px;height:6px;border-radius:50%;background:#F87171"></span>Critique<span style="font:500 12px/16px 'JetBrains Mono',ui-monospace,monospace;color:#828CAF">1</span></span></button>
  <button type="button" aria-pressed="false" style="flex:none;display:inline-flex;align-items:center;height:44px;padding:0;border:0;background:transparent;cursor:pointer"><span style="display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 12px;border-radius:8px;background:#181C30;color:#B4BCD7;font:500 14px/20px Inter,system-ui,sans-serif;white-space:nowrap"><span style="flex:none;width:6px;height:6px;border-radius:50%;background:#FACC15"></span>Attention<span style="font:500 12px/16px 'JetBrains Mono',ui-monospace,monospace;color:#828CAF">5</span></span></button>
</div>
```

#### `switch-on` — track #4F7BFF, thumb white with check. 60×48 hit area.
```html
<button type="button" role="switch" aria-checked="true" aria-label="Verrou biométrique" style="flex:none;display:flex;align-items:center;justify-content:center;width:60px;height:48px;padding:0;border:0;background:transparent;cursor:pointer"><span style="position:relative;display:block;width:52px;height:32px;border-radius:16px;background:#4F7BFF"><span style="position:absolute;top:4px;left:24px;display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:#FFFFFF;color:#4F7BFF;box-shadow:0 1px 3px rgba(0,0,0,.4)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M20 6 9 17l-5-5"></path></svg></span></span></button>
```

#### `switch-off` — track #2A3048, thumb #828CAF 16px.
```html
<button type="button" role="switch" aria-checked="false" aria-label="Nuit automatique" style="flex:none;display:flex;align-items:center;justify-content:center;width:60px;height:48px;padding:0;border:0;background:transparent;cursor:pointer"><span style="position:relative;display:block;width:52px;height:32px;border-radius:16px;background:#2A3048"><span style="position:absolute;top:8px;left:8px;width:16px;height:16px;border-radius:50%;background:#828CAF"></span></span></button>
```

#### `text-field` — filled field without border: surface2, radius 6, 56px, floating label 12px, value 16px, helper below.
```html
<label style="display:block">
  <span style="display:flex;flex-direction:column;justify-content:center;height:56px;padding:0 12px;box-sizing:border-box;border-radius:6px;background:#181C30">
    <span style="font:400 12px/16px Inter,system-ui,sans-serif;color:#828CAF">Adresse du serveur</span>
    <input type="text" value="rmm.votre-msp.fr" style="width:100%;padding:0;border:0;outline:none;background:transparent;color:#F0F4FC;font:400 16px/24px Inter,system-ui,sans-serif">
  </span>
  <span style="display:block;padding:6px 12px 0;font:400 12px/16px Inter,system-ui,sans-serif;color:#828CAF">HTTPS obligatoire</span>
</label>
```

#### `text-field-focused` — focus = 2px #FF6868 ring.
```html
<label style="display:block">
  <span style="display:flex;flex-direction:column;justify-content:center;height:56px;padding:0 12px;box-sizing:border-box;border-radius:6px;background:#181C30;box-shadow:0 0 0 2px #FF6868">
    <span style="font:400 12px/16px Inter,system-ui,sans-serif;color:#828CAF">Identifiant</span>
    <input type="text" value="og_karim.benali" style="width:100%;padding:0;border:0;outline:none;background:transparent;color:#F0F4FC;font:400 16px/24px Inter,system-ui,sans-serif">
  </span>
  
</label>
```

#### `text-field-error` — error = 2px #F87171 bottom bar + message with circle-alert.
```html
<label style="display:block">
  <span style="display:flex;flex-direction:column;justify-content:center;height:56px;padding:0 12px;box-sizing:border-box;border-radius:6px;background:#181C30;box-shadow:inset 0 -2px 0 #F87171">
    <span style="font:400 12px/16px Inter,system-ui,sans-serif;color:#F87171">Mot de passe</span>
    <input type="password" value="motdepasse" style="width:100%;padding:0;border:0;outline:none;background:transparent;color:#F0F4FC;font:400 16px/24px Inter,system-ui,sans-serif">
  </span>
  <span style="display:flex;align-items:flex-start;gap:6px;padding:6px 12px 0;font:400 12px/16px Inter,system-ui,sans-serif;color:#F87171"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none;margin-top:1px"><circle cx="12" cy="12" r="10"></circle><line x1="12" x2="12" y1="8" y2="12"></line><line x1="12" x2="12.01" y1="16" y2="16"></line></svg>Identifiant ou mot de passe incorrect.</span>
</label>
```

#### `otp-field` — 6 cells 48×56, mono 500 24, focused cell ring #FF6868.
```html
<div role="group" aria-label="Code à 6 chiffres" style="display:flex;justify-content:center;gap:8px"><input type="text" inputmode="numeric" maxlength="1" value="4" aria-label="Chiffre 1 sur 6" style="width:48px;height:56px;box-sizing:border-box;padding:0;border:0;border-radius:6px;outline:none;background:#181C30;color:#F0F4FC;text-align:center;font:500 24px/32px 'JetBrains Mono',ui-monospace,monospace"><input type="text" inputmode="numeric" maxlength="1" value="8" aria-label="Chiffre 2 sur 6" style="width:48px;height:56px;box-sizing:border-box;padding:0;border:0;border-radius:6px;outline:none;background:#181C30;color:#F0F4FC;text-align:center;font:500 24px/32px 'JetBrains Mono',ui-monospace,monospace"><input type="text" inputmode="numeric" maxlength="1" value="2" aria-label="Chiffre 3 sur 6" style="width:48px;height:56px;box-sizing:border-box;padding:0;border:0;border-radius:6px;outline:none;background:#181C30;color:#F0F4FC;text-align:center;font:500 24px/32px 'JetBrains Mono',ui-monospace,monospace"><input type="text" inputmode="numeric" maxlength="1" value="" aria-label="Chiffre 4 sur 6" style="width:48px;height:56px;box-sizing:border-box;padding:0;border:0;border-radius:6px;outline:none;background:#181C30;color:#F0F4FC;text-align:center;font:500 24px/32px 'JetBrains Mono',ui-monospace,monospace;box-shadow:0 0 0 2px #FF6868"><input type="text" inputmode="numeric" maxlength="1" value="" aria-label="Chiffre 5 sur 6" style="width:48px;height:56px;box-sizing:border-box;padding:0;border:0;border-radius:6px;outline:none;background:#181C30;color:#F0F4FC;text-align:center;font:500 24px/32px 'JetBrains Mono',ui-monospace,monospace"><input type="text" inputmode="numeric" maxlength="1" value="" aria-label="Chiffre 6 sur 6" style="width:48px;height:56px;box-sizing:border-box;padding:0;border:0;border-radius:6px;outline:none;background:#181C30;color:#F0F4FC;text-align:center;font:500 24px/32px 'JetBrains Mono',ui-monospace,monospace"></div>
```

#### `checkbox` — checked = #4F7BFF fill; unchecked = `background:transparent;box-shadow:inset 0 0 0 2px #4B5273`.
```html
<label style="display:flex;align-items:flex-start;gap:12px;min-height:44px;padding:10px 0;box-sizing:border-box;cursor:pointer">
  <input type="checkbox" checked style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap">
  <span aria-hidden="true" style="flex:none;display:flex;align-items:center;justify-content:center;width:20px;height:20px;margin-top:2px;border-radius:4px;background:#4F7BFF;color:#FFFFFF"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M20 6 9 17l-5-5"></path></svg></span>
  <span style="display:flex;flex-direction:column;gap:2px"><span style="font:400 14px/20px Inter,system-ui,sans-serif;color:#F0F4FC">Ne plus demander depuis cette adresse IP pendant 24&#8239;h</span><span style="font:400 12px/16px 'JetBrains Mono',ui-monospace,monospace;color:#828CAF">IP actuelle : 92.184.107.21</span></span>
</label>
```

### 4.13 Feedback
#### `snackbar` — snackbar (#222740, radius 8, E2). Place in `<div style="position:absolute;left:16px;right:16px;bottom:96px">` (above nav) or `bottom:80px` above the action bar.
```html
<div role="status" style="display:flex;align-items:center;gap:12px;min-height:48px;padding:4px 4px 4px 16px;box-sizing:border-box;border-radius:8px;background:#222740;box-shadow:0 -8px 32px -8px rgba(0,0,0,.55),0 8px 24px -8px rgba(0,0,0,.5)">
  <span style="flex:1;min-width:0;font:400 14px/20px Inter,system-ui,sans-serif;color:#F0F4FC">Alerte supprimée</span>
  <button type="button" style="flex:none;height:44px;padding:0 12px;border:0;border-radius:6px;background:transparent;color:#FF6868;font:600 14px/20px Inter,system-ui,sans-serif;cursor:pointer">Annuler</button>
</div>
```

#### `snackbar-success` — with leading status icon.
```html
<div role="status" style="display:flex;align-items:center;gap:12px;min-height:48px;padding:4px 4px 4px 14px;box-sizing:border-box;border-radius:8px;background:#222740;box-shadow:0 -8px 32px -8px rgba(0,0,0,.55),0 8px 24px -8px rgba(0,0,0,.5)">
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4ADE80" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><circle cx="12" cy="12" r="10"></circle><path d="m9 12 2 2 4-4"></path></svg>
  <span style="flex:1;min-width:0;font:400 14px/20px Inter,system-ui,sans-serif;color:#F0F4FC">Vous travaillez maintenant dans BASH</span>
  <button type="button" style="flex:none;height:44px;padding:0 12px;border:0;border-radius:6px;background:transparent;color:#FF6868;font:600 14px/20px Inter,system-ui,sans-serif;cursor:pointer">Revenir</button>
</div>
```

#### `session-pill` — SessionPill floating 8px above the nav: `<div style="position:absolute;left:16px;right:16px;bottom:88px">…</div>`.
```html
<a href="Terminal.dc.html" aria-label="Reprendre la session PowerShell sur PC-COMPTA-03 — 2 sessions ouvertes" style="display:flex;align-items:center;gap:10px;height:48px;padding:0 10px 0 14px;box-sizing:border-box;border-radius:24px;background:#1D2238;box-shadow:0 -8px 32px -8px rgba(0,0,0,.55),0 8px 24px -8px rgba(0,0,0,.6)">
  <span style="position:relative;flex:none;color:#F0F4FC"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="m7 11 2-2-2-2"></path><path d="M11 13h4"></path><rect width="18" height="18" x="3" y="3" rx="2" ry="2"></rect></svg><span style="position:absolute;right:-3px;bottom:-3px;width:8px;height:8px;border-radius:50%;background:#4ADE80;box-shadow:0 0 0 2px #1D2238"></span></span>
  <span style="flex:none;font:600 14px/20px Inter,system-ui,sans-serif;color:#F0F4FC">2 sessions</span>
  <span style="flex:1;min-width:0;font:400 12px/16px 'JetBrains Mono',ui-monospace,monospace;color:#B4BCD7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">PowerShell · PC-COMPTA-03</span>
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#828CAF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="m9 18 6-6-6-6"></path></svg>
</a>
```

#### `empty-state` — icon in a 64px surface1 disc + one sentence + one action.
```html
<div style="display:flex;flex-direction:column;align-items:center;gap:14px;padding:32px 24px;text-align:center">
  <span style="display:flex;align-items:center;justify-content:center;width:64px;height:64px;border-radius:50%;background:#131728;color:#828CAF;box-shadow:0 6px 24px -8px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.03)"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><line x1="21" x2="14" y1="4" y2="4"></line><line x1="10" x2="3" y1="4" y2="4"></line><line x1="21" x2="12" y1="12" y2="12"></line><line x1="8" x2="3" y1="12" y2="12"></line><line x1="21" x2="16" y1="20" y2="20"></line><line x1="12" x2="3" y1="20" y2="20"></line><line x1="14" x2="14" y1="2" y2="6"></line><line x1="8" x2="8" y1="10" y2="14"></line><line x1="16" x2="16" y1="18" y2="22"></line></svg></span>
  <p style="margin:0;max-width:280px;font:400 16px/24px Inter,system-ui,sans-serif;color:#B4BCD7">Aucun appareil ne correspond à vos filtres.</p>
  <button type="button" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:48px;padding:0 20px;box-sizing:border-box;border:0;border-radius:8px;white-space:nowrap;cursor:pointer;font:500 14px/20px Inter,system-ui,sans-serif;background:#1D2238;color:#F0F4FC">Effacer les filtres</button>
</div>
```

#### `empty-triage` — calm empty state of À traiter (flat #1EDD8A line at 30 %).
```html
<div style="display:flex;flex-direction:column;align-items:center;gap:10px;padding:40px 16px;text-align:center">
  <svg width="200" height="24" viewBox="0 0 200 24" aria-hidden="true" style="display:block"><defs><linearGradient id="calm-line-1" x1="0" y1="0" x2="200" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#1EDD8A" stop-opacity="0"></stop><stop offset=".5" stop-color="#1EDD8A" stop-opacity=".3"></stop><stop offset="1" stop-color="#1EDD8A" stop-opacity="0"></stop></linearGradient></defs><path d="M0 12H200" stroke="url(#calm-line-1)" stroke-width="2" stroke-linecap="round"></path></svg>
  <p style="margin:6px 0 0;font:600 28px/32px Rajdhani,Inter,sans-serif;letter-spacing:.025em;color:#F0F4FC">Rien à traiter.</p>
  <p style="margin:0;font:400 12px/16px 'JetBrains Mono',ui-monospace,monospace;color:#828CAF">Dernière vérification 03:20 · temps réel actif</p>
</div>
```

### 4.14 Terminal key bar
#### `key-bar` — KeyBar: 44px keys on surface2, mono 13. Modifier one-shot = #FF6868 label; locked = #C83232 fill + underline. Page dots below.
```html
<div style="display:flex;flex-direction:column;gap:4px;padding:6px 0 4px;background:#0F1220">
  <div style="display:flex;gap:6px;padding:0 8px;overflow:hidden"><button type="button" style="flex:none;min-width:44px;height:44px;padding:0 10px;box-sizing:border-box;border:0;border-radius:6px;background:#181C30;color:#D6DCEB;font:400 13px/16px 'JetBrains Mono',ui-monospace,monospace;cursor:pointer">Échap</button><button type="button" style="flex:none;min-width:44px;height:44px;padding:0 10px;box-sizing:border-box;border:0;border-radius:6px;background:#181C30;color:#D6DCEB;font:400 13px/16px 'JetBrains Mono',ui-monospace,monospace;cursor:pointer">Tab</button><button type="button" style="flex:none;min-width:44px;height:44px;padding:0 10px;box-sizing:border-box;border:0;border-radius:6px;background:#181C30;color:#FF6868;font:600 13px/16px 'JetBrains Mono',ui-monospace,monospace;cursor:pointer">Ctrl</button><button type="button" style="flex:none;min-width:44px;height:44px;padding:0 10px;box-sizing:border-box;border:0;border-radius:6px;background:#C83232;color:#FFFFFF;font:600 13px/16px 'JetBrains Mono',ui-monospace,monospace;cursor:pointer;text-decoration:underline;text-underline-offset:3px;text-decoration-thickness:2px">Alt</button><button type="button" style="flex:none;min-width:44px;height:44px;padding:0 10px;box-sizing:border-box;border:0;border-radius:6px;background:#181C30;color:#D6DCEB;font:400 13px/16px 'JetBrains Mono',ui-monospace,monospace;cursor:pointer">↑</button><button type="button" style="flex:none;min-width:44px;height:44px;padding:0 10px;box-sizing:border-box;border:0;border-radius:6px;background:#181C30;color:#D6DCEB;font:400 13px/16px 'JetBrains Mono',ui-monospace,monospace;cursor:pointer">↓</button><button type="button" style="flex:none;min-width:44px;height:44px;padding:0 10px;box-sizing:border-box;border:0;border-radius:6px;background:#181C30;color:#D6DCEB;font:400 13px/16px 'JetBrains Mono',ui-monospace,monospace;cursor:pointer">←</button><button type="button" style="flex:none;min-width:44px;height:44px;padding:0 10px;box-sizing:border-box;border:0;border-radius:6px;background:#181C30;color:#D6DCEB;font:400 13px/16px 'JetBrains Mono',ui-monospace,monospace;cursor:pointer">→</button><button type="button" style="flex:none;min-width:44px;height:44px;padding:0 10px;box-sizing:border-box;border:0;border-radius:6px;background:#181C30;color:#D6DCEB;font:400 13px/16px 'JetBrains Mono',ui-monospace,monospace;cursor:pointer">|</button><button type="button" style="flex:none;min-width:44px;height:44px;padding:0 10px;box-sizing:border-box;border:0;border-radius:6px;background:#181C30;color:#D6DCEB;font:400 13px/16px 'JetBrains Mono',ui-monospace,monospace;cursor:pointer">~</button></div>
  <div aria-hidden="true" style="display:flex;justify-content:center;gap:6px"><span style="width:6px;height:6px;border-radius:50%;background:#B4BCD7"></span><span style="width:6px;height:6px;border-radius:50%;background:#4B5273"></span><span style="width:6px;height:6px;border-radius:50%;background:#4B5273"></span><span style="width:6px;height:6px;border-radius:50%;background:#4B5273"></span></div>
</div>
```

### 4.15 Logo
#### `logo-mark` — Ance mark (the "O"). 28px in bars, 64px on the lock screen. Change the id suffix (`-a`) for each extra copy on the same artboard. Never recolor.
```html
<svg width="28" height="28" viewBox="0 0 122.88 122.88" role="img" aria-label="Obliance" style="display:block;flex:none"><defs><linearGradient id="obm-a-a" x1="100.79" y1="22.04" x2="51.77" y2="110.5" gradientUnits="userSpaceOnUse"><stop offset=".11" stop-color="#c2001b"></stop><stop offset=".56" stop-color="#d28c7f"></stop><stop offset=".65" stop-color="#c0695f"></stop><stop offset=".87" stop-color="#941210"></stop><stop offset=".91" stop-color="#8b0000"></stop></linearGradient><linearGradient id="obm-b-a" x1="20.66" y1="114.33" x2="63.21" y2="-2.64" gradientUnits="userSpaceOnUse"><stop offset=".08" stop-color="#c2001b"></stop><stop offset=".17" stop-color="#c41328"></stop><stop offset=".34" stop-color="#c9444b"></stop><stop offset=".56" stop-color="#d28c7f"></stop><stop offset=".59" stop-color="#cc8175"></stop><stop offset=".87" stop-color="#9d2421"></stop><stop offset="1" stop-color="#8b0000"></stop></linearGradient></defs><path fill="url(#obm-a-a)" d="M122.88,61.44c0,33.93-27.51,61.44-61.44,61.44h-.08c-20.87-10.92-35.66-31.91-37.87-56.52,2.47,19.24,19.25,33.99,39.34,33.23,19.73-.75,35.83-16.78,36.66-36.5.65-15.47-7.91-29.02-20.65-35.6-.33-.17-.66-.34-1-.49-.66-.33-1.33-.62-2.02-.91-4.46-1.82-9.35-2.83-14.47-2.83-1.13,0-2.25.05-3.36.15-2.6.22-5.13.72-7.56,1.44-.17.05-.35.1-.51.16-.17.05-.35.1-.51.16t.03-.03s.02-.02.03-.03c.02-.02.03-.03.05-.05.04-.04.09-.09.16-.16.06-.06.13-.13.21-.2.16-.15.35-.33.58-.53,0,0,.03-.02.03-.03.23-.2.49-.43.79-.69.78-.66,1.78-1.46,2.98-2.32.97-.68,2.06-1.41,3.28-2.15.6-.36,1.25-.72,1.92-1.09.25-.13.51-.27.77-.4.39-.2.78-.4,1.19-.6.41-.19.82-.39,1.24-.58.4-.17.8-.35,1.22-.51.22-.09.43-.17.66-.26.27-.1.53-.21.8-.3.18-.07.37-.14.56-.2.4-.14.8-.28,1.22-.41.03-.02.06-.03.09-.03.53-.16,1.07-.32,1.61-.47.4-.11.79-.21,1.2-.3,1.01-.24,2.05-.45,3.12-.61.39-.06.78-.11,1.18-.16.08,0,.16-.02.23-.03.44-.05.89-.09,1.34-.13h0c4.18-.13,10.67.22,17.98,2.89,8.65,3.17,14.03,8.44,17.36,12.27,1.29,1.48,2.69,2.96,3.74,4.61,1.92,3.02,4.1,6.91,5.49,11.72,0,0,2.4,8.34,2.4,17.04Z"></path><path fill="url(#obm-b-a)" d="M23.2,60.34c-.02.36-.03.73-.03,1.1,0,1.65.1,3.27.31,4.86,0,.02,0,.03,0,.05v.04c2.23,24.59,17.01,45.57,37.87,56.48-15.23-.02-29.16-5.58-39.89-14.78C8.19,96.72-.17,79.76,0,60.84.3,29.35,24.71,3.31,55.45.3h0c1.98-.21,3.99-.3,6.01-.3,9.64,0,18.77,2.23,26.89,6.19-3.38-.85-21.87-5.11-39.49,6.12-12.5,7.97-16.61,22.22-18.35,26.59-4.42,6.03-7.1,13.4-7.32,21.39v.04Z"></path></svg>
```

#### `logo-wordmark` — dark wordmark ("bli" crimson, "ance" white): S01, tablet rail header, S86. Height 32 → width 137.9.
```html
<svg width="138" height="32" viewBox="0 0 529.75 122.88" role="img" aria-label="Obliance" style="display:block;flex:none"><defs><linearGradient id="obw-a-a" x1="100.79" y1="22.04" x2="51.77" y2="110.5" gradientUnits="userSpaceOnUse"><stop offset=".11" stop-color="#c2001b"></stop><stop offset=".56" stop-color="#d28c7f"></stop><stop offset=".65" stop-color="#c0695f"></stop><stop offset=".87" stop-color="#941210"></stop><stop offset=".91" stop-color="#8b0000"></stop></linearGradient><linearGradient id="obw-b-a" x1="20.66" y1="114.33" x2="63.21" y2="-2.64" gradientUnits="userSpaceOnUse"><stop offset=".08" stop-color="#c2001b"></stop><stop offset=".17" stop-color="#c41328"></stop><stop offset=".34" stop-color="#c9444b"></stop><stop offset=".56" stop-color="#d28c7f"></stop><stop offset=".59" stop-color="#cc8175"></stop><stop offset=".87" stop-color="#9d2421"></stop><stop offset="1" stop-color="#8b0000"></stop></linearGradient></defs><path fill="url(#obw-a-a)" d="M122.88,61.44c0,33.93-27.51,61.44-61.44,61.44h-.08c-20.87-10.92-35.66-31.91-37.87-56.52,2.47,19.24,19.25,33.99,39.34,33.23,19.73-.75,35.83-16.78,36.66-36.5.65-15.47-7.91-29.02-20.65-35.6-.33-.17-.66-.34-1-.49-.66-.33-1.33-.62-2.02-.91-4.46-1.82-9.35-2.83-14.47-2.83-1.13,0-2.25.05-3.36.15-2.6.22-5.13.72-7.56,1.44-.17.05-.35.1-.51.16-.17.05-.35.1-.51.16t.03-.03s.02-.02.03-.03c.02-.02.03-.03.05-.05.04-.04.09-.09.16-.16.06-.06.13-.13.21-.2.16-.15.35-.33.58-.53,0,0,.03-.02.03-.03.23-.2.49-.43.79-.69.78-.66,1.78-1.46,2.98-2.32.97-.68,2.06-1.41,3.28-2.15.6-.36,1.25-.72,1.92-1.09.25-.13.51-.27.77-.4.39-.2.78-.4,1.19-.6.41-.19.82-.39,1.24-.58.4-.17.8-.35,1.22-.51.22-.09.43-.17.66-.26.27-.1.53-.21.8-.3.18-.07.37-.14.56-.2.4-.14.8-.28,1.22-.41.03-.02.06-.03.09-.03.53-.16,1.07-.32,1.61-.47.4-.11.79-.21,1.2-.3,1.01-.24,2.05-.45,3.12-.61.39-.06.78-.11,1.18-.16.08,0,.16-.02.23-.03.44-.05.89-.09,1.34-.13h0c4.18-.13,10.67.22,17.98,2.89,8.65,3.17,14.03,8.44,17.36,12.27,1.29,1.48,2.69,2.96,3.74,4.61,1.92,3.02,4.1,6.91,5.49,11.72,0,0,2.4,8.34,2.4,17.04Z"></path><path fill="url(#obw-b-a)" d="M23.2,60.34c-.02.36-.03.73-.03,1.1,0,1.65.1,3.27.31,4.86,0,.02,0,.03,0,.05v.04c2.23,24.59,17.01,45.57,37.87,56.48-15.23-.02-29.16-5.58-39.89-14.78C8.19,96.72-.17,79.76,0,60.84.3,29.35,24.71,3.31,55.45.3h0c1.98-.21,3.99-.3,6.01-.3,9.64,0,18.77,2.23,26.89,6.19-3.38-.85-21.87-5.11-39.49,6.12-12.5,7.97-16.61,22.22-18.35,26.59-4.42,6.03-7.1,13.4-7.32,21.39v.04Z"></path><g fill="#c2001b"><path d="M199.09,74.73c0,20.35-9.68,31.24-32.78,31.24-10.34,0-20.02-1.98-29.15-6.16V21.27h11.77v32.45c6.16-7.26,13.86-10.45,23.98-10.45,17.16,0,26.18,11.22,26.18,31.46ZM187.1,74.84c0-13.53-4.95-21.12-17.82-21.12-9.57,0-15.84,5.06-20.35,12.43v26.73c5.94,1.76,12.43,2.64,18.04,2.86,13.86,0,20.13-7.26,20.13-20.9Z"></path><path d="M212.73,21.27h11.66v83.6h-11.66V21.27Z"></path><path d="M239.46,27.76c0-4.18,2.53-6.71,7.7-6.71s7.7,2.53,7.7,6.71-2.64,6.82-7.7,6.82-7.7-2.53-7.7-6.82ZM241.33,44.37h11.66v60.5h-11.66s0-60.5,0-60.5Z"></path></g><g fill="#ffffff"><path d="M322.4,68.35v36.52h-9.79l-1.54-10.01c-5.72,7.15-13.86,11.11-26.18,11.11-13.2,0-19.91-5.17-19.91-16.83s7.37-15.84,21.34-17.38l24.42-2.86v-1.65c0-10.23-4.95-12.87-15.84-12.87h-23.98l1.54-10.01h23.1c18.92,0,26.84,6.27,26.84,23.98ZM310.74,84.74v-7.81l-21.23,2.64c-8.8,1.21-12.54,2.97-12.54,8.91s3.3,8.47,10.89,8.47c10.34,0,17.93-4.18,22.88-12.21Z"></path><path d="M397.09,67.36v37.51h-11.66v-36.3c0-10.34-3.52-14.74-14.3-14.74-9.68,0-16.28,4.18-20.79,11.77v39.27h-11.66v-60.5h9.79l1.43,9.24c6.05-7.48,13.42-10.34,23.65-10.34,15.4,0,23.54,6.82,23.54,24.09Z"></path><path d="M410.18,74.62c0-20.35,11.22-30.25,32.78-30.25h17.16l1.65,10.01h-18.92c-13.97,0-20.68,6.38-20.68,20.24s6.71,20.24,20.68,20.24h19.14l-1.54,10.01h-17.49c-21.56,0-32.78-9.9-32.78-30.25Z"></path><path d="M529.75,79.02h-47.85c1.43,10.89,8.36,15.84,20.24,15.84h23.1l-1.54,10.01h-21.56c-21.01,0-32.45-9.9-32.45-30.25s10.78-31.35,30.58-31.35,29.48,8.58,29.48,29.59c0,0,0,6.16,0,6.16ZM517.98,69.78c0-11.88-5.94-16.61-17.71-16.61s-17.27,4.73-18.37,16.61h36.08Z"></path></g></svg>
```

#### `logo-mono` — monochrome mark (notification-style), fill = currentColor.
```html
<svg width="24" height="24" viewBox="0 0 122.88 122.88" aria-hidden="true" style="display:block;flex:none;color:#F0F4FC"><path fill="currentColor" d="M122.88,61.44c0,33.93-27.51,61.44-61.44,61.44h-.08c-20.87-10.92-35.66-31.91-37.87-56.52,2.47,19.24,19.25,33.99,39.34,33.23,19.73-.75,35.83-16.78,36.66-36.5.65-15.47-7.91-29.02-20.65-35.6-.33-.17-.66-.34-1-.49-.66-.33-1.33-.62-2.02-.91-4.46-1.82-9.35-2.83-14.47-2.83-1.13,0-2.25.05-3.36.15-2.6.22-5.13.72-7.56,1.44-.17.05-.35.1-.51.16-.17.05-.35.1-.51.16t.03-.03s.02-.02.03-.03c.02-.02.03-.03.05-.05.04-.04.09-.09.16-.16.06-.06.13-.13.21-.2.16-.15.35-.33.58-.53,0,0,.03-.02.03-.03.23-.2.49-.43.79-.69.78-.66,1.78-1.46,2.98-2.32.97-.68,2.06-1.41,3.28-2.15.6-.36,1.25-.72,1.92-1.09.25-.13.51-.27.77-.4.39-.2.78-.4,1.19-.6.41-.19.82-.39,1.24-.58.4-.17.8-.35,1.22-.51.22-.09.43-.17.66-.26.27-.1.53-.21.8-.3.18-.07.37-.14.56-.2.4-.14.8-.28,1.22-.41.03-.02.06-.03.09-.03.53-.16,1.07-.32,1.61-.47.4-.11.79-.21,1.2-.3,1.01-.24,2.05-.45,3.12-.61.39-.06.78-.11,1.18-.16.08,0,.16-.02.23-.03.44-.05.89-.09,1.34-.13h0c4.18-.13,10.67.22,17.98,2.89,8.65,3.17,14.03,8.44,17.36,12.27,1.29,1.48,2.69,2.96,3.74,4.61,1.92,3.02,4.1,6.91,5.49,11.72,0,0,2.4,8.34,2.4,17.04Z"></path><path fill="currentColor" d="M23.2,60.34c-.02.36-.03.73-.03,1.1,0,1.65.1,3.27.31,4.86,0,.02,0,.03,0,.05v.04c2.23,24.59,17.01,45.57,37.87,56.48-15.23-.02-29.16-5.58-39.89-14.78C8.19,96.72-.17,79.76,0,60.84.3,29.35,24.71,3.31,55.45.3h0c1.98-.21,3.99-.3,6.01-.3,9.64,0,18.77,2.23,26.89,6.19-3.38-.85-21.87-5.11-39.49,6.12-12.5,7.97-16.61,22.22-18.35,26.59-4.42,6.03-7.1,13.4-7.32,21.39v.04Z"></path></svg>
```

## 5. Icons (Lucide, stroke 2, 24 grid)
Template (set `width`/`height` to 24 nav · 20–22 bars · 16–18 buttons · 12–14 inline; color via `stroke` or parent `color`):
```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none">…inner…</svg>
```
OS icons: Windows `monitor`, macOS `apple`, Linux `terminal`, FreeBSD `shield`, other `monitor`. Names follow current Lucide; the repo ships lucide 0.344 (file name in parentheses when different).

| Name | Use | Markup |
|---|---|---|
| `siren` | Nav : À traiter | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M7 18v-6a5 5 0 1 1 10 0v6"></path><path d="M5 21a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2z"></path><path d="M21 12h1"></path><path d="M18.5 4.5 18 5"></path><path d="M2 12h1"></path><path d="M12 2v1"></path><path d="m4.929 4.929.707.707"></path><path d="M12 12v6"></path></svg>` |
| `monitor` | Nav : Appareils ; OS Windows / autre | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><rect width="20" height="14" x="2" y="3" rx="2"></rect><line x1="8" x2="16" y1="21" y2="21"></line><line x1="12" x2="12" y1="17" y2="21"></line></svg>` |
| `activity` | Nav : Activité | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M22 12h-4l-3 9L9 3l-3 9H2"></path></svg>` |
| `layout-dashboard` | Nav : Flotte | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><rect width="7" height="9" x="3" y="3" rx="1"></rect><rect width="7" height="5" x="14" y="3" rx="1"></rect><rect width="7" height="9" x="14" y="12" rx="1"></rect><rect width="7" height="5" x="3" y="16" rx="1"></rect></svg>` |
| `menu` | Nav : Plus | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><line x1="4" x2="20" y1="12" y2="12"></line><line x1="4" x2="20" y1="6" y2="6"></line><line x1="4" x2="20" y1="18" y2="18"></line></svg>` |
| `building-2` | Puce de tenant | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"></path><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"></path><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"></path><path d="M10 6h4"></path><path d="M10 10h4"></path><path d="M10 14h4"></path><path d="M10 18h4"></path></svg>` |
| `chevron-down` | Puce de tenant, listes déroulantes | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="m6 9 6 6 6-6"></path></svg>` |
| `chevron-right` | Ligne navigable | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="m9 18 6-6-6-6"></path></svg>` |
| `chevron-left` | Pagination, volets | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="m15 18-6-6 6-6"></path></svg>` |
| `search` | Recherche | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg>` |
| `arrow-left` | Retour | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="m12 19-7-7 7-7"></path><path d="M19 12H5"></path></svg>` |
| `star` | Surveiller (barre supérieure S30) | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>` |
| `ellipsis-vertical` (`more-vertical`) | Menu ⋮ | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg>` |
| `x` | Fermer, effacer | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>` |
| `sliders-horizontal` | Filtres | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><line x1="21" x2="14" y1="4" y2="4"></line><line x1="10" x2="3" y1="4" y2="4"></line><line x1="21" x2="12" y1="12" y2="12"></line><line x1="8" x2="3" y1="12" y2="12"></line><line x1="21" x2="16" y1="20" y2="20"></line><line x1="12" x2="3" y1="20" y2="20"></line><line x1="14" x2="14" y1="2" y2="6"></line><line x1="8" x2="8" y1="10" y2="14"></line><line x1="16" x2="16" y1="18" y2="22"></line></svg>` |
| `folder-tree` | Arbre des groupes | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M20 10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-.8-.4l-.9-1.2A1 1 0 0 0 15 3h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z"></path><path d="M20 21a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-2.9a1 1 0 0 1-.88-.55l-.42-.85a1 1 0 0 0-.92-.6H13a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z"></path><path d="M3 5a2 2 0 0 0 2 2h3"></path><path d="M3 3v13a2 2 0 0 0 2 2h3"></path></svg>` |
| `plus` | Ajouter | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M5 12h14"></path><path d="M12 5v14"></path></svg>` |
| `circle-alert` (`alert-circle`) | Critique (toujours avec le rouge) | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><circle cx="12" cy="12" r="10"></circle><line x1="12" x2="12" y1="8" y2="12"></line><line x1="12" x2="12.01" y1="16" y2="16"></line></svg>` |
| `triangle-alert` (`alert-triangle`) | Attention ; bouton de danger | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path></svg>` |
| `info` | Info, note | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path></svg>` |
| `circle-check` (`check-circle-2`) | Réussi, rétabli | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><circle cx="12" cy="12" r="10"></circle><path d="m9 12 2 2 4-4"></path></svg>` |
| `circle-x` (`x-circle`) | Échec | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><circle cx="12" cy="12" r="10"></circle><path d="m15 9-6 6"></path><path d="m9 9 6 6"></path></svg>` |
| `check` | Coche, tenant courant | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M20 6 9 17l-5-5"></path></svg>` |
| `check-check` | Marquer comme lu | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M18 6 7 17l-5-5"></path><path d="m22 10-7.5 7.5L13 16"></path></svg>` |
| `clock` | En attente, expiration | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>` |
| `loader-circle` (`loader-2`) | En cours (rotation) | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>` |
| `circle-dot` | Surveiller (action rapide) | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="1"></circle></svg>` |
| `hourglass` | En attente d'approbation | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M5 22h14"></path><path d="M5 2h14"></path><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"></path><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"></path></svg>` |
| `wifi-off` | Isolement réseau (bleu) ; hors ligne | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M12 20h.01"></path><path d="M8.5 16.429a5 5 0 0 1 7 0"></path><path d="M5 12.859a10 10 0 0 1 5.17-2.69"></path><path d="M19 12.859a10 10 0 0 0-2.007-1.523"></path><path d="M2 8.82a15 15 0 0 1 4.177-2.643"></path><path d="M22 8.82a15 15 0 0 0-11.288-3.764"></path><path d="m2 2 20 20"></path></svg>` |
| `wifi` | Rétablir le réseau | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M12 20h.01"></path><path d="M2 8.82a15 15 0 0 1 20 0"></path><path d="M5 12.859a10 10 0 0 1 14 0"></path><path d="M8.5 16.429a5 5 0 0 1 7 0"></path></svg>` |
| `shield` | Mode confidentialité (orange) ; OS FreeBSD | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"></path></svg>` |
| `shield-off` | Désactiver la confidentialité | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="m2 2 20 20"></path><path d="M5 5a1 1 0 0 0-1 1v7c0 5 3.5 7.5 7.67 8.94a1 1 0 0 0 .67.01c2.35-.82 4.48-1.97 5.9-3.71"></path><path d="M9.309 3.652A12.252 12.252 0 0 0 11.24 2.28a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1v7a9.784 9.784 0 0 1-.08 1.264"></path></svg>` |
| `shield-alert` | Sécurité | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"></path><path d="M12 8v4"></path><path d="M12 16h.01"></path></svg>` |
| `shield-check` | Politiques, conformité | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"></path><path d="m9 12 2 2 4-4"></path></svg>` |
| `arrow-up` | Delta hausse ; mise à jour d'agent | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="m5 12 7-7 7 7"></path><path d="M12 19V5"></path></svg>` |
| `arrow-down` | Delta baisse | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M12 5v14"></path><path d="m19 12-7 7-7-7"></path></svg>` |
| `lock` | Onglet verrouillé, géré par le maître | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>` |
| `apple` | OS macOS | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M12 20.94c1.5 0 2.75 1.06 4 1.06 3 0 6-8 6-12.22A4.91 4.91 0 0 0 17 5c-2.22 0-4 1.44-5 2-1-.56-2.78-2-5-2a4.9 4.9 0 0 0-5 4.78C2 14 5 22 8 22c1.25 0 2.5-1.06 4-1.06Z"></path><path d="M10 2c1 .5 2 2 2 5"></path></svg>` |
| `terminal` | OS Linux | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" x2="20" y1="19" y2="19"></line></svg>` |
| `server` | Groupe, serveur | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><rect width="20" height="8" x="2" y="2" rx="2" ry="2"></rect><rect width="20" height="8" x="2" y="14" rx="2" ry="2"></rect><line x1="6" x2="6.01" y1="6" y2="6"></line><line x1="6" x2="6.01" y1="18" y2="18"></line></svg>` |
| `git-commit` (`git-commit-horizontal`) | Contexte : changement récent | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><circle cx="12" cy="12" r="3"></circle><line x1="3" x2="9" y1="12" y2="12"></line><line x1="15" x2="21" y1="12" y2="12"></line></svg>` |
| `network` | Contexte : voisins | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><rect x="16" y="16" width="6" height="6" rx="1"></rect><rect x="2" y="16" width="6" height="6" rx="1"></rect><rect x="9" y="2" width="6" height="6" rx="1"></rect><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"></path><path d="M12 12V8"></path></svg>` |
| `wrench` | Contexte : maintenance | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>` |
| `rotate-ccw` | Contexte : redémarrage en attente | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>` |
| `rotate-cw` | Redémarrer (service, appareil) | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path></svg>` |
| `refresh-cw` | Actualiser ; redémarrer l'agent | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path><path d="M8 16H3v5"></path></svg>` |
| `square-terminal` (`terminal-square`) | Terminal (PowerShell, CMD, SSH) | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="m7 11 2-2-2-2"></path><path d="M11 13h4"></path><rect width="18" height="18" x="3" y="3" rx="2" ry="2"></rect></svg>` |
| `monitor-play` | Voir l'écran (ObliReach) | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="m10 7 5 3-5 3Z"></path><rect width="20" height="14" x="2" y="3" rx="2"></rect><path d="M12 17v4"></path><path d="M8 21h8"></path></svg>` |
| `play` | Script, exécuter | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>` |
| `list` | Processus | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><line x1="8" x2="21" y1="6" y2="6"></line><line x1="8" x2="21" y1="12" y2="12"></line><line x1="8" x2="21" y1="18" y2="18"></line><line x1="3" x2="3.01" y1="6" y2="6"></line><line x1="3" x2="3.01" y1="12" y2="12"></line><line x1="3" x2="3.01" y1="18" y2="18"></line></svg>` |
| `list-checks` | Tâches | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="m3 17 2 2 4-4"></path><path d="m3 7 2 2 4-4"></path><path d="M13 6h8"></path><path d="M13 12h8"></path><path d="M13 18h8"></path></svg>` |
| `zap` | Agir ; commandes rapides du terminal | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>` |
| `history` | Historique | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path><path d="M12 7v5l4 2"></path></svg>` |
| `power` | Éteindre, alimentation | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M12 2v10"></path><path d="M18.4 6.6a9 9 0 1 1-12.77.04"></path></svg>` |
| `moon` | Mettre en veille ; thème Nuit | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"></path></svg>` |
| `sun` | Apparence (réglages) | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2"></path><path d="M12 20v2"></path><path d="m4.93 4.93 1.41 1.41"></path><path d="m17.66 17.66 1.41 1.41"></path><path d="M2 12h2"></path><path d="M20 12h2"></path><path d="m6.34 17.66-1.41 1.41"></path><path d="m19.07 4.93-1.41 1.41"></path></svg>` |
| `scan-line` | Analyser | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M3 7V5a2 2 0 0 1 2-2h2"></path><path d="M17 3h2a2 2 0 0 1 2 2v2"></path><path d="M21 17v2a2 2 0 0 1-2 2h-2"></path><path d="M7 21H5a2 2 0 0 1-2-2v-2"></path><path d="M7 12h10"></path></svg>` |
| `gauge` | Envoyer les mesures maintenant | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="m12 14 4-4"></path><path d="M3.34 19a10 10 0 1 1 17.32 0"></path></svg>` |
| `trash-2` | Supprimer, désinstaller | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path><line x1="10" x2="10" y1="11" y2="17"></line><line x1="14" x2="14" y1="11" y2="17"></line></svg>` |
| `key-round` | BitLocker, clé | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M2 18v3c0 .6.4 1 1 1h4v-3h3v-3h2l1.4-1.4a6.5 6.5 0 1 0-4-4Z"></path><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"></circle></svg>` |
| `fingerprint` | Biométrie | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M2 12C2 6.5 6.5 2 12 2a10 10 0 0 1 8 4"></path><path d="M5 19.5C5.5 18 6 15 6 12c0-.7.12-1.37.34-2"></path><path d="M17.29 21.02c.12-.6.43-2.3.5-3.02"></path><path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"></path><path d="M8.65 22c.21-.66.45-1.32.57-2"></path><path d="M14 13.12c0 2.38 0 6.38-1 8.88"></path><path d="M2 16h.01"></path><path d="M21.8 16c.2-2 .131-5.354 0-6"></path><path d="M9 6.8a6 6 0 0 1 9 5.2c0 .47 0 1.17-.02 2"></path></svg>` |
| `copy` | Copier | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg>` |
| `share-2` | Partager | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" x2="15.42" y1="13.51" y2="17.49"></line><line x1="15.41" x2="8.59" y1="6.51" y2="10.49"></line></svg>` |
| `eye` | Afficher | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"></path><circle cx="12" cy="12" r="3"></circle></svg>` |
| `eye-off` | Masquer | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"></path><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"></path><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"></path><line x1="2" x2="22" y1="2" y2="22"></line></svg>` |
| `external-link` | Ouvrir dans le navigateur / Obliview | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M15 3h6v6"></path><path d="M10 14 21 3"></path><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path></svg>` |
| `globe` | Vue web | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><circle cx="12" cy="12" r="10"></circle><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"></path><path d="M2 12h20"></path></svg>` |
| `pause` | Mettre en pause | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><rect width="4" height="16" x="6" y="4"></rect><rect width="4" height="16" x="14" y="4"></rect></svg>` |
| `square` | Arrêter | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><rect width="18" height="18" x="3" y="3" rx="2"></rect></svg>` |
| `bell` | Notifications | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"></path><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"></path></svg>` |
| `bell-off` | Notifications coupées | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5"></path><path d="M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7"></path><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"></path><path d="m2 2 20 20"></path></svg>` |
| `settings` | Réglages | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg>` |
| `user` | Profil | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>` |
| `users` | Équipes | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>` |
| `log-out` | Se déconnecter | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" x2="9" y1="12" y2="12"></line></svg>` |
| `calendar-clock` | Planifications | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5"></path><path d="M16 2v4"></path><path d="M8 2v4"></path><path d="M3 10h5"></path><path d="M17.5 17.5 16 16.3V14"></path><circle cx="16" cy="16" r="6"></circle></svg>` |
| `workflow` | Scénarios | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><rect width="8" height="8" x="3" y="3" rx="2"></rect><path d="M7 11v4a2 2 0 0 0 2 2h4"></path><rect width="8" height="8" x="13" y="13" rx="2"></rect></svg>` |
| `scroll-text` | Scripts | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M8 21h12a2 2 0 0 0 2-2v-2H10v2a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v3h4"></path><path d="M19 17V5a2 2 0 0 0-2-2H4"></path><path d="M15 8h-5"></path><path d="M15 12h-5"></path></svg>` |
| `hard-drive` | Disque | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><line x1="22" x2="2" y1="12" y2="12"></line><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path><line x1="6" x2="6.01" y1="16" y2="16"></line><line x1="10" x2="10.01" y1="16" y2="16"></line></svg>` |
| `cpu` | CPU | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><rect x="4" y="4" width="16" height="16" rx="2"></rect><rect x="9" y="9" width="6" height="6"></rect><path d="M15 2v2"></path><path d="M15 20v2"></path><path d="M2 15h2"></path><path d="M2 9h2"></path><path d="M20 15h2"></path><path d="M20 9h2"></path><path d="M9 2v2"></path><path d="M9 20v2"></path></svg>` |
| `memory-stick` | RAM | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M6 19v-3"></path><path d="M10 19v-3"></path><path d="M14 19v-3"></path><path d="M18 19v-3"></path><path d="M8 11V9"></path><path d="M16 11V9"></path><path d="M12 11V9"></path><path d="M2 15h20"></path><path d="M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v1.1a2 2 0 0 0 0 3.837V17a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-5.1a2 2 0 0 0 0-3.837Z"></path></svg>` |
| `user-plus` | Enrôlement | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><line x1="19" x2="19" y1="8" y2="14"></line><line x1="22" x2="16" y1="11" y2="11"></line></svg>` |
| `user-check` | Approbation | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><polyline points="16 11 18 13 22 9"></polyline></svg>` |
| `qr-code` | Scanner un QR code | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><rect width="5" height="5" x="3" y="3" rx="1"></rect><rect width="5" height="5" x="16" y="3" rx="1"></rect><rect width="5" height="5" x="3" y="16" rx="1"></rect><path d="M21 16h-3a2 2 0 0 0-2 2v3"></path><path d="M21 21v.01"></path><path d="M12 7v3a2 2 0 0 1-2 2H7"></path><path d="M3 12h.01"></path><path d="M12 3h.01"></path><path d="M12 16v.01"></path><path d="M16 12h1"></path><path d="M21 12v.01"></path><path d="M12 21v-1"></path></svg>` |
| `download` | Mise à jour de l'app | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" x2="12" y1="15" y2="3"></line></svg>` |
| `keyboard` | Clavier, raccourcis | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M10 8h.01"></path><path d="M12 12h.01"></path><path d="M14 8h.01"></path><path d="M16 12h.01"></path><path d="M18 8h.01"></path><path d="M6 8h.01"></path><path d="M7 16h10"></path><path d="M8 12h.01"></path><rect x="2" y="4" width="20" height="16" rx="2"></rect></svg>` |
| `mouse-pointer-2` | Trackpad ObliReach | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="m4 4 7.07 17 2.51-7.39L21 11.07z"></path></svg>` |
| `clipboard` | Presse-papiers, coller | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"></rect><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path></svg>` |
| `inbox` | État vide | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"></polyline><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path></svg>` |
| `cloud-off` | Hors connexion | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="m2 2 20 20"></path><path d="M5.782 5.782A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.307-.193"></path><path d="M21.532 16.5A4.5 4.5 0 0 0 17.5 10h-1.79A7.008 7.008 0 0 0 10 5.07"></path></svg>` |
| `mail` | 2FA par e-mail | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><rect width="20" height="16" x="2" y="4" rx="2"></rect><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path></svg>` |
| `smartphone` | Application d'authentification | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><rect width="14" height="20" x="5" y="2" rx="2" ry="2"></rect><path d="M12 18h.01"></path></svg>` |
| `tag` | Tags | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"></path><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"></circle></svg>` |
| `pin` | Épingler | `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none"><line x1="12" x2="12" y1="17" y2="22"></line><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"></path></svg>` |

## 6. Snippet index
`freshness-live` · `freshness-updated` · `freshness-stale` · `avatar-live` · `avatar-reconnecting` · `avatar-offline` · `tenant-chip-master` · `tenant-chip-filter` · `tenant-chip-client` · `topbar-root` · `topbar-detail` · `bottom-nav` · `nav-rail` · `status-pill-online` · `status-pill-offline` · `status-pill-warning` · `status-pill-critical` · `status-pill-pending` · `status-pill-updating` · `status-pill-maintenance` · `status-pill-suspended` · `status-pill-pending_uninstall` · `status-pill-update_error` · `status-pill-compact` · `severity-chip-critical` · `severity-chip-warning` · `severity-chip-info` · `severity-chip-recovery` · `metric-bar` · `metric-band` · `metric-band-offline` · `mini-bars` · `section-header` · `section-header-status` · `section-header-action` · `device-row` · `device-row-offline` · `device-row-pending` · `device-row-modes` · `device-row-compact` · `device-row-swipe` · `card` · `card-nested` · `health-ribbon` · `featured-card` · `kpi-tile` · `kpi-grid` · `btn-primary` · `btn-secondary` · `btn-tonal` · `btn-danger` · `btn-biometric` · `btn-text` · `btn-link` · `btn-disabled` · `btn-icon` · `btn-full` · `fab-extended` · `segmented` · `segmented-mono` · `search-field` · `chip-filter-selected` · `chip-filter` · `chip-dropdown` · `chip-row` · `switch-on` · `switch-off` · `settings-row-switch` · `text-field` · `text-field-focused` · `text-field-error` · `otp-field` · `checkbox` · `snackbar` · `snackbar-success` · `empty-state` · `empty-triage` · `incident-card` · `incident-card-metric` · `incident-card-recovered` · `context-card` · `banner-privacy` · `banner-isolation` · `banner-uninstall` · `banner-note` · `realtime-strip` · `offline-banner` · `action-bar` · `tabs` · `list-row` · `list-row-web` · `list-group` · `sheet-scrim` · `bottom-sheet` · `sheet-group-header` · `sheet-action-item` · `sheet-action-item-disabled` · `sheet-action-item-danger` · `session-pill` · `expiry-ring` · `progress-ring` · `command-tracker` · `key-bar` · `skeleton-row` · `logo-mark` · `logo-wordmark` · `logo-mono`
