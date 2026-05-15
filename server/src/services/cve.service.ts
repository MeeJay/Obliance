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
// enriches them with CVSS scores that CISA KEV doesn't expose. Bonus:
// the same endpoint can later return non-KEV CVEs by dropping `hasKev`.
//
// Rate limit (anonymous): 5 requests / 30s rolling. We only need 1 call
// per sync (max 2000 results/page, current KEV catalog ~1300 entries).
const NVD_KEV_URL =
  'https://services.nvd.nist.gov/rest/json/cves/2.0?hasKev&resultsPerPage=2000';

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
        cpeMatch?: Array<{ criteria: string; vulnerable?: boolean }>;
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

class CveService {
  // ─── Sync from NVD (KEV-flagged subset) ──────────────────────────────────
  // Method name stays `syncCisaKev` because the callers don't care that
  // we changed transport — same conceptual catalog (CISA KEV entries),
  // just pulled via NIST's API to bypass CISA's WAF.
  async syncCisaKev(): Promise<{ fetched: number; upserted: number; failed: number }> {
    const now = new Date();
    let feed: NvdFeed;
    try {
      const res = await fetch(NVD_KEV_URL, {
        headers: {
          'Accept': 'application/json',
          // NVD docs ask for a descriptive UA so they can contact you on
          // abuse — keep something neutral and identifiable.
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
      logger.error({ err }, 'NVD fetch failed');
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
      const severity = (metric?.baseSeverity ?? '').toLowerCase() || 'high'; // KEV → at least 'high'

      // Extract vendor / product from the FIRST CPE match. Store every
      // CPE string we saw under cpe_matches for advanced matchers later.
      const allCpes: string[] = [];
      for (const cfg of cve.configurations ?? []) {
        for (const node of cfg.nodes ?? []) {
          for (const m of node.cpeMatch ?? []) {
            if (m.criteria) allCpes.push(m.criteria);
          }
        }
      }
      const parsed = allCpes.length > 0 ? parseCpe(allCpes[0]) : { vendor: null, product: null };

      try {
        await db('cves')
          .insert({
            cve_id: cve.id,
            source: 'nvd_kev',
            vendor: parsed.vendor,
            product: parsed.product,
            name: cve.cisaVulnerabilityName ?? null,
            description: desc,
            severity,
            cvss_score: cvssScore,
            kev_flag: true,
            published_at: cve.published ? new Date(cve.published) : (cve.cisaExploitAdd ? new Date(cve.cisaExploitAdd) : null),
            modified_at: cve.lastModified ? new Date(cve.lastModified) : now,
            due_date: cve.cisaActionDue ? new Date(cve.cisaActionDue) : null,
            required_action: cve.cisaRequiredAction ?? null,
            references: JSON.stringify([]),
            cpe_matches: JSON.stringify(allCpes),
            synced_at: now,
          })
          .onConflict('cve_id')
          .merge({
            vendor: parsed.vendor,
            product: parsed.product,
            name: cve.cisaVulnerabilityName ?? null,
            description: desc,
            severity,
            cvss_score: cvssScore,
            kev_flag: true,
            modified_at: cve.lastModified ? new Date(cve.lastModified) : now,
            due_date: cve.cisaActionDue ? new Date(cve.cisaActionDue) : null,
            required_action: cve.cisaRequiredAction ?? null,
            cpe_matches: JSON.stringify(allCpes),
            synced_at: now,
            updated_at: now,
          });
        upserted++;
      } catch (err) {
        logger.error({ err, cve: cve.id }, 'NVD KEV row upsert failed');
        failed++;
      }
    }

    logger.info({ fetched: feed.vulnerabilities.length, upserted, failed }, 'NVD KEV sync complete');
    return { fetched: feed.vulnerabilities.length, upserted, failed };
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

    const allCves = await db('cves').select('id', 'vendor', 'product', 'cpe_matches');

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

      for (const sw of swTokenized) {
        const productMatch = subsetOf(cveProductTokens, sw.nameTokens);
        if (!productMatch) continue;

        const vendorMatch =
          !!cveVendor &&
          !!sw.publisher &&
          (sw.publisher.includes(cveVendor) || cveVendor.includes(sw.publisher));

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
