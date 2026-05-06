// ─────────────────────────────────────────────────────────────────────────────
// Dashboard builder — sample inspection helpers.
//
// Pure functions that take a raw command/file output sample and produce a
// list of field candidates the UI can offer to the user. Type detection is
// heuristic (regex over the stringified value); admins always get the
// final word in the builder by editing the proposed label/format/layout.
// ─────────────────────────────────────────────────────────────────────────────

export type FieldType =
  | 'number'
  | 'integer'
  | 'string'
  | 'bool'
  | 'date'        // 2024-10-24 / 24102024
  | 'time'        // 11:45
  | 'datetime'    // 2024-10-24T11:45:00Z
  | 'duration'    // raw seconds — labelled "uptime"
  | 'unknown';

export type LayoutHint = 'stat-card' | 'pill' | 'hero-block' | 'badge' | 'cell' | 'pre';

export interface FieldCandidate {
  /** Stable id used in the layout state. */
  id: string;
  /** Human-meaningful path back to the value:
   *  - JSON: dotted path, e.g. `pool.connected`, `devices[0].name`.
   *  - CSV  with header: `<columnName>`.
   *  - CSV  no  header: `col[2]`.
   *  - Raw  lines     : `line[3]`. */
  path: string;
  /** First sample value found at this path. Truncated for display. */
  sampleValue: string;
  /** Heuristic type. The user can override in the builder. */
  detectedType: FieldType;
  /** Humanized version of the path's last segment — e.g. `pool.connected`
   *  → "Pool Connected". The user can rename in the builder. */
  suggestedLabel: string;
  /** Default layout that fits the type — number → stat-card, bool → pill, etc. */
  suggestedLayout: LayoutHint;
  /** True when the parent path is an array of objects — hints to the UI
   *  that this column is a "table cell" candidate rather than a scalar. */
  isInArray?: boolean;
  /** Parent key — drives the "create section X (n fields)" suggestions. */
  parentSection?: string;
}

// ── Type detection ──────────────────────────────────────────────────────────
const RE_BOOL_TRUE  = /^(true|on|yes|1)$/i;
const RE_BOOL_FALSE = /^(false|off|no|0)$/i;
const RE_INT        = /^-?\d+$/;
const RE_NUMBER     = /^-?\d+(\.\d+)?$/;
const RE_TIME_HMS   = /^([01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;
const RE_DATE_ISO   = /^\d{4}-\d{2}-\d{2}$/;
const RE_DATE_DMY   = /^\d{2}\/\d{2}\/\d{4}$/;
const RE_DATE_COMPACT_DMY = /^\d{8}$/;          // 24102024 — risky if just a number
const RE_DATETIME   = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;

export function detectType(value: unknown, hint?: { keyName?: string }): FieldType {
  if (value === null || value === undefined) return 'unknown';
  if (typeof value === 'boolean') return 'bool';
  if (typeof value === 'number')  return Number.isInteger(value) ? 'integer' : 'number';
  if (typeof value !== 'string')  return 'unknown';
  const s = value.trim();
  if (s.length === 0) return 'unknown';
  if (RE_BOOL_TRUE.test(s) || RE_BOOL_FALSE.test(s)) return 'bool';
  if (RE_DATETIME.test(s))  return 'datetime';
  if (RE_TIME_HMS.test(s))  return 'time';
  if (RE_DATE_ISO.test(s))  return 'date';
  if (RE_DATE_DMY.test(s))  return 'date';
  // 8-digit compact date (24102024) — only treat as date if the field name
  // suggests it (`date`, `day`, `dt`, ...). Otherwise it's just a big number.
  if (RE_DATE_COMPACT_DMY.test(s)) {
    const k = (hint?.keyName ?? '').toLowerCase();
    if (/(^|_)(date|day|dt|jour)(_|$)/.test(k)) return 'date';
  }
  if (RE_INT.test(s))    return 'integer';
  if (RE_NUMBER.test(s)) return 'number';
  // Heuristic: a key called "*uptime*" / "*seconds*" with an integer value
  // → duration.
  const kn = (hint?.keyName ?? '').toLowerCase();
  if (RE_INT.test(s) && /(uptime|seconds|duration|elapsed)/.test(kn)) return 'duration';
  return 'string';
}

export function suggestLayout(type: FieldType): LayoutHint {
  switch (type) {
    case 'bool':                   return 'pill';
    case 'integer':
    case 'number':
    case 'duration':               return 'stat-card';
    case 'date':
    case 'time':
    case 'datetime':               return 'cell';
    case 'string':                 return 'cell';
    default:                       return 'cell';
  }
}

/** Humanize a key path or column label for display. Splits on common
 *  separators and title-cases each piece — `pool_connected` →
 *  "Pool Connected", `hashrate.total` → "Hashrate Total". */
export function humanize(path: string): string {
  const tail = path.replace(/\[\d+\]$/, '').split('.').pop() ?? path;
  return tail
    .replace(/[_\-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── JSON walker ─────────────────────────────────────────────────────────────

/**
 * Recursively walk a parsed JSON value and emit a candidate for every
 * scalar leaf. Arrays of objects are expanded one level (the first row
 * provides the column shape, and every leaf inside is flagged
 * `isInArray=true` so the UI can suggest a table layout). Arrays of
 * scalars become a single candidate of type `string` with the joined
 * preview.
 */
export function walkJson(parsed: unknown, opts?: { maxDepth?: number; maxFields?: number }): FieldCandidate[] {
  const maxDepth  = opts?.maxDepth  ?? 6;
  const maxFields = opts?.maxFields ?? 200;
  const out: FieldCandidate[] = [];
  let id = 0;

  const truncate = (s: string) => (s.length > 80 ? s.slice(0, 77) + '…' : s);

  function visit(node: unknown, path: string, depth: number, parentSection: string | undefined, inArray: boolean): void {
    if (out.length >= maxFields) return;
    if (depth > maxDepth) return;
    if (node === null || node === undefined) {
      pushScalar(node, path, parentSection, inArray);
      return;
    }
    if (Array.isArray(node)) {
      // Array of scalars → join sample.
      if (node.length === 0) {
        pushScalar([], path, parentSection, inArray);
        return;
      }
      const first = node[0];
      if (first === null || ['number', 'boolean', 'string'].includes(typeof first)) {
        const sample = node.slice(0, 5).map(String).join(', ');
        out.push(makeCandidate(`f${id++}`, path, sample, detectType(first, { keyName: keyOf(path) }), parentSection, inArray));
      } else if (typeof first === 'object') {
        // Array of objects — expand the first row's keys as candidates,
        // marked isInArray so the UI suggests a table layout.
        const rowSample = first as Record<string, unknown>;
        const sectionName = keyOf(path) || 'rows';
        for (const [k, v] of Object.entries(rowSample)) {
          if (v !== null && typeof v === 'object' && !Array.isArray(v)) continue; // skip nested obj for tables
          visit(v, `${path}[].${k}`, depth + 1, sectionName, true);
        }
      }
      return;
    }
    if (typeof node === 'object') {
      const sectionName = keyOf(path) || parentSection;
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        const childPath = path ? `${path}.${k}` : k;
        visit(v, childPath, depth + 1, sectionName, inArray);
      }
      return;
    }
    pushScalar(node, path, parentSection, inArray);
  }

  function pushScalar(value: unknown, path: string, parentSection: string | undefined, inArray: boolean): void {
    if (out.length >= maxFields) return;
    const t = detectType(value, { keyName: keyOf(path) });
    out.push(makeCandidate(`f${id++}`, path, truncate(value === null || value === undefined ? '' : String(value)), t, parentSection, inArray));
  }

  function makeCandidate(_id: string, path: string, sampleValue: string, t: FieldType, parentSection: string | undefined, inArray: boolean): FieldCandidate {
    return {
      id: _id,
      path,
      sampleValue,
      detectedType: t,
      suggestedLabel: humanize(path),
      suggestedLayout: suggestLayout(t),
      isInArray: inArray,
      parentSection,
    };
  }

  function keyOf(path: string): string {
    if (!path) return '';
    return path.replace(/\[\d+\]$/, '').split('.').pop() ?? '';
  }

  try { visit(parsed, '', 0, undefined, false); } catch { /* malformed sample — return what we got */ }
  return out;
}

/** Try to parse a string as JSON. Returns the parsed value on success,
 *  null on failure — callers fall back to other format detectors. */
export function tryParseJson(sample: string): unknown | null {
  try { return JSON.parse(sample); } catch { return null; }
}

// ── CSV / delimited text ────────────────────────────────────────────────────

export interface CsvParseResult {
  delimiter: string;
  hasHeader: boolean;
  columns: { name: string; index: number }[];
  rows: string[][];
}

const COMMON_DELIMITERS = [',', ';', '\t', '|'];

/** Auto-detect the delimiter by checking which character produces the most
 *  consistent column count across the first few non-empty lines. */
export function detectDelimiter(sample: string): string {
  const lines = sample.split(/\r?\n/).filter((l) => l.trim().length > 0).slice(0, 10);
  if (lines.length === 0) return ',';
  let best = ','; let bestScore = -Infinity;
  for (const delim of COMMON_DELIMITERS) {
    const counts = lines.map((l) => l.split(delim).length);
    if (counts.every((c) => c < 2)) continue;
    const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
    const variance = counts.reduce((a, b) => a + (b - avg) ** 2, 0) / counts.length;
    // Prefer high column count + low variance.
    const score = avg - variance * 4;
    if (score > bestScore) { bestScore = score; best = delim; }
  }
  return best;
}

/** Heuristic header detection — the first row's cells look like names
 *  (mostly alphabetic, no pure numbers) AND subsequent rows have a
 *  matching column count with at least one numeric cell. */
export function looksLikeHeader(rows: string[][]): boolean {
  if (rows.length < 2) return false;
  const head = rows[0];
  const second = rows[1];
  if (head.length !== second.length) return false;
  // Header heuristic: every cell starts with a letter / is non-numeric.
  const allText = head.every((c) => c.trim().length > 0 && !RE_NUMBER.test(c.trim()) && !RE_DATE_COMPACT_DMY.test(c.trim()));
  // And the second row has at least one number/date — typical "data" pattern.
  const hasData = second.some((c) => RE_NUMBER.test(c.trim()) || RE_DATE_COMPACT_DMY.test(c.trim()) || RE_TIME_HMS.test(c.trim()));
  return allText && hasData;
}

/** Parse a CSV/TSV/etc. sample into a column-shape + rows array. */
export function parseCsv(sample: string, opts?: { delimiter?: string; hasHeader?: boolean }): CsvParseResult {
  const delimiter = opts?.delimiter ?? detectDelimiter(sample);
  const lines = sample.split(/\r?\n/).filter((l) => l.length > 0);
  const cells = lines.map((l) => l.split(delimiter));
  const hasHeader = opts?.hasHeader ?? looksLikeHeader(cells);
  let columns: { name: string; index: number }[];
  let rows: string[][];
  if (hasHeader) {
    columns = (cells[0] ?? []).map((name, i) => ({ name: name.trim() || `col${i + 1}`, index: i }));
    rows = cells.slice(1);
  } else {
    const ncols = cells[0]?.length ?? 0;
    columns = Array.from({ length: ncols }, (_, i) => ({ name: `col${i + 1}`, index: i }));
    rows = cells;
  }
  return { delimiter, hasHeader, columns, rows };
}

/** Convert the parsed CSV into FieldCandidates — one candidate per
 *  column. The sample value is the first-row cell, type detected from
 *  the most common pattern across the first 10 rows of that column. */
export function csvToCandidates(parsed: CsvParseResult): FieldCandidate[] {
  const out: FieldCandidate[] = [];
  for (const col of parsed.columns) {
    const samples = parsed.rows.slice(0, 10).map((r) => r[col.index] ?? '');
    const types = samples.map((v) => detectType(v, { keyName: col.name })).filter((t) => t !== 'unknown');
    const t = mostCommon(types) ?? 'string';
    out.push({
      id: `col_${col.index}`,
      path: parsed.hasHeader ? col.name : `col[${col.index}]`,
      sampleValue: samples[0] ?? '',
      detectedType: t,
      suggestedLabel: parsed.hasHeader ? humanize(col.name) : `Column ${col.index + 1}`,
      suggestedLayout: 'cell',
      isInArray: true,                    // CSV rows form a table by nature
      parentSection: 'rows',
    });
  }
  return out;
}

function mostCommon<T>(arr: T[]): T | undefined {
  if (arr.length === 0) return undefined;
  const counts = new Map<T, number>();
  let best: T | undefined; let bestCount = 0;
  for (const v of arr) {
    const c = (counts.get(v) ?? 0) + 1;
    counts.set(v, c);
    if (c > bestCount) { bestCount = c; best = v; }
  }
  return best;
}

// ── Format dispatcher ───────────────────────────────────────────────────────

export type SourceFormat =
  | 'json'
  | 'csv-header'
  | 'csv-noheader'
  | 'lines'
  | 'kv'           // key=value or key: value, one pair per line
  | 'jsonlines'    // one JSON object per line
  | 'regex'        // user-supplied regex with named groups
  | 'auto';

export interface AutomapResult {
  /** Format the parser actually used after auto-detection. */
  format: SourceFormat;
  csv?: CsvParseResult;
  json?: unknown;
  /** Set when format='kv' — preserves the original key separator (`=` or `:`)
   *  so the codegen can match the parser to the user's actual data. */
  kvSeparator?: '=' | ':';
  /** Set when format='regex' — names of the captured groups discovered in
   *  the user's regex. The regex itself lives in BuilderState, the names
   *  here drive the candidate list. */
  regexGroups?: string[];
  candidates: FieldCandidate[];
  /** When the sample is parseable as JSON we expose grouped sections
   *  ("create section *Pool* (3 fields)") for the builder UI. */
  sections: Array<{ name: string; fieldIds: string[] }>;
}

// ── key=value parser ────────────────────────────────────────────────────────
// Recognises `key=value`, `key: value`, plus optional surrounding whitespace.
// Picks `=` or `:` based on which separator dominates in the sample so the
// codegen can produce a parser that actually matches the user's data.
const RE_KV_LINE_EQ = /^\s*([A-Za-z_][\w.\-]*)\s*=\s*(.*)\s*$/;
const RE_KV_LINE_COLON = /^\s*([A-Za-z_][\w.\-]*)\s*:\s*(.*)\s*$/;

export interface KvParseResult {
  separator: '=' | ':';
  pairs: Array<{ key: string; value: string }>;
}

export function parseKv(sample: string, opts?: { separator?: '=' | ':' }): KvParseResult {
  const lines = sample.split(/\r?\n/).filter((l) => l.trim().length > 0);
  let separator: '=' | ':' = opts?.separator ?? '=';
  if (!opts?.separator) {
    const eqMatches = lines.filter((l) => RE_KV_LINE_EQ.test(l)).length;
    const colonMatches = lines.filter((l) => RE_KV_LINE_COLON.test(l)).length;
    separator = colonMatches > eqMatches ? ':' : '=';
  }
  const re = separator === ':' ? RE_KV_LINE_COLON : RE_KV_LINE_EQ;
  const pairs: Array<{ key: string; value: string }> = [];
  for (const line of lines) {
    const m = re.exec(line);
    if (m) pairs.push({ key: m[1].trim(), value: m[2].trim() });
  }
  return { separator, pairs };
}

export function kvToCandidates(parsed: KvParseResult): FieldCandidate[] {
  return parsed.pairs.map((p, i) => ({
    id: `kv_${i}_${p.key}`,
    path: p.key,
    sampleValue: p.value.length > 80 ? p.value.slice(0, 77) + '…' : p.value,
    detectedType: detectType(p.value, { keyName: p.key }),
    suggestedLabel: humanize(p.key),
    suggestedLayout: suggestLayout(detectType(p.value, { keyName: p.key })),
  }));
}

// ── JSON Lines parser ──────────────────────────────────────────────────────
// Each non-empty line must be a self-contained JSON object. The first
// successful parse seeds the field schema; subsequent lines are kept for
// the table layout (every row of a JSON-Lines log file becomes a table row).
export interface JsonlParseResult {
  records: unknown[];
  /** Schema discovered from the first record — drives the candidate list. */
  firstRecord: unknown | null;
}

export function parseJsonLines(sample: string): JsonlParseResult | null {
  const lines = sample.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return null;
  const records: unknown[] = [];
  let firstOk = false;
  for (const line of lines) {
    try {
      records.push(JSON.parse(line));
      firstOk = true;
    } catch { /* skip malformed line */ }
  }
  if (!firstOk) return null;
  return { records, firstRecord: records[0] ?? null };
}

export function jsonLinesToCandidates(parsed: JsonlParseResult): FieldCandidate[] {
  if (!parsed.firstRecord || typeof parsed.firstRecord !== 'object') return [];
  // Reuse walkJson on the first record but tag everything as `isInArray`
  // so the UI hints at the table layout (every line is a row).
  const seeds = walkJson(parsed.firstRecord);
  return seeds.map((c) => ({ ...c, isInArray: true }));
}

// ── Regex with named groups ─────────────────────────────────────────────────
// Extracts the names of every named capture group in the user-supplied
// regex AND applies it to the sample to gather a first-match value per
// group. Empty names list = no matches / pattern compiles but doesn't match.
const RE_NAMED_GROUP = /\(\?<([A-Za-z_][A-Za-z0-9_]*)>/g;

export interface RegexParseResult {
  groupNames: string[];
  /** Map of group name → first match captured against the sample. */
  firstMatch: Record<string, string>;
  /** When the regex has the global flag, all matches across the sample.
   *  Used by the UI to suggest a table layout for multi-line patterns. */
  allMatches: Array<Record<string, string>>;
  error?: string;
}

export function parseRegex(sample: string, pattern: string, flags: string = ''): RegexParseResult {
  const out: RegexParseResult = { groupNames: [], firstMatch: {}, allMatches: [] };
  if (!pattern) return out;
  // Discover the named group names by simple scan — the runtime regex
  // engine doesn't expose this for unmatched patterns.
  RE_NAMED_GROUP.lastIndex = 0;
  for (let m: RegExpExecArray | null; (m = RE_NAMED_GROUP.exec(pattern)) !== null;) {
    if (!out.groupNames.includes(m[1])) out.groupNames.push(m[1]);
  }
  let re: RegExp;
  try {
    re = new RegExp(pattern, flags);
  } catch (err) {
    out.error = err instanceof Error ? err.message : String(err);
    return out;
  }
  if (flags.includes('g')) {
    let m: RegExpExecArray | null;
    let safety = 0;
    while ((m = re.exec(sample)) !== null && safety++ < 200) {
      out.allMatches.push({ ...(m.groups ?? {}) });
      if (m.index === re.lastIndex) re.lastIndex++; // avoid zero-length infinite loop
    }
    if (out.allMatches.length > 0) out.firstMatch = out.allMatches[0];
  } else {
    const m = re.exec(sample);
    if (m && m.groups) out.firstMatch = m.groups;
  }
  return out;
}

export function regexToCandidates(parsed: RegexParseResult): FieldCandidate[] {
  return parsed.groupNames.map((name, i) => {
    const v = parsed.firstMatch[name] ?? '';
    return {
      id: `re_${i}_${name}`,
      path: name,
      sampleValue: v.length > 80 ? v.slice(0, 77) + '…' : v,
      detectedType: detectType(v, { keyName: name }),
      suggestedLabel: humanize(name),
      suggestedLayout: suggestLayout(detectType(v, { keyName: name })),
      isInArray: parsed.allMatches.length > 1,
    };
  });
}

/** Apply auto-detection then dispatch to the right parser. The user can
 *  override the format choice in the builder UI; this function takes the
 *  override via the `format` arg (defaults to `auto`). */
export function automap(sample: string, opts?: { format?: SourceFormat; csvDelimiter?: string; regexPattern?: string; regexFlags?: string }): AutomapResult {
  const trimmed = sample.trim();
  if (!trimmed) return { format: 'auto', candidates: [], sections: [] };
  const format = opts?.format ?? 'auto';

  // Try JSON first if explicit or if the sample looks like JSON.
  if (format === 'json' || (format === 'auto' && (trimmed.startsWith('{') || trimmed.startsWith('[')))) {
    const json = tryParseJson(trimmed);
    if (json !== null) {
      const candidates = walkJson(json);
      const sections = groupSections(candidates);
      return { format: 'json', json, candidates, sections };
    }
  }

  // JSON Lines — every line is its own JSON object. Detected when the
  // user picks it explicitly OR when auto and the sample has multiple
  // lines, each starting with `{`.
  if (format === 'jsonlines' || (format === 'auto' && trimmed.split(/\r?\n/).filter((l) => l.trim().startsWith('{')).length >= 2)) {
    const jsonl = parseJsonLines(trimmed);
    if (jsonl) {
      const candidates = jsonLinesToCandidates(jsonl);
      return { format: 'jsonlines', json: jsonl.firstRecord, candidates, sections: [{ name: 'records', fieldIds: candidates.map((c) => c.id) }] };
    }
  }

  // key=value or key:value lines — picked when the format flag asks
  // explicitly, or in auto mode when more than half of non-empty lines
  // match the kv pattern.
  if (format === 'kv' || format === 'auto') {
    const lines = trimmed.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const kvHits = lines.filter((l) => RE_KV_LINE_EQ.test(l) || RE_KV_LINE_COLON.test(l)).length;
    const isKv = format === 'kv' || (lines.length > 0 && kvHits / lines.length >= 0.6);
    if (isKv) {
      const kv = parseKv(trimmed);
      if (kv.pairs.length > 0) {
        const candidates = kvToCandidates(kv);
        return { format: 'kv', kvSeparator: kv.separator, candidates, sections: [{ name: 'pairs', fieldIds: candidates.map((c) => c.id) }] };
      }
    }
  }

  // Regex with named groups — only triggered explicitly (no auto-detect
  // for arbitrary patterns).
  if (format === 'regex' && opts?.regexPattern) {
    const re = parseRegex(trimmed, opts.regexPattern, opts.regexFlags ?? '');
    const candidates = regexToCandidates(re);
    return { format: 'regex', regexGroups: re.groupNames, candidates, sections: [{ name: 'matches', fieldIds: candidates.map((c) => c.id) }] };
  }

  // CSV explicit or auto-detected (sample contains repeated delimiters).
  if (format === 'csv-header' || format === 'csv-noheader' || format === 'auto') {
    const explicitHeader = format === 'csv-header' ? true : (format === 'csv-noheader' ? false : undefined);
    const csv = parseCsv(trimmed, { delimiter: opts?.csvDelimiter, hasHeader: explicitHeader });
    if (csv.columns.length >= 2 && csv.rows.length > 0) {
      const candidates = csvToCandidates(csv);
      return {
        format: csv.hasHeader ? 'csv-header' : 'csv-noheader',
        csv,
        candidates,
        sections: [{ name: 'rows', fieldIds: candidates.map((c) => c.id) }],
      };
    }
  }

  // Fallback — raw lines. One candidate per non-empty line, type per cell.
  if (format === 'lines' || format === 'auto') {
    const lines = trimmed.split(/\r?\n/).filter((l) => l.length > 0);
    const candidates: FieldCandidate[] = lines.slice(0, 50).map((line, i) => ({
      id: `line_${i}`,
      path: `line[${i}]`,
      sampleValue: line.length > 80 ? line.slice(0, 77) + '…' : line,
      detectedType: detectType(line),
      suggestedLabel: `Line ${i + 1}`,
      suggestedLayout: 'cell',
    }));
    return { format: 'lines', candidates, sections: [{ name: 'lines', fieldIds: candidates.map((c) => c.id) }] };
  }

  return { format: 'auto', candidates: [], sections: [] };
}

/** Group candidates by their parent section so the UI can offer
 *  "Create section X (n fields)" suggestions. */
function groupSections(candidates: FieldCandidate[]): Array<{ name: string; fieldIds: string[] }> {
  const map = new Map<string, string[]>();
  for (const c of candidates) {
    const key = c.parentSection || '_root';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(c.id);
  }
  return [...map.entries()].map(([name, fieldIds]) => ({ name, fieldIds }));
}
