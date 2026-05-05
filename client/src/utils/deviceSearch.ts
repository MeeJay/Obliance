import type { Device } from '@obliance/shared';

// Single source of truth for "does this device match the user's search
// query?". Used by the sidebar search, the DeviceMultiSelect picker, and
// any future ad-hoc filter UIs. The field set mirrors what the server's
// /devices endpoint searches on (hostname, displayName, ipLocal, ipPublic,
// macAddress, last_logged_in_user, os_name, os_version, agent_version,
// geo_city, geo_country, description, uuid, tags) so the UX stays
// consistent whether the filter is local (sidebar) or remote (/devices).
export function deviceMatchesSearch(device: Device, rawQuery: string): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;

  const fields: Array<string | null | undefined> = [
    device.hostname,
    device.displayName,
    device.description,
    device.ipLocal,
    device.ipPublic,
    device.macAddress,
    device.lastLoggedInUser,
    device.osName,
    device.osVersion,
    device.osBuild,
    device.agentVersion,
    device.geoCity,
    device.geoCountry,
    device.geoRegion,
    device.uuid,
    device.groupName,
  ];

  for (const f of fields) {
    if (f && String(f).toLowerCase().includes(q)) return true;
  }
  // Tags array — match if any tag substring matches
  if (Array.isArray(device.tags)) {
    for (const tag of device.tags) {
      if (tag && tag.toLowerCase().includes(q)) return true;
    }
  }
  return false;
}
