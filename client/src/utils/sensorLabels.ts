/**
 * Prettifies raw sensor label strings into human-readable names.
 * E.g. "CPU Package" → "CPU Package", "Core #0" → "Core 0"
 */
export function prettifySensorLabel(label: string): string {
  return label
    .replace(/#(\d+)/g, '$1')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
