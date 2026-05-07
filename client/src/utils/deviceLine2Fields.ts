// Lot D.1 — Catalog of optional fields shown on the second line of a
// /devices row. Users toggle them on/off via the "Colonnes" popover; the
// selection is persisted in localStorage so it survives reloads and follows
// the user across sessions on the same browser.

export interface Line2FieldDef {
  /** Stable key — also used as the localStorage flag. */
  key: string;
  /** Short label shown in the toggle popover. */
  label: string;
  /** Whether the field is rendered by default for users who never opened
   *  the popover. Keep this lean — too many defaults clutter the row. */
  defaultVisible: boolean;
}

export const LINE2_FIELDS: Line2FieldDef[] = [
  { key: 'tenant',       label: 'Tenant',           defaultVisible: false },
  { key: 'ipLocal',      label: 'IP LAN',           defaultVisible: true  },
  { key: 'ipPublic',     label: 'IP WAN',           defaultVisible: false },
  { key: 'macAddress',   label: 'MAC',              defaultVisible: false },
  { key: 'os',           label: 'OS',               defaultVisible: true  },
  { key: 'agentVersion', label: 'Version agent',    defaultVisible: true  },
  { key: 'group',        label: 'Groupe',           defaultVisible: true  },
  { key: 'lastUser',     label: 'Dernier user',     defaultVisible: true  },
  { key: 'geoCity',      label: 'Géolocalisation',  defaultVisible: false },
  { key: 'lastReboot',   label: 'Dernier reboot',   defaultVisible: false },
  { key: 'lifecycle',    label: 'Lifecycle',        defaultVisible: false },
  { key: 'warranty',     label: 'Garantie',         defaultVisible: false },
  { key: 'tags',         label: 'Tags',             defaultVisible: false },
];

const STORAGE_KEY = 'obliance:deviceLine2Fields';

/** Read the user's saved visibility preferences. Falls back to defaults
 *  for any field that is missing (e.g. after a release that adds new
 *  optional fields, the catalog grows but the user's saved set doesn't). */
export function loadVisibleFields(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultVisibleFields();
    const arr = JSON.parse(raw) as string[];
    if (!Array.isArray(arr)) return defaultVisibleFields();
    // Whitelist against the catalog so stale keys from older versions don't
    // resurrect rendering paths that no longer exist.
    const known = new Set(LINE2_FIELDS.map(f => f.key));
    return new Set(arr.filter(k => known.has(k)));
  } catch {
    return defaultVisibleFields();
  }
}

export function saveVisibleFields(visible: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...visible]));
  } catch {
    // localStorage unavailable — fall through, preferences will be lost on
    // reload but the UI keeps working in-session.
  }
}

export function defaultVisibleFields(): Set<string> {
  return new Set(LINE2_FIELDS.filter(f => f.defaultVisible).map(f => f.key));
}
