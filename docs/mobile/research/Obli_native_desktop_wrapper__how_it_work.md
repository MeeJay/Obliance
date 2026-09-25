# Obli native desktop wrapper: how it works today, and what it means for an Android shell

## TL;DR
- There is no Obliance-specific desktop app. The Go + webview wrapper that sets `window.__obliance_is_native_app` is **ObliTools** (also written "Obli.tools"). It is one app for the whole Obli suite. Its source is in `D:\Obliview\obli.tools\`, and `D:\Obliance\obli.tools` is a symlink to that folder.
- **`/api/oblireach-desktop/version` is a different app.** It serves **Oblireach Desktop** (`D:\Oblireach\client-app\`), a standalone remote-session viewer (go-webview2 plus a local proxy). It does not wrap the Obliance UI. In Obliance, the Header's "Download App" link and `DownloadPage.tsx` hand out that Oblireach MSI, not ObliTools.
- ObliTools injects the "native" flags for 4 apps at once, but each web client checks its own name, and the names are not consistent. One Android shell can serve every Obli app if it sets all the per-app flags (or the apps move to one shared flag).

---

## 1. Where it lives and how it is built

**Source:** `D:\Obliview\obli.tools\`, Go module `oblitools-desktop`, using `github.com/webview/webview_go` (WebView2 on Windows, WKWebView on macOS). `VERSION` = `1.2.41`.

| File | Role |
|---|---|
| `main.go` (88 KB) | Injected JS (`overlayJS`, `tabBarJS`), the shell tab-bar HTML, all bindings, the AppView lifecycle, `main()` |
| `config.go` | `%APPDATA%\ObliTools\config.json` on Windows, `~/Library/Application Support/ObliTools/config.json` on macOS, `~/.config/ObliTools/config.json` on Linux |
| `download.go` | Download a file, then reveal it in Explorer/Finder |
| `notify_windows.go` / `notify_darwin.go` | OS notifications (PowerShell toast on Windows, `osascript` on macOS) |
| `chooseFolder_*.go` | Native folder picker |
| `platform_windows.go` | Win32 window positioning |
| `build-windows.ps1` | Produces `ObliTools.exe` + `ObliToolsSetup.msi` |
| `build-mac.sh` | Produces DMG/ZIP for amd64 and arm64 |
| `dist/` | Build outputs |

**It is one app for the whole suite:**
- **Config.** `Config{ Environments []Environment{Name, Apps []AppEntry{Name, URL, Color, LastURL}}, ActiveEnvIdx, Width, Height, DownloadDir, TabConfig{AutoCycleEnabled, AutoCycleIntervalS, FollowAlertsEnabled, NativeNotificationsEnabled} }`. An "environment" is a named deployment (for example "Perso" or "Taff") that holds several apps. Old flat `apps`/`url` configs are migrated automatically.
- **Shell window.** It shows a 40 px tab bar, served from `http://127.0.0.1:<random>/` by an embedded HTTP server because WebView2 blocks inline scripts on `about:`/`file:`. The tab bar holds one tab per app, collapsed tabs for the other environments, and a gear icon that opens the environment and app manager.
- **One webview per app.** Each app runs in its own WebView window with its own thread (`launchAppView`). On Windows the window has its chrome stripped, is owned by the shell, and a 50 ms loop keeps it positioned under the tab bar. On macOS and Linux those calls are stubs, so each app view shows up as a separate window.
- **Shared profile.** Every app view is created with `webview.New(false)` and no user-data folder, so all of them share one WebView2 profile (`%APPDATA%\ObliTools.exe`). The CLAUDE.md claim of "separate cookie store" is wrong. The consequence is that the Obligate session cookie is shared, which makes SSO into a second app silent.
- **First launch.** A setup page asks for one URL (`__go_saveURL`). The other apps are then discovered through `GET /api/oblitools/manifest` (see §3).
- **App identity is guessed from the hostname.** `appNameFromURL` and `appColorFromURL` look for "obliance", "oblimap", "obliguard" or "obliview" in the URL. Anything else gets blue #3b82f6.

**Oblireach Desktop, for reference.** Source is `D:\Oblireach\client-app\` (`main.go`, `proxy.go`, `ui.go`). It is its own HTML/JS UI served by a local proxy on 127.0.0.1 that forwards `/proxy/api/*` to the Obliance server and keeps cookies in `%APPDATA%\OblireachClient\session.json`. It injects only `window.__reach_version`.

---

## 2. The complete JS ↔ native contract

### How it is delivered and when
webview_go `Bind(name, fn)` does two things:
- It registers a script with `init()`, which becomes WebView2 `AddScriptToExecuteOnDocumentCreated`. It also runs `eval()` once.
- That script defines `window[name] = function(...args)`, which returns a **Promise**. The call is sent as `window.external.invoke(JSON.stringify({id: seq, method: name, params: [...args]}))`, where `window.external.invoke` is shimmed to `window.chrome.webview.postMessage`.
- Go replies by evaluating `window._rpc[seq].resolve(result)` or `.reject(...)`.
- A Go func that returns `(T, error)` rejects with the error string. That is why `DownloadPage` compares `String(err) !== 'cancelled'`.

This glue is in `C:\Users\MeeJay\go\pkg\mod\github.com\webview\webview_go@v0.0.0-20240831120633-6173450d4dd6\libs\webview\include\webview.h:923-947`.

Order in `launchAppView` (`main.go:1958-1967`):
1. `setupAppBindings` (all the `__go_*` functions)
2. `v.Init(overlayJS)`
3. `v.Init(tabBarJS)`
4. `v.Init("window.__obliview_app_version=window.__obliguard_app_version=window.__oblimap_app_version=window.__obliance_app_version=\"<ObliTools VERSION>\"")`

All of this runs **at document creation, before any page script**, on every navigation. That includes cross-origin pages such as Obligate. The bindings exist on every origin loaded in the app webview. The overlay and tab-bar code guard themselves: they skip non-http(s) pages and 127.0.0.1/localhost, and they are idempotent through `__ov_injected` / `__ov_tabs_injected`.

### Globals set on app pages (`overlayJS`, `main.go:103-259`)

| Global | Value / meaning |
|---|---|
| `__obliview_is_native_app`, `__obliance_is_native_app`, `__oblimap_is_native_app`, `__obliguard_is_native_app` | `true`. All four are always set together. |
| `__obliview_app_version`, `__obliguard_app_version`, `__oblimap_app_version`, `__obliance_app_version` | ObliTools version string. Used by `DesktopUpdateBanner`. |
| `__ov_injected`, `__ov_tabs_injected` | Internal guards |
| `__ov_native_tabs` | `true` once the multi-tenant bar has been injected |
| `__ov_app_bar_height` | Read but never set (a leftover `appBarJS`), so it is always 0 |
| `__ov_act`, `__ov_fat` | Timer handles for auto-cycle and follow-alerts |
| `localStorage.__ov_pnav` | Pending deep link, used after a tenant switch |

### Native functions bound on app webviews (`setupAppBindings`, `main.go:1662-1909`)
Every function returns a Promise.

| Function | Signature | Semantics |
|---|---|---|
| `__go_saveAppLastURL` | `(appOrigin: string, path: string) → void` | Saves `LastURL` for that app. The next launch navigates to `URL + LastURL`, except for `/auth/*`. |
| `__go_reportAlertCount` | `(appOrigin: string, count: number) → void` | Updates `alertCache[origin]`, which feeds the shell tab badges |
| `__go_nativeNotify` | `(appOrigin, title, body) → void` | Shows an OS notification titled `"<AppName> — title"`. Only when `TabConfig.NativeNotificationsEnabled` is on, and at most once per origin every 30 s. |
| `__go_openInAppTab` | `(absUrl: string) → void` | Finds the registered app with the same origin, navigates its webview to the URL, makes its tab active, and updates the shell highlight through `__ot_setActiveTab`. If no app matches, **nothing happens**. |
| `__go_proposeLinkedApps` | `(apps: {name, url, color}[]) → void` | Adds any unknown origins to the caller's environment, saves, starts their webviews and rebuilds the tab bar |
| `__go_getTabConfig` | `() → TabConfig` | Returns the cycling and notification preferences |
| `__go_saveTabConfig` | `(autoCycleEnabled: bool, autoCycleIntervalS: number, followAlertsEnabled: bool, nativeNotificationsEnabled: bool) → void` | Saves those preferences |
| `__go_getDownloadDir` | `() → string` | Saved folder, or `""` |
| `__go_chooseDownloadDir` | `() → string` | Opens the native folder picker and saves the choice. Rejects with `"cancelled"`. |
| `__go_downloadFile` | `(relUrl: string, filename: string) → string (absolute dest path)` | Asks for a folder first if none is set. Plain `http.Get(appURL + relUrl)` with **no cookies**, so it only works for public URLs. Saves to `<dir>/<filename>`, reveals the file (`explorer /select,` or `open -R`) and returns the path. Rejects with the error message. |

### Native functions on the shell / tab-bar webview only (`setupShellBindings`, `main.go:1430-1658`)
- `__go_saveURL(url)`: first setup.
- `__go_switchTab(globalIdx)`
- `__go_switchEnv(envIdx)`
- `__go_saveEnvs(envs: Environment[], activeEnvIdx)`
- `__go_getAlertCounts() → {[origin]: count}`
- `__go_saveSize(w, h)`
- `__go_showManagePanel()` / `__go_hideManagePanel()`: hide or restore the app windows around the gear overlay.

Go calls into the shell JS with `window.__ot_setActiveTab(idx)` and `window.__ot_rebuildEnvs(envs, aei, aai)`.

The table in obli.tools CLAUDE.md (`getApps`, `addApp`, `downloadAndReveal`, …) is out of date. The names above are the real ones.

### What the page sends to native
- **There is no direct page-to-native channel besides the `__go_*` calls.** Obliance's `notifyNative()` (`client/src/hooks/useSocket.ts:11`) runs `window.dispatchEvent(new CustomEvent('obliance:notify', {detail: {type: 'device_alert'|'device_ok'|'device_critical'}}))`.
- **Nothing listens for Obliance's `obliance:notify` event.** The overlay only listens for `obliview:notify` with `detail.type ∈ {probe_down, probe_up, agent_alert, agent_fixed}` and plays WebAudio tones. Obliview and Obliguard dispatch `obliview:notify`. Oblimap dispatches `oblimap:notify`, which is also never heard. The code comment in Obliance says "Electron", which is also out of date.
- **OS notifications come from polling, not socket events.** The overlay itself polls `GET /api/live-alerts/all` 4 s after load, then every 30 s. It counts unread items (`!read_at && !readAt && !read`), calls `__go_reportAlertCount`, compares IDs with the ones it has already seen, and calls `__go_nativeNotify` for new ones.

### What `tabBarJS` does inside the page (`main.go:283-834`)
This is the multi-tenant bar.
- **When it runs.** Only in a top-level window, not on `/login`, `/enrollment` or the reset pages. It fetches `/api/tenants` and `/api/auth/me`, and does nothing unless there are 2 or more tenants.
- **What it draws.** A fixed 40 px bar at z-index 2147483640, and a forced `#root{margin-top:40px; height:calc(100vh - 40px); overflow:hidden}`. The bar has one tab per tenant with an unread badge, an "Alerts" panel covering all tenants (`GET /api/live-alerts/all` → `{alerts, tenants}`; `PATCH /api/live-alerts/:id/read`), and a settings dialog (auto-cycle, follow alerts, native notifications).
- **Switching tenant.** `POST /api/tenant/switch {tenantId}`, then `location.href='/'`. A deep link waiting from an alert click is stored in `localStorage.__ov_pnav` and used on the next page load.
- **How Obliance reacts.** `TenantSwitcher.tsx:36-37` hides the React tenant dropdown when `__obliance_is_native_app && tenants.length > 1`, because this bar replaces it.

---

## 3. Login/SSO, multiple servers and tenants, notifications, downloads, external links

- **Login/SSO.** ObliTools has no SSO logic of its own.
  - The web app's normal flow runs entirely inside the app webview: `/auth/sso-redirect` → 302 to Obligate `/authorize?client_id=<apiKey>&redirect_uri=<self>/auth/callback&state` → Obligate's login page renders in the same webview → back to `/auth/callback`. This is in `server/src/routes/obligateCallback.routes.ts:328-381`.
  - Because the profile is shared, the Obligate cookie makes the other apps' SSO silent.
  - `/auth/*`, `/login`, `/enrollment` and the reset pages are never saved as `LastURL`.
  - Oblireach Desktop uses a separate **desktop SSO API**:
    1. `POST /api/auth/sso-desktop-init {localCallbackUrl}`. The server **rejects anything that is not a loopback host** (127.0.0.1, ::1, localhost). It returns `{requestId, authorizeUrl}`.
    2. The user authenticates at Obligate, which redirects to `http://127.0.0.1:<port>/sso/callback?code&state`.
    3. `POST /api/auth/sso-desktop-complete {requestId, code, state}` sets the session cookie.
    - Pending requests are kept in memory for 5 minutes (`obligateCallback.routes.ts:12-24, 573-699`).
    - An Android `myapp://` callback would need this loopback whitelist relaxed. Obligate would also have to accept that redirect_uri.
- **Cookie-less token mode.** Obliview, Oblimap, obliplan and ObliDesk accept `X-Auth-Token: <sessionID>`. Login returns a `sessionToken`, which the client keeps in `sessionStorage` (`oblitools_auth_token`, or `obliplan_auth_token` for obliplan). **Obliance has the client half but not the server half.** `client/src/api/client.ts:7-30` sends the header, but there is no `x-auth-token` middleware and login does not return a `sessionToken`, so Obliance only works with cookies. Two side effects when `isInObliTools` is true:
  - A 401 that means the session was lost **does not redirect to `/login`**; the client only clears the sessionStorage token (`client.ts:85-91`).
  - `isInObliTools` is also true whenever `__obliview_is_native_app` is set, and ObliTools sets that flag for every app.
- **Multiple servers and apps.** Environments group apps. Discovery happens 4 s after load: `GET /api/oblitools/manifest` (requireAuth) returns `{name:'Obliance', color:'#8b5cf6', ssoPath:'/auth/sso-redirect', linkedApps:[{name, url: baseUrl, color}]}`, built from Obligate's connected apps minus Obliance itself (`server/src/routes/oblitools.routes.ts`). The result is passed to `__go_proposeLinkedApps`. `ssoPath` is not used by the Go side.
- **App switching.** In native mode the Header hides both the app-switcher pills and the "Download App" link (`Header.tsx:74,104`), because the shell tab bar replaces them. When the page itself triggers a cross-origin navigation — `location.replace/assign`, the `Location.prototype.href` setter, or `window.open` — the overlay routes it to `__go_openInAppTab`. A cross-origin URL that does not match a registered app is **silently dropped**.
- **External links.** `<a target=_blank>` is not intercepted, so WebView2's default behaviour applies (a popup window). There is no "open in system browser" feature in ObliTools. Oblireach Desktop has `/local/open-url`, limited to the configured server's origin.
- **Downloads.** Only pages that explicitly call `__go_downloadFile` use the native path. That is `DownloadPage` in Obliance, Obliview, Obliguard and Oblimap. Every other download goes through WebView2's default download UI.
- **Update prompt.** `DesktopUpdateBanner` compares `__<app>_app_version` against `GET /api/agent/desktop-version`.
  - Obliview serves that route from `obli.tools/VERSION` (`Obliview/server/src/services/agent.service.ts:1247`).
  - **In Obliance the banner never appears.** Obliance only has `/api/agent/version/desktop`, which reads `agent/dist/version-desktop.json`, and that file does not exist. The client requests `/agent/desktop-version`, which is a 404.

---

## 4. Server side: how the desktop binaries are stored and served

**Oblireach Desktop** (`server/src/controllers/oblireachDesktop.controller.ts`, mounted at `routes/index.ts:71`, public):
- `GET /api/oblireach-desktop/version` returns `{ version, downloadUrl: '/api/oblireach-desktop/download', releasedAt?, releaseNotes? }`.
  - `version` is `<repo>/oblireach-desktop/VERSION`, currently `1.0.6`, re-read on every request.
  - `releasedAt` is the MSI's modification time.
  - `releaseNotes` is `RELEASE_NOTES.md` if present.
  - Returns 503 if VERSION is missing.
- `GET /api/oblireach-desktop/download` streams `oblireach-desktop/dist/OblireachDesktop.msi` with `Content-Type: application/x-msi`, `Content-Disposition: attachment`, `Cache-Control: public, max-age=300` and a weak ETag. Returns 404 if the file is missing.
- The path is resolved as `path.resolve(__dirname,'../../../../oblireach-desktop')`.
- The MSI is **committed to git** (`.gitignore` has `!oblireach-desktop/dist/`).
- The Dockerfile has `RUN mkdir -p ./oblireach-desktop/dist` and `COPY oblireach-desktop/ ./oblireach-desktop/` (`server/Dockerfile:66-71`). `.dockerignore` allows it with `!oblireach-desktop/dist` and `!oblireach-desktop/RELEASE_NOTES.md`.

**ObliTools** (`server/src/app.ts:132-158`):
- `GET /downloads/:filename` uses a whitelist: `ObliTools.exe`, `ObliToolsSetup.msi`, `ObliTools-{arm64,amd64}.{zip,dmg}`. Files come from `path.resolve(process.cwd(),'..','obli.tools','dist')`, which is `/app/obli.tools/dist` since `WORKDIR /app/server`.
- The Dockerfile writes `obli.tools/VERSION` from `--build-arg OBLITOOLS_VERSION` (default `0.0.0`). It copies `_oblitools_dist_stage/` to `./obli.tools/dist/`, because `obli.tools` is a junction Docker cannot follow and the .bat stages the files first (`server/Dockerfile:73-86`).
- No Obliance endpoint reads `obli.tools/VERSION`.

---

## 5. How each web client detects the native wrapper

The naming is per app and inconsistent. The only reason it works is that ObliTools sets `__obliview_`, `__obliance_`, `__oblimap_` and `__obliguard_is_native_app` together.

| Client | Flag(s) read | Where |
|---|---|---|
| Obliance | `__obliance_is_native_app` (Header, TenantSwitcher, useSocket, DownloadPage, DesktopUpdateBanner), `__obliance_app_version`; **`__obliview_is_native_app`** in `api/client.ts:9` (token mode) | `D:\Obliance\client\src\...` |
| Obliview | `__obliview_is_native_app` everywhere (client.ts, ProtectedRoute skips enrollment, Header, TenantSwitcher, useSocket, DownloadPage, Banner), `__obliview_app_version` | `D:\Obliview\client\src\...` |
| Obliguard | **Mixed:** `__obliview_is_native_app` in client.ts, Header, TenantSwitcher and useSocket; `__obliguard_is_native_app` and `__obliguard_app_version` in DownloadPage and Banner | `D:\Obliguard\client\src\...` |
| Oblimap | `__oblimap_is_native_app` in Header, TenantSwitcher, useSocket, DownloadPage and Banner; `__obliview_is_native_app` in client.ts | `D:\Oblimap\client\src\...` |
| ObliDesk | `__obliview_is_native_app` only, for X-Auth-Token mode (`client/src/api/client.ts:34-41`, `vite-env.d.ts:28`) | |
| obliplan | No flag; only checks `window !== window.top` (iframe) for X-Auth-Token | `client/src/api/client.ts:6-24` |
| Oblihub, Obligate, Oblireach web | No native detection at all | |

What this means for one Android shell:
- One shell can serve every app. ObliTools already works this way: multiple servers, environments, discovery through `/api/oblitools/manifest`, silent SSO over a shared cookie jar.
- **Flags.** To keep today's behaviour, set all four `__<app>_is_native_app` and `__<app>_app_version` globals at document start. New apps (oblidesk, obliplan, oblihub) have no per-app flag in the injector. A shared flag such as `window.__obli_native = {platform, version, capabilities}` is worth adding and adopting across the clients.
- **Setting the flags has side effects.**
  - The React tenant dropdown disappears when there are 2+ tenants, and the app-switcher pills and Download link are hidden. The shell must provide those, or leave the flag unset.
  - Obliview/Oblimap/ObliDesk switch to token mode.
  - Obliance stops redirecting to `/login` after a 401.
  - Obliview skips the enrollment redirect.
- **Bridge.** Mirror the `__go_*` names and the Promise/RPC shape. On Android, `WebViewCompat.addDocumentStartJavaScript` plus `addWebMessageListener`, both restricted to allowed origins, are the direct equivalents of `AddScriptToExecuteOnDocumentCreated` and `chrome.webview.postMessage`.
- **Notifications.** Use the `/api/live-alerts/all` polling approach (or a push path) rather than the `obli*:notify` events, which are unused for Obliance and Oblimap.

## Issues found along the way (not fixed)
1. **Update banner never shows in Obliance.** `DesktopUpdateBanner` calls `/api/agent/desktop-version`, but the server only has `/api/agent/version/desktop`, and that route reads a missing `agent/dist/version-desktop.json`.
2. **Obliance notification sounds never play.** Obliance dispatches `obliance:notify` with types `device_*`, and nothing listens. The same is true of Oblimap's `oblimap:notify`.
3. **Obliance has half of the token mode.** The client sends `X-Auth-Token`, but the server has no middleware for it and login returns no `sessionToken`.
4. **`__go_downloadFile` builds its URL by plain string concatenation.** `buildAbsoluteURL` does `appURL + relUrl`, so a `relUrl` starting with `@host/...` would point at another host. The bindings are also available on every origin loaded in the webview.
5. **The obli.tools CLAUDE.md is out of date.** Its binding table and the "separate cookie store" claim do not match the code.