import { Knex } from 'knex';

// Seed a built-in Windows system script that forces a fresh agent identity
// and restarts the Obliance agent so it re-enrolls. The Windows counterpart
// to migration 095 (Linux machine-id regen).
//
// Why a different mechanism than Linux:
//   Linux derives identity from /etc/machine-id, which the agent reads first
//   and which we can regenerate in-guest. Windows derives identity from the
//   SMBIOS UUID (Win32_ComputerSystemProduct.UUID) — set by the hypervisor /
//   firmware and NOT writable from inside the guest OS. VMs cloned from a
//   template therefore share one immutable SMBIOS UUID and collide on a
//   single device row. We can't regen the SMBIOS UUID, so instead the agent
//   honours an opt-in override file in a BRAND-AGNOSTIC location shared by
//   every Obli* agent:
//     C:\ProgramData\Oblitools\device-uuid-override
//   This script writes a fresh GUID there and bounces the service. On next
//   start the agent picks up the override (priority over SMBIOS) and
//   re-enrols cleanly as a distinct device. Because the location is shared,
//   the same regen also re-homes Obliview / Oblimap / Obliguard agents on
//   the box — they all read the same override file.
//
// The real, permanent fix is at the hypervisor (regenerate the VM BIOS
// GUID): Hyper-V Set-VM BIOSGUID, VMware uuid.bios in the .vmx, Proxmox/KVM
// `qm set <id> -smbios1 uuid=...`. This script is the in-guest remedy when
// hypervisor access isn't available or the fleet was already cloned.
//
// Why the restart is detached + delayed:
//   The script runs as a child of the agent. Killing the service inline
//   would drop the command result before it's pushed, so the schedule
//   history would show a false "failed". We spawn a fully detached cmd
//   (Start-Process breaks it out of the agent's process tree) that waits
//   15s, lets the script return exit 0 and the result get pushed, then
//   stops + starts the service.

const SCRIPT_NAME = 'Regen Windows device ID (fix duplicate agent ID)';

const SCRIPT_CONTENT = `# Force a fresh Obliance agent identity on a Windows host whose SMBIOS UUID
# collides with another machine (typical after cloning a VM template without
# regenerating the BIOS GUID at the hypervisor). Writes an override UUID the
# agent reads in preference to the unchangeable SMBIOS UUID, then restarts
# the service so the host re-enrolls as a distinct device.
$ErrorActionPreference = 'Stop'

$dir  = Join-Path $env:ProgramData 'Oblitools'
$file = Join-Path $dir 'device-uuid-override'
New-Item -ItemType Directory -Force -Path $dir | Out-Null

$old = ''
if (Test-Path $file) { try { $old = (Get-Content -Raw -Path $file).Trim() } catch {} }

# SMBIOS UUID for context — if this is shared across VMs you should ALSO fix
# it at the hypervisor (Set-VM BIOSGUID / uuid.bios / qm smbios1) so future
# re-clones don't collide again.
try {
  $smbios = (Get-CimInstance -ClassName Win32_ComputerSystemProduct).UUID
  Write-Output "SMBIOS UUID: $smbios  (if shared across VMs, fix at the hypervisor too)"
} catch {}

$new = [guid]::NewGuid().ToString()
Set-Content -Path $file -Value $new -Encoding Ascii -NoNewline
Write-Output "Old override: $old"
Write-Output "New override: $new"
Write-Output "Agent will restart in 15s and re-enroll under the new ID (appears as a new pending entry)."

# Detached restart, decoupled from this script's process tree so it survives
# the service stop. timeout lets the script return 0 + push its result first.
Start-Process -WindowStyle Hidden cmd.exe -ArgumentList '/c','timeout /t 15 /nobreak >nul & sc stop OblianceAgent >nul 2>&1 & timeout /t 3 /nobreak >nul & sc start OblianceAgent >nul 2>&1'

exit 0
`;

export async function up(knex: Knex): Promise<void> {
  const existing = await knex('scripts')
    .whereNull('tenant_id')
    .where({ name: SCRIPT_NAME, is_builtin: true })
    .first();
  if (existing) return;

  await knex('scripts').insert({
    tenant_id: null,
    name: SCRIPT_NAME,
    description:
      'Writes a fresh device-uuid-override (the agent reads it in preference to the unchangeable Windows SMBIOS UUID), then restarts OblianceAgent so the host re-enrolls as a distinct device. Use on Windows VMs cloned without regenerating the BIOS GUID. The permanent fix is at the hypervisor.',
    tags: JSON.stringify(['identity', 'cloning', 'machine-id', 'troubleshoot']),
    platform: 'windows',
    runtime: 'powershell',
    content: SCRIPT_CONTENT,
    timeout_seconds: 60,
    expected_exit_code: 0,
    run_as: 'system',
    script_type: 'system',
    is_builtin: true,
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex('scripts')
    .whereNull('tenant_id')
    .where({ name: SCRIPT_NAME, is_builtin: true })
    .delete();
}
