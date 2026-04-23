# Oblireach Desktop App — drop zone

This directory is where the **Oblireach Desktop App** binary and its
version marker live inside the Obliance repo. The server serves the
MSI for end-user download and exposes the version so the desktop app
can offer an in-app update button.

## Layout

```
oblireach-desktop/
├── VERSION                       # plain-text, one line, e.g. "1.2.3"
├── RELEASE_NOTES.md              # optional, served verbatim alongside the version
└── dist/
    └── OblireachDesktop.msi      # Windows installer (only supported platform today)
```

## Conventions — read this before bumping

1. **`VERSION`** is plain text, a single semver on one line, no `v` prefix,
   optional trailing newline. Example: `1.0.0`. The server reads it on
   every request (not cached) so a file change is live without a
   restart.
2. **`dist/OblireachDesktop.msi`** is the installer file name the
   server hands out. Rename anywhere else is a breaking change.
3. **`RELEASE_NOTES.md`** is optional. When present, the version
   endpoint returns its contents under `releaseNotes`. Markdown is
   fine — the desktop app can render or show as plain text.

## Endpoints

| Route | Purpose |
|---|---|
| `GET /api/oblireach-desktop/version` | Returns `{ version, downloadUrl, releaseNotes?, releasedAt? }`. Public (no auth) so the desktop app can poll without credentials. |
| `GET /api/oblireach-desktop/download` | Streams `dist/OblireachDesktop.msi` with `Content-Disposition: attachment`. Public. |
| `GET /download` | Browser-facing page with a download button. Public. |

## How the desktop app decides to show the update banner

```
local_version = embedded_at_build_time
remote        = GET /api/oblireach-desktop/version
if semver(remote.version) > semver(local_version):
    show "Update available" button
    button.onClick = open remote.downloadUrl in OS default browser
```

No auto-update — the user opts in by clicking the button.
