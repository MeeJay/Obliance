I built the Android shell "Obli Shell" in `D:\Obliance\mobile\android`. All ten features are in place, and the requested gradlew run passes. There are three gaps. Nothing was run on a device or emulator. The release APK is unsigned. `gradlew.bat` will not be committed as the repo is set up now.

**Build result.** `testOblianceDebugUnitTest assembleOblianceDebug assembleOblianceRelease` succeeded. `lintOblianceDebug` reports 0 errors and 9 warnings, all "newer version available". The one lint error, the unescaped drive colon in `sdk.dir`, is fixed: it now reads `sdk.dir=D\:/LifeTrack/.android-sdk`. I also built `assembleObliviewDebug` to check that a second flavor works with the generic icon. Build finished at 21:43.

**Tests.** 96 JVM tests in 12 classes, 0 failures, 0 skipped. They cover:
- the navigation policy, origins and the parsing of `sso-config` and the linked apps list;
- server URL normalisation;
- bridge message parsing and parameter validation;
- update manifest parsing, the integer versionCode comparison, the 24 h check budget, versionCode derivation (including a check against `VERSION`) and the signing-certificate check;
- the live-alert parsing and high-water logic;
- the lock timing rule, the file chooser type mapping, Content-Disposition file names and the WebView version check.

One test also runs the injected bridge script in Node against a fake `__obliBridge`, and it passed.

**APKs**

| Build | Path | Size |
|---|---|---|
| obliance debug | `D:\Obliance\mobile\android\app\build\outputs\apk\obliance\debug\app-obliance-debug.apk` | 14,811,364 bytes |
| obliance release (R8, unsigned) | `D:\Obliance\mobile\android\app\build\outputs\apk\obliance\release\app-obliance-release-unsigned.apk` | 2,127,150 bytes |
| obliview debug | `D:\Obliance\mobile\android\app\build\outputs\apk\obliview\debug\app-obliview-debug.apk` | 13,961,847 bytes |

The release APK reports package `tools.obli.obliance`, versionCode 10000, versionName 1.0.0, minSdk 26, targetSdk 37.

**Versions used.** Gradle 9.7.0, AGP 9.3.1 with its built-in Kotlin 2.2.10 (the separate Kotlin plugin is not applied), Compose BOM 2026.08.00, compileSdk and targetSdk 37, minSdk 26, JDK 21. Libraries: core-ktx 1.19.0, appcompat 1.7.1, activity-compose 1.13.0, lifecycle 2.11.0, work 2.11.2, webkit 1.17.1, browser 1.10.0, biometric 1.1.0 (newest stable; newer releases are alpha), kotlinx-serialization-json 1.9.0, coroutines 1.10.2, junit 4.13.2.

**How it is organised.**
- **Seven flavors from one table** in `app/build.gradle.kts`. Each gets `tools.obli.<id>`, its colours and a `obli-<id>://setup` deep link. There is no per-app Kotlin.
- **Obliance icon.** The Obliance launcher icon is an adaptive vector drawn from the two paths and gradients of `Ance.svg` on the #0f1220 background. The other six apps get an "O" ring in their accent colour.
- **Signing.** Release is signed only when all four `obli.keystore.*` / `obli.key.*` values are given. With none, the build is unsigned. With only some, the build fails with an explicit message.
- **Where the code lives.** Most of the logic is plain Kotlin under `nav/`, `bridge/`, `update/` and `alerts/`, which is what the tests exercise. `MainActivity.kt` holds the single WebView with Compose overlays for setup, errors, lock and dialogs.
- **README.** `README.md` is in French and covers architecture, building, adding a flavor, signing and the release process.

**Not done, or to know**
1. **No runtime check on a device.** The build host is a Hyper-V VM with no virtualisation extensions and no device is attached, so no emulator can run. I checked the release bridge from the outside instead. R8's seeds keep `NativeBridge.onPostMessage`, the webkit message listener adapter and the Chromium boundary interfaces, and the dex contains `addDocumentStartJavaScript`. Proof that the bridge works in a real release build needs a phone.
2. **Release is unsigned.** No keystore was created, as instructed.
3. **`gradlew.bat` is excluded by the repo-wide `*.bat` rule** in the root `.gitignore`, which CLAUDE.md says never to remove. Committing it needs a `!mobile/android/gradlew.bat` exception, and that is your call.
4. **Contract points to settle in `docs/obli-mobile.md`** for whoever writes the web side (`client/src/native/bridge.ts`):
   - `setSystemBars` is ambiguous. The name `lightIcons` suggests light icons, but the doc's example (`'#0f1220', false`) would put dark icons on a dark bar. For clearly dark or clearly light colours the shell now picks the readable icon colour itself; the flag only decides for mid tones.
   - Bridge `params` are accepted as a named object (what the injected wrapper sends) or as a positional array.
   - Return values the contract does not specify: `downloadUrl` returns `{id}`, `notify` returns `true`/`false`, `readClipboard` returns a string, the others return `true`.
   - `checkForUpdate` also shows the native update dialog unless called with `{prompt:false}`.
5. **The server's `manifest.json` must set `packageName: "tools.obli.obliance"`.** A mismatched package name makes the shell refuse the update. Debug builds (package ends in `.debug`) are never offered the release APK, by design.
6. **Receivers and sibling apps.**
   - The update-download receiver is exported, because the download-complete broadcast comes from the system download service (a different app ID). It only acts on its own download and verifies the SHA-256 and the signing certificate before offering the install.
   - To open another Obli app, the shell sends it a `tools.obli.action.OPEN_URL` intent. The receiving shell only opens pages of its own server, never `/api/*` or `/auth/*` except `/auth/sso-redirect`.
7. **Only the obliance and obliview flavors were built.** The other five are generated from the same table but were not built.

No server or client file was changed, so there is no server or client build to run.