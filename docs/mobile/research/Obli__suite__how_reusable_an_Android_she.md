# Obli* suite: how reusable an Android shell and responsive layout would be

**Sources.** `D:\Obliance\docs\obli-design-system.md` (405 lines, 2026-04-29) is an **old copy**. The version the apps actually follow is **`D:\Mockup\obli-design-system.md`** (725 lines, 2026-08-28). It adds §11 (Inter/Rajdhani/Mono stack), §12 (detached topbar), §13 (tenant pill), §15 (i18n) and §17 (theme propagation). Other apps' code cites §11 and §12. I read both copies. I skimmed `obliance_redesign_proposal.html`: it has **zero `@media` rules**, a fixed `.shell` with `min-height: 760px; max-width: 1600px`, and fixed grids (`1.6fr 1fr 1fr 1fr 1fr`, `2fr 1fr`, `repeat(4,1fr)`).

---

## 1. Design-system rules that constrain a mobile/tablet layout

**Mobile, tablet, responsive, breakpoints, touch, viewport, PWA: not mentioned anywhere in either copy of the doc.** The spec is desktop-only. The rules below are the ones a mobile layout has to respect or explicitly override.

| Area | Rule (doc section) | Mobile/tablet implication |
|---|---|---|
| Breakpoints | None defined. All 7 Tailwind configs use the **defaults** (sm 640 / md 768 / lg 1024 / xl 1280 / 2xl 1536). None has a `screens` entry. | We can define breakpoints freely. They must be identical in the 7 configs. |
| Topbar | 52 px, full width, sidebar below it (§4.1, §12). Left to right: logo (26×26 mark + 19 px name), tenant pill (`TENANT` mono label + name, max-w 140 px + chevron), app pills (7 apps: Obliview · Obliguard · Oblimap · Obliance · Obliplan · Oblidesk · Oblihub, each with an accent dot; the current one gets a glow and `rgba(accent,.12)` background). Right cluster uses `margin-left: auto`: "Télécharger l'appli", socket dot, bell, user badge (avatar 26–28 + name + mono role pill), logout. | Needs about 1100 px or more. On phones it needs an order in which items are dropped or moved into menus (not specified today). |
| Sidebar | 260 px expanded / 64 px collapsed. "Collapsed must show icons only, **never disappear**" (§4.2). There are 3 mutually exclusive states (pinned-expanded / pinned-collapsed / floating) driven by two localStorage flags. Floating is **hover-driven** (8 px edge strip plus `mouseenter`). There is a resize handle driven by `mousedown`. Icons: ChevronsLeft/Right for collapse, Pin/PinOff for floating (§7.1). | "Never disappear" conflicts with phones and needs an explicit phone exception (off-canvas drawer). Floating and resize cannot work on touch. §6.3 syncs collapsed state across apps, so a tablet must **not** write its forced state into localStorage. |
| Main | Padding `24 26 20`, gap 18. Page header is title · meta plus actions on the right. Cards: `--s2`, radius 14, padding `18 20`, `--shadow-card`, **no borders** (hard rule §2). | Phones need smaller padding (e.g. 12–16). Keep the no-border rule; for sheets, drawers and the tab bar, use background steps and shadows, not borders. |
| Dashboard | 5 KPI (first one 1.6×) / chart 2fr + donut 1fr / 4 status cards. "Shape non-negotiable" (§5, §14). | Needs a documented reflow: tablet 2–3 columns, phone 1 column with the featured KPI full width. Same order, different grid. |
| Colors | Shared tokens §2/§10: bg `#0b0d1a`, s1 `#0f1220` (topbar/sidebar), s2 `#131728`, text `#e8ecf5 / #8c93b6 / #4b5273`. Apps use space-separated RGB `--c-*` variables so `bg-accent/30` works. | Android status and navigation bars can use `--s1` `#0f1220`. |
| Accent per app | Obliview `#2bc4bd`/`#5fd9d3`, Obliguard `#f5a623`/`#ffb84a`, Oblimap `#1edd8a`/`#5cf0a8`, Obliance `#e03a3a`/`#ff6868`, Obliplan `#7c6cff`/`#9d86ff`, Oblidesk `#22b8f5`/`#5fd0ff`, Oblihub `#2d4ec9`/`#5a78e8`. | Direct input for Android flavors. **Mismatch:** Oblihub ships `--c-accent: 22 120 205` (#1678cd) and uses `#1678cd` in its own switcher, while the doc and the other 6 apps say `#2d4ec9`. |
| Typography | §11 overrides §3: Inter for body/nav/tables, Rajdhani **only** at 24 px or more (`font-display`, opt-in), JetBrains Mono for counts/IDs. Minimum sizes: 13 px nav, 12 px muted text; smaller only for mono. | Keep the minimums on mobile. Do not shrink Rajdhani KPIs below 24 px; drop to Inter instead. |
| Spacing/shape | Radius 6/7 pill, 9 icon button, 12/14 card, 22 badge. Gap scale 4…20. **Minimum 32 px interactive height on desktop, 38 px on the form-button track** (§8). | "on desktop" suggests a touch size was intended but never written. Touch needs 44 px (Android asks for 48 dp). |
| Cross-app | Pills navigate to `${baseUrl}/auth/sso-redirect?tenant=<slug>` (tenant handoff, §6). Avatar, name and role come from Obligate. Theme comes from Obligate (§17). | The Android shell must handle navigation to another domain, and to Obligate for SSO. |
| i18n | §15 and the CLAUDE.md rule: `t('key', 'fallback')` everywhere, including `aria-label`. | New mobile chrome strings (hamburger, "Apps", drawer close) must go through `t()`. |

---

## 2. Per app: layout files, similarity to Obliance, existing responsive support

There is **no shared package anywhere.** Each client is `@<app>/client` with its own `@<app>/shared`. Layout code is **copied between repos**; lineage traces are visible (Obliguard's `package.json` name is `@obliview/client`, and Obliguard/Oblimap/ObliDesk/Obliance `api/client.ts` all check `__obliview_is_native_app`). The stack is the same everywhere: React 18.3, react-router 6.22, zustand 4.5, lucide 0.344, Tailwind 3.4.1, Vite 5.1. Every Tailwind config has the same `--c-*` RGB token scheme with `accent.DEFAULT/hover/dark`.

**Viewport meta:** all apps have `width=device-width, initial-scale=1.0`. **obliplan is the only exception**: it adds `viewport-fit=cover`, `theme-color #7c6cff`, `manifest.webmanifest`, apple-mobile-web-app tags, `sw.js`, and 192/512 icons (PWA-ready).

| App | Layout files (all under `D:\<App>\client\src\components\layout\` unless noted) | Similarity to Obliance | Existing responsive support |
|---|---|---|---|
| **Obliance** (reference) | `AppLayout.tsx` (206 lines), `Header.tsx` (211), `Sidebar.tsx` (1076), `TenantSwitcher.tsx` (127). State in `D:\Obliance\client\src\store\uiStore.ts` (`sidebarOpen/Width/Floating/Collapsed`; keys `ov-sidebar-width`, `ov-sidebar-floating`, `obli:sidebar-collapsed`). | — | **Essentially none in the chrome.** No breakpoint in AppLayout, Header or Sidebar; only 3 in `GlobalShellPanel`. The 7 pills plus the full user badge are always shown. Root uses `h-screen`. Floating is hover-only, resize is mouse-only. Header uses the non-existent class `h-13`, hidden by an inline `style={{height:52}}` (also copied into Obliguard). 158 breakpoint classes across pages, 2 JS width checks. |
| **Obliview** | Same 4 files: 169 / 157 / 451 / 129 lines. `uiStore` has a proper mutex loader (`loadSavedSidebarMutex`). Keys `obliview:sidebarFloating`, `obliview:groupPanelCollapsed`. | **Near-identical** AppLayout (67 diff lines, mostly comments and global modals). Header is the same design, but the switcher is written differently (`APP_ACCENTS` map + `APP_DISPLAY_ORDER` + `UserAvatar`). | None in layout (0 breakpoint classes); 34 in src. |
| **Obliguard** | 183 / 247 / 733 / 127 lines. Keys `og-sidebar-width`, `og-sidebar-floating`, `obli:sidebar-collapsed`. | **Near-identical.** AppLayout 71 diff lines; Header 134 diff lines with the same `APP_ORDER` structure as Obliance; TenantSwitcher only 10 diff lines. | 1 breakpoint in Header (`hidden sm:flex`); 30 in src. |
| **Oblimap** | 169 / 211 / 414 / 126 lines (plus `GlobalAddProbeModal.tsx`). Keys `ov-sidebar-width`, `ov-sidebar-floating`, `oblimap:groupPanelCollapsed`. | **Closest to Obliance**: AppLayout 57 diff lines, Header 76, TenantSwitcher 17. | 0 in layout; 42 in src. |
| **ObliDesk** | 171 / 303 / 939 / 185 lines (plus `CommandPalette.tsx`). Sidebar state lives **in `Sidebar.tsx`** (`useSidebarState`, `setSidebarWidth`, `SIDEBAR_COLLAPSED_WIDTH`), not in uiStore. Tailwind adds `rounded-card/pill` and `shadow-card` tokens. | **Same behaviour, rewritten** (AppLayout 199 diff lines, Header 314). Floating, resize and 64 px collapse are all present. | **Best topbar degradation today:** pill labels `hidden lg:inline` (dots only below 1024), user name and role `hidden md:inline`, counters `hidden sm:flex` / `xl:inline`. Nothing for the sidebar. 92 breakpoint classes in src. |
| **Oblihub** | Only `Header.tsx` (155) and `Sidebar.tsx` (297). **No AppLayout:** the layout is inline in `D:\Oblihub\client\src\App.tsx` (lines 65–74) and wraps every route as `<AppLayout><Page/></AppLayout>`, without `<Outlet>`. | **Different/simplified.** Fixed `w-[260px]` aside, collapse chevrons but no pin/floating, no resize. **No i18n** (no react-i18next). Accent mismatch noted in section 1. | None in layout; 36 in src. |
| **obliplan** | `AppLayout.tsx` (52), `Header.tsx` (135), `Sidebar.tsx` (314, has a `variant="drawer"`), `MobileTabBar.tsx` (53), `TenantSwitcher.tsx` (125). Plus `D:\obliplan\client\src\hooks\useMediaQuery.ts` (`useMediaQuery`, `useIsMobile` = below 768). | **Different design**: no floating, no resize, relative imports (no `@/`), no i18n (MobileTabBar labels hard-coded in French, which breaks §15), switcher list missing Oblidesk. | **The only app with a real phone mode.** Below md: sidebar hidden (`hidden md:contents`), hamburger in Header opens an off-canvas drawer (`w-64 max-w-[85%]`, `bg-black/60` backdrop that closes on tap), fixed bottom `MobileTabBar` (h-14, `pb-[env(safe-area-inset-bottom)]`, filtered by module/permission), main `pb-20 md:pb-6`, wordmark switches to icon below sm, pills `hidden md:flex`, user name/role `hidden md:inline`. |

**Native-app flags today.** The ObliTools desktop wrapper (`D:\Obliance\obli.tools\main.go` lines 110–111) injects `__obliview/obliance/oblimap/obliguard_is_native_app = true`. The web code uses that flag to hide the app pills, the download link, and **the tenant switcher when there is more than one tenant** (because the desktop shell draws its own tenant tabs). Obliance also fires `window.dispatchEvent(new CustomEvent('obliance:notify', {detail:{type}}))` in `D:\Obliance\client\src\hooks\useSocket.ts:11` for native alerts. ObliDesk, Oblihub and obliplan have no desktop-shell hooks.

**Overall reusability:** the chrome is highly reusable. Obliview, Obliguard, Oblimap and Obliance can take the same patch, ObliDesk needs an adaptation, Oblihub first needs its AppLayout extracted, and obliplan already follows the target phone pattern. The obstacles are the lack of a shared package, inconsistent localStorage keys (which break the §6.3 cross-app sync already), and 3 different state-store designs.

---

## 3. Recommendation

### 3.1 Android shell: one generic codebase, one flavor per app

Follow the LifeTrack pattern (`D:\LifeTrack\apps\android`: Kotlin + Compose, AGP 9, compileSdk 37, `local.properties` loaded explicitly for signing secrets, server URL from a Gradle property turned into `BuildConfig.DEFAULT_SERVER_URL`, updates checked against the configured server's `/downloads/`). For the Obli suite, make it **one project with a flavor dimension `app`**, so `assembleOblianceRelease`, `assembleObliviewRelease`, etc. all build from the same shell.

- **Location:** start it at `D:\Obliance\mobile\android` (Obliance is the first consumer). The empty `D:\Obli` folder is the natural future home as a suite repo, `D:\Obli\mobile\android`.
- **App table** in `app/build.gradle.kts`, the single place per-app data lives:
  ```kotlin
  data class ObliApp(val id: String, val name: String, val accent: String, val accent2: String, val defaultUrl: String)
  val obliApps = listOf(
    ObliApp("obliance","Obliance","#e03a3a","#ff6868","https://obliance.obli.tools"),
    ObliApp("obliview","Obliview","#2bc4bd","#5fd9d3","https://obliview.obli.tools"),
    ObliApp("obliguard","Obliguard","#f5a623","#ffb84a", ...), ObliApp("oblimap",...),
    ObliApp("obliplan","Obliplan","#7c6cff","#9d86ff", ...), ObliApp("oblidesk","Oblidesk","#22b8f5","#5fd0ff", ...),
    ObliApp("oblihub","Oblihub","#2d4ec9","#5a78e8", ...))
  flavorDimensions += "app"
  productFlavors { obliApps.forEach { a -> create(a.id) {
    dimension = "app"; applicationId = "com.example.${a.id}"
    resValue("string", "app_name", a.name); resValue("color", "obli_accent", a.accent); resValue("color", "obli_accent2", a.accent2)
    buildConfigField("String", "OBLI_APP", "\"${a.id}\"")
    buildConfigField("String", "DEFAULT_SERVER_URL", "\"${secret("obli.${a.id}.server.url") ?: a.defaultUrl}\"")
  } } }
  ```
  The default URLs follow LifeTrack's `<app>.obli.tools` pattern and **need confirming** (no production URL found in the Obliance source). Signing uses the LifeTrack `secret()` helper with `obli.keystore.*` in `local.properties`.
- **Per-flavor source sets hold resources only:** `app/src/<id>/res/mipmap-*` (adaptive icon generated from `D:\Logos\SVG\<X>.svg`, as for the tray icons) and an optional `values/strings.xml` override. **No Kotlin code per app.**
- **The generic shell (in `main`) provides:**
  - a first-run server screen pre-filled with `DEFAULT_SERVER_URL`;
  - a WebView with persistent cookies (`CookieManager`, flush on pause) so express-session and Obligate SSO survive restarts;
  - a file chooser (`onShowFileChooser`) and `DownloadManager` for exports and agent installers;
  - the back button mapped to WebView history, with the drawer closing first (see 3.2);
  - edge-to-edge window with status and navigation bars set to `#0f1220`;
  - an APK update check against `/downloads/`, like LifeTrack. Obliance already has a `/download` page to host the APK.
- **Navigation policy** in `shouldOverrideUrlLoading`, so the web code stays unchanged:
  - the configured host and the Obligate host stay in the WebView;
  - an app pill that points to another Obli domain launches `com.example.<app>` with the URL if that app is installed, otherwise opens a Custom Tab;
  - everything else opens externally.
- **JS bridge contract.** Inject at document start with `androidx.webkit.WebViewCompat.addDocumentStartJavaScript`:
  `window.__obli_native = { platform: 'android', app: '<id>', version: '<x.y.z>' }` plus a `ObliNative` `@JavascriptInterface` (`notify(type)`, `share(text)`, `openExternal(url)`). The shell forwards the existing `<app>:notify` CustomEvent to `ObliNative.notify`.
  **Do not set `__<app>_is_native_app`.** That flag means "desktop shell with its own tenant tabs" and would hide the tenant switcher and the app pills on Android.

### 3.2 Responsive primitives, and how the other apps adopt them

**Distribution.** A shared npm package does not fit today's setup: each app builds from its own Docker context and `node_modules` are not installed locally. Vendor a small canonical folder instead:
- keep the source in `D:\Obli\web-shell\` (or in Obliance first);
- copy it into each app's `client/src/components/layout/shell/`, with a header comment `// obli-shell vX — synced, do not edit here`;
- use a sync script. This matches how the suite already shares code, but with a single source of truth.

**Files to add, all app-agnostic:**
1. `useMediaQuery.ts`: lift obliplan's version and add `useLayoutMode()` returning `'phone' | 'tablet' | 'desktop'` and `useCoarsePointer()` (`(pointer: coarse)`).
2. `useEffectiveSidebar(prefs)`: computes the display state from the breakpoint plus the user preference **without writing localStorage**, so a tablet never changes the desktop preference that §6.3 syncs:

   | Mode | Width | Sidebar | Floating/resize |
   |---|---|---|---|
   | phone | below 768 (md) | hidden; off-canvas drawer with the expanded sidebar (`w-[260px] max-w-[85%]`, backdrop, closes on route change, Esc and Android back) | disabled |
   | tablet portrait | 768–1023 | forced 64 px rail; tapping the toggle opens the expanded drawer as an overlay | disabled |
   | tablet landscape | 1024–1279 | pinned allowed, starts collapsed | floating disabled on coarse pointer |
   | desktop | 1280 and up | current behaviour (collapsed/floating mutex, resize) | enabled |
3. `AppShell.tsx`: the §12 skeleton plus these changes:
   - `h-dvh` instead of `h-screen`;
   - safe-area padding (`env(safe-area-inset-*)`);
   - the drawer;
   - an optional `mobileTabs` prop that renders a generic `MobileTabBar` (obliplan's version, with items passed as `{labelKey, fallback, path, icon}` so they are i18n-ready).

   Each app then keeps only its own `Header` and `Sidebar` content and its store keys.
4. **Topbar degradation order**, to be written into the doc (generalises ObliDesk and obliplan):
   - below 1280: pill labels hidden, dots only;
   - below 1024: download link and extra counters hidden, user badge shows the avatar only;
   - below 768: hamburger shown, logo mark without text, tenant pill with the TENANT label hidden and the name truncated, app pills replaced by an `AppSwitcherSheet` (a grid of the reachable apps behind one current-app dot button), logout moved to the drawer footer, socket dot and bell kept.
5. **Touch rules:**
   - add `screens: { touch: { raw: '(pointer: coarse)' }, hoverable: { raw: '(hover: hover)' } }` to all 7 Tailwind configs;
   - 44 px minimum hit area on touch (`touch:min-h-11`);
   - hover-only affordances need a tap equivalent;
   - modals become full-screen sheets on phones (`max-md:inset-0 max-md:rounded-none`);
   - tables scroll horizontally with a sticky first column on tablet and become a card list on phone.
6. **Dashboard reflow:**
   - hero: phone 1 column with the featured KPI full width, tablet `grid-cols-2`/`3`, desktop 1.6/1/1/1/1;
   - chart + donut: stacked below 1024;
   - bottom row: 2×2 on tablet, 1 column on phone.
7. **index.html, every app:** `viewport-fit=cover`, `<meta name="theme-color" content="#0f1220">`. Keep pinch zoom (no `user-scalable=no`).

**Adoption effort per app:**
- Obliance, Oblimap, Obliguard, Obliview: swap the AppLayout body for `AppShell`, add about 10 breakpoint classes to Header, add a drawer variant to Sidebar. **Low.**
- ObliDesk: wire its `useSidebarState` into `useEffectiveSidebar`. **Low–medium.**
- Oblihub: extract an `<Outlet>`-based AppLayout from `App.tsx` first, and fix the accent. **Medium.**
- obliplan: already there; replace its local `AppLayout`/`MobileTabBar` with the shared ones and add i18n to the tab labels. **Low.**

**Changes to the design doc:**
1. Add a new **§18 "Responsive, touch and native shells"**: the breakpoint table and sidebar matrix above, an explicit phone exception to "never disappear", the topbar degradation order, touch sizes, safe-area rules, the dashboard reflow, the mobile tab bar spec, and the `__obli_native` bridge contract (versus the desktop `__<app>_is_native_app`).
2. Standardise localStorage keys on one shared name, as §6.3 requires (today there are 6 different key sets).
3. Fix the Oblihub accent: `#2d4ec9` versus `#1678cd`.
4. Replace `D:\Obliance\docs\obli-design-system.md` with the D:\Mockup copy, or make it point there, so the repo copy is no longer out of date.

**Key files:**
- `D:\Mockup\obli-design-system.md`
- `D:\Obliance\client\src\components\layout\AppLayout.tsx`
- `D:\Obliance\client\src\components\layout\Header.tsx`
- `D:\Obliance\client\src\store\uiStore.ts`
- `D:\obliplan\client\src\components\layout\AppLayout.tsx`
- `D:\obliplan\client\src\components\layout\MobileTabBar.tsx`
- `D:\obliplan\client\src\hooks\useMediaQuery.ts`
- `D:\ObliDesk\client\src\components\layout\Header.tsx`
- `D:\Oblihub\client\src\App.tsx`
- `D:\Obliance\obli.tools\main.go`
- `D:\LifeTrack\apps\android\app\build.gradle.kts`