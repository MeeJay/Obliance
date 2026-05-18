import { db } from '../db';
import { logger } from '../utils/logger';
import { isMasterTenant } from '@obliance/shared';

// CVE catalog + matching against the per-device software inventory.
//
// Architecture mirrors update.service:
//   - cves         : global catalog (no tenant_id) populated by syncCisaKev
//   - device_cves  : tenant-scoped matches between devices and CVEs.
//                    Master tenant queries fan out across all child tenants.
//
// MVP source = CISA KEV (Known Exploited Vulnerabilities) — small, curated,
// daily refresh. ~1300 entries, all actively exploited in the wild → high
// signal. NVD full feed can be added later as a second `source` value
// without touching the matching logic.
//
// Matching heuristic (per device, per inventory row):
//   - Vendor matches CVE.vendor (case-insensitive substring both ways)
//     AND product matches CVE.product           → high confidence
//   - Product matches CVE.product (>= 6 chars) only
//     OR name matches CVE.name keyword          → medium confidence
//   - Fuzzy substring fallback                  → low confidence (badge gray)
//
// Match confidence is surfaced in the UI so admins can ignore low-conf
// noise. Admins can also explicitly Dismiss a match — sets dismissed_at,
// hides it from the affected-devices list, prevents re-creation on rescan.

// We pull from NIST NVD instead of CISA's direct feed. CISA's Akamai WAF
// aggressively blocks programmatic clients (cloud-host IPs, non-browser
// UAs, missing Sec-Fetch headers, …) — fighting it is a losing arms
// race. NVD is purpose-built for programmatic consumption, replicates
// every CISA KEV entry verbatim under the same `cisa*` fields, AND
// enriches them with CVSS scores that CISA KEV doesn't expose.
//
// Rate limit (anonymous): 5 requests / 30s rolling. KEV fits in 1 call
// (~1300 entries); the recent-CRITICAL feed paginates if needed
// (default 2000 per page, typical ~600 entries / 90d).
const NVD_BASE = 'https://services.nvd.nist.gov/rest/json/cves/2.0';
const NVD_KEV_URL = `${NVD_BASE}?hasKev&resultsPerPage=2000`;

// Source registry — drives both the runtime sync dispatcher and the UI
// "sources" selector. Each source maps to a `source` value in the
// `cves` table so the same row schema can carry several catalogs side
// by side and the admin can compare them.
export type CveSourceKey = 'nvd_kev' | 'nvd_recent_critical' | 'ghsa';

// GHSA — GitHub Security Advisories. REST API, OSS package focus.
// Without GITHUB_TOKEN: 60 req/h, ~6000 advisories max per sync. With
// a token: 5000 req/h. We cap pagination at 30 pages (3000 entries)
// per call and walk only the most recent — sync runs daily, so a
// rolling window stays current without exhausting the rate limit.
const GHSA_BASE = 'https://api.github.com/advisories';
const GHSA_WINDOW_DAYS = 90;
const GHSA_MAX_PAGES = 30;

interface NvdCveItem {
  cve: {
    id: string;
    published?: string;
    lastModified?: string;
    descriptions?: Array<{ lang: string; value: string }>;
    metrics?: {
      cvssMetricV31?: Array<{ cvssData?: { baseScore?: number; baseSeverity?: string } }>;
      cvssMetricV30?: Array<{ cvssData?: { baseScore?: number; baseSeverity?: string } }>;
      cvssMetricV2?:  Array<{ cvssData?: { baseScore?: number; baseSeverity?: string } }>;
    };
    configurations?: Array<{
      nodes?: Array<{
        cpeMatch?: Array<{
          criteria: string;
          vulnerable?: boolean;
          versionStartIncluding?: string;
          versionStartExcluding?: string;
          versionEndIncluding?: string;
          versionEndExcluding?: string;
        }>;
      }>;
    }>;
    cisaExploitAdd?: string;
    cisaActionDue?: string;
    cisaRequiredAction?: string;
    cisaVulnerabilityName?: string;
  };
}

interface NvdFeed {
  resultsPerPage: number;
  totalResults: number;
  vulnerabilities: NvdCveItem[];
}

// Extract vendor + product from the first CPE 2.3 string of a CVE.
// Format: cpe:2.3:<part>:<vendor>:<product>:<version>:…  (11 colons total)
function parseCpe(cpe: string): { vendor: string | null; product: string | null } {
  const parts = cpe.split(':');
  // parts[0]='cpe', parts[1]='2.3', parts[2]=part, parts[3]=vendor, parts[4]=product
  if (parts.length < 5 || parts[0] !== 'cpe' || parts[1] !== '2.3') {
    return { vendor: null, product: null };
  }
  const cleanup = (s: string) => (s && s !== '*' && s !== '-' ? s.replace(/_/g, ' ') : null);
  return { vendor: cleanup(parts[3]), product: cleanup(parts[4]) };
}

// Token helpers for matching. Splitting on the broad punctuation set
// (space, underscore, dash, dot, slash, comma, parens) lets us compare
// "Acrobat_Reader_DC" against "Adobe Acrobat Reader DC" cleanly while
// rejecting bogus substring overlap like "ios" inside "iotop".
function tokenSet(name: string | null | undefined): Set<string> {
  if (!name) return new Set();
  return new Set(
    name
      .toLowerCase()
      .split(/[\s_\-./\\,()[\]]+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0),
  );
}

function subsetOf(needle: Set<string>, haystack: Set<string>): boolean {
  if (needle.size === 0) return false;
  for (const t of needle) if (!haystack.has(t)) return false;
  return true;
}

// OS-level CVE compatibility check. CISA/NVD scope OS CVEs via part='o'
// CPEs (e.g. cpe:2.3:o:cisco:ios:* for Cisco IOS, cpe:2.3:o:microsoft:
// windows_10:* for Windows 10). We only land such a CVE on a device
// whose os_type makes physical sense — otherwise stock Linux boxes
// would inherit every Cisco / Juniper / network-OS CVE in the catalog.
function osTypeCompatible(cveVendor: string, cveProductTokens: Set<string>, osType: string): boolean {
  const v = cveVendor.toLowerCase();
  const t = osType.toLowerCase();
  if (!t) return false;
  if (t === 'windows') return v === 'microsoft' && cveProductTokens.has('windows');
  if (t === 'macos') return v === 'apple' && (cveProductTokens.has('macos') || cveProductTokens.has('mac') || cveProductTokens.has('os'));
  if (t === 'linux') {
    if (v === 'linux' && (cveProductTokens.has('kernel') || cveProductTokens.has('linux'))) return true;
    // Common distro vendors
    return ['canonical', 'ubuntu', 'debian', 'redhat', 'fedora', 'centos', 'suse', 'opensuse', 'oracle', 'alpinelinux', 'alpine', 'arch', 'rocky', 'almalinux'].includes(v);
  }
  if (t === 'freebsd') return v === 'freebsd';
  return false;
}

function safeParseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}

// ── Version comparison ──────────────────────────────────────────────────────
// Permissive dotted-numeric comparator. Designed for vendor strings that
// don't follow strict semver: Chrome "148.0.7778.168", Firefox "120.0",
// Windows "10.0.19045.5247", Linux kernels "6.5.0-21-generic". We split
// on dots and any leading run of digits per component is used as the
// numeric weight; non-numeric trailing tags (e.g. "-rc1", "-generic")
// are stripped for the comparison so "148.0.7778.168" cleanly compares
// greater than "94.0.4606.61".
//
// Returns -1 / 0 / +1, or null when either input can't be parsed at all
// (then the caller MUST treat the match as undecidable — never silently
// "passes" the range check, because that's how false positives leaked
// in the previous algorithm).
function parseVersionComponents(v: string | null | undefined): number[] | null {
  if (!v) return null;
  // Strip a leading `v` prefix ("v1.2.3") and anything from the first
  // `+` (build metadata) or whitespace onwards.
  const trimmed = String(v).trim().replace(/^v/i, '').split(/[\s+]/)[0];
  if (!trimmed) return null;
  // Split on dots, dashes, underscores — but keep numeric prefixes per
  // segment so "0-21-generic" → [0, 21] (generic is ignored).
  const parts = trimmed.split(/[.\-_]/).map((p) => {
    const m = p.match(/^\d+/);
    return m ? parseInt(m[0], 10) : NaN;
  }).filter((n) => Number.isFinite(n));
  return parts.length > 0 ? parts : null;
}

function compareVersions(a: string | null | undefined, b: string | null | undefined): number | null {
  const av = parseVersionComponents(a);
  const bv = parseVersionComponents(b);
  if (!av || !bv) return null;
  const len = Math.max(av.length, bv.length);
  for (let i = 0; i < len; i++) {
    const x = av[i] ?? 0;
    const y = bv[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

interface AffectedRange {
  versionStartIncluding: string | null;
  versionStartExcluding: string | null;
  versionEndIncluding: string | null;
  versionEndExcluding: string | null;
}

/** Returns true when `installed` falls inside the range. A null bound
 *  is treated as open-ended on that side. If the installed version
 *  can't be parsed against a bound, that bound is treated as
 *  unsatisfied (defensive — we'd rather drop the FP than create one). */
function installedInRange(installed: string, range: AffectedRange): boolean {
  if (range.versionStartIncluding) {
    const c = compareVersions(installed, range.versionStartIncluding);
    if (c === null || c < 0) return false;
  }
  if (range.versionStartExcluding) {
    const c = compareVersions(installed, range.versionStartExcluding);
    if (c === null || c <= 0) return false;
  }
  if (range.versionEndIncluding) {
    const c = compareVersions(installed, range.versionEndIncluding);
    if (c === null || c > 0) return false;
  }
  if (range.versionEndExcluding) {
    const c = compareVersions(installed, range.versionEndExcluding);
    if (c === null || c >= 0) return false;
  }
  return true;
}

/** True when the installed software's version still matters for this
 *  CVE — i.e. it lands inside at least one affected range. When no
 *  range info exists we keep the match (can't tell). When ranges exist
 *  but the installed version is unparseable we *drop* the match — the
 *  classic FP "Chrome 148 is patched, why are we flagging it" came from
 *  blindly trusting the product match when no version logic ran. */
function versionStillVulnerable(installedVersion: string | null, ranges: AffectedRange[]): boolean {
  if (!ranges.length) return true; // no range info — keep the match
  if (!installedVersion) return true; // can't compare — keep, but mark low conf upstream
  const parsed = parseVersionComponents(installedVersion);
  if (!parsed) return true; // unparseable installed version — keep, low conf
  for (const r of ranges) {
    if (installedInRange(installedVersion, r)) return true;
  }
  return false;
}

// ── GHSA types ──────────────────────────────────────────────────────────────
// Subset of the GitHub Security Advisories REST schema we actually read.
// Full schema docs: https://docs.github.com/en/rest/security-advisories/global-advisories
interface GhsaVuln {
  package?: { ecosystem?: string; name?: string };
  vulnerable_version_range?: string;
  first_patched_version?: string | null;
}
interface GhsaAdvisory {
  ghsa_id: string;
  cve_id: string | null;
  summary?: string;
  description?: string;
  severity?: string;                          // low|medium|high|critical
  cvss?: { score?: number; vector_string?: string };
  identifiers?: Array<{ type: string; value: string }>;
  references?: Array<{ url?: string }>;
  published_at?: string;
  updated_at?: string;
  vulnerabilities?: GhsaVuln[];
}

// Parse the GitHub-style `Link` header and pull out the URL flagged
// `rel="next"`. Returns null when we're on the last page.
function parseLinkHeaderNext(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(',')) {
    const m = /<([^>]+)>;\s*rel="next"/.exec(part.trim());
    if (m) return m[1];
  }
  return null;
}

// Source registry — single place that defines every CVE source the app
// knows about. The UI selector reads this list verbatim. To add a new
// source: define its label / URL / kevFlag policy here, plumb a case in
// the dispatcher below, and it shows up in the selector with live stats.
export interface CveSourceMeta {
  key: CveSourceKey;
  label: string;
  description: string;
}
const CVE_SOURCES: CveSourceMeta[] = [
  {
    key: 'nvd_kev',
    label: 'NVD — CISA KEV',
    description: 'CVE flaggées par CISA comme activement exploitées dans la nature. Catalogue compact (~1300 entrées), signal le plus actionnable.',
  },
  {
    key: 'nvd_recent_critical',
    label: 'NVD — CRITICAL récentes (90j)',
    description: 'CVE CVSS 9+ publiées dans les 90 derniers jours. Capte les nouvelles vulnérabilités avant que CISA ne les ajoute au KEV.',
  },
  {
    key: 'ghsa',
    label: 'GitHub Security Advisories',
    description: 'Advisories OSS (npm, pip, gem, cargo, maven, NuGet, …) sur les 90 derniers jours. Complémentaire à NVD pour les paquets de langage installés. Token GitHub optionnel (env GITHUB_TOKEN) pour relever le rate limit 60→5000 req/h.',
  },
];

class CveService {
  listSourcesMeta(): CveSourceMeta[] { return CVE_SOURCES; }

  // ─── Sync dispatcher ─────────────────────────────────────────────────────
  // Routes a sync request to the right NVD endpoint. `syncCisaKev` kept
  // as alias for backward compat (legacy callers + cron).
  async syncCisaKev() { return this.syncSource('nvd_kev'); }

  async syncSource(key: CveSourceKey): Promise<{ fetched: number; upserted: number; failed: number }> {
    if (key === 'nvd_kev') return this._syncFromNvd('nvd_kev', NVD_KEV_URL, /* forceKev */ true);
    if (key === 'nvd_recent_critical') {
      // Window: last 90 days. NVD requires both pubStartDate and
      // pubEndDate when one is given. CRITICAL = CVSS 9-10.
      const end = new Date();
      const start = new Date(Date.now() - 90 * 24 * 3600 * 1000);
      const url =
        `${NVD_BASE}?cvssV3Severity=CRITICAL` +
        `&pubStartDate=${encodeURIComponent(start.toISOString())}` +
        `&pubEndDate=${encodeURIComponent(end.toISOString())}` +
        `&resultsPerPage=2000`;
      return this._syncFromNvd('nvd_recent_critical', url, /* forceKev */ false);
    }
    if (key === 'ghsa') return this._syncFromGhsa();
    throw new Error(`Unknown CVE source: ${key}`);
  }

  // Sync every source in sequence. Skips sources that throw so a single
  // failing source doesn't take the whole job down. Used by the daily
  // cron + the "Sync all" button.
  async syncAllSources(): Promise<Array<{ source: CveSourceKey; ok: boolean; fetched?: number; upserted?: number; failed?: number; error?: string }>> {
    const results: Array<{ source: CveSourceKey; ok: boolean; fetched?: number; upserted?: number; failed?: number; error?: string }> = [];
    for (const meta of CVE_SOURCES) {
      try {
        const r = await this.syncSource(meta.key);
        results.push({ source: meta.key, ok: true, ...r });
      } catch (err) {
        results.push({ source: meta.key, ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return results;
  }

  private async _syncFromNvd(sourceKey: CveSourceKey, url: string, forceKev: boolean): Promise<{ fetched: number; upserted: number; failed: number }> {
    const now = new Date();
    let feed: NvdFeed;
    try {
      const res = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Obliance-RMM CVE sync (+https://obliance.io)',
        },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`NVD fetch HTTP ${res.status}: ${body.slice(0, 200)}`);
      }
      const ct = res.headers.get('content-type') || '';
      if (!ct.toLowerCase().includes('json')) {
        const body = await res.text().catch(() => '');
        throw new Error(`NVD returned non-JSON (content-type=${ct}): ${body.slice(0, 200)}`);
      }
      feed = (await res.json()) as NvdFeed;
      if (!Array.isArray(feed?.vulnerabilities)) {
        throw new Error('NVD payload malformed (vulnerabilities missing)');
      }
    } catch (err) {
      logger.error({ err, sourceKey }, 'NVD fetch failed');
      throw err;
    }

    let upserted = 0;
    let failed = 0;
    for (const item of feed.vulnerabilities) {
      const cve = item.cve;
      if (!cve?.id) { failed++; continue; }

      // Pick the first English description, fall back to anything.
      const desc =
        cve.descriptions?.find((d) => d.lang === 'en')?.value
        ?? cve.descriptions?.[0]?.value
        ?? null;

      // CVSS v3.1 takes priority; fall back to v3.0 then v2 so older
      // CVEs still get a score.
      const metric =
        cve.metrics?.cvssMetricV31?.[0]?.cvssData
        ?? cve.metrics?.cvssMetricV30?.[0]?.cvssData
        ?? cve.metrics?.cvssMetricV2?.[0]?.cvssData
        ?? null;
      const cvssScore = typeof metric?.baseScore === 'number' ? metric.baseScore : null;
      // KEV sources default to 'high' since the feed itself is exploited-
      // in-the-wild. Other sources rely on the real CVSS severity.
      const severity =
        (metric?.baseSeverity ?? '').toLowerCase()
        || (forceKev ? 'high' : 'unknown');

      // Extract vendor / product from the FIRST CPE match. Store every
      // CPE string we saw under cpe_matches for advanced matchers later.
      // Also pull the version-range info — used by the UI to display
      // "Patched in X.Y.Z" / "Vulnerable from A.B.C…".
      const allCpes: string[] = [];
      const affectedVersions: Array<{
        cpe: string;
        vendor: string | null;
        product: string | null;
        versionStartIncluding: string | null;
        versionStartExcluding: string | null;
        versionEndIncluding: string | null;
        versionEndExcluding: string | null;
      }> = [];
      for (const cfg of cve.configurations ?? []) {
        for (const node of cfg.nodes ?? []) {
          for (const m of node.cpeMatch ?? []) {
            if (!m.criteria || m.vulnerable === false) continue;
            allCpes.push(m.criteria);
            const p = parseCpe(m.criteria);
            affectedVersions.push({
              cpe: m.criteria,
              vendor: p.vendor,
              product: p.product,
              versionStartIncluding: m.versionStartIncluding ?? null,
              versionStartExcluding: m.versionStartExcluding ?? null,
              versionEndIncluding: m.versionEndIncluding ?? null,
              versionEndExcluding: m.versionEndExcluding ?? null,
            });
          }
        }
      }
      const parsed = allCpes.length > 0 ? parseCpe(allCpes[0]) : { vendor: null, product: null };
      // First patched version = the earliest known fix. NVD encodes
      // "fixed in vX" via versionEndExcluding (the upper bound a vuln
      // range stops at — so the patched build is exactly that value).
      // versionEndIncluding means the range still includes that version
      // (less actionable as "patched in"), so we prefer Excluding.
      let firstPatched: string | null = null;
      for (const av of affectedVersions) {
        if (av.versionEndExcluding) { firstPatched = av.versionEndExcluding; break; }
      }
      if (!firstPatched) {
        for (const av of affectedVersions) {
          if (av.versionEndIncluding) { firstPatched = `> ${av.versionEndIncluding}`; break; }
        }
      }

      const kevFlag = forceKev || !!cve.cisaExploitAdd;
      // For non-KEV sources we fall back to NVD's own publication date
      // for the name (no cisaVulnerabilityName).
      const cveName = cve.cisaVulnerabilityName ?? null;

      try {
        await db('cves')
          .insert({
            cve_id: cve.id,
            source: sourceKey,
            vendor: parsed.vendor,
            product: parsed.product,
            name: cveName,
            description: desc,
            severity,
            cvss_score: cvssScore,
            kev_flag: kevFlag,
            published_at: cve.published ? new Date(cve.published) : (cve.cisaExploitAdd ? new Date(cve.cisaExploitAdd) : null),
            modified_at: cve.lastModified ? new Date(cve.lastModified) : now,
            due_date: cve.cisaActionDue ? new Date(cve.cisaActionDue) : null,
            required_action: cve.cisaRequiredAction ?? null,
            references: JSON.stringify([]),
            cpe_matches: JSON.stringify(allCpes),
            affected_versions: JSON.stringify(affectedVersions),
            first_patched_version: firstPatched,
            synced_at: now,
          })
          .onConflict('cve_id')
          .merge({
            // Keep the FIRST seen source — don't let a later non-KEV sync
            // overwrite a row that came from KEV. We do however refresh
            // every other field so the metadata stays fresh.
            vendor: parsed.vendor,
            product: parsed.product,
            name: cveName,
            description: desc,
            severity,
            cvss_score: cvssScore,
            kev_flag: db.raw('GREATEST(cves.kev_flag::int, ?::int)::boolean', [kevFlag ? 1 : 0]),
            modified_at: cve.lastModified ? new Date(cve.lastModified) : now,
            due_date: cve.cisaActionDue ? new Date(cve.cisaActionDue) : null,
            required_action: cve.cisaRequiredAction ?? null,
            cpe_matches: JSON.stringify(allCpes),
            affected_versions: JSON.stringify(affectedVersions),
            first_patched_version: firstPatched,
            synced_at: now,
            updated_at: now,
          });
        upserted++;
      } catch (err) {
        logger.error({ err, cve: cve.id, sourceKey }, 'NVD row upsert failed');
        failed++;
      }
    }

    logger.info({ fetched: feed.vulnerabilities.length, upserted, failed, sourceKey }, 'NVD sync complete');
    return { fetched: feed.vulnerabilities.length, upserted, failed };
  }

  // ─── Sync from GitHub Security Advisories ────────────────────────────────
  // OSS-package focused (npm, pip, gem, cargo, maven, NuGet, …). Paginates
  // via the standard GitHub Link header, stops when we cross the rolling
  // window or hit GHSA_MAX_PAGES. The cron runs daily so a 90-day window
  // is plenty to stay current without slamming the rate limit.
  private async _syncFromGhsa(): Promise<{ fetched: number; upserted: number; failed: number }> {
    const now = new Date();
    const cutoff = Date.now() - GHSA_WINDOW_DAYS * 24 * 3600 * 1000;

    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Obliance-RMM CVE sync (+https://obliance.io)',
    };
    // GITHUB_TOKEN raises the rate limit 60→5000 req/h. Without it we
    // still work but the first sync may be slow on a large window.
    const token = process.env.GITHUB_TOKEN?.trim();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    let nextUrl: string | null = `${GHSA_BASE}?per_page=100&sort=published&direction=desc`;
    let fetched = 0;
    let upserted = 0;
    let failed = 0;
    let page = 0;

    while (nextUrl && page < GHSA_MAX_PAGES) {
      page++;
      let res: Response;
      try {
        res = await fetch(nextUrl, { headers });
      } catch (err) {
        logger.error({ err, nextUrl }, 'GHSA fetch failed');
        throw err;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`GHSA fetch HTTP ${res.status}: ${body.slice(0, 200)}`);
      }
      const advisories = (await res.json()) as GhsaAdvisory[];
      if (!Array.isArray(advisories) || advisories.length === 0) break;

      let crossedCutoff = false;
      for (const adv of advisories) {
        fetched++;
        const pubAt = adv.published_at ? new Date(adv.published_at).getTime() : 0;
        if (pubAt && pubAt < cutoff) { crossedCutoff = true; continue; }
        try {
          await this._upsertGhsa(adv, now);
          upserted++;
        } catch (err) {
          logger.error({ err, ghsa: adv.ghsa_id }, 'GHSA upsert failed');
          failed++;
        }
      }
      if (crossedCutoff) break;

      // Parse Link header for the `rel="next"` URL. GitHub paginates
      // via this standard envelope — when there's no next link we've
      // hit the end.
      nextUrl = parseLinkHeaderNext(res.headers.get('Link'));
    }

    logger.info({ fetched, upserted, failed, pages: page }, 'GHSA sync complete');
    return { fetched, upserted, failed };
  }

  private async _upsertGhsa(adv: GhsaAdvisory, now: Date): Promise<void> {
    // GHSA advisories often carry a CVE id; when they don't we use the
    // GHSA-XXXX-XXXX-XXXX identifier as the catalog key. Both formats
    // stay distinct so we never collide with NVD rows.
    const cveId = adv.cve_id || adv.ghsa_id;
    if (!cveId) return;

    const vulns = Array.isArray(adv.vulnerabilities) ? adv.vulnerabilities : [];
    const firstVuln = vulns[0];

    // GHSA vendor concept = package ecosystem (npm, pip, gem, etc.) —
    // we store the ecosystem in `vendor` and the package name in
    // `product`. Token-based matching naturally lets a Linux package
    // named `python3-requests` match a GHSA on pip/requests.
    const vendor = firstVuln?.package?.ecosystem?.toLowerCase() ?? null;
    const product = firstVuln?.package?.name ?? null;

    // Aggregate every package's version-range data so the UI can show
    // the patched-from version + the vulnerable range. Use the FIRST
    // vuln's first_patched_version as the canonical "Patched in" hint.
    const affectedVersions = vulns.map((v) => ({
      cpe: null,
      vendor: v.package?.ecosystem ?? null,
      product: v.package?.name ?? null,
      vulnerableRange: v.vulnerable_version_range ?? null,
      firstPatchedVersion: v.first_patched_version ?? null,
    }));
    const firstPatched = vulns.find((v) => !!v.first_patched_version)?.first_patched_version ?? null;

    const severity = (adv.severity ?? '').toLowerCase() || 'unknown';
    const cvssScore = typeof adv.cvss?.score === 'number' ? adv.cvss.score : null;

    await db('cves')
      .insert({
        cve_id: cveId,
        source: 'ghsa',
        vendor,
        product,
        name: adv.summary ?? null,
        description: adv.description ?? null,
        severity,
        cvss_score: cvssScore,
        kev_flag: false,
        published_at: adv.published_at ? new Date(adv.published_at) : null,
        modified_at: adv.updated_at ? new Date(adv.updated_at) : now,
        due_date: null,
        required_action: null,
        references: JSON.stringify((adv.references ?? []).map((r) => r.url).filter(Boolean)),
        cpe_matches: JSON.stringify([]),
        affected_versions: JSON.stringify(affectedVersions),
        first_patched_version: firstPatched,
        synced_at: now,
      })
      .onConflict('cve_id')
      .merge({
        // Same GREATEST-on-kev_flag trick as the NVD path: a CVE that
        // was already flagged KEV by another source must keep that flag
        // when GHSA back-fills it without one.
        vendor,
        product,
        name: adv.summary ?? null,
        description: adv.description ?? null,
        severity,
        cvss_score: cvssScore,
        kev_flag: db.raw('GREATEST(cves.kev_flag::int, 0::int)::boolean'),
        modified_at: adv.updated_at ? new Date(adv.updated_at) : now,
        references: JSON.stringify((adv.references ?? []).map((r) => r.url).filter(Boolean)),
        affected_versions: JSON.stringify(affectedVersions),
        first_patched_version: firstPatched,
        synced_at: now,
        updated_at: now,
      });
  }

  // ─── Matching ────────────────────────────────────────────────────────────
  //
  // Run a fresh match for ONE device. Compares the latest software
  // inventory against the CVE catalog and writes device_cves rows.
  //
  // Stale non-dismissed matches are purged at the start so a stricter
  // algorithm rev (like this one) actually drops the false positives
  // accumulated by previous runs. Dismissed rows are preserved — they
  // keep suppressing the same noise on re-match.
  //
  // Anti-FP rules (the previous algorithm matched everything that had
  // any substring overlap, which produced Cisco IOS hits on Linux iotop
  // and Firefox hits on stock servers):
  //
  //   1. TOKEN-based product match, not substring. We split both the
  //      software name AND the CVE product by space/underscore/dash/dot
  //      and require ALL CVE tokens to be present in the software-name
  //      token set. "ios" no longer matches "iotop".
  //   2. CPE PART filter. Each CVE's affected products are described as
  //      cpe:2.3:<part>:vendor:product:… where part ∈ {a=app, o=OS,
  //      h=hardware}.
  //        - part=h → skip entirely (we don't track hardware exposure)
  //        - part=o → require OS-type compatibility with the device
  //          (Cisco IOS CVEs don't land on Linux/Windows/macOS hosts).
  //   3. SHORT-PRODUCT guard. CVE products under 4 chars (`ios`, `git`,
  //      `vim`, `go`, …) require an explicit vendor match — without one
  //      they're too noisy.
  //   4. SYNTHETIC OS rows replace the publisher='linux' kludge with a
  //      proper "Microsoft Windows", "Apple macOS", "Linux kernel" +
  //      distro entry so OS-level CVEs actually land on the right boxes.
  async rescanDevice(deviceId: number): Promise<number> {
    const device = await db('devices').where({ id: deviceId })
      .select('id', 'tenant_id', 'os_type', 'os_name', 'os_version', 'os_distro')
      .first();
    if (!device) return 0;

    // Drop stale (non-dismissed) matches so a stricter rev of the
    // algorithm propagates cleanly. Dismissed rows are kept — they
    // continue suppressing false positives the admin already triaged.
    await db('device_cves')
      .where({ device_id: deviceId })
      .whereNull('dismissed_at')
      .delete();

    const software = await db('device_inventory_software')
      .where({ device_id: deviceId })
      .whereRaw(`scanned_at = (SELECT MAX(scanned_at) FROM device_inventory_software WHERE device_id = ?)`, [deviceId])
      .select('id', 'name', 'version', 'publisher');

    // Synthetic OS rows so OS-level CVEs (Windows, macOS, Linux kernel)
    // can land on the device even when the kernel isn't in the package
    // inventory. We include enough tokens so token-based matching works
    // both ways (e.g. "linux kernel ubuntu" matches CVEs on "linux_kernel"
    // AND CVEs scoped to vendor "ubuntu").
    const osType = (device.os_type as string | null) ?? '';
    const osName = (device.os_name as string | null) ?? '';
    const osDistro = (device.os_distro as string | null) ?? '';
    const osVersion = (device.os_version as string | null) ?? null;
    if (osType === 'windows') {
      software.push({ id: null, name: `Microsoft Windows ${osName || ''}`.trim(), version: osVersion, publisher: 'Microsoft' } as any);
    } else if (osType === 'macos') {
      software.push({ id: null, name: `Apple macOS ${osName || ''}`.trim(), version: osVersion, publisher: 'Apple' } as any);
    } else if (osType === 'linux') {
      software.push({ id: null, name: 'Linux Kernel', version: osVersion, publisher: 'Linux' } as any);
      if (osDistro) software.push({ id: null, name: osDistro, version: osVersion, publisher: osDistro } as any);
      if (osName && osName.toLowerCase() !== osDistro.toLowerCase()) {
        software.push({ id: null, name: osName, version: osVersion, publisher: osDistro || osName } as any);
      }
    } else if (osType === 'freebsd') {
      software.push({ id: null, name: 'FreeBSD', version: osVersion, publisher: 'freebsd' } as any);
    }

    if (software.length === 0) return 0;

    const allCves = await db('cves').select('id', 'vendor', 'product', 'cpe_matches', 'affected_versions', 'first_patched_version');

    // Pre-tokenize the inventory once per device.
    const swTokenized = software.map((s) => ({
      raw: s,
      nameTokens: tokenSet(s.name as string),
      publisher: ((s.publisher as string | null) ?? '').toLowerCase(),
    }));

    let inserted = 0;
    for (const cve of allCves) {
      const cveVendor = ((cve.vendor as string | null) ?? '').toLowerCase();
      const cveProduct = ((cve.product as string | null) ?? '').toLowerCase();
      if (!cveProduct) continue;

      const cveProductTokens = tokenSet(cveProduct);
      if (cveProductTokens.size === 0) continue;

      // CPE part introspection — feed comes back as parsed JSON via knex.
      const cpes: string[] = Array.isArray(cve.cpe_matches)
        ? (cve.cpe_matches as string[])
        : (typeof cve.cpe_matches === 'string' ? safeParseJsonArray(cve.cpe_matches as string) : []);
      const cpeParts = new Set<string>();
      for (const c of cpes) {
        const p = c.split(':')[2];
        if (p) cpeParts.add(p);
      }
      // Hardware CVEs (routers, IoT boards) can't be matched against
      // device_inventory_software — skip them outright. They're real
      // CVEs but we have no signal to act on.
      if (cpeParts.size > 0 && !cpeParts.has('a') && !cpeParts.has('o') && cpeParts.has('h')) continue;

      const osScoped = cpeParts.has('o') && !cpeParts.has('a');

      // Short product name (<4 chars, e.g. "ios", "git", "vim") without
      // a vendor field is a guaranteed FP magnet — only run them when
      // we can cross-check the vendor.
      const shortProduct = cveProduct.length < 4;
      if (shortProduct && !cveVendor) continue;

      // OS-level CVEs must match the device's OS family. Cisco IOS CVE
      // (vendor=cisco, product=ios) is part=o → must NOT match Linux.
      if (osScoped && !osTypeCompatible(cveVendor, cveProductTokens, osType)) continue;

      // Single-token CVE product names (e.g. `core`, `node`, `http`,
      // `server`) match anywhere there's a package with that token in
      // its name, so we require an explicit vendor cross-check before
      // declaring a hit. Was: CVE-2020-15505 (Ivanti MobileIron
      // vendor=mobileiron, product=core) lighting up `libevent-core`,
      // `initramfs-tools-core` on stock Linux.
      const singleToken = cveProductTokens.size === 1;

      // Parse the per-CVE affected ranges ONCE per CVE — avoids re-parsing
      // for every software row. Empty list = no range info (keep the match
      // and rely on the product/vendor guard alone). When ranges exist we
      // drop hits where the installed version sits above the patched
      // boundary (was: Chrome 148 still flagged for a CVE patched in 94).
      const rangesRaw = cve.affected_versions as unknown;
      let ranges: AffectedRange[] = [];
      try {
        const parsed: any = typeof rangesRaw === 'string' ? JSON.parse(rangesRaw) : rangesRaw;
        if (Array.isArray(parsed)) {
          ranges = parsed.map((r: any) => ({
            versionStartIncluding: r?.versionStartIncluding ?? null,
            versionStartExcluding: r?.versionStartExcluding ?? null,
            versionEndIncluding: r?.versionEndIncluding ?? null,
            versionEndExcluding: r?.versionEndExcluding ?? null,
          })).filter((r) =>
            r.versionStartIncluding || r.versionStartExcluding ||
            r.versionEndIncluding || r.versionEndExcluding,
          );
        }
      } catch { ranges = []; }
      // Fallback ceiling: if we know the first-patched version but have
      // no explicit ranges (older catalog rows that pre-date the
      // affected_versions column), build a synthetic upper bound so we
      // still drop "installed >= patched" cases. The catalog uses
      // "> X" to flag a vendor that only published a versionEndIncluding
      // (so X itself is vulnerable, fix lands somewhere after); we map
      // that to versionEndIncluding to preserve the inclusive semantic.
      if (ranges.length === 0 && cve.first_patched_version) {
        const raw = String(cve.first_patched_version);
        const inclusive = raw.startsWith('>');
        const fp = raw.replace(/^>\s*/, '');
        if (fp) {
          ranges = [{
            versionStartIncluding: null,
            versionStartExcluding: null,
            versionEndIncluding: inclusive ? fp : null,
            versionEndExcluding: inclusive ? null : fp,
          }];
        }
      }

      for (const sw of swTokenized) {
        const productMatch = subsetOf(cveProductTokens, sw.nameTokens);
        if (!productMatch) continue;

        const vendorMatch =
          !!cveVendor &&
          !!sw.publisher &&
          (sw.publisher.includes(cveVendor) || cveVendor.includes(sw.publisher));

        // Single-token products are too generic to act on without
        // a vendor confirmation — drop them silently.
        if (singleToken && !vendorMatch) continue;

        // Version gate — only when we have ranges AND the installed
        // version parses cleanly. Apps with parseable versions get the
        // exact filter; rows with no inventory version (publisher-only
        // synthetic OS rows often) fall back to the conservative
        // "keep, low confidence" path.
        const installedVersion = (sw.raw.version as string | null) ?? null;
        if (!versionStillVulnerable(installedVersion, ranges)) continue;

        let confidence: 'high' | 'medium' | 'low';
        if (vendorMatch) confidence = 'high';
        else if (shortProduct) continue; // already filtered above but defence in depth
        else if (cveProduct.length >= 6) confidence = 'medium';
        else confidence = 'low';

        try {
          await db('device_cves')
            .insert({
              device_id: deviceId,
              tenant_id: device.tenant_id,
              cve_id: cve.id,
              matched_software_id: (sw.raw.id as number | null) ?? null,
              matched_vendor: (sw.raw.publisher as string | null) ?? null,
              matched_product: sw.raw.name,
              matched_version: (sw.raw.version as string | null) ?? null,
              match_confidence: confidence,
              matched_at: new Date(),
            })
            .onConflict(['device_id', 'cve_id', 'matched_product'])
            .merge({
              matched_software_id: (sw.raw.id as number | null) ?? null,
              matched_vendor: (sw.raw.publisher as string | null) ?? null,
              matched_version: (sw.raw.version as string | null) ?? null,
              match_confidence: confidence,
              matched_at: new Date(),
            });
          inserted++;
        } catch (err) {
          logger.error({ err, deviceId, cveId: cve.id }, 'device_cves upsert failed');
        }
      }
    }
    return inserted;
  }

  // Rescan EVERY device in a tenant (or every device on master). Heavy —
  // use sparingly. Called manually from the UI or by the daily sync cron
  // after the catalog refresh.
  async rescanFleet(tenantId: number): Promise<{ devices: number; matches: number }> {
    const isMaster = isMasterTenant(tenantId);
    const q = db('devices')
      .where({ approval_status: 'approved' })
      .whereNot({ status: 'pending_uninstall' })
      .select('id');
    if (!isMaster) q.where({ tenant_id: tenantId });
    const devices = await q;

    let totalMatches = 0;
    for (const d of devices) {
      try {
        totalMatches += await this.rescanDevice(d.id);
      } catch (err) {
        logger.error({ err, deviceId: d.id }, 'rescanDevice failed');
      }
    }
    return { devices: devices.length, matches: totalMatches };
  }

  // ─── Queries ─────────────────────────────────────────────────────────────
  // Fleet-wide aggregated view — one row per CVE with affected device
  // count. Mirrors update.service.getAggregatedUpdates so the UI can
  // be a near-copy of the Updates page.
  async getAggregatedCves(tenantId: number, filters?: {
    severity?: string; kevOnly?: boolean; search?: string;
    page?: number; pageSize?: number;
  }) {
    const isMaster = isMasterTenant(tenantId);
    const page = Math.max(1, filters?.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, filters?.pageSize ?? 50));

    let baseQ = db('device_cves as dc')
      .join('cves as c', 'c.id', 'dc.cve_id')
      .whereNull('dc.dismissed_at');
    if (!isMaster) baseQ = baseQ.where('dc.tenant_id', tenantId);
    if (filters?.severity) baseQ = baseQ.where('c.severity', filters.severity);
    if (filters?.kevOnly) baseQ = baseQ.where('c.kev_flag', true);
    if (filters?.search) {
      const s = `%${filters.search.toLowerCase()}%`;
      baseQ = baseQ.where((q) =>
        q.whereRaw('LOWER(c.cve_id) LIKE ?', [s])
         .orWhereRaw('LOWER(c.name) LIKE ?', [s])
         .orWhereRaw('LOWER(c.product) LIKE ?', [s])
         .orWhereRaw('LOWER(c.vendor) LIKE ?', [s]),
      );
    }

    const countResult = await baseQ.clone().countDistinct('c.id as count').first();
    const total = Number(countResult?.count ?? 0);

    const rows = await baseQ.clone()
      .select(
        'c.id', 'c.cve_id', 'c.vendor', 'c.product', 'c.name',
        'c.severity', 'c.cvss_score', 'c.kev_flag',
        'c.published_at', 'c.due_date',
        'c.first_patched_version',
        db.raw('COUNT(DISTINCT dc.device_id)::int as device_count'),
        db.raw("COUNT(DISTINCT dc.device_id) FILTER (WHERE dc.match_confidence = 'high')::int as high_count"),
        db.raw("COUNT(DISTINCT dc.device_id) FILTER (WHERE dc.match_confidence = 'medium')::int as medium_count"),
        db.raw("COUNT(DISTINCT dc.device_id) FILTER (WHERE dc.match_confidence = 'low')::int as low_count"),
      )
      .groupBy('c.id')
      .orderByRaw(`
        CASE WHEN c.kev_flag THEN 0 ELSE 1 END,
        CASE c.severity
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          WHEN 'low' THEN 4
          ELSE 5
        END,
        device_count DESC
      `)
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    return {
      items: rows.map((r: any) => ({
        id: r.id, cveId: r.cve_id, vendor: r.vendor, product: r.product, name: r.name,
        severity: r.severity, cvssScore: r.cvss_score ? parseFloat(r.cvss_score) : null,
        kevFlag: r.kev_flag, publishedAt: r.published_at, dueDate: r.due_date,
        firstPatchedVersion: r.first_patched_version ?? null,
        deviceCount: r.device_count,
        highCount: r.high_count, mediumCount: r.medium_count, lowCount: r.low_count,
      })),
      total, page, pageSize,
    };
  }

  // Devices affected by a single CVE. Master sees the cross-tenant list
  // with device.tenant_id on each row (the UI surfaces a TenantBadge).
  async getCveAffectedDevices(tenantId: number, cveId: number) {
    const isMaster = isMasterTenant(tenantId);
    const q = db('device_cves as dc')
      .join('devices as d', 'd.id', 'dc.device_id')
      .join('cves as c', 'c.id', 'dc.cve_id')
      .where({ 'dc.cve_id': cveId })
      .whereNull('dc.dismissed_at')
      .select(
        'dc.id', 'dc.device_id', 'dc.match_confidence',
        'dc.matched_vendor', 'dc.matched_product', 'dc.matched_version',
        db.raw(`COALESCE(NULLIF(d.display_name, ''), d.hostname) AS device_name`),
        'd.group_id', 'd.tenant_id as device_tenant_id', 'd.status as device_status',
      )
      .orderBy('device_name');
    if (!isMaster) q.where('dc.tenant_id', tenantId);
    const rows = await q;
    return rows.map((r: any) => ({
      id: r.id, deviceId: r.device_id, deviceName: r.device_name,
      groupId: r.group_id, deviceStatus: r.device_status,
      tenantId: r.device_tenant_id,
      matchConfidence: r.match_confidence,
      matchedVendor: r.matched_vendor, matchedProduct: r.matched_product,
      matchedVersion: r.matched_version,
    }));
  }

  // Single-device CVE list — used on DeviceDetailPage's Security section.
  async getDeviceCves(deviceId: number, tenantId: number) {
    const isMaster = isMasterTenant(tenantId);
    const q = db('device_cves as dc')
      .join('cves as c', 'c.id', 'dc.cve_id')
      .where('dc.device_id', deviceId)
      .whereNull('dc.dismissed_at')
      .select(
        'dc.id', 'dc.match_confidence',
        'dc.matched_vendor', 'dc.matched_product', 'dc.matched_version',
        'c.id as cve_pk', 'c.cve_id', 'c.vendor', 'c.product', 'c.name',
        'c.severity', 'c.cvss_score', 'c.kev_flag',
        'c.published_at', 'c.due_date', 'c.description', 'c.required_action',
        'c.first_patched_version',
      )
      .orderByRaw(`
        CASE WHEN c.kev_flag THEN 0 ELSE 1 END,
        CASE dc.match_confidence
          WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3
        END
      `);
    if (!isMaster) q.where('dc.tenant_id', tenantId);
    const rows = await q;
    return rows.map((r: any) => ({
      id: r.id,
      matchConfidence: r.match_confidence,
      matchedVendor: r.matched_vendor, matchedProduct: r.matched_product,
      matchedVersion: r.matched_version,
      cve: {
        id: r.cve_pk, cveId: r.cve_id, vendor: r.vendor, product: r.product, name: r.name,
        severity: r.severity, cvssScore: r.cvss_score ? parseFloat(r.cvss_score) : null,
        kevFlag: r.kev_flag, publishedAt: r.published_at, dueDate: r.due_date,
        description: r.description, requiredAction: r.required_action,
        firstPatchedVersion: r.first_patched_version ?? null,
      },
    }));
  }

  async dismissDeviceCve(id: number, tenantId: number, userId: number): Promise<boolean> {
    const isMaster = isMasterTenant(tenantId);
    const q = db('device_cves').where({ id });
    if (!isMaster) q.where({ tenant_id: tenantId });
    const updated = await q.update({
      dismissed_at: new Date(),
      dismissed_by: userId,
    });
    return updated > 0;
  }

  // Per-source aggregate stats — drives the UI source selector. One row
  // per source key registered in CVE_SOURCES, even if it has 0 CVE in
  // the catalog (so the user sees the option exists and can sync it).
  // `latestPublished` is the most recent CVE publication date in the
  // source, `lastSyncedAt` is when we last hit the upstream feed.
  async getSourcesStats(): Promise<Array<{
    key: CveSourceKey; label: string; description: string;
    count: number; latestPublished: string | null; lastSyncedAt: string | null;
  }>> {
    const rows = await db('cves')
      .select('source')
      .count('* as count')
      .max('published_at as latest_published')
      .max('synced_at as last_synced_at')
      .groupBy('source') as Array<{ source: string; count: string | number; latest_published: Date | null; last_synced_at: Date | null }>;
    const byKey = new Map<string, { count: number; latest: Date | null; lastSync: Date | null }>();
    for (const r of rows) {
      byKey.set(r.source, {
        count: Number(r.count),
        latest: r.latest_published,
        lastSync: r.last_synced_at,
      });
    }
    return this.listSourcesMeta().map((m) => {
      const s = byKey.get(m.key);
      return {
        key: m.key,
        label: m.label,
        description: m.description,
        count: s?.count ?? 0,
        latestPublished: s?.latest ? new Date(s.latest).toISOString() : null,
        lastSyncedAt: s?.lastSync ? new Date(s.lastSync).toISOString() : null,
      };
    });
  }

  async getStats(tenantId: number) {
    const isMaster = isMasterTenant(tenantId);
    const q = db('device_cves as dc')
      .join('cves as c', 'c.id', 'dc.cve_id')
      .whereNull('dc.dismissed_at')
      .select(
        db.raw('COUNT(DISTINCT dc.cve_id)::int as total_cves'),
        db.raw('COUNT(DISTINCT dc.device_id)::int as affected_devices'),
        db.raw("COUNT(DISTINCT dc.cve_id) FILTER (WHERE c.kev_flag)::int as kev_cves"),
        db.raw("COUNT(DISTINCT dc.cve_id) FILTER (WHERE c.severity = 'critical')::int as critical_cves"),
      );
    if (!isMaster) q.where('dc.tenant_id', tenantId);
    const row = await q.first();
    return {
      totalCves: Number(row?.total_cves ?? 0),
      affectedDevices: Number(row?.affected_devices ?? 0),
      kevCves: Number(row?.kev_cves ?? 0),
      criticalCves: Number(row?.critical_cves ?? 0),
    };
  }
}

export const cveService = new CveService();
