/**
 * Compress verbose OS names so the /devices row stays readable on narrow
 * screens. Only marketing fluff is collapsed — meaningful tokens (build
 * channel, edition, year) survive in shorter form. The original full name
 * remains available via the row's title tooltip.
 *
 * Examples:
 *   "Microsoft Windows 10 IoT Enterprise LTSC 2021" → "MS Win 10 IoT Ent LTSC 21"
 *   "Microsoft Windows Server 2019 Datacenter"      → "MS Win Srv 19 DC"
 *   "Microsoft Windows 11 Pro"                       → "MS Win 11 Pro"
 *   "macOS Sonoma 14.5"                              → "macOS Sonoma 14.5"
 *   "Ubuntu 22.04 LTS"                               → "Ubuntu 22.04 LTS"
 */
export function shortenOsName(name: string | null | undefined): string {
  if (!name) return '';
  let s = name;
  s = s.replace(/\bMicrosoft\b/g, 'MS');
  s = s.replace(/\bWindows\b/g, 'Win');
  s = s.replace(/\bEnterprise\b/g, 'Ent');
  s = s.replace(/\bProfessional\b/g, 'Pro');
  s = s.replace(/\bDatacenter\b/g, 'DC');
  s = s.replace(/\bStandard\b/g, 'Std');
  // "Server 2019" → "Srv 19", "Server 2008 R2" → "Srv 08 R2"
  s = s.replace(/\bServer\s+(?:20)?(\d{2})\b/g, 'Srv $1');
  // "LTSC 2021" → "LTSC 21" (only when the century prefix is 20YY)
  s = s.replace(/\b(LTSC|LTSB)\s+20(\d{2})\b/g, '$1 $2');
  // Collapse double spaces left by previous substitutions
  s = s.replace(/\s{2,}/g, ' ').trim();
  return s;
}
