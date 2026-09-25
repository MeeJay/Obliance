# LifeTrack Android build: research for an Obliance Android app

LifeTrack's Android toolchain is already installed on this machine and works for a new app. It needs network access for any dependency set that differs from LifeTrack's, and the network is up. I proved this with a small Compose test project in the scratchpad: it built debug and release APKs in 3 min 17 s on a first run. No LifeTrack file was changed.

A note on `D:\AndroidBuild`: it is not LifeTrack's toolchain. `construire-apk-vigie.ps1` builds a different project, Vigie, which is an Expo/React Native app at `D:\GTLLM\vigie\mobile\android`. It uses a portable Temurin JDK 17.0.20.1 in `D:\AndroidBuild\jdk`, a portable SDK in `D:\AndroidBuild\sdk` (only cmdline-tools and platform-tools, no platforms or build-tools yet) and Gradle 9.3.1. It signs with the debug key, so its APKs can be installed but not published. `build-2.log` stops partway through the Gradle plugin compile (last write 18:02). Do not reuse it for Obliance.

## (1) Toolchain

| Item | Value |
|---|---|
| JDK | Microsoft OpenJDK **21.0.8** at `C:\Program Files\Android\openjdk\jdk-21.0.8`. Java is **not on PATH** and no global `JAVA_HOME` is set, so every session must run `$env:JAVA_HOME = 'C:\Program Files\Android\openjdk\jdk-21.0.8'`. |
| Android SDK | `D:\LifeTrack\.android-sdk`, git-ignored. cmdline-tools 12.0 (`latest`) and platform-tools (adb). |
| SDK platforms installed | `android-36`, `android-37.0`, `android-37.1` |
| Build-tools installed | `36.0.0`, `36.1.0`, `37.0.0` (apksigner.bat, aapt2.exe, zipalign.exe) |
| Gradle wrapper | **9.7.0**, from `gradle-wrapper.properties`: `distributionUrl=https\://services.gradle.org/distributions/gradle-9.7.0-bin.zip`. Both 9.7.0 and 9.3.1 are unpacked in `C:\Users\MeeJay\.gradle\wrapper\dists`. |
| AGP | **9.3.1**. AGP 9 includes Kotlin itself ("built-in Kotlin"), so there must be no `org.jetbrains.kotlin.android` plugin. |
| Kotlin | **2.2.10**. This is forced: it must equal the Kotlin version bundled with AGP 9.3.1. |
| KSP | 2.2.10-2.0.2 |
| Compose BOM | **2026.08.00** (material3 1.4.0, compose-ui 1.12.0) |
| Main AndroidX libraries | core-ktx 1.19.0, activity-compose 1.13.0, lifecycle 2.11.0, navigation-compose 2.9.8, work 2.11.2, room 2.8.4, datastore 1.2.1, security-crypto 1.1.0 |
| Other libraries | okhttp 5.4.0, kotlinx-serialization 1.9.0, coroutines 1.10.2, coil 3.3.0 (pinned, see §6) |
| compileSdk / minSdk / targetSdk | **37 / 28 / 37** |
| Java/JVM target | 17 |
| ABI | `abiFilters += "arm64-v8a"` only |

### Can a build run offline?

**Only for LifeTrack's exact dependency set.**

What is on disk:
- `C:\Users\MeeJay\.gradle\caches` is well populated: `modules-2/files-2.1` is 832 MB across 149 groups, `build-cache-1` is 696 MB, `caches/9.7.0` is 973 MB.
- AGP 9.3.1 (also 8.5.0 and 8.12.0), Kotlin 2.2.10, KSP, compose-bom 2026.08.00, aapt2 9.3.1 and the full LifeTrack library set are all cached.

What I tested, with a small Compose project using LifeTrack's version catalog:
- **`--offline` failed** because a smaller dependency set resolves to different transitive versions that are not cached: `room-runtime:2.7.0`, `exifinterface:1.4.1`, `profileinstaller:1.4.0`, `tracing:1.2.0`.
- **Online it succeeded**: `assembleDebug assembleRelease` completed in 3 min 17 s on the first run.
  - The debug APK was 35.5 MB.
  - The unsigned release APK was 27.9 MB, with R8 off.

Network check: dl.google.com, repo.maven.apache.org and services.gradle.org all returned 200.

Not cached, so they must be downloaded if the tablet UI needs them:
- `androidx.compose.material3.adaptive` / window-size-class
- `material-icons-core` and `material-icons-extended`

LifeTrack itself is phone-only. It has no WindowSizeClass or NavigationRail code, and its icons are vector drawables in `res/drawable`.

## (2) Commands to build a signed release APK

These are LifeTrack's steps (PowerShell, one command per line):

```powershell
$env:JAVA_HOME = 'C:\Program Files\Android\openjdk\jdk-21.0.8'
cd D:\LifeTrack\apps\android
.\gradlew.bat assembleRelease          # signing comes from local.properties (lifetrack.keystore.*)
#   or pass the values explicitly: "-Plifetrack.keystore.file=D:/..." "-Plifetrack.keystore.password=..." "-Plifetrack.key.alias=lifetrack" "-Plifetrack.key.password=..."
& 'D:\LifeTrack\.android-sdk\build-tools\37.0.0\apksigner.bat' verify --print-certs app\build\outputs\apk\release\app-release.apk
#   the "certificate SHA-256 digest" line must equal RELEASE-FINGERPRINT.txt, otherwise STOP and publish nothing
Copy-Item app\build\outputs\apk\release\app-release.apk D:\LifeTrack\dist\lifetrack-companion-<ver>.apk   # and delete the previous APK in dist/
powershell -ExecutionPolicy Bypass -File D:\LifeTrack\apps\landing\tools\build-apk-manifest.ps1
docker compose build web ; docker compose up -d web     # the APK is baked into the web image
```

Useful checks before releasing: `.\gradlew.bat testDebugUnitTest` and `.\gradlew.bat lintDebug` (lint is configured with `abortOnError=true`).

If the four signing values are missing, the release build comes out **unsigned** (`app-release-unsigned.apk`) and does not fail. There is no `release-apk.ps1` yet: ROADMAP A4 proposes one but it was never written.

## (3) Signing model

**Where the key lives.**
- Keystore: `D:\LifeTrack\.secrets\lifetrack-release.jks` (4,414 bytes, RSA 4096, SHA384withRSA, `CN=LifeTrack Companion, OU=Self-hosted, O=Obliance Prod, L=Paris, C=FR`).
- Password: `.secrets\keystore-password.txt`.
- `.secrets/` is git-ignored, and `.gitignore` also blocks `*.jks`, `*.keystore`, `keystore.properties`, `local.properties` and `keystore-hors-machine/`.

**Keys in `local.properties`** (values not shown): `sdk.dir`, `lifetrack.keystore.file`, `lifetrack.keystore.password`, `lifetrack.key.alias`, `lifetrack.key.password`.

**How `app/build.gradle.kts` loads them.**
- It explicitly loads `local.properties` into a `Properties` object. Gradle does not do this on its own, which is how the first key was lost.
- A `secret(name)` helper looks in three places, in order: the `-P` property, then `local.properties`, then an environment variable (`LIFETRACK_KEYSTORE_FILE` and so on).
- The `signingConfigs.release` block is only created when the keystore path is set.

**Debug builds** use `C:\Users\MeeJay\.android\debug.keystore`, which exists. Debug has `applicationIdSuffix=".debug"`, so debug and release installs can sit side by side.

**Fingerprint pinning.** The SHA-256 is recorded in two places, on purpose, because it is not a secret:
- `apps/android/RELEASE-FINGERPRINT.txt`
- `ops/offsite/keystore-fingerprint.txt`

The fingerprint is `4aa6ffa1…154b9e`. The rule is to check it with `apksigner verify --print-certs` on the published APK before every release; if it differs, stop.

**Archiving policy** (`ops/keystore-archive.ps1` / `.sh`, and `ops/README.md` section "Le keystore Android — trois copies"):
- It keeps three independent copies:
  - **A**: an attachment in a password manager, done by hand. It is still not done.
  - **B**: a `.tar.age` archive on a USB key kept at another address.
  - **C**: an A4 page with 6 QR codes, including the password by default.
- The script needs Docker because age and qrencode live in the `backup` image. It then re-reads the fingerprint with keytool, with the password piped on stdin, never in argv.
- The keystore is deliberately **not** in the nightly backup, so it cannot be rotated out and does not share the same age key.
- The fallback "Sans Docker" procedure (base64 split into 6 blocks, then a real `apksigner sign` with the restored copy) is documented.

## (4) versionCode / versionName conventions

- `versionCode` is an integer that goes up by 1 every release. It is currently **35**.
- `versionName = "0.<versionCode>.0"` (0.3.0 = 3, 0.35.0 = 35).
- The changelog is written as a long comment block just above `versionCode` in `app/build.gradle.kts`.
- Only `versionCode` is ever compared, because as strings "0.10.0" sorts below "0.9.0". The manifest generator reads the code from the APK itself (`aapt2 dump badging`) and writes a `<apk>.version-code` sidecar so a Linux host without an SDK can regenerate the manifest.
- The default server URL is the Gradle property `lifetrack.server.url` in `gradle.properties`, exposed as `BuildConfig.DEFAULT_SERVER_URL`. It can be overridden with `-Plifetrack.server.url=...`.

## (5) Update check and APK distribution

**Server side** (static files served by nginx, not by the API):
- The APKs and `apk-manifest.json` are **tracked in git** under `D:\LifeTrack\dist` (a deliberate decision of 2026-08-19). `docker/web.Dockerfile` copies them in with `COPY dist/ /srv/downloads/`. Only one APK is kept in `dist/`.
- `GET /downloads/apk-manifest.json` is served with `Cache-Control: no-store`. It has this shape:
  ```json
  {"schema":1,"generated_at":"…Z","latest":"lifetrack-companion-0.35.0.apk","latest_version_code":35,
   "apks":[{"file":"…apk","version":"0.35.0","version_code":35,"size_bytes":71229687,"sha256":"…","built_at":"…Z"}]}
  ```
- `GET /downloads/<name>.apk` is served as `application/vnd.android.package-archive` with `Content-Disposition: attachment` and `Cache-Control: public, max-age=31536000, immutable`, and without gzip. A missing file gets a French "bientôt disponible" page.
- `lifetrack-companion-latest.apk` is a hard link to the newest APK (a copy if hard links are refused). It gives the web and landing pages a link that works without JavaScript; the web component is `apps/web/src/components/companion/CompanionApk.tsx`.

**App side** (package `update/`, about 2,000 lines, with unit tests):
- **Which server.** The app asks the server it is configured for (account server, then device-key server, then `DEFAULT_SERVER_URL`). The manifest URL is that server plus `/downloads/apk-manifest.json`. It sends `Cache-Control: no-cache`, and refuses cleartext HTTP unless the user opted in.
- **When it checks.**
  - At launch, with a 24-hour budget.
  - After every sync, as a "passenger": it can report good news but never shows a failure.
  - On "Vérifier maintenant", which ignores the budget.
- **Version comparison.** Integers only. `newerThan` scans the whole `apks` list rather than trusting `latest_version_code`.
- **Download.** It uses the system `DownloadManager` (survives the app being killed on HyperOS, shows its own progress notification). The file goes to `getExternalFilesDir(DIRECTORY_DOWNLOADS)`, which needs no storage permission. Metered networks are allowed, roaming is not.
- **Completion and verification.** `UpdateDownloadReceiver` listens for `DOWNLOAD_COMPLETE` (`exported="false"`) and checks that the download id is its own. It then compares the file's SHA-256 with the manifest. On a mismatch it deletes the file and reports `CHECKSUM_MISMATCH`.
- **Notification.** Channel `lifetrack-updates` at `IMPORTANCE_DEFAULT`, which requires `POST_NOTIFICATIONS`.
- **Install** (`ApkInstaller`):
  - It first checks `canRequestPackageInstalls()`. If that is false, it opens `Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES` with a `package:` URI, and falls back to the version without a URI because HyperOS ignores it.
  - It launches `ACTION_VIEW` on a `content://` URI from a `FileProvider` with authority `${applicationId}.updates`. It uses `ACTION_VIEW`, not `ACTION_INSTALL_PACKAGE`, and adds `FLAG_GRANT_READ_URI_PERMISSION` and `FLAG_ACTIVITY_NEW_TASK`.
  - `res/xml/file_paths.xml` exposes exactly one path: `<external-files-path name="updates" path="Download/"/>`.
  - If install fails, it offers two fallbacks: open the file with any handler, or open `{server}/downloads/` in the browser.
- **Manifest permissions:** `REQUEST_INSTALL_PACKAGES`, `POST_NOTIFICATIONS`, `INTERNET`, `ACCESS_NETWORK_STATE`. `usesCleartextTraffic="true"` is only a capability; the code enforces the actual rule. `allowBackup="false"` together with `data_extraction_rules.xml`.

## (6) Lessons and pitfalls documented

- **Lost key.** The first keystore was lost because Gradle does not load `local.properties` as project properties. The release build came out unsigned without any error. Every 0.1.0 install had to be uninstalled. The fix is the explicit `Properties()` loader in `app/build.gradle.kts`.
- **AGP 9 quirks.**
  - Built-in Kotlin: adding the `kotlin.android` plugin is a hard error.
  - The Kotlin, Compose-compiler, serialization and KSP versions must all equal AGP's bundled Kotlin (2.2.10).
  - KSP needs `android.disallowKotlinSourceSets=false`.
  - `resValues` is off by default and must be set to `resValues = true`.
  - `compileSdk` must be 37 because core 1.19, compose-ui 1.12 and lifecycle 2.11 refuse 36.
  - Coil is pinned at 3.3.0 because 3.4 and later pull a newer kotlin-stdlib, which breaks every Kotlin file with "incompatible version of Kotlin".
- **APK size.**
  - `material-icons-extended` alone added about 32–70 MB of dex, so use vector drawables instead.
  - R8 is off: easier to debug, but a much larger APK. The keep rules for kotlinx.serialization and OkHttp are already in `proguard-rules.pro`.
  - The arm64-only ABI filter cut the APK from 30.5 to 15.7 MB, but the APK then **won't install on an x86 emulator or a 32-bit device**. That matters for tablets: Vigie keeps 32-bit ARM because Sunmi tablets are often 32-bit.
- **HyperOS.**
  - It blocks background work: autostart must be enabled, the battery policy set to "Sans restriction", and swiping the app away from recents counts as a force-stop.
  - The app mitigates this with a network-only constraint on the worker, `ExistingPeriodicWorkPolicy.UPDATE`, re-scheduling on BOOT_COMPLETED / MY_PACKAGE_REPLACED, 10-minute exponential backoff, and a `foregroundServiceType="dataSync"` merged into the WorkManager service to avoid `MissingForegroundServiceTypeException` on Android 14+.
  - `OemSettingsIntents` deep-links to the MIUI autostart and battery screens.
  - Installing by hand triggers a MIUI security scan, and "Vérifier les applications avant l'installation" may block it.
- **Tooling traps.**
  - On this French-locale JDK, keytool prints `SHA 256:`, so run it with `-J-Duser.language=en`.
  - apksigner's `--ks-pass file:` needs **two lines** when `--key-pass` points at the same file.
  - PowerShell 5.1 scripts containing non-ASCII must be UTF-8 **with BOM**.
  - `ErrorActionPreference=Stop` turns native-tool stderr into fatal errors.
  - Gradle `-D` does not reach the forked test JVM, so it must be forwarded in `tasks.withType<Test>`.
  - Build on Windows only: devlinux does not have enough RAM.
- **Documentation drift.** The README still describes 0.3.0 and RELEASE-FINGERPRINT says "last seen 0.31.0", while `dist/` holds 0.35.0. ROADMAP flags that hard-coded numbers in prose go stale.

## (7) Files that can be copied as a template

These can be copied verbatim, renaming the `lifetrack.*` / `com.example.lifetrack` identifiers (for example to `obliance.*` / `tools.obli.obliance`):
- `D:\LifeTrack\apps\android\gradlew`, `gradlew.bat`, `gradle\wrapper\gradle-wrapper.jar`, `gradle\wrapper\gradle-wrapper.properties`
- `D:\LifeTrack\apps\android\gradle\libs.versions.toml`: drop the Health Connect, CameraX, ML Kit and Room entries if unused; add `material3-adaptive` if needed.
- `D:\LifeTrack\apps\android\settings.gradle.kts`, `build.gradle.kts` (root), `gradle.properties` (change the server-URL property), `local.properties.example`
- `D:\LifeTrack\apps\android\app\build.gradle.kts`: keep the `localProperties` + `secret()` + signingConfigs + `DEFAULT_SERVER_URL` + lint/packaging blocks, and drop the changelog comments and the LifeTrack-only dependencies.
- `D:\LifeTrack\apps\android\app\proguard-rules.pro`
- Update feature, taking the whole package: `D:\LifeTrack\apps\android\app\src\main\kotlin\com\example\lifetrack\update\` (`UpdateContract.kt`, `UpdateVersions.kt`, `ApkManifestParser.kt`, `Sha256.kt`, `DefaultUpdateRepository.kt`, `UpdateModule.kt`, `UpdateNotifications.kt`, `StoredUpdateServerSource.kt`, `download\*`, `install\ApkInstaller.kt`, `net\OkHttpApkManifestClient.kt`, `store\SharedPreferencesUpdateStore.kt`), plus `ui\update\*`, `res\xml\file_paths.xml`, `res\values\strings_update.xml`, and the provider/receiver/permissions blocks from `AndroidManifest.xml`. The tests are in `app\src\test\kotlin\...\update\`.
- Publishing: `D:\LifeTrack\apps\landing\tools\build-apk-manifest.ps1` and `.sh`, and the `/downloads/` locations in `D:\LifeTrack\docker\nginx.conf` (lines 350–396).
- Keystore safety: `D:\LifeTrack\ops\keystore-archive.ps1` (it depends on LifeTrack's Docker `backup` image, so adapt it or use the manual "sans Docker" procedure), `apps\android\RELEASE-FINGERPRINT.txt` as a pattern, and the signing rules from `D:\LifeTrack\.gitignore` (lines 31–85).
- The minimal project I built is in the scratchpad (`...\scratchpad\offline-probe`, config files and one screen). It builds with the same toolchain and is a clean starting point.

For Obliance, the local-machine settings would be: `sdk.dir=D:/LifeTrack/.android-sdk` (forward slashes avoid escaping), `$env:JAVA_HOME` set to JDK 21, a new keystore made with `keytool -genkeypair ... -keyalg RSA -keysize 4096 -validity 10950` into `D:\Obliance\.secrets\`, and its fingerprint recorded in the repo before the first release.