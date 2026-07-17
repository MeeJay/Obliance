import type { VirtualMachine } from './types';

/**
 * Search matching for the Hyper-V VM grid.
 *
 * Lives in `shared` because two callers must agree exactly: the client table
 * (what the user sees) and the server export route (what lands in the CSV).
 * The export is documented as "exactly the rows the user sees" — that promise
 * only holds if both run the same matcher.
 */

/** Strip everything that isn't a hex digit and upper-case, so "00:15:5D",
 *  "00-15-5d" and "00155D" all collapse to the same token. */
function hexOnly(s: string): string {
  return s.toUpperCase().replace(/[^0-9A-F]/g, '');
}

/**
 * True when the VM matches a free-text query. Matched fields:
 *   - VM name, host name        (substring, case-insensitive)
 *   - IP addresses              (substring — "192.168.30." matches a subnet)
 *   - MAC addresses             (separator-insensitive substring)
 *
 * MAC matching normalises BOTH sides to bare hex, so a user can paste
 * "00:15:5D:01:02:03", type "00155d", or search an OUI prefix "00-15-5D" and
 * still hit. A query is only tried as a MAC when it contains at least two hex
 * digits and no other characters — otherwise "5" or "e" would match nearly
 * every MAC and drown the real name matches.
 */
export function vmMatchesSearch(vm: VirtualMachine, rawQuery: string): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;

  if ((vm.name || '').toLowerCase().includes(q)) return true;
  if ((vm.hostName || '').toLowerCase().includes(q)) return true;

  for (const ip of vm.ipAddresses ?? []) {
    if (ip.toLowerCase().includes(q)) return true;
  }

  const qHex = hexOnly(rawQuery);
  const queryIsHexish = qHex.length >= 2 && qHex.length === rawQuery.trim().replace(/[:\-. ]/g, '').length;
  if (queryIsHexish) {
    for (const mac of vm.macAddresses ?? []) {
      if (hexOnly(mac).includes(qHex)) return true;
    }
  }
  return false;
}
