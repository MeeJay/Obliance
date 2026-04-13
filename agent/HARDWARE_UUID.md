# Hardware-derived Device UUID — shared algorithm for Obli* agents

This document describes the exact algorithm that every Obli* agent
(Obliance, Obliview, Oblimap, Obliguard, ...) must use to compute the
device UUID, so that all tools installed on the same physical machine
produce **the same** identifier without any coordination.

The canonical implementation lives in `agent/machine_uuid.go` and its
platform-specific siblings in the Obliance repository. That file is
designed to be copied **verbatim** into other Obli* agents — any change
must be mirrored everywhere.

## Resolution priority

1. **SMBIOS / hardware UUID**
   - Windows: `Win32_ComputerSystemProduct.UUID`
   - Linux:   `/sys/class/dmi/id/product_uuid`
   - macOS:   `IOPlatformUUID` from `ioreg`
   - FreeBSD: `kenv smbios.system.uuid`
   - Validated with `normaliseUUID()`; if the result matches a
     **blacklisted** UUID, it is rejected.

2. **System disk serial (derived)**
   - Read the hardware serial of the physical disk hosting the system
     volume (`C:\` / `/`).
   - Reject placeholder values (`isPlaceholderSerial`).
   - Compute `SHA-256("obliance-disk:" + lowercase(serial))`.
   - Take the first 16 bytes.
   - Force UUID version 5 and RFC 4122 variant bits.
   - Format as the canonical `8-4-4-4-12` hex layout.

3. **Previously stored UUID** — only if both above fail.

4. **Randomly generated UUID** — ultimate fallback, non-deterministic.
   Logged as a warning. Should essentially never happen on real hardware.

## The hash namespace prefix

The prefix `obliance-disk:` is mandatory. It prevents hash-domain
collisions if we ever add another derivation source (CPU, NIC MAC, ...).
Any new source must use its own prefix (e.g. `obliance-mac:`).

**Never** change this prefix without coordinating a simultaneous update
across every Obli* agent — doing so would make old and new agents
disagree on the UUID of the same machine.

## Blacklisted SMBIOS UUIDs

Kept in the `badHardwareUUIDs` map. These are well-known placeholders
OEMs leave in the BIOS, shared across many physical machines. Add
entries (lowercase) whenever a new collision is discovered in the field.

## Placeholder serial detection

The `placeholderSerials` map plus a simple "all-same-character"
heuristic filters out junk serials like `"To be filled by O.E.M."`,
`"Default string"`, `"None"`, empty strings, `"00000000"`, etc.

Comparison is always done on the lowercased, trimmed input.

## Testing

To verify two agents agree on a machine:

```
# On the machine in question
# (PowerShell)
(Get-CimInstance Win32_ComputerSystemProduct).UUID
# Should match the UUID registered by every Obli* agent installed.
```

If SMBIOS is blacklisted, every agent should fall back to the same
disk-derived UUID. To debug:

```
# Windows
powershell "$p=(Get-Partition -DriveLetter C); (Get-CimInstance Win32_DiskDrive | ? Index -eq $p.DiskNumber).SerialNumber"
# The resulting serial hashed via the documented algorithm must match
# the UUID seen by every Obli* agent.
```

## Files to copy

When adding this algorithm to a new Obli* agent, copy these files from
the Obliance `agent/` directory:

- `machine_uuid.go`
- `machine_uuid_windows.go`
- `machine_uuid_linux.go`
- `machine_uuid_darwin.go`
- `machine_uuid_freebsd.go`
- `machine_uuid_stub.go`

Each file uses only the Go standard library. The Windows file defines a
local `hiddenCmd()` helper so no external dependencies are required.
The only external symbol referenced from outside the set is
`generateUUID()`, which must exist in the host agent (a standard
RFC 4122 v4 generator — 9 lines of code).
