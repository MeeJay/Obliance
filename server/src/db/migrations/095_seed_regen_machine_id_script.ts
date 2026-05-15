import { Knex } from 'knex';

// Seed a built-in Linux system script that regenerates the host's
// machine-id and restarts the Obliance agent so it re-enrolls with a
// fresh UUID. Used to resolve duplicate-agent-id situations where
// several VMs (cloned without resetting /etc/machine-id, or KVM guests
// sharing a SMBIOS UUID) push under a single device row.
//
// Why not use `systemd-machine-id-setup`:
//   On KVM/QEMU guests systemd-machine-id-setup deterministically derives
//   the new ID from the SMBIOS UUID, so two clones with the same SMBIOS
//   end up with the same machine-id again. We bypass it and pull from
//   /proc/sys/kernel/random/uuid which always yields a true random ID.
//
// Why the agent restart is detached + delayed:
//   The script is executed by the agent itself. If we kill the agent
//   process during the script, the command result never gets pushed back
//   and the schedule history shows a false "failed". Spawning the
//   restart in `nohup`/`disown` with a 15s sleep lets the script return
//   exit 0 first, the next push pings the result, and only then the
//   service comes down for restart.

const SCRIPT_NAME = 'Regen Linux machine-id (fix duplicate agent ID)';

const SCRIPT_CONTENT = `#!/bin/bash
# Regen /etc/machine-id and restart the Obliance agent so it re-enrolls
# with a fresh UUID. Run this on a VM that shares its agent ID with
# another machine (typical after cloning a Linux template without
# resetting machine-id).
set -e

OLD_ID="$(cat /etc/machine-id 2>/dev/null || echo missing)"
echo "Old /etc/machine-id: $OLD_ID"

if [ -f /sys/class/dmi/id/product_uuid ]; then
  SMBIOS_UUID="$(cat /sys/class/dmi/id/product_uuid 2>/dev/null || echo unknown)"
  echo "SMBIOS product_uuid: $SMBIOS_UUID  (if shared across VMs, you must also fix this at the hypervisor)"
fi

# Bypass systemd-machine-id-setup — on KVM guests it re-seeds from the
# SMBIOS UUID, which would produce the same duplicate ID again. Pull
# from the kernel random pool instead (truly unique).
rm -f /etc/machine-id /var/lib/dbus/machine-id
cat /proc/sys/kernel/random/uuid | tr -d - > /etc/machine-id
chmod 444 /etc/machine-id
mkdir -p /var/lib/dbus
ln -sf /etc/machine-id /var/lib/dbus/machine-id

NEW_ID="$(cat /etc/machine-id)"
echo "New /etc/machine-id: $NEW_ID"

if [ "$OLD_ID" = "$NEW_ID" ]; then
  echo "ERROR: machine-id regen did not change the ID. Check /proc/sys/kernel/random/uuid availability." >&2
  exit 1
fi

# Detach the agent restart so this script returns 0 cleanly BEFORE the
# service is killed. Without the delay, the agent gets SIGTERM'd while
# still pushing the command result and the schedule history shows the
# run as failed even when everything worked.
echo "Agent will restart in 15s — device will re-enroll with the new ID and appear as a new pending entry."
(
  sleep 15
  if command -v systemctl >/dev/null 2>&1; then
    systemctl restart obliance-agent
  else
    service obliance-agent restart
  fi
) >/dev/null 2>&1 &
disown || true

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
      'Regenerates /etc/machine-id with a truly random UUID (bypasses systemd-machine-id-setup KVM-seeding), then restarts obliance-agent so the host re-enrolls. Use on Linux VMs cloned without machine-id reset.',
    tags: JSON.stringify(['identity', 'cloning', 'machine-id', 'troubleshoot']),
    platform: 'linux',
    runtime: 'bash',
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
