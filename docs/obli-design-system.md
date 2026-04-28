# Obli\* Design System — Operator (v1, 2026-04-28)

The canonical theme name is **"Obli Operator"** (id: `obli-operator`).
It's the default theme shipped via Obligate's theme selector and the
canonical UI specification every Obli* app must implement. Apps still own
their accent color and per-app content; the **layout, navigation patterns and
common chrome are identical across the suite**.

Reference HTML mockup (Obliance variant):
**`D:\Mockup\obliance_redesign_proposal.html`**

Open it in a browser. Every selector / spacing / SVG icon below is taken
verbatim from that file. When in doubt, copy from it.

---

## 1. Per-app accent color

| App         | Accent       | Hex        | Highlight  |
|-------------|--------------|------------|------------|
| Obliview    | Teal         | `#2bc4bd`  | `#5fd9d3`  |
| Obliguard   | Orange       | `#f5a623`  | `#ffb84a`  |
| Oblimap     | Green        | `#1edd8a`  | `#5cf0a8`  |
| Obliance    | Red          | `#e03a3a`  | `#ff6868`  |
| Oblihub     | Deep blue    | `#2d4ec9`  | `#5a78e8`  |

In the mockup the accent is `--ance / --ance2`. Each app should expose the
accent as two CSS variables under names like `--accent / --accent2` and
substitute them into the same selectors.

---

## 2. Color tokens (shared, theme-stable)

```css
--bg:    #0b0d1a;          /* page bg */
--s1:    #0f1220;          /* topbar + sidebar bg */
--s2:    #131728;          /* card bg */
--s3:    #181c30;
--s4:    #1d2238;
--hover:  rgba(255,255,255,0.04);
--hover2: rgba(255,255,255,0.06);

--green:  #1edd8a;
--amber:  #f5a623;
--blue:   #4f7bff;

/* Brighter, more readable text scale */
--text:   #e8ecf5;
--text2:  #8c93b6;
--text3:  #4b5273;
--text4:  #2f3552;

--font:   'Rajdhani', sans-serif;
--mono:   'JetBrains Mono', monospace;

/* No borders on cards — use shadow + bg delta for depth */
--shadow-card:    0 1px 0 0 rgba(255,255,255,0.03), 0 6px 24px -8px rgba(0,0,0,0.45);
--shadow-glow:    0 0 0 1px rgba(<accent>, 0.18) inset, 0 6px 28px -10px rgba(<accent>,0.25);
```

**Hard rule — no `border:` on cards / pills / buttons.** Depth is conveyed by
background lightness step (`--bg → --s1 → --s2`) and `--shadow-card`. Hover is
a background swap, never an outline.

---

## 3. Typography

- **Display / UI**: Rajdhani 400 / 500 / 600 / 700.
  ```html
  <link href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&display=swap" rel="stylesheet">
  ```
- **Mono / numbers / IDs**: JetBrains Mono 300 / 400 / 500.
  ```html
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500&display=swap" rel="stylesheet">
  ```

Scale (taken from mockup, **bigger than before for readability**):

| Use                   | Size  | Weight | Family    |
|-----------------------|-------|--------|-----------|
| Page title            | 24 px | 600    | Rajdhani  |
| Card title            | 16 px | 600    | Rajdhani  |
| KPI value (featured)  | 36 px | 600    | Rajdhani  |
| KPI value (regular)   | 32 px | 600    | Rajdhani  |
| Nav / button          | 13–14 px | 500 | Rajdhani  |
| KPI label / meta      | 11 px (uppercase, .14em letter-spacing) | 400 | JetBrains Mono |
| Counts / IDs / dates  | 11–12 px | 400 | JetBrains Mono |

---

## 4. Layout chrome (every app, every page)

### 4.1 Topbar — 52 px tall

Order from left to right:

1. **Logo block** — `<app-name-mark>` 26 × 26 with the app's accent gradient + the text app name (Rajdhani 19 px / 600).
2. **Tenant selector** — `--hover` background, 7 px radius, label `TENANT` in mono + tenant name in Rajdhani + chevron. Click = dropdown of tenants the user can switch to.
3. **App switcher pills** — every pill is one of the 5 apps with its accent dot, in this order:
   ```
   Obliview · Obliguard · Oblimap · Obliance · Oblihub
   ```
   The current app's pill has `background: rgba(<accent>, 0.12); color: <accent2>` and the dot has `box-shadow: 0 0 8px currentColor`. Click any other pill = navigate to that app, carrying the current tenant context (see § 6).
4. **Right cluster (margin-left: auto)**:
   - Topbar link "Télécharger l'appli" with download icon
   - Notification bell (icon button, red dot top-right when unread)
   - User badge — 26 × 26 avatar + username + role pill (small mono on the right of a 1px subtle vertical separator)

### 4.2 Sidebar — 260 px expanded / 64 px collapsed / floating overlay

**Critical**: collapsed mode must show **icons only, never disappear**. The
collapse toggle is the panel icon top-right of the sidebar header (not in the
topbar).

#### 4.2.1 Three states, two flags

The sidebar has three render modes driven by two booleans persisted in
localStorage. **They are mutually exclusive.**

| State                  | `sidebarCollapsed` | `sidebarFloating` | Render                              |
|------------------------|--------------------|-------------------|-------------------------------------|
| Pinned, expanded       | `false`            | `false`           | 260 px column, full content         |
| Pinned, collapsed      | `true`             | `false`           | 64 px icon-only column              |
| Floating overlay       | `false`            | `true`            | Auto-hide overlay, expanded content |

**Rules** (enforce in the store, not just the UI — stale localStorage will
otherwise resurrect the dual state):

1. The **Collapse** button (`ChevronsLeft`) is hidden while `sidebarFloating`
   is true.
2. The **Pin/Float** button is hidden while `sidebarCollapsed` is true.
3. Toggling EITHER flag forces the OTHER to `false` AND writes both keys to
   localStorage.

Why: if both are `true` the AppLayout draws a 260 px floating overlay that
contains a 64 px Sidebar — leaving 200 px of empty drop-shadow visible on
the right of the icon column. Ugly + confusing. The two-flag mutex prevents
that mode from ever being reachable.

#### 4.2.2 Layout

Expanded structure (top to bottom):

```
[ Header padding 14px / gap 9px ]
  ├─ Toggle button (right-aligned)
  ├─ "Add agent" primary button (full width, accent bg)
  └─ Search input (rounded, no border, hover bg)

[ Body — scrollable ]
  ├─ Main nav links (Dashboard / per-app pages — see § 5)
  ├─ Section header "APPAREILS" (or app-equivalent, mono 10px uppercase .14em)
  ├─ Device tree (root groups → expand → child groups → device list with
  │   green/grey status dot)
  ├─ Divider (1px rgba 4%)
  ├─ Section header "ADMINISTRATION"
  └─ Admin nav links (Agents / Users / Supervision / Security / Tenants / Settings)

[ Footer — pinned bottom ]
  ├─ Divider
  ├─ User row: avatar + full name + sub-line "username · role"
  └─ Logout link
```

Collapsed mode hides: search input, all `.sb-text` labels, the device tree,
section headers, user info text. Icons stay visible in the same vertical
order, all centered, 36 × 36 hit areas.

Active nav link: `background: rgba(<accent>, 0.12); color: <accent2>` — same
treatment as the active app pill, no border.

Sidebar state (collapsed yes/no, expanded device-tree IDs) is persisted in
`localStorage` under keys prefixed with the app name, e.g.
`obliance:groupPanelCollapsed`.

### 4.3 Main content area

- Padding `24 26 20`, gap 18 px between sections.
- Page header is just `<title> · <meta>` flanked by action buttons on the
  right. **No big banner**.
- Cards: `background: var(--s2); border-radius: 14; padding: 18 20;
  box-shadow: var(--shadow-card)` — no border.

---

## 5. Dashboard pattern (every app must implement)

The dashboard layout is **identical**, the data is per-app:

```
[ Page header ]
[ Hero row ] — 5 KPI cards, first one "featured" (1.6× wider) with sparkline + day axis
[ Two-column row ] — left (2fr): time-series chart with 24h/7j/14j/30j tabs
                     right (1fr): donut + legend
[ Bottom row ] — 4 small status cards (icon left, label/name/count, badge right)
```

Per-app data choices:

| App        | Hero KPIs                                                  | Chart                          | Donut                  | Bottom cards                                   |
|------------|------------------------------------------------------------|--------------------------------|------------------------|------------------------------------------------|
| Obliance   | Total / Online / Offline / Updates pending / 72h-stale     | Online over 14 days            | OS distribution        | Largest group, agent version, approvals, schedule failures |
| Obliview   | Total monitors / Up / Down / Cert expiring / Slow          | Uptime % over 14 days          | Monitor types          | Worst monitor, fastest, recent incident, SLA   |
| Obliguard  | Threats today / Blocked / Quarantined / Critical hosts     | Threat rate over 14 days       | Threat categories      | Top threat, top source IP, longest infection, missed scans |
| Oblimap    | Networks / Subnets discovered / Hosts up / Anomalies       | Hosts discovered over 14 days  | Network types          | Densest subnet, last scan, new hosts, port-anomaly count   |
| Oblihub    | Connected apps / Auth events / Failed logins / Sessions    | Logins over 14 days            | App breakdown          | Most-used app, top user, recent revoke, expiring sessions  |

The **shape** (5 KPI / chart+donut / 4 status cards) is non-negotiable so the
suite reads as one product.

---

## 6. Cross-app behaviour

1. **App switcher persists tenant context.** Clicking an app pill opens that
   app at the same tenant. Implementation: tenant id rides in the URL hash or
   a shared cookie scoped to the parent domain (`.binaryhearts.me`).
2. **Theme selector lives in Obligate.** The user picks one theme; every Obli*
   app reads it from the Obligate session and renders accordingly.
   - **The "Obli design v1" theme described in this document is the new
     default.**
   - Other themes (the old Obliance v0, custom user themes) remain available.
3. **Sidebar collapsed state syncs across apps.** Same-named localStorage key
   so collapsing in Obliance keeps the sidebar collapsed when you jump to
   Oblimap.
4. **User avatar / name / role come from Obligate** — apps must NOT hardcode
   these locally; they reflect whatever Obligate returns.

   The avatar is `user.avatar` on the auth payload (already populated by
   Obligate, already used by GlobalChatPanel etc.). Render the image in:

   - The topbar user badge (28 × 28 round, `object-cover`).
   - The sidebar profile row (20 × 20 round in expanded mode, 24 × 24 in
     collapsed mode).

   Fallback when `user.avatar === null` is a gradient circle showing the
   first uppercase letter of the username — same visual the chat panel
   uses today, so the suite stays consistent for users who never set an
   avatar.

---

## 7. SVG icon set

Use Lucide-style 24×24 stroke-based icons. The mockup includes inline
`<symbol>` definitions for: grid, monitor, zap, shield, cpu, users, eye,
lock, building, settings, search, plus, chevright, chevdown, folder,
server, panel, bell, download, logout, refresh, warn, clock, package, spark.

Stroke weight 2. Colour `currentColor`. Inactive nav uses `--text3`, hover
`--text2`, active `<accent2>`.

### 7.1 Sidebar control icons (must be distinct)

These two buttons sit side-by-side in the expanded sidebar header and have
**different semantics** — they MUST use different icons or the user can't
tell them apart:

| Action                              | Icon (Lucide)            | When                              |
|-------------------------------------|--------------------------|-----------------------------------|
| Collapse sidebar (260px → 64px)     | `ChevronsLeft`           | expanded → collapsed              |
| Expand sidebar (64px → 260px)       | `ChevronsRight`          | collapsed → expanded              |
| Pin sidebar (was floating)          | `Pin`                    | sidebar currently floating        |
| Unpin / float sidebar (auto-hide)   | `PinOff`                 | sidebar currently pinned          |

Earlier prototypes reused `PanelLeft / PanelLeftClose` for both actions —
that produced two visually-identical icons doing different things. **Don't.**

---

## 8. Spacing & shape system

| Token         | Use                                               |
|---------------|---------------------------------------------------|
| 6 / 7 px      | Pill / small button radius                        |
| 9 px          | Icon button, KPI card icon background             |
| 12 px         | Compact card radius                               |
| 14 px         | Standard card radius                              |
| 22 px         | User badge (rounded full)                         |
| 4 / 6 / 8 / 10 / 12 / 14 / 18 / 20 px | gap / padding scale         |

Every interactive element is min 32 px tall on desktop, 38 px tall on the
form-button track ("Add agent", "Export", page actions) so the rhythm reads
horizontally.

---

## 9. Implementation prompt for other Obli* apps

> Use this exact block when asking another Obli* AI to apply the design.

---

> **PROMPT**:
>
> The Obli\* suite has a new shared design system documented at
> `D:\Mockup\obli-design-system.md` with a fully working reference mockup at
> `D:\Mockup\obliance_redesign_proposal.html`.
>
> Apply the design system to **<app name>**. Specifically:
>
> 1. Replace the topbar with the spec in §4.1 — including the **tenant
>    selector** (left), the **5-app pill switcher** with the dot for
>    `<app name>` glowing, the right-cluster with download / bell / user
>    badge.
> 2. Replace the sidebar with the spec in §4.2. **Critical**: collapsed
>    mode must shrink to 64 px showing icon-only items, never hide the
>    sidebar. Persist the collapsed flag under `<app>:groupPanelCollapsed`.
> 3. Refresh the dashboard page to the layout in §5 with the data choices
>    listed for `<app name>`.
> 4. Migrate to the typography in §3 (Rajdhani + JetBrains Mono).
> 5. Drop ALL `border:` declarations on cards / pills / buttons. Use
>    `--shadow-card` for depth and the `--hover` background for interactive
>    states.
> 6. The accent color for `<app name>` is `<hex>` (highlight `<hex2>`).
>    Bind it to `--accent / --accent2` and apply to the active pill, the
>    "Add" button, the active sidebar link, the featured KPI glow.
>
> The mockup HTML is the authoritative reference for selectors, spacing,
> SVG icons, animation timings. When you have a question about a value,
> read it from there before guessing.
>
> Provide a short PR plan (3 commits max: tokens + topbar/sidebar +
> dashboard) and list what you'll change. Do NOT touch app-specific
> business logic — only chrome and dashboard layout.

---

## 10. Obligate theme selector entry

Add this entry to Obligate's theme catalog. The canonical name is
**"Obli Operator"** (the audience: SREs, ops engineers, fleet admins).

```ts
{
  id: 'obli-operator',
  name: 'Obli Operator',
  description: 'Default dark theme for the Obli suite — Rajdhani display + JetBrains Mono numerics, brighter type scale, depth via shadow (no borders), per-app accent.',
  isDefault: true,                  // ← becomes default on next release
  layoutVersion: 'v1',

  // Theme tokens — values in space-separated RGB triplets so Tailwind's
  // alpha-modifier syntax (bg-accent/30) works. Apps consume these as
  // CSS custom properties (`--c-*`) per their existing theme system.
  tokens: {
    '--c-bg-primary':       '11 13 26',     // #0b0d1a
    '--c-bg-secondary':     '19 23 40',     // #131728
    '--c-bg-tertiary':      '24 28 48',     // #181c30
    '--c-bg-hover':         '255 255 255 / 0.04',
    '--c-bg-active':        '255 255 255 / 0.06',
    '--c-border':           '255 255 255 / 0.05',
    '--c-border-light':     '255 255 255 / 0.08',
    '--c-text-primary':     '232 236 245',  // #e8ecf5  — brighter than v0
    '--c-text-secondary':   '140 147 182',  // #8c93b6
    '--c-text-muted':       '75 82 115',    // #4b5273

    // Status (shared)
    '--c-status-up':        '30 221 138',   // #1edd8a
    '--c-status-down':      '107 115 153',  // muted gray (was red — red is now reserved for accent)
    '--c-status-pending':   '79 123 255',   // #4f7bff
    '--c-status-warning':   '245 166 35',   // #f5a623
    '--c-status-critical':  '224 58 58',    // accent

    // Accent — per-app, swap these four:
    '--c-accent':           '224 58 58',    // app brand (Obliance: red)
    '--c-accent-hover':     '255 104 104',
    '--c-accent-dark':      '180 30 30',
    '--c-primary':          '224 58 58',
  },

  // Per-app overrides — Obligate hands the right block to each app on
  // theme apply. The accent + primary tokens above are replaced.
  perApp: {
    obliview:  { accent: '43 196 189',  hover: '95 217 211',  dark: '24 142 138' }, // teal
    obliguard: { accent: '245 166 35',  hover: '255 184 74',  dark: '184 124 24' }, // orange
    oblimap:   { accent: '30 221 138',  hover: '92 240 168',  dark: '20 165 105' }, // green
    obliance:  { accent: '224 58 58',   hover: '255 104 104', dark: '180 30 30'  }, // red
    oblihub:   { accent: '45 78 201',   hover: '90 120 232',  dark: '30 56 158'  }, // deep blue
  },

  // Typography
  fonts: {
    sans: ['Rajdhani', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
    mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
  },
}
```

The previous Obliance / Obli* themes stay available under their existing ids
(`obli-classic` etc.) for users who prefer them — Obligate must not delete
them when adding `obli-operator`.
