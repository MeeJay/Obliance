Server APK distribution and the platform fixes are in place. Server and client type-checks are clean, apart from the known noise (`@xyflow`; exceljs, bcryptjs, cron-parser, multer, playwright-chromium, `softwareRepo.routes.ts`). I ran the new endpoints in a local Express smoke test against a temporary drop zone and they behave as specified. Not tested: `nginx -t` (no access to the Docker daemon) and a full `vite build` (`@xyflow/react` is not installed).

**Routes** (public, no auth, mounted at `/api/mobile`, skipped by `apiLimiter`)
- `GET /api/mobile/android/version`
  - Always sends `Cache-Control: no-store`.
  - Returns 503 when `mobile/release/manifest.json` is missing or invalid. It is valid when `version` is a non-empty string and `versionCode` is an integer ≥ 0.
  - Returns 200 with `{app, packageName, version, versionCode, minSupportedVersionCode, minSdk, sha256, sizeBytes, signerSha256, builtAt, available, downloadUrl:"/api/mobile/android/download", releaseNotes}`.
  - Two changes to what you specified:
    - `available` is true only when a non-empty APK exists **and** `versionCode > 0`, so a stray APK next to the placeholder manifest is never offered.
    - `minSdk` is an extra field. The download page uses it to show "Android 8.0+".
  - SHA-256 values are normalised to lowercase hex with no colons. If the manifest has no `sha256`, the server hashes the APK once and caches the result (keyed on size and modification time), never per request.
- `GET /api/mobile/android/download`
  - Returns 404 unless `/version` would report `available: true`.
  - Otherwise serves the file with `res.sendFile`, so Range (206/416), ETag, Last-Modified and HEAD work.
  - Headers: `Content-Type: application/vnd.android.package-archive`, `Content-Disposition: attachment; filename="Obliance-<version>.apk"`, `X-Content-SHA256`.
  - `Cache-Control: no-cache` instead of the desktop route's 5-minute cache, so a cached copy can never outlive a release and fail the shell's SHA check.
- Paths resolve to `process.cwd()/../mobile/release`, which is `/app/mobile/release` in Docker.

**Files**
- **New:**
  - `D:\Obliance\server\src\controllers\mobileApp.controller.ts`
  - `D:\Obliance\server\src\routes\mobileApp.routes.ts`
  - `D:\Obliance\mobile\release\README.md`: layout, manifest field rules, endpoints, release steps.
  - `D:\Obliance\mobile\release\manifest.json`: placeholder with `version "0.0.0"`, `versionCode 0` and null hashes/package, which returns 200 with `available: false`.
  - `D:\Obliance\client\src\i18n\_pending\apkdist.en.json` and `apkdist.fr.json`: 40 flat keys each, in `download.android.*` plus nine existing page keys that were missing from the locales and currently show as raw keys. The French uses vouvoiement.
- `server/src/routes/index.ts`: `router.use('/mobile', mobileAppRoutes)` right after `/oblireach-desktop`.
- `server/src/middleware/rateLimiter.ts`: skips `req.path.startsWith('/api/mobile/android/')`.
- `server/Dockerfile`: adds `RUN mkdir -p ./mobile/release` and `COPY mobile/release/ ./mobile/release/` after the oblireach-desktop block. The build never breaks, because README and manifest are committed.
- `.dockerignore` (repo root): both builds use it, via `docker build -f server/Dockerfile .` and `-f client/Dockerfile .`. Adds `mobile/*`, `!mobile/release`, `!mobile/release/RELEASE_NOTES.md`, `**/*.jks`, `**/*.keystore`, `**/.secrets`, so the Gradle project never enters the Docker build context.
- `.gitignore`: adds `mobile/release/*.apk`, `mobile/android/local.properties`, `mobile/android/.gradle/`, `mobile/android/**/build/`, `*.jks`, `*.keystore`, `.secrets/`.
- `client/nginx.conf`:
  - gzip at server level (`gzip_vary`, `gzip_proxied any`, level 5, min 1024) for text, CSS, JS, JSON, XML, web manifest and SVG. The APK type, octet-stream and images are not listed.
  - `location = /index.html { add_header Cache-Control "no-cache" always; }`.
  - One addition you didn't ask for: `gzip off;` in `location /api/agent/`, so the agent traffic is unchanged.
  - Everything else is untouched.
- `client/vite.config.ts`: `target: ['es2020','chrome87','edge88','firefox78','safari14']`, which is Vite 5's own "modules" baseline.
  - **Why this target:** the only thing that needed `esnext` was `@novnc/novnc`'s top-level await, and noVNC is no longer imported anywhere in `client/src`. There is no top-level await or class static block in `src/`.
  - **Checked:** I bundled the client (without `@xyflow`) with esbuild at es2020/chrome87 and even es2015, with no errors. The `esnext` output already contained ES2021/ES2022 syntax (`||=`, class fields).
  - **Why not lower:** Chrome 87 is Vite's official floor without the legacy plugin, and the Tailwind layout needs flex `gap` (Chrome 84) anyway.
  - **Not checked:** `@xyflow/react`, because it is not installed.
- `client/src/pages/DownloadPage.tsx`: uses `@/native/bridge` (the Foundation agent's file now exists), `utils/download` and `utils/clipboard`.
  - **In a browser:** the Oblireach Desktop section is unchanged, followed by a "Mobile app" section with an Android card. The card shows version, date, size and required Android version, a download link to the absolute URL, the copyable direct link, four install steps (including this server's address), release notes, and a collapsible block with the package, SHA-256 and signer fingerprint.
  - **Inside the Android app (`isAndroidApp()`):** the desktop section is hidden. The page shows "You are using the app vX", the server's latest version and a "Check for updates" button that calls `native.checkForUpdate()`. If the shell lacks the `update` capability and the server has a newer version, it offers a DownloadManager download instead.
  - **Indentation:** the file was flattened to one space per line, like many files in the repo. I re-indented it properly, so the diff covers the whole file.

**Notes for the orchestrator**
- Existing bug, not fixed: in the locales, `download.title` and `download.description` still say "Obli.tools", so the page header doesn't match the Oblireach Desktop MSI it offers.
- The Android shell should check that the WebView is version 87 or newer and ask for an update below that.
- A QR code of the download URL was suggested in the research, but no QR library is installed.
- Nothing was committed and no `*.bat` or `CLAUDE.md` was touched.

→ Build a lancer : **server + client**