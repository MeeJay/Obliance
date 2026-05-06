// ─────────────────────────────────────────────────────────────────────────────
// Dashboard builder — script generation.
//
// Pure functions that turn the user's builder choices (source / format /
// fields / layout) into a self-contained sh or ps1 script ready to paste
// into a custom section's `command` field. The generated script bundles:
//   - an Obliance-branded HTML template (CSS lifted from the user's
//     reference htmlgen.sh — same look)
//   - the boilerplate helpers (html_escape / format_num / etc.)
//   - the format-specific extraction (jq for JSON on sh, ConvertFrom-Json
//     on ps1, cut / awk for CSV without header, Get-Content -Tail N for
//     file tails)
//   - one `<div>` per layout block, fed by the extracted variables
//
// The output is intentionally readable so admins can edit it after
// generation — the builder is a kickstart, not a black box.
// ─────────────────────────────────────────────────────────────────────────────

// (No imports needed from dashboardAutomap — the builder UI translates
//  FieldCandidate → BuilderField before calling generateScript.)

export type BuilderRuntime = 'sh' | 'powershell';

export interface BuilderSource {
  kind: 'command' | 'file';
  /** Free-form shell/PowerShell command — used when kind='command'. */
  command?: string;
  /** Absolute file path — used when kind='file'. */
  filePath?: string;
  /** File read mode. 'all' reads the whole file; 'tail'/'head' read N lines. */
  fileMode?: 'all' | 'tail' | 'head';
  fileLines?: number;
}

export type FieldColor = 'muted' | 'green' | 'amber' | 'red' | 'blue' | 'purple';

export interface ColorRule {
  /** Comparison operator. `eq` works on any type; `gt`/`lt` on numerics;
   *  `contains` on strings. The first matching rule wins. */
  when: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'truthy' | 'falsy';
  /** Right-hand-side. Numeric for gt/lt, string otherwise. Ignored for
   *  truthy/falsy. */
  value?: string | number;
  color: FieldColor;
}

export interface BuilderField {
  /** Mirror of FieldCandidate.id so we can look the candidate back up. */
  id: string;
  /** Source path — same as candidate.path. */
  path: string;
  /** Final label shown on the rendered card / pill / cell. */
  label: string;
  /** User-confirmed type, may differ from the auto-detected hint. */
  type: 'number' | 'integer' | 'string' | 'bool' | 'date' | 'time' | 'datetime' | 'duration';
  /** True when the field comes from an array of objects (CSV row, JSON array). */
  isInArray?: boolean;
  /** Per-field colour rules, evaluated in order at render time. The first
   *  rule that matches wins; if none match the value renders in the
   *  default text colour. */
  colorRules?: ColorRule[];
  /** History tracking — when true the codegen appends a (timestamp,value)
   *  row to a per-field tmp file and renders a sparkline next to the
   *  value. Only meaningful for numeric / duration types. */
  trackHistory?: boolean;
  /** How many samples to keep in the rolling history file. */
  historyMaxSamples?: number;
}

export type BlockKind = 'hero-row' | 'stat-grid' | 'pill-row' | 'table' | 'pre' | 'sparkline-card';

export interface BuilderBlock {
  id: string;
  kind: BlockKind;
  title?: string;
  /** Field ids in this block. Order matters. */
  fieldIds: string[];
}

export interface BuilderState {
  runtime: BuilderRuntime;
  source: BuilderSource;
  format: 'json' | 'csv-header' | 'csv-noheader' | 'lines' | 'kv' | 'jsonlines' | 'regex';
  csvDelimiter?: string;
  /** key=value separator (`=` or `:`) when format='kv'. */
  kvSeparator?: '=' | ':';
  /** Pattern + flags when format='regex'. The pattern is embedded
   *  as-is into the generated extraction code. */
  regexPattern?: string;
  regexFlags?: string;
  /** All chosen fields keyed by id. */
  fields: Record<string, BuilderField>;
  /** Layout blocks in render order. */
  blocks: BuilderBlock[];
  /** Optional dashboard title shown in the header — defaults to the section name. */
  title?: string;
  /** Section identifier used to scope per-field history files on the
   *  agent — multiple HTML sections on the same device must not share
   *  state. The builder fills this with a stable random suffix. */
  historyKey?: string;
}

// ── HTML template snippets ──────────────────────────────────────────────────

/** CSS reused from the user's reference htmlgen.sh — kept identical so a
 *  builder-generated dashboard is visually consistent with hand-written ones. */
const TEMPLATE_CSS = `
:root {
    --bg-primary: #0a0e1a;
    --bg-secondary: #131826;
    --bg-tertiary: #1a2030;
    --border: #252d42;
    --text-primary: #e4e8f0;
    --text-secondary: #8b95ad;
    --accent-red: #e63946;
    --accent-green: #4ade80;
    --accent-amber: #f4a261;
    --accent-blue: #4a9eff;
    --accent-purple: #a78bfa;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
    font-family: 'Rajdhani', sans-serif;
    background: var(--bg-primary);
    color: var(--text-primary);
    padding: 24px;
    font-size: 15px;
    line-height: 1.5;
}
header {
    border-bottom: 2px solid var(--accent-red);
    padding-bottom: 16px;
    margin-bottom: 24px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    flex-wrap: wrap;
    gap: 16px;
}
.brand-name { font-size: 24px; font-weight: 700; letter-spacing: 4px; text-transform: uppercase; }
.brand-name .accent { color: var(--accent-red); }
.brand-sub { font-size: 12px; color: var(--text-secondary); letter-spacing: 2px; text-transform: uppercase; margin-top: 4px; }
.meta { text-align: right; font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--text-secondary); }
.meta strong { color: var(--text-primary); }

.hero-row {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-left: 4px solid var(--accent-red);
    border-radius: 6px;
    padding: 28px 32px;
    margin-bottom: 20px;
    display: grid;
    gap: 24px;
    align-items: center;
}
.hero-block { text-align: center; }
.hero-label { font-size: 11px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 3px; margin-bottom: 12px; font-weight: 600; }
.hero-value { font-family: 'JetBrains Mono', monospace; font-size: 48px; font-weight: 700; line-height: 1; color: var(--text-primary); letter-spacing: -1px; }
.hero-value.green { color: var(--accent-green); }
.hero-value.red { color: var(--accent-red); }
.hero-value.amber { color: var(--accent-amber); }
.hero-value.muted { color: var(--text-secondary); opacity: 0.6; }
.hero-sub { font-size: 10px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 1px; margin-top: 8px; font-family: 'JetBrains Mono', monospace; }

.stat-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
    margin-bottom: 20px;
}
.stat-card {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-left: 3px solid var(--accent-blue);
    padding: 14px 18px;
    border-radius: 4px;
}
.stat-card.green { border-left-color: var(--accent-green); }
.stat-card.amber { border-left-color: var(--accent-amber); }
.stat-card.red   { border-left-color: var(--accent-red); }
.stat-card.purple{ border-left-color: var(--accent-purple); }
.stat-label { font-size: 10px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 2px; margin-bottom: 6px; }
.stat-value { font-size: 22px; font-weight: 600; font-family: 'JetBrains Mono', monospace; }
.stat-value.green  { color: var(--accent-green); }
.stat-value.amber  { color: var(--accent-amber); }
.stat-value.red    { color: var(--accent-red); }
.stat-value.purple { color: var(--accent-purple); }
.stat-value.blue   { color: var(--accent-blue); }

.pill-row { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 20px; }
.pill {
    display: inline-flex; align-items: center; gap: 8px;
    font-family: 'JetBrains Mono', monospace; font-size: 11px;
    letter-spacing: 2px; padding: 4px 10px; border-radius: 3px;
    border: 1px solid; text-transform: uppercase;
}
.pill.green { color: var(--accent-green); border-color: var(--accent-green); background: rgba(74, 222, 128, 0.1); }
.pill.amber { color: var(--accent-amber); border-color: var(--accent-amber); background: rgba(244, 162, 97, 0.1); }
.pill.red   { color: var(--accent-red);   border-color: var(--accent-red);   background: rgba(230, 57, 70, 0.1); }
.pill.muted { color: var(--text-secondary); border-color: var(--border); background: var(--bg-tertiary); }

table.dash-table {
    width: 100%;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 4px;
    border-collapse: collapse;
    margin-bottom: 20px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
}
table.dash-table th {
    background: var(--bg-tertiary);
    text-align: left;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 2px;
    font-size: 10px;
    font-weight: 600;
}
table.dash-table td { padding: 8px 12px; border-bottom: 1px solid var(--border); color: var(--text-primary); }
table.dash-table tr:last-child td { border-bottom: none; }

pre.dash-pre {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-left: 3px solid var(--accent-blue);
    padding: 12px 16px;
    border-radius: 4px;
    margin-bottom: 20px;
    color: var(--text-primary);
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    overflow-x: auto;
    white-space: pre-wrap;
}

.spark-card {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-left: 3px solid var(--accent-red);
    border-radius: 6px;
    padding: 16px 20px;
    margin-bottom: 20px;
}
.spark-row { display: grid; grid-template-columns: 200px 1fr; gap: 16px; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border); }
.spark-row:last-child { border-bottom: none; }
.spark-label { font-size: 10px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 2px; display: block; margin-bottom: 4px; }
.spark-value { font-family: 'JetBrains Mono', monospace; font-size: 18px; font-weight: 700; color: var(--accent-red); }
.spark-svg { width: 100%; height: 40px; display: block; }
.spark-empty { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--text-secondary); font-style: italic; padding: 8px; }

footer {
    margin-top: 16px;
    padding-top: 14px;
    border-top: 1px solid var(--border);
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    color: var(--text-secondary);
    text-align: center;
    letter-spacing: 1px;
}
`.trim();

// ── Variable-name sanitisation ──────────────────────────────────────────────
// JSON paths like `pool.connected` / `devices[0].name` aren't valid shell
// variable names. We slugify them into safe identifiers (`F_pool_connected`,
// `F_devices_0_name`) for the generated script.
function shellVarName(path: string): string {
  return 'F_' + path.replace(/\[(\d+)\]/g, '_$1').replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
}

function jqPathOf(path: string): string {
  // Convert our dotted-path syntax to a jq expression. `[0]` is preserved,
  // the leading dot is added.
  return '.' + path.replace(/\.\[\]\./g, '[].');
}

// ── sh generator ────────────────────────────────────────────────────────────

function generateBash(state: BuilderState): string {
  const fields = Object.values(state.fields);
  const dashboardTitle = state.title || 'Custom Dashboard';

  // Source acquisition.
  let sourceCmd: string;
  if (state.source.kind === 'file') {
    const path = (state.source.filePath ?? '').replace(/"/g, '\\"');
    const lines = Math.max(1, Math.min(1000, state.source.fileLines ?? 50));
    if (state.source.fileMode === 'tail') sourceCmd = `RAW=$(tail -n ${lines} "${path}" 2>/dev/null)`;
    else if (state.source.fileMode === 'head') sourceCmd = `RAW=$(head -n ${lines} "${path}" 2>/dev/null)`;
    else                                       sourceCmd = `RAW=$(cat "${path}" 2>/dev/null)`;
  } else {
    sourceCmd = `RAW=$(${state.source.command ?? 'echo ""'} 2>/dev/null)`;
  }

  // Per-field extraction.
  const extractions: string[] = [];
  if (state.format === 'json') {
    for (const f of fields) {
      const v = shellVarName(f.path);
      extractions.push(`${v}=$(printf '%s' "$RAW" | jq -r '${jqPathOf(f.path)} // empty' 2>/dev/null)`);
    }
  } else if (state.format === 'jsonlines') {
    // Pull the LAST line as the "current snapshot" for scalar fields.
    extractions.push(`# JSON Lines — last record is the current snapshot.`);
    extractions.push(`LAST_REC=$(printf '%s' "$RAW" | grep -v '^[[:space:]]*$' | tail -n 1)`);
    for (const f of fields) {
      const v = shellVarName(f.path);
      extractions.push(`${v}=$(printf '%s' "$LAST_REC" | jq -r '${jqPathOf(f.path)} // empty' 2>/dev/null)`);
    }
  } else if (state.format === 'kv') {
    // Build an associative-array-like lookup using grep for each field.
    // Avoids requiring bash 4 (associative arrays). The kv separator is
    // either `=` or `:` per the parser.
    const sep = state.kvSeparator ?? '=';
    extractions.push(`# key=value parser — separator is '${sep}'.`);
    for (const f of fields) {
      const v = shellVarName(f.path);
      const key = f.path.replace(/[\\.^$*+?()[\]{}|]/g, '\\$&');
      extractions.push(`${v}=$(printf '%s' "$RAW" | grep -m1 -oE "^[[:space:]]*${key}[[:space:]]*${sep === '=' ? '=' : ':'}[[:space:]]*.*" | sed -E "s/^[[:space:]]*${key}[[:space:]]*${sep === '=' ? '=' : ':'}[[:space:]]*//; s/[[:space:]]*$//")`);
    }
  } else if (state.format === 'regex') {
    // Use perl one-liner for named-group extraction — POSIX awk lacks
    // named groups but perl is universally available on Linux/macOS.
    extractions.push(`# Regex with named groups — perl-driven extraction.`);
    const pattern = state.regexPattern ?? '';
    const flags = (state.regexFlags ?? '').replace(/[^gimsx]/g, '');
    const perlMod = flags.includes('i') ? 'i' : '';
    const escaped = pattern.replace(/'/g, "'\\''");
    for (const f of fields) {
      const v = shellVarName(f.path);
      extractions.push(`${v}=$(printf '%s' "$RAW" | perl -ne "if (/${escaped.replace(/"/g, '\\"')}/${perlMod}) { print \\$+{${f.path}}; last }")`);
    }
  } else if (state.format === 'csv-header' || state.format === 'csv-noheader') {
    const delim = state.csvDelimiter ?? ',';
    // For CSV, `RAW` is a multi-line block. We don't extract scalars per-cell;
    // instead each block reads the rows directly via awk (see renderTableBash).
    extractions.push(`# CSV data lives in $RAW — each row is parsed inside the table block below.`);
    extractions.push(`CSV_DELIM='${delim.replace(/'/g, "'\\''")}'`);
  } else if (state.format === 'lines') {
    extractions.push(`# Raw lines — rendered as a <pre> block by default.`);
  }

  // History tracking — for every field with trackHistory=true, append the
  // current value to a per-field tmp file and trim to historyMaxSamples.
  // The sparkline-card block reads these files at render time.
  const historyKey = state.historyKey ?? 'default';
  const historyFields = fields.filter((f) => f.trackHistory);
  if (historyFields.length > 0) {
    extractions.push('');
    extractions.push(`# History tracking (sparkline data).`);
    for (const f of historyFields) {
      const v = shellVarName(f.path);
      const file = `/tmp/obliance-${historyKey}-${shellVarName(f.path).toLowerCase()}.dat`;
      const max = Math.max(2, Math.min(500, f.historyMaxSamples ?? 60));
      extractions.push(`HIST_${v}="${file}"`);
      extractions.push(`if [[ -n "$${v}" ]]; then echo "$(date +%s) $${v}" >> "$HIST_${v}"; tail -n ${max} "$HIST_${v}" > "$HIST_${v}.tmp" && mv "$HIST_${v}.tmp" "$HIST_${v}"; fi`);
    }
  }

  // Block rendering — each block dumps its HTML fragment via a heredoc.
  const blocks = state.blocks.map((blk) => renderBlockBash(blk, state)).join('\n\n');

  return `#!/bin/bash
# === Obliance dashboard — generated by the builder ===
# Edit freely; the generator output is intentionally readable.

set +e
exec 2>/dev/null

# ── Helpers ─────────────────────────────────────────────────────────────────
html_escape() {
    sed -e 's/&/\\&amp;/g' -e 's/</\\&lt;/g' -e 's/>/\\&gt;/g' -e 's/"/\\&quot;/g' -e "s/'/\\&#39;/g"
}
format_num() {
    local n="\${1:-0}"
    echo "$n" | rev | sed 's/.\\{3\\}/& /g' | rev | sed 's/^ //'
}
format_uptime() {
    local s="\${1:-0}"
    local d=$((s / 86400))
    local h=$(( (s % 86400) / 3600 ))
    local m=$(( (s % 3600) / 60 ))
    local sec=$((s % 60))
    if [[ $d -gt 0 ]]; then echo "\${d}d \${h}h \${m}m"
    elif [[ $h -gt 0 ]]; then echo "\${h}h \${m}m \${sec}s"
    elif [[ $m -gt 0 ]]; then echo "\${m}m \${sec}s"
    else echo "\${sec}s"; fi
}

# ── Source ──────────────────────────────────────────────────────────────────
${sourceCmd}

# ── Field extraction ────────────────────────────────────────────────────────
${extractions.join('\n')}

HOSTNAME_FQDN=$(hostname)
HOSTNAME_HTML=$(echo "$HOSTNAME_FQDN" | html_escape)
GENERATED_AT=$(date '+%Y-%m-%d %H:%M:%S')

# ── HTML output ─────────────────────────────────────────────────────────────
cat <<HTMLEOF
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Obliance — ${escapeHtml(dashboardTitle)}</title>
<link href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>
${TEMPLATE_CSS}
</style>
</head>
<body>
    <header>
        <div>
            <div class="brand-name">OBLI<span class="accent">ANCE</span></div>
            <div class="brand-sub">${escapeHtml(dashboardTitle)}</div>
        </div>
        <div class="meta">
            HOST: <strong>\${HOSTNAME_HTML}</strong><br>
            RENDERED: <strong>\${GENERATED_AT}</strong>
        </div>
    </header>

${blocks}

    <footer>
        OBLIANCE RMM • POWERED BY OBLI-SUITE • \${HOSTNAME_HTML}
    </footer>
</body>
</html>
HTMLEOF
`;
}

function renderBlockBash(blk: BuilderBlock, state: BuilderState): string {
  const fields = blk.fieldIds.map((id) => state.fields[id]).filter(Boolean);
  if (fields.length === 0) return '';

  if (blk.kind === 'hero-row') {
    const cols = fields.length;
    const cells = fields.map((f) => {
      const v = '$' + shellVarName(f.path);
      const display = formatExprBash(v, f);
      const colorExpr = colorClassExprBash(f);
      return `        <div class="hero-block">
            <div class="hero-label">${escapeHtml(f.label)}</div>
            <div class="hero-value ${colorExpr}">${display}</div>
        </div>`;
    }).join('\n');
    return `    <div class="hero-row" style="grid-template-columns: repeat(${cols}, 1fr);">
${cells}
    </div>`;
  }

  if (blk.kind === 'stat-grid') {
    const cells = fields.map((f) => {
      const v = '$' + shellVarName(f.path);
      const display = formatExprBash(v, f);
      const colorExpr = colorClassExprBash(f);
      return `        <div class="stat-card">
            <div class="stat-label">${escapeHtml(f.label)}</div>
            <div class="stat-value ${colorExpr}">${display}</div>
        </div>`;
    }).join('\n');
    return `    <div class="stat-grid">
${cells}
    </div>`;
  }

  if (blk.kind === 'pill-row') {
    const cells = fields.map((f) => {
      const v = '$' + shellVarName(f.path);
      // Pill colour: explicit colour rules win, otherwise booleans
      // green/red, otherwise muted.
      const explicit = colorClassExprBash(f, /* fallback */ f.type === 'bool' ? `$([[ "${v}" == "true" ]] && echo green || echo red)` : 'muted');
      return `        <span class="pill ${explicit}">${escapeHtml(f.label)}: ${v}</span>`;
    }).join('\n');
    return `    <div class="pill-row">
${cells}
    </div>`;
  }

  if (blk.kind === 'sparkline-card') {
    // One sparkline per field that has trackHistory enabled. Each card
    // reads its tmp file, computes min/max, and emits an SVG polyline.
    // Multiple fields stack vertically inside the same card.
    const sparklines = fields.filter((f) => f.trackHistory).map((f) => {
      const v = shellVarName(f.path);
      const histVar = `HIST_${v}`;
      return `        <div class="spark-row">
            <div class="spark-meta">
                <span class="spark-label">${escapeHtml(f.label)}</span>
                <span class="spark-value">${formatExprBash('$' + v, f)}</span>
            </div>
            $(
                rates=$(awk '{print $2}' "$${histVar}" 2>/dev/null)
                rcount=$(printf '%s\\n' "$rates" | grep -c .)
                if [[ $rcount -ge 2 ]]; then
                    minr=$(printf '%s\\n' "$rates" | sort -n | head -n 1)
                    maxr=$(printf '%s\\n' "$rates" | sort -n | tail -n 1)
                    range=$((maxr - minr)); [[ $range -le 0 ]] && range=1
                    points=$(awk -v min="$minr" -v range="$range" -v rc="$rcount" 'BEGIN{i=0} {x=4 + (i/(rc-1)) * 592; y=4 + (1 - ($1 - min)/range) * 32; printf "%.2f,%.2f ", x, y; i++}' <<< "$rates")
                    printf '<svg class="spark-svg" viewBox="0 0 600 40" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><polyline points="%s" fill="none" stroke="#e63946" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>' "$points"
                else
                    printf '<div class="spark-empty">collecting samples…</div>'
                fi
            )
        </div>`;
    }).join('\n');
    if (!sparklines) return '';
    const title = blk.title ? `<div class="stat-label" style="margin-bottom:8px">${escapeHtml(blk.title)}</div>` : '';
    return `    <div class="spark-card">${title}
${sparklines}
    </div>`;
  }

  if (blk.kind === 'table') {
    // CSV-driven table — read $RAW directly as the row source.
    const headers = fields.map((f) => `<th>${escapeHtml(f.label)}</th>`).join('');
    const indices = fields.map((f) => extractCsvColIndex(f.path)).join(',');
    const title = blk.title ? `<div class="stat-label" style="margin-bottom:8px">${escapeHtml(blk.title)}</div>` : '';
    return `    ${title}
    <table class="dash-table">
        <thead><tr>${headers}</tr></thead>
        <tbody>
$(printf '%s' "$RAW" | awk -v FS="$CSV_DELIM" -v IDX='${indices}' '
            BEGIN { n = split(IDX, a, ","); }
            NF > 0 {
                printf "<tr>";
                for (i = 1; i <= n; i++) printf "<td>%s</td>", $((a[i] + 1));
                printf "</tr>\\n";
            }')
        </tbody>
    </table>`;
  }

  if (blk.kind === 'pre') {
    return `    <pre class="dash-pre">$(printf '%s' "$RAW" | html_escape)</pre>`;
  }

  return '';
}

function formatExprBash(varRef: string, f: BuilderField): string {
  // varRef is like "$F_hashrate_total" — already escaped for the shell.
  switch (f.type) {
    case 'integer':
    case 'number':
      return `\$(format_num "${varRef}")`;
    case 'duration':
      return `\$(format_uptime "${varRef}")`;
    default:
      return `\$(echo "${varRef}" | html_escape)`;
  }
}

/**
 * Build a shell expression that resolves to the colour class to apply to a
 * value's `<span>`/`<div>`. The first matching rule wins (evaluated in
 * order); if none match, the optional `fallback` is emitted instead. The
 * expression itself is a single `$(…)` so it can be inlined into a class
 * attribute without clobbering surrounding HTML.
 */
function colorClassExprBash(f: BuilderField, fallback: string = ''): string {
  const rules = f.colorRules ?? [];
  if (rules.length === 0) return fallback;
  const v = '$' + shellVarName(f.path);
  // Build a chained `if … elif …` block that prints the right class.
  const isNumeric = f.type === 'number' || f.type === 'integer' || f.type === 'duration';
  const tests: string[] = [];
  for (const r of rules) {
    const valStr = String(r.value ?? '').replace(/'/g, "'\\''");
    let test: string;
    switch (r.when) {
      case 'eq':       test = isNumeric ? `[[ "${v}" == "${valStr}" ]]` : `[[ "${v}" == "${valStr}" ]]`; break;
      case 'neq':      test = `[[ "${v}" != "${valStr}" ]]`; break;
      case 'gt':       test = `[[ -n "${v}" && "${v}" -gt ${valStr || 0} ]]`; break;
      case 'gte':      test = `[[ -n "${v}" && "${v}" -ge ${valStr || 0} ]]`; break;
      case 'lt':       test = `[[ -n "${v}" && "${v}" -lt ${valStr || 0} ]]`; break;
      case 'lte':      test = `[[ -n "${v}" && "${v}" -le ${valStr || 0} ]]`; break;
      case 'contains': test = `[[ "${v}" == *"${valStr}"* ]]`; break;
      case 'truthy':   test = `[[ -n "${v}" && "${v}" != "0" && "${v}" != "false" && "${v}" != "" ]]`; break;
      case 'falsy':    test = `[[ -z "${v}" || "${v}" == "0" || "${v}" == "false" ]]`; break;
    }
    tests.push(`if ${test}; then echo ${r.color}`);
  }
  // First-match wins; if nothing matches and a fallback was supplied,
  // print it; otherwise nothing.
  const fb = fallback ? `else echo ${fallback}` : '';
  return `\$(${tests.join('; el')}; ${fb}; fi)`;
}

/** Extract the integer column index from a CSV field path:
 *  "col[3]" → 3, "<headerName>" → -1 (header not yet supported in awk). */
function extractCsvColIndex(path: string): number {
  const m = /^col\[(\d+)\]$/.exec(path);
  return m ? parseInt(m[1], 10) : -1;
}

// ── PowerShell generator ────────────────────────────────────────────────────

function generatePowerShell(state: BuilderState): string {
  const fields = Object.values(state.fields);
  const dashboardTitle = state.title || 'Custom Dashboard';

  let sourceCmd: string;
  if (state.source.kind === 'file') {
    const path = (state.source.filePath ?? '').replace(/"/g, '`"');
    const lines = Math.max(1, Math.min(1000, state.source.fileLines ?? 50));
    if (state.source.fileMode === 'tail') sourceCmd = `$RAW = Get-Content -Path "${path}" -Tail ${lines} -ErrorAction SilentlyContinue | Out-String`;
    else if (state.source.fileMode === 'head') sourceCmd = `$RAW = Get-Content -Path "${path}" -TotalCount ${lines} -ErrorAction SilentlyContinue | Out-String`;
    else                                       sourceCmd = `$RAW = Get-Content -Path "${path}" -Raw -ErrorAction SilentlyContinue`;
  } else {
    sourceCmd = `$RAW = (& {${state.source.command ?? '""'}}) 2>$null | Out-String`;
  }

  const extractions: string[] = [];
  if (state.format === 'json') {
    extractions.push(`try { $JSON = $RAW | ConvertFrom-Json -ErrorAction Stop } catch { $JSON = $null }`);
    for (const f of fields) {
      const v = shellVarName(f.path);
      extractions.push(`$${v} = ${psSelectExpr(f.path)}`);
    }
  } else if (state.format === 'jsonlines') {
    extractions.push(`$LAST_REC = ($RAW -split "\`r?\`n" | Where-Object { $_ -match '\\S' } | Select-Object -Last 1)`);
    extractions.push(`try { $JSON = $LAST_REC | ConvertFrom-Json -ErrorAction Stop } catch { $JSON = $null }`);
    for (const f of fields) {
      const v = shellVarName(f.path);
      extractions.push(`$${v} = ${psSelectExpr(f.path)}`);
    }
  } else if (state.format === 'kv') {
    const sep = state.kvSeparator ?? '=';
    extractions.push(`$KV = @{}`);
    extractions.push(`($RAW -split "\`r?\`n") | ForEach-Object { if ($_ -match '^\\s*([^\\s${sep === '=' ? '=' : ':'}]+)\\s*${sep === '=' ? '=' : ':'}\\s*(.*?)\\s*$') { $KV[$matches[1].Trim()] = $matches[2].Trim() } }`);
    for (const f of fields) {
      const v = shellVarName(f.path);
      const key = f.path.replace(/'/g, "''");
      extractions.push(`$${v} = $KV['${key}']`);
    }
  } else if (state.format === 'regex') {
    const pattern = (state.regexPattern ?? '').replace(/'/g, "''");
    const flagsStr = (state.regexFlags ?? '').replace(/[^gimsx]/g, '');
    // PowerShell regex flags via inline (?im…) prefix.
    const psFlags = flagsStr.includes('i') ? '(?i)' : '';
    extractions.push(`$RE_MATCH = [regex]::Match($RAW, '${psFlags}${pattern}')`);
    for (const f of fields) {
      const v = shellVarName(f.path);
      const name = f.path.replace(/'/g, "''");
      extractions.push(`$${v} = if ($RE_MATCH.Success) { $RE_MATCH.Groups['${name}'].Value } else { '' }`);
    }
  } else if (state.format === 'csv-header' || state.format === 'csv-noheader') {
    const delim = state.csvDelimiter ?? ',';
    extractions.push(`$CSV_DELIM = '${delim.replace(/'/g, "''")}'`);
    extractions.push(`$ROWS = $RAW -split "\`r?\`n" | Where-Object { $_ -match '\\S' } | ForEach-Object { ,@($_ -split [regex]::Escape($CSV_DELIM)) }`);
  }

  // History tracking — ps1 mirror of the bash behaviour.
  const historyKey = state.historyKey ?? 'default';
  const historyFields = fields.filter((f) => f.trackHistory);
  if (historyFields.length > 0) {
    extractions.push('');
    extractions.push('# History tracking (sparkline data).');
    for (const f of historyFields) {
      const v = shellVarName(f.path);
      const file = `$env:TEMP\\\\obliance-${historyKey}-${shellVarName(f.path).toLowerCase()}.dat`;
      const max = Math.max(2, Math.min(500, f.historyMaxSamples ?? 60));
      extractions.push(`$HIST_${v} = "${file}"`);
      extractions.push(`if ($null -ne $${v} -and "$${v}" -ne '') { Add-Content -Path $HIST_${v} -Value "$([int][double]::Parse((Get-Date -UFormat %s))) $${v}"; (Get-Content $HIST_${v} -Tail ${max}) | Set-Content $HIST_${v} }`);
    }
  }

  const blocks = state.blocks.map((blk) => renderBlockPs(blk, state)).join("`r`n`r`n");

  return `# === Obliance dashboard — generated by the builder ===
$ErrorActionPreference = 'SilentlyContinue'

function Format-Num([long]$n) {
    if ($null -eq $n) { return '0' }
    return ('{0:N0}' -f $n) -replace ',', ' '
}
function Format-Uptime([long]$s) {
    if ($null -eq $s) { $s = 0 }
    $d = [math]::Floor($s / 86400)
    $h = [math]::Floor(($s % 86400) / 3600)
    $m = [math]::Floor(($s % 3600) / 60)
    $sec = $s % 60
    if ($d -gt 0) { return "$($d)d $($h)h $($m)m" }
    if ($h -gt 0) { return "$($h)h $($m)m $($sec)s" }
    if ($m -gt 0) { return "$($m)m $($sec)s" }
    return "$($sec)s"
}
function Html-Escape([string]$s) {
    if ($null -eq $s) { return '' }
    return ($s -replace '&','&amp;' -replace '<','&lt;' -replace '>','&gt;' -replace '"','&quot;' -replace "'",'&#39;')
}

# ── Source ──────────────────────────────────────────────────────────────────
${sourceCmd}

# ── Field extraction ────────────────────────────────────────────────────────
${extractions.join('\n')}

$HOSTNAME_HTML  = Html-Escape ([System.Net.Dns]::GetHostName())
$GENERATED_AT   = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'

# ── HTML output ─────────────────────────────────────────────────────────────
$html = @"
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Obliance — ${escapeHtml(dashboardTitle)}</title>
<link href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>
${TEMPLATE_CSS}
</style>
</head>
<body>
    <header>
        <div>
            <div class="brand-name">OBLI<span class="accent">ANCE</span></div>
            <div class="brand-sub">${escapeHtml(dashboardTitle)}</div>
        </div>
        <div class="meta">
            HOST: <strong>$HOSTNAME_HTML</strong><br>
            RENDERED: <strong>$GENERATED_AT</strong>
        </div>
    </header>

${blocks}

    <footer>
        OBLIANCE RMM • POWERED BY OBLI-SUITE • $HOSTNAME_HTML
    </footer>
</body>
</html>
"@
Write-Output $html
`;
}

/** Convert a JSON-like dotted path into a PowerShell `Select-Object`-style
 *  property accessor on $JSON. Bracket indexing for arrays. */
function psSelectExpr(path: string): string {
  if (!path) return '$JSON';
  const parts = path.split('.');
  let expr = '$JSON';
  for (const p of parts) {
    const arrayMatch = /^([^[]+)\[(\d+)\]$/.exec(p);
    if (arrayMatch) {
      expr = `${expr}.${arrayMatch[1]}[${arrayMatch[2]}]`;
    } else {
      expr = `${expr}.${p}`;
    }
  }
  return expr;
}

function renderBlockPs(blk: BuilderBlock, state: BuilderState): string {
  const fields = blk.fieldIds.map((id) => state.fields[id]).filter(Boolean);
  if (fields.length === 0) return '';

  if (blk.kind === 'hero-row') {
    const cols = fields.length;
    const cells = fields.map((f) => {
      const ref = `$(${formatExprPs(f)})`;
      const colorExpr = colorClassExprPs(f);
      return `        <div class="hero-block">
            <div class="hero-label">${escapeHtml(f.label)}</div>
            <div class="hero-value ${colorExpr}">${ref}</div>
        </div>`;
    }).join('\n');
    return `    <div class="hero-row" style="grid-template-columns: repeat(${cols}, 1fr);">
${cells}
    </div>`;
  }

  if (blk.kind === 'stat-grid') {
    const cells = fields.map((f) => {
      const ref = `$(${formatExprPs(f)})`;
      const colorExpr = colorClassExprPs(f);
      return `        <div class="stat-card">
            <div class="stat-label">${escapeHtml(f.label)}</div>
            <div class="stat-value ${colorExpr}">${ref}</div>
        </div>`;
    }).join('\n');
    return `    <div class="stat-grid">
${cells}
    </div>`;
  }

  if (blk.kind === 'pill-row') {
    const cells = fields.map((f) => {
      const v = `$${shellVarName(f.path)}`;
      const explicit = colorClassExprPs(f, /* fallback */ f.type === 'bool' ? `$(if ([string]${v} -eq 'True' -or ${v} -eq $true) { 'green' } else { 'red' })` : 'muted');
      return `        <span class="pill ${explicit}">${escapeHtml(f.label)}: ${v}</span>`;
    }).join('\n');
    return `    <div class="pill-row">
${cells}
    </div>`;
  }

  if (blk.kind === 'sparkline-card') {
    // PowerShell sparkline — read tmp file lines, normalise, emit SVG.
    const sparklines = fields.filter((f) => f.trackHistory).map((f) => {
      const v = shellVarName(f.path);
      const histVar = `HIST_${v}`;
      return `        <div class="spark-row">
            <div class="spark-meta">
                <span class="spark-label">${escapeHtml(f.label)}</span>
                <span class="spark-value">$(${formatExprPs(f)})</span>
            </div>
            $(
                $rawHist = if (Test-Path $${histVar}) { Get-Content $${histVar} } else { @() }
                $rates = $rawHist | ForEach-Object { ($_ -split ' ',2)[1] } | Where-Object { $_ -match '^\\d+(\\.\\d+)?$' } | ForEach-Object { [double]$_ }
                if ($rates.Count -ge 2) {
                    $minR = ($rates | Measure-Object -Minimum).Minimum
                    $maxR = ($rates | Measure-Object -Maximum).Maximum
                    $range = $maxR - $minR; if ($range -le 0) { $range = 1 }
                    $points = ($rates | ForEach-Object -Begin { $i = 0 } -Process {
                        $x = 4 + ($i / ($rates.Count - 1)) * 592
                        $y = 4 + (1 - ($_ - $minR)/$range) * 32
                        $i++
                        '{0:N2},{1:N2}' -f $x, $y
                    }) -join ' '
                    "<svg class='spark-svg' viewBox='0 0 600 40' preserveAspectRatio='none' xmlns='http://www.w3.org/2000/svg'><polyline points='$points' fill='none' stroke='#e63946' stroke-width='2' stroke-linejoin='round' stroke-linecap='round'/></svg>"
                } else {
                    "<div class='spark-empty'>collecting samples…</div>"
                }
            )
        </div>`;
    }).join('\n');
    if (!sparklines) return '';
    const title = blk.title ? `<div class="stat-label" style="margin-bottom:8px">${escapeHtml(blk.title)}</div>` : '';
    return `    <div class="spark-card">${title}
${sparklines}
    </div>`;
  }

  if (blk.kind === 'table') {
    const headers = fields.map((f) => `<th>${escapeHtml(f.label)}</th>`).join('');
    const indices = fields.map((f) => extractCsvColIndex(f.path));
    const title = blk.title ? `<div class="stat-label" style="margin-bottom:8px">${escapeHtml(blk.title)}</div>` : '';
    return `    ${title}
    <table class="dash-table">
        <thead><tr>${headers}</tr></thead>
        <tbody>
$(($ROWS | ForEach-Object {
    $row = $_
    $cells = ${JSON.stringify(indices)} | ForEach-Object {
        $idx = [int]$_
        $val = if ($idx -ge 0 -and $idx -lt $row.Count) { Html-Escape $row[$idx] } else { '' }
        "<td>$val</td>"
    }
    "<tr>$(-join $cells)</tr>"
}) -join "\`n")
        </tbody>
    </table>`;
  }

  if (blk.kind === 'pre') {
    return `    <pre class="dash-pre">$(Html-Escape $RAW)</pre>`;
  }

  return '';
}

function formatExprPs(f: BuilderField): string {
  const v = `$${shellVarName(f.path)}`;
  switch (f.type) {
    case 'integer':
    case 'number':
      return `Format-Num ${v}`;
    case 'duration':
      return `Format-Uptime ${v}`;
    default:
      return `Html-Escape ${v}`;
  }
}

/**
 * PowerShell mirror of colorClassExprBash — emits a `$(if … elseif …)`
 * chain that resolves to the right colour class. PowerShell's
 * arithmetic comparators (-gt / -lt / -eq) handle both numeric and
 * string operands, with implicit casting for the numeric checks.
 */
function colorClassExprPs(f: BuilderField, fallback: string = ''): string {
  const rules = f.colorRules ?? [];
  if (rules.length === 0) return fallback;
  const v = `$${shellVarName(f.path)}`;
  const isNumeric = f.type === 'number' || f.type === 'integer' || f.type === 'duration';
  const tests: string[] = [];
  for (const r of rules) {
    const valStr = String(r.value ?? '').replace(/'/g, "''");
    let test: string;
    switch (r.when) {
      case 'eq':       test = isNumeric ? `[double]${v} -eq ${Number(r.value) || 0}` : `'${valStr}' -eq ${v}`; break;
      case 'neq':      test = isNumeric ? `[double]${v} -ne ${Number(r.value) || 0}` : `'${valStr}' -ne ${v}`; break;
      case 'gt':       test = `[double]${v} -gt ${Number(r.value) || 0}`; break;
      case 'gte':      test = `[double]${v} -ge ${Number(r.value) || 0}`; break;
      case 'lt':       test = `[double]${v} -lt ${Number(r.value) || 0}`; break;
      case 'lte':      test = `[double]${v} -le ${Number(r.value) || 0}`; break;
      case 'contains': test = `${v} -like '*${valStr}*'`; break;
      case 'truthy':   test = `${v} -and ${v} -ne '0' -and ${v} -ne 'false' -and ${v} -ne ''`; break;
      case 'falsy':    test = `-not ${v} -or ${v} -eq '0' -or ${v} -eq 'false'`; break;
    }
    tests.push(`if (${test}) { '${r.color}' }`);
  }
  const fb = fallback ? `else { '${fallback}' }` : '';
  return `\$(${tests.join(' els')}; ${fb})`;
}

// ── Public entry point ──────────────────────────────────────────────────────

export function generateScript(state: BuilderState): string {
  return state.runtime === 'powershell' ? generatePowerShell(state) : generateBash(state);
}

// ── HTML escape (used inside the generator's own static strings) ────────────
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
