# Obli mobile (Android) — release drop zone

This directory holds the **signed Android APK** and its manifest. The server
serves both to the Android shell's updater and to the `/download` page.
The contract is `docs/obli-mobile.md` §6. Every Obli app uses the same
contract and manifest schema, so one shared shell updater works for all of them.

The Gradle project lives in `mobile/android/`. **It never enters the Docker
build context** (see `.dockerignore`). Only this directory is copied into the
server image (`server/Dockerfile` → `/app/mobile/release`).

## Layout

```
mobile/release/
├── README.md          # this file (committed)
├── manifest.json      # committed as a placeholder; rewritten by the release script
├── RELEASE_NOTES.md   # optional, returned verbatim as `releaseNotes`
└── obliance.apk       # signed release APK (gitignored; copied by the release script)
```

## `manifest.json`

```json
{
  "schema": 1,
  "app": "obliance",
  "packageName": "<applicationId>",
  "version": "1.0.0",
  "versionCode": 10000,
  "minSupportedVersionCode": 0,
  "minSdk": 26,
  "sha256": "<sha-256 of obliance.apk, 64 hex chars>",
  "sizeBytes": 12345678,
  "signerSha256": "<sha-256 of the signing certificate, 64 hex chars>",
  "builtAt": "2026-09-24T12:00:00Z"
}
```

| Field | Rule |
|---|---|
| `version` | Required. `versionName`, no `v` prefix. |
| `versionCode` | Required. Integer ≥ 0. **`0` means "no release"** (the committed placeholder): the endpoint then returns `available: false`, even if an APK is present. |
| `minSupportedVersionCode` | Shells below this should force the update. `0` means no minimum. |
| `sha256` | Hex digest of `obliance.apk` (`Get-FileHash -Algorithm SHA256`). Case and `:` separators are normalized. If it is missing, the server hashes the file once and caches the result. |
| `signerSha256` | Signing certificate digest as printed by `apksigner verify --print-certs` ("certificate SHA-256 digest"). The shell refuses an APK whose signer differs from its own. |
| `sizeBytes` | Informational. When the APK exists, the server reports the real file size. |
| `builtAt` | ISO-8601 UTC. |

The server reads the manifest on every request (no cache), so replacing the
files in a running dev checkout takes effect immediately. In production the
files are baked into the server image: **a new APK means a server image rebuild.**

## Endpoints (public, no auth, not rate-limited)

| Route | Response |
|---|---|
| `GET /api/mobile/android/version` | `{app, packageName, version, versionCode, minSupportedVersionCode, minSdk, sha256, sizeBytes, signerSha256, builtAt, available, downloadUrl, releaseNotes}`. `Cache-Control: no-store`. **503** if `manifest.json` is missing or invalid. `available` = a non-empty `obliance.apk` exists and `versionCode > 0`. |
| `GET /api/mobile/android/download` | The APK: `Content-Type: application/vnd.android.package-archive`, `Content-Disposition: attachment; filename="Obliance-<version>.apk"`, `X-Content-SHA256`, Range/ETag/Last-Modified, `Cache-Control: no-cache`. **404** if there is no APK. |

## Release steps (the release script's job)

1. `gradlew assembleRelease` with the keystore stored **outside the repo**, then `apksigner verify --print-certs`.
2. Copy the APK to `mobile/release/obliance.apk`.
3. Write `manifest.json` (version, versionCode, sha256, sizeBytes, signerSha256, builtAt).
4. Optionally write `RELEASE_NOTES.md`.
5. Rebuild and push the **server** image.
