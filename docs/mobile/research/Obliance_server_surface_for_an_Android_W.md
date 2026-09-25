# Obliance server surface for an Android WebView shell

The WebView can load the remote origin as-is. First fix two things in the code base; they are independent of Android. Socket.io auth trusts a `userId` sent by the client (0.1). Live alerts never reach the client in real time (0.2).

---

## 0. Critical findings (fix before any native client touches the server)

**0.1 CRITICAL: socket.io authenticates nobody.** At `server/src/socket.ts:32-55`, `io.use()` reads `const { userId, tenantId } = socket.handshake.auth` from the client. It checks only that the user exists and is active. It never reads the session cookie, and CORS is `origin: true` (`socket.ts:24`).
- Any client can connect from anywhere with `io(url,{auth:{userId:1,tenantId:1}})` and become the bootstrap admin.
- That socket then gets `FILE_EXPLORER_CMD` (read/write files on any device, `socket.ts:109`), `CUSTOM_SECTION_OPEN` (runs live streams, `:129`), `chat:*`, and every tenant broadcast.
- **Fix:**
  1. Export the `session(...)` middleware from `app.ts:98-113` as a const.
  2. In `createSocketServer`, add `io.engine.use(sessionMiddleware)`.
  3. In `io.use`, take `userId` from `socket.request.session.userId` and the tenant from `session.currentTenantId`. Ignore the values in `handshake.auth`, or reject when they don't match.
- The browser WS handshake already sends the cookie (same origin). A native client (OkHttp / socket.io-client-java) must send `Cookie: connect.sid=…` via `extraHeaders`.

**0.2 Live alerts never arrive in real time.** The server emits `'notification:new'` (`server/src/services/liveAlert.service.ts:104`). The client listens for `SocketEvents.NOTIFICATION_NEW = 'NOTIFICATION_NEW'` (`client/src/hooks/useSocket.ts:30`, `shared/src/socketEvents.ts:46`). Alerts only show up on refetch. Every push design below hooks at `liveAlert.service.ts:104`, so fix the name there first.

**0.3 The 2FA "trust this IP" can be spoofed.** `clientIp()` (`server/src/services/tfaTrust.service.ts:10`) takes the **first** `X-Forwarded-For` entry. nginx appends with `$proxy_add_x_forwarded_for`, so the client controls that value. Someone holding a stolen session can send `X-Forwarded-For: <trusted ip>` and skip the sensitive-action TOTP step-up (`restriction.service.ts:311-318`). Use `req.ip` with a correct `trust proxy` hop count, or the right-most untrusted entry. On mobile, IP trust is weak anyway: IPs change between cell and wifi, and a carrier (CGNAT) IPv4 address is shared by many users.

**0.4 Minor.**
- `oblireachDesktop.controller.ts:20` uses `path.resolve(__dirname,'../../../../oblireach-desktop')`. In dev (tsx) this resolves to `D:\oblireach-desktop`, outside the repo. Only the Docker layout works. The new controller below uses `process.cwd()`, as `app.ts:143` does.
- Neither login path regenerates the session ID (`auth.controller.ts`, `obligateCallback.routes.ts:217`).

---

## 1. Auth, session and SSO facts for a WebView

### Session cookie (`server/src/app.ts:98-113`)

| Property | Value | WebView consequence |
|---|---|---|
| Name | `connect.sid` (default; cleared at `auth.controller.ts` logout) | none |
| Domain | not set (host-only on `obliance.<domain>`) | Not shared with other Obli apps. Each app has its own session. |
| `httpOnly` | true | The shell reads it natively with `CookieManager.getCookie(baseUrl)`, not from JS. |
| `secure` | `true` whenever `NODE_ENV=production` (`:108`) | **An HTTP install cannot log in at all.** The shell must require `https://`. Android also blocks cleartext by default. Also `req.secure` depends on `X-Forwarded-Proto`: nginx forwards `$http_x_forwarded_proto` (`client/nginx.conf:37,54…`), so an outer TLS proxy must set it or the cookie is never issued. |
| `sameSite` | `lax` | SSO works because every hop is a top-level GET navigation (first-party). Lax only matters for iframes and cross-site POSTs, and neither is used. |
| `maxAge` | 7 days (`:110`) | See the next row. |
| `rolling` | not set (false); `resave:false`, `saveUninitialized:false` | express-session `touch()` slides the **DB** expiry on each request, but the **cookie's Expires** is only re-sent when the session changes (login, tenant switch). In practice there is a hard re-login about 7 days after login. |
| Remember-me | none; no refresh token | The WebView keeps persistent cookies across restarts, which acts as an implicit 7-day remember-me. The shell must call `CookieManager.flush()` in `onPause`, or a process kill right after login loses the cookie. |
| First Set-Cookie | at `/auth/sso-redirect` (stores `oauthState`) or `/api/auth/login` | none |

The Obligate side (`D:\Obligate\server\src\app.ts:65-70`) uses cookie `maxAge` = `SESSION_MAX_AGE`, 24h by default, and `SameSite=None; Secure` over HTTPS. After the 7-day Obliance expiry, SSO is silent only if the Obligate session is under 24h old. Otherwise the user logs in again on Obligate, with TOTP.

Optional server change for mobile comfort: `rolling: true`, or a longer `req.session.cookie.maxAge` at login when the shell identifies itself (for example header `X-Obli-Client: android`). Pair that with a native biometric app lock.

### Local login and 2FA
1. `POST /api/auth/login` (`auth.controller.ts:20`) returns `{requires2fa, methods}` and stores `pendingMfaUserId` in the same cookie session.
2. `POST /api/profile/2fa/verify` (`twoFactor.routes.ts:18`, `mfaLimiter` 50 per 15 min per IP) completes the session.

Email OTP means the user switches to the mail app. If Android kills the Activity, the cookie survives but the SPA's `step` state resets (`LoginPage.tsx:31`), so the user types the password again. Minor.

Step-up 2FA for sensitive actions: the server answers `401 {twoFactorRequired}` (`restriction.service.ts:319-331`). The axios interceptor (`client/src/api/client.ts`, via `awaitTwoFactorCode`) shows the prompt. Pure XHR, no WebView issue. For SSO users the TOTP is checked against Obligate on the server (`obligate.service.verifyTotp`).

### SSO: every navigation in order (all full-page, no popup, no iframe)
Obligate sends `frame-ancestors 'none'`, so it can never be iframed.

1. `https://obliance.D/login`: the SPA calls `GET /api/auth/sso-config` (public; returns `obligateUrl`, `obligateReachable`, `obligateEnabled`, `obligateCallback.routes.ts:460`). It then runs `window.location.href='/auth/sso-redirect'` (`client/src/pages/LoginPage.tsx:55`).
   - Anti-loop: `sessionStorage._sso_redirect_ts` (`:48-53`). **This needs `domStorageEnabled=true`.** With DOM storage off, `sessionStorage` is null, `checkSso` falls into its catch, and SSO never starts automatically.
2. `GET https://obliance.D/auth/sso-redirect` (`obligateCallback.routes.ts:328`; mounted at root by `app.ts:122` and proxied by nginx `location /auth/`, `nginx.conf:30`).
   - The server health-checks Obligate from the **server** side (2s), stores `oauthState` in the session and saves it.
   - Then it returns **302 to `{obligate_url}/authorize?client_id=<API key>&redirect_uri=https://obliance.D/auth/callback&state=…`**. This is **cross-domain hop 1** (Obliance to Obligate).
   - `redirect_uri` is built from `X-Forwarded-Proto` and `X-Forwarded-Host` (`:356-365`). If the shell's server URL is a LAN IP or a different hostname than the one registered in Obligate, the exchange fails with `/login?error=sso_failed`. The shell must use the canonical public URL.
3. On Obligate, everything stays on `obligate.D`: `/authorize`, then `/login` (SPA, with TOTP), optionally `/enroll?returnTo=…`, an "Access Denied" page if the user has no mapping, then back to `/authorize`.
4. **Cross-domain hop 2** (Obligate to Obliance): 302 to `https://obliance.D/auth/callback?code&state` (`:272`). The server checks `state` against the session cookie, exchanges the code server-to-server, provisions an `og_` user, then returns 200 HTML with `<meta http-equiv=refresh content="0;url=/">` (`:315`).
5. Logout: `client/src/store/authStore.ts:118` fetches `/api/auth/sso-logout-url`, then line 131 navigates to `{obligate}/logout?redirect_uri=https://obliance.D/login`. That is **cross-domain hop 3**. Obligate then 302s back to `/login` (**hop 4**), and LoginPage redirects to SSO again, which lands on Obligate's login screen.
6. Cross-app pill: `client/src/components/layout/Header.tsx:76-78` navigates to `{otherApp}/auth/sso-redirect?tenant=<slug>` (**hop 5**, Obliance to another Obli app, then that app to Obligate and back).
7. `_blank` links to Obligate: `ProfilePage.tsx:198` (`{obligate}/account`) and `SettingsPage.tsx:466` (Obligate "Open").
8. Cross-app device links: `DeviceDetailPage.tsx:5777` (`link.url` from `/api/auth/device-links`, `_blank`, pointing at other Obli apps).

**Rules for `shouldOverrideUrlLoading`:**
- Keep the Obliance host **and** the Obligate host inside the same WebView. Get the Obligate host from `/api/auth/sso-config` before login.
- If Obligate is sent to Chrome or a Custom Tab, the `oauthState` cookie stays in the WebView jar but the callback lands in Chrome. The result is `state mismatch`, then `/login?error=sso_failed` in Chrome, and the WebView is stuck on Obligate.
- Other Obli app hosts (from `/api/auth/connected-apps`): open them in that app's own Android shell through an App Link, or a Custom Tab (the user logs in again in Chrome), or allow them in the WebView. Allowing them fits the "base for all Obli apps" goal.
- If Obligate can be reached from the server but not from the phone (for example LAN-only), the WebView shows a network error on the Obligate host. The shell should catch `onReceivedError` for that host and offer `https://obliance.D/login?local=1`, the break-glass local form (`LoginPage.tsx:29`).
- Google's "disallowed_useragent" does not apply. Obligate has no upstream IdP; LDAP is only planned.
- The existing desktop SSO endpoints (`/api/auth/sso-desktop-init|complete`, `:578-699`) are **not usable** on Android, because the callback must be loopback (`:604-608`). A future Custom Tab flow (for passkeys or browser autofill) would need a new `sso-mobile-init` with an App Link callback plus `/.well-known/assetlinks.json`. In-WebView SSO needs **zero server changes** and is the recommendation for v1.

### Flags the shell must NOT set
- `__obliance_is_native_app` hides the app switcher and the Download link (`Header.tsx:16,107,137`). It also **hides the TenantSwitcher when there is more than one tenant** (`TenantSwitcher.tsx:36-37`), because the desktop app injects its own tab bar. Setting it on Android removes tenant switching.
- `__obliview_is_native_app` (`client/src/api/client.ts:7-9`) switches to `X-Auth-Token` mode. The Obliance server never reads that header (no match in `server/src`), and the 401 handler (`:86`) then stops redirecting to `/login`.
- Use a new flag instead, for example `window.ObliNative = {platform:'android', version, saveFile(), …}` injected by `addJavascriptInterface`.

---

## 2. Places that open a window/tab, navigate off the SPA, or trigger a download (each needs native handling)

### 2a. New window, `_blank`, top-level navigation

| file:line | What | Native handling |
|---|---|---|
| `client/src/components/devices/DeviceRow.tsx:155` | `window.open('/devices/:id','_blank')` on middle-click (tablet + mouse) | `setSupportMultipleWindows(true)` + `onCreateWindow`; same origin, so load in the main WebView |
| `client/src/pages/ReportsPage.tsx:278` | `window.open('/api/reports/outputs/:id/download','_blank')` (server: `report.routes.ts:65` `res.download`, needs cookie + tenant) | `onCreateWindow`, then treat as a download (2b) |
| `client/src/components/devices/DeviceCvesSection.tsx:125` | `<a target=_blank href=cveDetailUrl()>` (external NVD) | Custom Tab |
| `client/src/pages/CvesPage.tsx:238`, `:439` | same | Custom Tab |
| `client/src/pages/DeviceDetailPage.tsx:5777-5778` | cross-app device links, `_blank` | Obli host policy (other app shell, WebView or Custom Tab) |
| `client/src/pages/ProfilePage.tsx:198-199` | `{obligate}/account`, `_blank` | in-WebView (keeps the Obligate cookie) |
| `client/src/pages/SettingsPage.tsx:466` | `{obligate}` "Open", `_blank` | in-WebView |
| `client/src/components/layout/Header.tsx:78` | `location.href = {otherApp}/auth/sso-redirect?tenant=` | Obli host policy |
| `client/src/store/authStore.ts:131` | `location.href = {obligate}/logout?...` | in-WebView |
| `client/src/pages/LoginPage.tsx:55` | `location.href = '/auth/sso-redirect'` | in-WebView |
| `client/src/api/client.ts:89` | 401 leads to `location.href='/login'` (full reload) | none |
| `client/src/components/layout/NotificationCenter.tsx:174` | `location.href = alert.navigateTo` (full reload) | none; this is also the deep-link target for push |
| `client/src/pages/DownloadPage.tsx:82` | `location.href = '/api/oblireach-desktop/download'` (MSI) | hide on Android, show an APK card instead |

### 2b. Server-streamed downloads
Handle these in the `DownloadListener`. Use `DownloadManager.Request` with `addRequestHeader("Cookie", CookieManager.getCookie(url))` and the WebView User-Agent. The routes are session-protected.

| file:line | URL | Server |
|---|---|---|
| `client/src/components/layout/GlobalAddAgentModal.tsx:198-199` | `/api/agent/installer/wizard.exe?keyId=` (`download=` attribute) | `agentAdmin.routes.ts:30` (auth) |
| `client/src/components/layout/GlobalAddAgentModal.tsx:252-253` | `/api/agent/installer/wizard-linux-amd64?keyId=` | `agentAdmin.routes.ts:48` (auth) |
| `client/src/pages/ScriptSchedulesPage.tsx:184` | `/api/schedules/:id/history/:batch/export` (plain `<a>`) | `schedule.routes.ts:415`, CSV attachment |
| `client/src/pages/ReportsPage.tsx:278` | reports (see 2a) | `report.routes.ts:65` |
| `client/src/pages/ImportExportPage.tsx:353` | `/obliance-import-example.json` with `download=` attribute; static, served by nginx **without Content-Disposition** | without the `download` attribute honoured, the WebView navigates and renders JSON. Intercept it. |

### 2c. Blob downloads (`URL.createObjectURL` + `a.download` + `a.click()`)
**All 12 call `URL.revokeObjectURL(url)` right after `click()`**, so a native "fetch the blob URL through a JS bridge" approach fails. The `DownloadListener` receives a `blob:` URL that `DownloadManager` cannot fetch and that is already revoked.

**Fix in the client:** add one helper, `utils/saveBlob.ts`, that calls `window.ObliNative?.saveFile(base64, filename, mime)` when present (write to MediaStore Downloads) and otherwise keeps today's anchor code. Replace these call sites:

- `client/src/components/devices/DeviceTable.tsx:289-294`: device export csv/xlsx/pdf (`device.api.ts:167` `responseType:'blob'`)
- `client/src/components/devices/FileExplorerTab.tsx:373-381`: agent file download
- `client/src/components/ObliReachViewer.tsx:715-722`: screenshot PNG
- `client/src/components/ObliReachViewer.tsx:741-747`: session recording webm
- `client/src/components/networkDiscovery/GenerateDeployScriptModal.tsx:96-103`
- `client/src/components/networkDiscovery/ExportDiscoveryModal.tsx:108-115`
- `client/src/components/hyperv/HyperVVmTable.tsx:132-137` (`hyperv.api.ts:73` blob)
- `client/src/pages/AuditLogPage.tsx:174-180`
- `client/src/pages/DeviceDetailPage.tsx:2026-2033`: compliance CSV
- `client/src/pages/ImportExportPage.tsx:221-228`: full export JSON
- `client/src/pages/ScenariosPage.tsx:10-16`: scenario export
- `client/src/pages/SettingsPage.tsx:795-801`: scenarios bulk export

### 2d. Other WebView APIs that need a native hook
- **File pickers** need `WebChromeClient.onShowFileChooser`, otherwise nothing happens:
  - `GlobalChatPanel.tsx:415`, `ImportExportPage.tsx:452`, `ProfilePage.tsx:229` (avatar), `ScenariosPage.tsx:1608`, `SettingsPage.tsx:871`, `FileExplorerTab.tsx:647` (dynamic `input.click()`)
  - `SoftwareCompliancePage.tsx:1757` uses `accept=".msi,.exe,.deb,.rpm,.pkg,.dmg"`. Map extensions to `*/*`, or Android greys the files out.
- **JS dialogs** need a `WebChromeClient`. Without one, `confirm()` returns false and destructive actions silently do nothing.
  - `confirm()` has about 50 calls in 29 files.
  - `prompt()` is used at `FileExplorerTab.tsx:499`, `ApprovalsPage.tsx:76,90`, `DashboardPage.tsx:688`, `DeviceDetailPage.tsx:3951`, `SoftwareCompliancePage.tsx:1594`.
- **Fullscreen** needs `onShowCustomView`/`onHideCustomView`: `SshTerminalModal.tsx:164`, `ObliReachViewer.tsx:682`, `GlobalShellPanel.tsx:110`.
- **Clipboard:** `writeText` works (secure context plus a user gesture). `navigator.clipboard.readText()` at `ObliReachViewer.tsx:624` fails in a WebView because there is no clipboard-read permission path. Bridge it with `ObliNative.readClipboard()`.
- **WebView settings the SPA depends on:** `javaScriptEnabled`, `domStorageEnabled` (theme `oa-theme` in index.html and the SSO anti-loop). `mediaPlaybackRequiresUserGesture=false` helps ObliReach audio. WebCodecs `VideoDecoder` and `MediaRecorder` work in current Android WebView.

---

## 3. nginx and CSP headers that affect a WebView

1. **CSP does not apply to the SPA.** helmet's CSP (`app.ts:38-51`: `script-src 'self'`, `connect-src 'self' wss: ws:`) is only on Express responses (`/api/*`, `/auth/callback` HTML). nginx serves `index.html` (`client/nginx.conf:115`) and adds **no** CSP or X-Frame-Options, so nothing breaks today.
   - If a CSP matching helmet's is ever added in nginx, it breaks the inline theme `<script>` in `client/index.html` and the Google Fonts `<link>` (`fonts.googleapis.com` / `fonts.gstatic.com`). That would happen in browsers too.
   - `frameguard:false` (`app.ts:37`) is irrelevant (the WebView is top-level).
   - helmet's default COOP `same-origin` only matters for popups with `window.opener`, which are not used.
2. **CORS and CORP pin the app to the server origin.** CORS is `origin: CLIENT_ORIGIN` (`app.ts:59`), a single origin, and helmet's default CORP is `same-origin`. The shell **must load `https://obliance.D` directly**. Bundling the SPA in the APK (`file://` or `appassets.androidplatform.net`) would make every API call cross-origin: rejected by CORS, and the SameSite=Lax cookie would not be sent.
3. **`index.html` has no Cache-Control** (`nginx.conf:115-117`, only `try_files`). The WebView applies heuristic freshness from `Last-Modified` (about 10% of the file's age) and keeps its HTTP cache across app restarts.
   - After a deploy it can serve an old `index.html` pointing to hashed bundles that no longer exist. The single-bundle app then shows a white screen, and a phone has no F5.
   - Fix: `location = /index.html { add_header Cache-Control "no-cache" always; }`. `try_files … /index.html` redirects internally into it. Also add native pull-to-refresh.
4. **Static regex** `location ~* \.(js|css|png|…|svg|woff2)$ { expires 1y; immutable }` (`nginx.conf:120-123`):
   - It also covers non-hashed `/favicon.svg` and `/logo.svg`, which stay cached for a year.
   - Regex beats prefix, so any future `/api/…\.png|js|svg` route would be served from disk as a 404. The APK route below must not end in those extensions. `.apk` is safe.
5. **No compression anywhere.** nginx has no `gzip` (off by default), Express has no `compression` middleware, and socket.io leaves `perMessageDeflate` off.
   - The SPA is one multi-MB chunk: there is no `React.lazy` in `App.tsx`, and all 18 locale JSONs (about 100 KB each) are imported statically in `client/src/i18n/index.ts`. This matters on cellular.
   - Add to the `server{}` block or `nginx-main.conf` `http{}`: `gzip on; gzip_vary on; gzip_proxied any; gzip_min_length 1024; gzip_types text/css application/javascript application/json image/svg+xml;`. The APK type stays excluded because it is already zipped.
6. **Build target.** `client/vite.config.ts:22` has `build.target: 'esnext'`. Tablets with an old or non-updatable WebView (no Play Services, Fire OS) may fail to parse the bundle. Set `target: ['es2020','chrome90']`, and/or have the shell check `WebView.getCurrentWebViewPackage().versionName` and ask for an update.
7. **WebSockets** are already correct for a WebView: `/socket.io/` and `/api/` have upgrade headers and 3600s timeouts (`nginx.conf:60-93`).
   - Data cost: `DEVICE_METRICS_PUSHED` / `DEVICE_UPDATED` go to the whole `tenant:X` room (`agentHub.service.ts:193`, `device.service.ts:1440`). A foreground phone receives the whole fleet's metrics feed, and a paused WebView keeps the socket open.
   - Recommendations: the shell calls `webView.onPause()` + `pauseTimers()`, and the client disconnects the socket after about 60s hidden. The reconnect logic already exists in `socketClient.ts:85-110`.
8. **Page-level (not headers).** `index.html` viewport lacks `viewport-fit=cover`. With Android 15 edge-to-edge (targetSdk 35+), apply `WindowInsetsCompat` padding natively on the WebView container, and use `adjustResize` for the keyboard.
9. **Reverse proxy.** `/auth/` and `/api/` forward `X-Forwarded-Proto $http_x_forwarded_proto` (`nginx.conf:37`). Without an outer TLS proxy setting it, `redirect_uri` becomes `http://` and the Secure cookie is never set. The shell sees a login loop. This is a documentation point.
10. **App Links (optional).** `/.well-known/assetlinks.json` currently falls through to the SPA's `index.html`. If notification deep links or App Links for `https://obliance.D/devices/*` are wanted, add `location = /.well-known/assetlinks.json` serving static JSON.

---

## 4. Proposal: `GET /api/mobile/android/version` + APK download

This mirrors `/api/oblireach-desktop/*` (`routes/oblireachDesktop.routes.ts`, `controllers/oblireachDesktop.controller.ts`) and LifeTrack's `dist/apk-manifest.json` (versionCode + sha256 + size, generated at build time, not hashed per request).

**Layout: drop zone plus source, separate.**
```
android/                      # Gradle project (source) — NEVER in Docker context
mobile-android/               # drop zone (committed: README.md + manifest.json placeholder)
├── manifest.json             # written by the release script
├── RELEASE_NOTES.md          # optional
└── dist/obliance.apk         # signed release APK (gitignored, copied by the bat)
```
`manifest.json`:
```json
{ "schema":1, "version":"1.0.0", "versionCode":10000, "minSdk":26,
  "sha256":"…", "sizeBytes":0, "builtAt":"2026-…Z", "signerSha256":"…",
  "minSupportedVersionCode":10000 }
```

**New `server/src/controllers/mobileApp.controller.ts`:**
```ts
const ROOT = path.resolve(process.cwd(), '..', 'mobile-android'); // dev (server/) and Docker (/app/server) both OK
const MANIFEST = path.join(ROOT, 'manifest.json');
const NOTES = path.join(ROOT, 'RELEASE_NOTES.md');
const APK = path.join(ROOT, 'dist', 'obliance.apk');

export function androidVersion(_req: Request, res: Response): void {
  let m: any; try { m = JSON.parse(fs.readFileSync(MANIFEST, 'utf-8')); } catch { m = null; }
  if (!m?.version || !m?.versionCode) { res.status(503).json({ error: 'Android app version unavailable' }); return; }
  let releaseNotes: string | undefined; try { if (fs.existsSync(NOTES)) releaseNotes = fs.readFileSync(NOTES, 'utf-8'); } catch {}
  res.setHeader('Cache-Control', 'no-store');
  res.json({ app: 'obliance', packageName: '<applicationId>', ...m,
             available: fs.existsSync(APK), downloadUrl: '/api/mobile/android/download', releaseNotes });
}

export function androidDownload(_req: Request, res: Response): void {
  if (!fs.existsSync(APK)) { res.status(404).json({ error: 'APK not available' }); return; }
  let m: any = null; try { m = JSON.parse(fs.readFileSync(MANIFEST, 'utf-8')); } catch {}
  if (m?.sha256) res.setHeader('X-Content-SHA256', m.sha256);
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.attachment(`Obliance-${m?.version ?? 'latest'}.apk`);   // Content-Disposition: attachment
  res.type('application/vnd.android.package-archive');
  res.sendFile(APK);   // Range + ETag + Last-Modified for free → resumable DownloadManager
}
```
Use `res.sendFile`, not `createReadStream` as the desktop controller does, so Range and resume work. Do not `readFileSync` the whole binary to hash it per request as `agentDownload` does (`agent.controller.ts:176-178`).

**New `server/src/routes/mobileApp.routes.ts`:** public, with `router.get('/android/version', …)` and `router.get('/android/download', …)`.

**Wire-up:**
- `server/src/routes/index.ts`: add `router.use('/mobile', mobileAppRoutes);` right after line 71 (`/oblireach-desktop`), in the public block. Later, authenticated push routes go under `router.use('/mobile/push', requireAuth, …)`.
- `server/src/middleware/rateLimiter.ts`: add `req.path.startsWith('/api/mobile/android/')` to the `apiLimiter` skip list. Unauthenticated update polls from carrier IPs would otherwise count against the shared 500 per 5 min.

**`server/Dockerfile`:** after the oblireach-desktop block (`RUN mkdir -p ./oblireach-desktop/dist` / `COPY oblireach-desktop/ …`):
```dockerfile
# Obliance Android app — served by GET /api/mobile/android/{version,download}.
# manifest.json is written by 000-RegularUpdate.bat; dist/obliance.apk optional (download → 404).
RUN mkdir -p ./mobile-android/dist
COPY mobile-android/ ./mobile-android/
```

**`.dockerignore`:** it currently excludes `**/dist` and `*.md` with exceptions only for `agent/dist` and `oblireach-desktop/`. Add:
```
android
!mobile-android/dist
!mobile-android/RELEASE_NOTES.md
```
`android` keeps the Gradle tree, `local.properties` and any keystore out of the build context.

**`.gitignore`:** add `mobile-android/dist/*.apk`, `android/local.properties`, `android/.gradle/`, `android/**/build/`, `*.jks`, `*.keystore`. The APK is built on the same Windows host that runs `docker build`, so there is no need to commit it.

**Release script:** a new step in `000-RegularUpdate.bat`, edited through CP850 PowerShell only.
- It bumps `mobile-android/VERSION`, or the manifest version; Gradle derives `versionCode`.
- It runs `gradlew assembleRelease` with the keystore stored outside the repo (as LifeTrack does), `apksigner verify`, copies the APK into `mobile-android/dist/obliance.apk`, and writes `manifest.json` using `Get-FileHash`.
- Add a row to the CLAUDE.md versioning table.
- Only the server image needs a rebuild. nginx needs nothing: the route sits under `/api/`, and `.apk` is not caught by the static regex.

**Client:** add an "Android" card on `DownloadPage` (`/download`) fed by `/api/mobile/android/version`, with a QR code of the absolute download URL. Hide the MSI card on Android. The shell's updater compares `versionCode`, downloads, checks `sha256` (and `signerSha256` against its own signature), then hands the file to `PackageInstaller`.

**For the other Obli apps:** keep this exact contract (`/api/mobile/android/{version,download}`, same manifest schema) so one shared Android shell and updater module works for every app.

---

## 5. Push notifications without Google FCM

Server prerequisites, whatever the choice:
- Fix 0.1 and 0.2.
- Alerts are **tenant-scoped** (`live_alerts.tenant_id`), not per-user. The fan-out has to resolve recipients: `user_tenants` members of the tenant, plus platform admins (`users.role='admin'`) for god view. Optionally filter device alerts through `permissionService`, since today every socket in `tenant:X:notifications` receives every alert.
- The single hook point is `liveAlertService.add()` at `liveAlert.service.ts:104`. `navigateTo` is already on the row, so it becomes the deep link.

| Option | How | Real-time | Battery / UX | Server work | Verdict |
|---|---|---|---|---|---|
| **A. Foreground service holding a connection** | Native service with its own socket, not the WebView's | yes | Permanent notification. The socket.io ping every 25s keeps the radio awake. OEM battery killers (Xiaomi, Huawei, Samsung) need a battery-optimization exemption. FGS keeps network access in Doze. | Fix 0.1. Do not join `tenant:X`, which carries the metrics feed: add a notify-only mode, or better a lightweight raw WS `/api/mobile/ws` in the existing upgrade router (`index.ts:53+`) with a 3-5 min app-level heartbeat. Needs a long-lived per-device token, because the cookie dies after 7 days. | Workable, but **N Obli apps means N persistent notifications and N connections**. Android 14+ requires an FGS type: `specialUse` (fine for a sideloaded APK, no Play review) or `remoteMessaging`. `dataSync` is capped at 6h/24h on Android 15. |
| **B. WorkManager polling** | Periodic worker (15 min minimum) calls an alerts endpoint | no (15 min to hours in deep Doze) | negligible | Add `?since=<id>` to `GET /api/live-alerts/all` (`liveAlert.routes.ts:9`) or a dedicated `/api/mobile/alerts`. Device-token auth, for the same 7-day cookie reason. | A safety net and catch-up, not alerting. |
| **C. UnifiedPush (WebPush-encrypted)** | The app registers with a distributor app (ntfy, NextPush, …). The distributor holds **one** connection for all apps. The server POSTs encrypted payloads to the endpoint URL. | yes | Best: one shared connection. The user installs ntfy (F-Droid or Play) pointed at a self-hosted ntfy server or ntfy.sh. | New table `mobile_devices` (migration 125: `id, user_id, token_hash, name, up_endpoint, p256dh, auth, tenant_filter, min_severity, created_at, last_seen_at, revoked_at`). `POST/DELETE /api/mobile/push/subscriptions` (requireAuth; register from the shell using the WebView cookie). `GET /api/mobile/push/vapid-public-key` (VAPID keys stored in `app_config`). Sender uses npm `web-push` (pure JS, fine on Alpine) with TTL and `urgency:'high'`; delete subscriptions on 404/410. Payload of 4 KB max: title, severity, tenant, `navigateTo`, no secrets. The server already ships `notifications/plugins/ntfy.ts`, so ntfy is familiar in this setup. | **Recommended primary.** |

**Recommendation.**
1. **v1:** fix 0.1 and 0.2. While the app is in the foreground, use in-app real-time through the WebView socket. Add WorkManager 15-min catch-up against `/api/live-alerts/all?since=` using a revocable per-device token issued at first login (list and revoke it on the Profile page). This needs zero new infrastructure and works on every device.
2. **v1.1 primary: UnifiedPush with WebPush encryption,** hooked at `liveAlert.service.ts:104`, using the `org.unifiedpush.android:connector` library. It is real-time and cheap on battery. Above all, it scales to the whole Obli suite: every Obli app's shell registers with the same distributor, so one connection covers all apps. The server module (`mobilePush.service.ts` + routes + migration) can be copied as-is into each app.
3. **Opt-in fallback** when no distributor is installed: an Option A "persistent connection" toggle using the raw `/api/mobile/ws` endpoint and FGS type `specialUse`, with a clear battery warning. Skip FCM entirely.

Android side for all options: `POST_NOTIFICATIONS` runtime permission (API 33+), one notification channel per severity (info / warning / critical), and a tap action that opens the WebView at `navigateTo`.

---

## 6. Server / nginx / client change checklist

**Server**
1. `socket.ts`: session-based auth via `io.engine.use(session)`. Export the middleware from `app.ts`.
2. `liveAlert.service.ts:104`: emit `SocketEvents.NOTIFICATION_NEW`.
3. `tfaTrust.service.ts:10`: stop trusting the first `X-Forwarded-For` entry.
4. New `mobileApp.controller.ts` + `mobileApp.routes.ts`; mount at `routes/index.ts` after line 71; add to the `apiLimiter` skip list.
5. Optional: `rolling: true`, or a longer cookie `maxAge` for the mobile client (`app.ts:106-112`).
6. Later: `mobilePush.service.ts`, `/api/mobile/push/*`, migration 125 `mobile_devices`, `web-push` dependency, `?since=` on `/api/live-alerts/all`.

**Build and packaging**
7. `server/Dockerfile`: `mobile-android/` COPY block.
8. `.dockerignore`: `android`, `!mobile-android/dist`, `!mobile-android/RELEASE_NOTES.md`.
9. `.gitignore`: APK, keystore and Gradle entries.
10. Release script step (CP850 edit) and a CLAUDE.md versioning row.

**nginx (`client/nginx.conf`)**
11. `Cache-Control: no-cache` on `/index.html`.
12. gzip block.
13. Optional: exact-match `assetlinks.json` location.
14. Optional: narrow the 1y-immutable regex to `/assets/`.

**Client**
15. `utils/saveBlob.ts` helper used by the 12 blob call sites (section 2c), plus the `window.ObliNative` bridge contract.
16. A new Android flag. Do not reuse `__obliance_is_native_app` or `__obliview_is_native_app`.
17. Android card on `DownloadPage`.
18. `vite.config.ts` `build.target` lowered.
19. Disconnect the socket after the page has been hidden for about 60s.