import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Shield, AlertCircle, RefreshCw, Loader2, ExternalLink, X, ChevronRight, Search, Database, ChevronDown } from 'lucide-react';
import { clsx } from 'clsx';
import toast from 'react-hot-toast';
import { cveApi } from '@/api/cve.api';
import { useAuthStore } from '@/store/authStore';
import { TenantBadge } from '@/components/common/TenantBadge';
import { TableScroll } from '@/components/common/TableScroll';
import { Drawer } from '@/components/common/Drawer';
import { Modal } from '@/components/common/Modal';
import { IconButton } from '@/components/common/IconButton';
import { useIsCoarsePointer, useMediaQuery, MEDIA } from '@/hooks/useMediaQuery';
import { useClickOutside } from '@/hooks/useClickOutside';
import { useNativeBack } from '@/hooks/useNativeBack';
import { openExternal } from '@/utils/openExternal';
import type { CveAggregated, CveAffectedDevice, CveStats, CveSourceStats } from '@obliance/shared';

// GHSA advisories without a CVE id (cveId starts with "GHSA-") aren't on
// NVD — route those to github.com/advisories, everything else to NVD.
function cveDetailUrl(cveId: string): string {
  if (cveId?.startsWith('GHSA-')) return `https://github.com/advisories/${cveId}`;
  return `https://nvd.nist.gov/vuln/detail/${cveId}`;
}

/** External advisory link. Goes through openExternal (Custom Tab / new tab)
 * so the Android WebView never navigates the SPA away to NVD / GitHub. */
function CveLink({ cveId, className, stopPropagation }: { cveId: string; className: string; stopPropagation?: boolean }) {
  const url = cveDetailUrl(cveId);
  return (
    <a
      href={url}
      target="_blank" rel="noopener noreferrer"
      onClick={(e) => {
        if (stopPropagation) e.stopPropagation();
        e.preventDefault();
        void openExternal(url);
      }}
      className={className}
    >
      {cveId}
    </a>
  );
}

/** KEV marker: icon with a hover title; on touch a visible "KEV" label
 * (the meaning was only in the title). */
function KevMarker({ size = 'w-3.5 h-3.5' }: { size?: string }) {
  const { t } = useTranslation();
  const label = t('cves.kevTooltip') || 'CISA Known Exploited Vulnerability';
  return (
    <span title={label} className="inline-flex items-center gap-1 shrink-0">
      <AlertCircle className={clsx(size, 'text-red-400 shrink-0')} />
      <span className="hidden coarse:inline text-[10px] font-semibold text-red-400">KEV</span>
    </span>
  );
}

// Mirrors UpdatesPage in shape: header counters, filter chips, list of
// CVEs sorted by severity / KEV / affected-count. Clicking a row pops a
// drawer with the affected devices (the same UX as Updates → "Devices
// affected" view).

const SEVERITY_CONFIG: Record<string, { label: string; color: string }> = {
 critical: { label: 'Critical', color: 'text-red-400 bg-red-400/10 border-red-400/30' },
 high:     { label: 'High',     color: 'text-orange-400 bg-orange-400/10 border-orange-400/30' },
 medium:   { label: 'Medium',   color: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30' },
 low:      { label: 'Low',      color: 'text-blue-400 bg-blue-400/10 border-blue-400/30' },
 unknown:  { label: 'Unknown',  color: 'text-gray-400 bg-gray-400/10 border-gray-400/30' },
};

export function CvesPage(_props: { embedded?: boolean } = {}) {
 const { t } = useTranslation();
 const coarse = useIsCoarsePointer();
 // Below sm the sources picker is a bottom sheet (a 420px dropdown anchored
 // to a wrapping toolbar button can end up off-screen).
 const sourcesAsSheet = !useMediaQuery(MEDIA.sm);
 const { isAdmin } = useAuthStore();
 const [items, setItems] = useState<CveAggregated[]>([]);
 const [stats, setStats] = useState<CveStats | null>(null);
 const [isLoading, setIsLoading] = useState(true);
 const [search, setSearch] = useState('');
 const [severity, setSeverity] = useState<string>('');
 const [kevOnly, setKevOnly] = useState(false);
 const [selectedCve, setSelectedCve] = useState<CveAggregated | null>(null);
 const [syncing, setSyncing] = useState<string | null>(null); // null | 'all' | sourceKey
 const [sources, setSources] = useState<CveSourceStats[]>([]);
 const [sourcesOpen, setSourcesOpen] = useState(false);
 const sourcesRef = useRef<HTMLDivElement | null>(null);

 const load = async () => {
   setIsLoading(true);
   try {
     const [aggregated, stat, srcs] = await Promise.all([
       cveApi.listAggregated({ search: search || undefined, severity: severity || undefined, kevOnly, pageSize: 200 }),
       cveApi.getStats(),
       cveApi.listSources().catch(() => [] as CveSourceStats[]),
     ]);
     setItems(aggregated.items);
     setStats(stat);
     setSources(srcs);
   } catch {
     toast.error(t('common.error') || 'Loading CVEs failed');
   } finally {
     setIsLoading(false);
   }
 };

 // Close the sources dropdown on outside tap / click, Escape and Android
 // back. (The phone sheet is a Modal, which handles all of that itself —
 // and is portaled, so it would count as "outside".)
 useClickOutside(sourcesRef, () => setSourcesOpen(false), sourcesOpen && !sourcesAsSheet);
 useNativeBack(() => setSourcesOpen(false), sourcesOpen && !sourcesAsSheet, { escape: true });

 useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [severity, kevOnly]);

 // Debounced search
 useEffect(() => {
   const id = window.setTimeout(() => { void load(); }, 300);
   return () => window.clearTimeout(id);
   // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [search]);

 // `source` undefined → sync every registered source. With a key →
 // refresh only that one (used by the per-source rows in the selector).
 const handleSync = async (sourceKey?: string) => {
   const tag = sourceKey ?? 'all';
   setSyncing(tag);
   try {
     const result = await cveApi.sync(sourceKey);
     if (result.sources) {
       const ok = result.sources.filter((s) => s.ok);
       const ko = result.sources.filter((s) => !s.ok);
       const totalUpserted = ok.reduce((acc, s) => acc + (s.upserted ?? 0), 0);
       toast.success(t('cves.syncSummary', { ok: ok.length, total: result.sources.length, upserted: totalUpserted, defaultValue: 'Sync: {{ok}}/{{total}} sources OK, {{upserted}} CVE upserted' }));
       if (ko.length > 0) toast.error(t('cves.syncSourcesFailed', { list: ko.map((s) => `${s.source} — ${s.error ?? '?'}`).join('; '), defaultValue: 'Failed: {{list}}' }));
     } else {
       toast.success(t('cves.syncDone', { upserted: result.upserted ?? 0 }) || `Synced ${result.upserted ?? 0} CVEs`);
     }
     const rescan = await cveApi.rescan();
     toast.success(t('cves.rescanDone', { devices: rescan.devices, matches: rescan.matches }) || `Rescan: ${rescan.devices} devices, ${rescan.matches} matches`);
     await load();
   } catch (err: any) {
     // Surface the server-side error message — pulled out of the axios
     // error envelope. Falls back to the generic toast when the server
     // didn't include one (e.g. network-level failures).
     const detail = err?.response?.data?.error || err?.message;
     toast.error(detail ? t('cves.syncError', { detail, defaultValue: 'CVE sync: {{detail}}' }) : (t('cves.syncFailed') || 'CVE sync failed'));
   } finally {
     setSyncing(null);
   }
 };

 // Pick the source with the freshest CVE for the button label so the
 // admin sees at a glance which catalog is "leading" right now.
 const freshest = sources.reduce<CveSourceStats | null>((best, s) => {
   if (!s.latestPublished) return best;
   if (!best?.latestPublished) return s;
   return new Date(s.latestPublished) > new Date(best.latestPublished) ? s : best;
 }, null);

 const totalCves = stats?.totalCves ?? 0;

 return (
   <div className="space-y-4">
     {/* Header counters */}
     <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
       <StatCard label={t('cves.statTotal') || 'Total CVEs'} value={totalCves} color="text-text-primary" />
       <StatCard label={t('cves.statKev') || 'Actively exploited (KEV)'} value={stats?.kevCves ?? 0} color="text-red-400" />
       <StatCard label={t('cves.statCritical') || 'Critical'} value={stats?.criticalCves ?? 0} color="text-orange-400" />
       <StatCard label={t('cves.statAffectedDevices') || 'Affected devices'} value={stats?.affectedDevices ?? 0} color="text-yellow-400" />
     </div>

     {/* Toolbar */}
     <div className="flex flex-wrap items-center gap-2">
       <div className="relative w-full sm:w-auto">
         <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-text-muted pointer-events-none" />
         <input
           type="text"
           value={search}
           onChange={(e) => setSearch(e.target.value)}
           placeholder={t('cves.searchPlaceholder') || 'CVE-ID, product, vendor…'}
           autoCapitalize="off" autoCorrect="off" spellCheck={false}
           className="pl-8 pr-3 py-1.5 text-sm bg-bg-secondary border border-bg-tertiary rounded-md text-text-primary w-full sm:w-72 focus:outline-none focus:border-accent"
         />
       </div>
       <Chip active={kevOnly} onClick={() => setKevOnly((v) => !v)} color="text-red-400 border-red-400/40 bg-red-400/10">
         {t('cves.filterKev') || 'KEV only'}
       </Chip>
       <Chip active={severity === 'critical'} onClick={() => setSeverity(severity === 'critical' ? '' : 'critical')} color="text-red-400 border-red-400/40 bg-red-400/10">
         {t('compliance.severities.critical', 'Critical')}
       </Chip>
       <Chip active={severity === 'high'} onClick={() => setSeverity(severity === 'high' ? '' : 'high')} color="text-orange-400 border-orange-400/40 bg-orange-400/10">
         {t('compliance.severities.high', 'High')}
       </Chip>
       <Chip active={severity === 'medium'} onClick={() => setSeverity(severity === 'medium' ? '' : 'medium')} color="text-yellow-400 border-yellow-400/40 bg-yellow-400/10">
         {t('compliance.severities.medium', 'Medium')}
       </Chip>
       <div className="flex-1" />
       <button
         onClick={() => void load()}
         className="px-3 py-1.5 text-sm text-text-muted hover:text-text-primary border border-bg-tertiary rounded-md flex items-center gap-1.5 coarse:min-h-10"
         title={t('common.refresh') || 'Refresh'}
       >
         <RefreshCw className="w-3.5 h-3.5" />
         {t('common.refresh') || 'Refresh'}
       </button>
       {isAdmin() && (
         <div ref={sourcesRef} className="relative">
           <button
             onClick={() => setSourcesOpen((v) => !v)}
             disabled={!!syncing}
             className="px-3 py-1.5 text-sm bg-accent text-white rounded-md flex items-center gap-1.5 disabled:opacity-50 coarse:min-h-10"
             title={t('cves.sourcesTooltip') || 'Pick a CVE source to sync'}
             aria-expanded={sourcesOpen}
           >
             {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Database className="w-3.5 h-3.5" />}
             {t('cves.sourcesButton') || 'Sources'}
             <ChevronDown className="w-3 h-3 opacity-70" />
           </button>
           {sourcesOpen && (
             <SourcesDropdown
               sources={sources}
               freshestKey={freshest?.key ?? null}
               syncing={syncing}
               onSync={(key) => { setSourcesOpen(false); void handleSync(key); }}
               onSyncAll={() => { setSourcesOpen(false); void handleSync(); }}
               onClose={() => setSourcesOpen(false)}
               asSheet={sourcesAsSheet}
             />
           )}
         </div>
       )}
     </div>

     {/* List */}
     {isLoading ? (
       <div className="flex items-center justify-center py-12">
         <Loader2 className="w-6 h-6 animate-spin text-text-muted" />
       </div>
     ) : items.length === 0 ? (
       <div className="text-center text-text-muted py-12 bg-bg-secondary rounded-xl">
         <Shield className="w-12 h-12 mx-auto mb-3 text-green-400/60" />
         <p className="text-sm">{t('cves.empty') || 'No CVE matches found. Either your fleet is clean or the catalog hasn\'t synced yet.'}</p>
       </div>
     ) : (
       <>
       {/* Phone: one card per CVE (the 7-column table does not fit). */}
       <ul className="md:hidden space-y-2">
         {items.map((c) => (
           <li key={c.id}>
             <button
               type="button"
               onClick={() => setSelectedCve(c)}
               className="w-full text-left bg-bg-secondary rounded-xl px-3 py-2.5 hover:bg-bg-tertiary/30"
             >
               <div className="flex items-center gap-2 flex-wrap">
                 {c.kevFlag && <KevMarker />}
                 <span className="font-mono text-xs text-accent break-all">{c.cveId}</span>
                 <SeverityBadge severity={c.severity ?? 'unknown'} />
                 <ChevronRight className="w-4 h-4 text-text-muted ml-auto shrink-0" />
               </div>
               {c.name && <div className="text-xs text-text-muted mt-1 line-clamp-2">{c.name}</div>}
               <div className="text-sm text-text-primary mt-1 break-words">
                 {c.vendor ? `${c.vendor} / ` : ''}{c.product || '—'}
               </div>
               <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-text-muted">
                 <span>
                   {t('cves.colDevices') || 'Devices'}: <span className="text-text-primary font-medium tabular-nums">{c.deviceCount}</span>
                   {c.highCount > 0 && <span className="text-red-400 ml-1.5">H {c.highCount}</span>}
                   {c.mediumCount > 0 && <span className="text-yellow-400 ml-1">M {c.mediumCount}</span>}
                   {c.lowCount > 0 && <span className="text-gray-400 ml-1">L {c.lowCount}</span>}
                 </span>
                 <span>
                   {t('cves.colPatched') || 'Patched in'}: {c.firstPatchedVersion
                     ? <span className="text-green-400 font-mono">{c.firstPatchedVersion}</span>
                     : <span className="text-text-muted/60">—</span>}
                 </span>
                 <span>
                   {t('cves.colDue') || 'Due'}: <span className="text-text-primary">{c.dueDate ? new Date(c.dueDate).toLocaleDateString() : '—'}</span>
                 </span>
               </div>
             </button>
           </li>
         ))}
       </ul>
       <TableScroll className="hidden md:block bg-bg-secondary rounded-xl">
         <table className="w-full text-sm min-w-[720px]">
           <thead>
             <tr className="bg-bg-tertiary/50 text-left">
               <th className="px-3 py-2 text-xs text-text-muted uppercase">{t('cves.colCve') || 'CVE'}</th>
               <th className="px-3 py-2 text-xs text-text-muted uppercase">{t('cves.colProduct') || 'Product'}</th>
               <th className="px-3 py-2 text-xs text-text-muted uppercase">{t('cves.colSeverity') || 'Severity'}</th>
               <th className="px-3 py-2 text-xs text-text-muted uppercase">{t('cves.colPatched') || 'Patched in'}</th>
               <th className="px-3 py-2 text-xs text-text-muted uppercase text-right">{t('cves.colDevices') || 'Devices'}</th>
               <th className="px-3 py-2 text-xs text-text-muted uppercase">{t('cves.colDue') || 'Due'}</th>
               <th className="w-8"></th>
             </tr>
           </thead>
           <tbody>
             {items.map((c) => (
               <tr
                 key={c.id}
                 onClick={() => setSelectedCve(c)}
                 className="border-t border-bg-tertiary hover:bg-bg-tertiary/30 cursor-pointer"
               >
                 <td className="px-3 py-2">
                   <div className="flex items-center gap-2">
                     {c.kevFlag && <KevMarker />}
                     {coarse ? (
                       // Touch: the id is the biggest target of the row — a tap opens the
                       // drawer (which has an explicit "open advisory" button) instead of
                       // leaving the app.
                       <span className="font-mono text-xs text-accent">{c.cveId}</span>
                     ) : (
                       <>
                         <CveLink cveId={c.cveId} stopPropagation className="font-mono text-xs text-accent hover:underline" />
                         <ExternalLink className="w-3 h-3 text-text-muted/60" />
                       </>
                     )}
                   </div>
                   {c.name && <div className="text-xs text-text-muted truncate max-w-[420px] mt-0.5 coarse:whitespace-normal coarse:line-clamp-2">{c.name}</div>}
                 </td>
                 <td className="px-3 py-2 text-text-primary">
                   {c.vendor ? `${c.vendor} / ` : ''}{c.product || '—'}
                 </td>
                 <td className="px-3 py-2">
                   <SeverityBadge severity={c.severity ?? 'unknown'} />
                 </td>
                 <td className="px-3 py-2 text-xs">
                   {c.firstPatchedVersion ? (
                     <span className="text-green-400 font-mono">{c.firstPatchedVersion}</span>
                   ) : (
                     <span className="text-text-muted/60">—</span>
                   )}
                 </td>
                 <td className="px-3 py-2 text-right tabular-nums">
                   <div className="font-medium">{c.deviceCount}</div>
                   <div className="text-[10px] text-text-muted">
                     {c.highCount > 0 && <span className="text-red-400">H {c.highCount}</span>}
                     {c.mediumCount > 0 && <span className="text-yellow-400 ml-1">M {c.mediumCount}</span>}
                     {c.lowCount > 0 && <span className="text-gray-400 ml-1">L {c.lowCount}</span>}
                   </div>
                 </td>
                 <td className="px-3 py-2 text-xs text-text-muted">
                   {c.dueDate ? new Date(c.dueDate).toLocaleDateString() : '—'}
                 </td>
                 <td className="px-3 py-2 text-text-muted">
                   <ChevronRight className="w-4 h-4" />
                 </td>
               </tr>
             ))}
           </tbody>
         </table>
       </TableScroll>
       </>
     )}

     {selectedCve && (
       <AffectedDevicesDrawer cve={selectedCve} onClose={() => setSelectedCve(null)} />
     )}
   </div>
 );
}

function SourcesDropdown({
 sources, freshestKey, syncing, onSync, onSyncAll, onClose, asSheet = false,
}: {
 sources: CveSourceStats[];
 freshestKey: string | null;
 syncing: string | null;
 onSync: (key: string) => void;
 onSyncAll: () => void;
 onClose: () => void;
 /** Render as a bottom sheet (phone) instead of an anchored dropdown. */
 asSheet?: boolean;
}) {
 const { t } = useTranslation();
 const fmt = (iso: string | null) => {
   if (!iso) return '—';
   const d = new Date(iso);
   const days = Math.round((Date.now() - d.getTime()) / (24 * 3600 * 1000));
   if (days === 0) return t('cves.today') || "Aujourd'hui";
   if (days === 1) return t('cves.yesterday') || 'Hier';
   if (days < 30) return t('cves.daysAgo', { days }) || `Il y a ${days}j`;
   return d.toLocaleDateString();
 };
 const list = (
     <div className="divide-y divide-bg-tertiary">
       {sources.length === 0 && (
         <div className="px-3 py-4 text-sm text-text-muted text-center">
           {t('cves.noSources') || 'Aucune source enregistrée.'}
         </div>
       )}
       {sources.map((s) => {
         const isFreshest = s.key === freshestKey && s.count > 0;
         const isSyncing = syncing === s.key;
         return (
           <div key={s.key} className="px-3 py-3">
             <div className="flex items-start gap-2">
               <div className="flex-1 min-w-0">
                 <div className="flex items-center gap-2">
                   <span className="text-sm font-semibold text-text-primary">{s.label}</span>
                   {isFreshest && (
                     <span className="text-[9px] uppercase px-1.5 py-0.5 rounded-full border border-green-400/40 text-green-400 bg-green-400/10 font-semibold">
                       {t('cves.freshestBadge') || 'Le plus récent'}
                     </span>
                   )}
                 </div>
                 <div className="text-[11px] text-text-muted mt-0.5 leading-tight">{s.description}</div>
                 <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-muted">
                   <span>
                     <span className="text-text-primary font-medium tabular-nums">{s.count}</span>{' '}
                     {t('cves.entries') || 'entrées'}
                   </span>
                   <span title={s.latestPublished ? new Date(s.latestPublished).toLocaleString() : ''}>
                     {t('cves.lastPublished') || 'Dernière publication'}: <span className="text-text-primary">{fmt(s.latestPublished)}</span>
                   </span>
                   <span title={s.lastSyncedAt ? new Date(s.lastSyncedAt).toLocaleString() : ''}>
                     {t('cves.lastSync') || 'Dernier sync'}: <span className="text-text-primary">{fmt(s.lastSyncedAt)}</span>
                   </span>
                 </div>
               </div>
               <button
                 onClick={() => onSync(s.key)}
                 disabled={syncing !== null}
                 className="px-2 py-1 text-xs rounded border border-bg-tertiary text-text-primary hover:bg-bg-tertiary disabled:opacity-50 flex items-center gap-1 shrink-0 coarse:min-h-10 coarse:px-3"
                 title={t('cves.syncThis') || 'Synchroniser cette source'}
               >
                 {isSyncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                 {t('cves.sync') || 'Sync'}
               </button>
             </div>
           </div>
         );
       })}
     </div>
 );
 const closeButton = (
       <button
         onClick={onClose}
         className="text-xs text-text-muted hover:text-text-primary coarse:min-h-10 coarse:px-2"
       >
         {t('common.close') || 'Fermer'}
       </button>
 );
 const syncAllButton = (
       <button
         onClick={onSyncAll}
         disabled={syncing !== null}
         className="text-xs px-3 py-1 rounded bg-accent text-white disabled:opacity-50 flex items-center gap-1.5 coarse:min-h-10"
       >
         {syncing === 'all' ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
         {t('cves.syncAll') || 'Tout synchroniser'}
       </button>
 );
 if (asSheet) {
   return (
     <Modal
       open
       onClose={onClose}
       title={t('cves.sourcesHeading') || 'Sources de CVE'}
       phoneLayout="sheet"
       bodyClassName="p-0"
       footer={<>{closeButton}{syncAllButton}</>}
       footerClassName="justify-between border-t border-bg-tertiary"
     >
       {list}
     </Modal>
   );
 }
 return (
   <div className="absolute right-0 top-full mt-1 w-[420px] max-w-[calc(100vw-2rem)] max-h-[70vh] max-h-[70dvh] overflow-y-auto overscroll-contain bg-bg-secondary border border-bg-tertiary rounded-md shadow-2xl z-30">
     <div className="px-3 py-2 text-[11px] uppercase font-semibold text-text-muted bg-bg-tertiary/40 border-b border-bg-tertiary">
       {t('cves.sourcesHeading') || 'Sources de CVE'}
     </div>
     {list}
     <div className="px-3 py-2 bg-bg-tertiary/40 border-t border-bg-tertiary flex items-center justify-between">
       {closeButton}
       {syncAllButton}
     </div>
   </div>
 );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
 return (
   <div className="bg-bg-secondary rounded-xl p-3">
     <div className={clsx('text-2xl font-bold tabular-nums', color)}>{value}</div>
     <div className="text-xs text-text-muted mt-1">{label}</div>
   </div>
 );
}

function Chip({ active, onClick, color, children }: { active: boolean; onClick: () => void; color: string; children: React.ReactNode }) {
 return (
   <button
     onClick={onClick}
     aria-pressed={active}
     className={clsx(
       'px-3 py-1.5 text-xs rounded-md border transition-colors coarse:min-h-10',
       active ? color : 'text-text-muted border-bg-tertiary hover:text-text-primary',
     )}
   >
     {children}
   </button>
 );
}

function SeverityBadge({ severity }: { severity: string }) {
 const cfg = SEVERITY_CONFIG[severity] ?? SEVERITY_CONFIG.unknown;
 return (
   <span className={clsx('inline-flex items-center px-2 py-0.5 text-[10px] uppercase font-semibold rounded-full border', cfg.color)}>
     {cfg.label}
   </span>
 );
}

function AffectedDevicesDrawer({ cve, onClose }: { cve: CveAggregated; onClose: () => void }) {
 const { t } = useTranslation();
 const coarse = useIsCoarsePointer();
 const navigate = useNavigate();
 const [devices, setDevices] = useState<CveAffectedDevice[]>([]);
 const [isLoading, setIsLoading] = useState(true);

 useEffect(() => {
   let cancelled = false;
   cveApi.listAffectedDevices(cve.id)
     .then((rows) => { if (!cancelled) setDevices(rows); })
     .catch(() => { /* silent */ })
     .finally(() => { if (!cancelled) setIsLoading(false); });
   return () => { cancelled = true; };
 }, [cve.id]);

 const isGhsa = cve.cveId?.startsWith('GHSA-');
 return (
   // Shared Drawer: Escape + Android back close it, scroll lock, focus trap.
   <Drawer
     open
     onClose={onClose}
     side="right"
     ariaLabel={cve.cveId}
     className="w-full max-w-2xl bg-bg-primary border-l border-bg-tertiary lg:animate-none"
     bodyClassName="p-0"
   >
       <div className="sticky top-0 z-10 bg-bg-primary border-b border-bg-tertiary px-4 sm:px-5 py-3 flex items-start gap-3">
         <div className="flex-1 min-w-0">
           <div className="flex items-center gap-2 flex-wrap">
             {cve.kevFlag && <KevMarker size="w-4 h-4" />}
             <CveLink cveId={cve.cveId} className="font-mono text-sm text-accent hover:underline break-all" />
             <SeverityBadge severity={cve.severity ?? 'unknown'} />
           </div>
           {cve.name && <h2 className="text-base font-semibold text-text-primary mt-1 break-words">{cve.name}</h2>}
           {(cve.vendor || cve.product) && (
             <div className="text-xs text-text-muted mt-1">
               {cve.vendor ? `${cve.vendor} / ` : ''}{cve.product}
             </div>
           )}
           {cve.firstPatchedVersion && (
             <div className="text-xs mt-1.5">
               <span className="text-text-muted">{t('cves.patchedIn') || 'Patched in'}: </span>
               <span className="text-green-400 font-mono">{cve.firstPatchedVersion}</span>
             </div>
           )}
           {/* Due date + match breakdown were only in the table, which phones do not show. */}
           {(cve.dueDate || cve.highCount > 0 || cve.mediumCount > 0 || cve.lowCount > 0) && (
             <div className="text-xs mt-1.5 flex flex-wrap gap-x-4 gap-y-1 md:hidden">
               {cve.dueDate && (
                 <span><span className="text-text-muted">{t('cves.colDue') || 'Due'}: </span><span className="text-text-primary">{new Date(cve.dueDate).toLocaleDateString()}</span></span>
               )}
               <span className="text-[11px]">
                 {cve.highCount > 0 && <span className="text-red-400">H {cve.highCount}</span>}
                 {cve.mediumCount > 0 && <span className="text-yellow-400 ml-1">M {cve.mediumCount}</span>}
                 {cve.lowCount > 0 && <span className="text-gray-400 ml-1">L {cve.lowCount}</span>}
               </span>
             </div>
           )}
           {coarse && (
             <button
               type="button"
               onClick={() => void openExternal(cveDetailUrl(cve.cveId))}
               className="mt-2 inline-flex items-center gap-1.5 min-h-10 px-3 text-xs rounded-md border border-bg-tertiary text-accent hover:bg-bg-tertiary"
             >
               <ExternalLink className="w-3.5 h-3.5" />
               {isGhsa ? t('cves.openInGithub', 'Open in GitHub Advisories') : t('cves.openInNvd', 'Open in NVD')}
             </button>
           )}
         </div>
         <IconButton
           label={t('common.close') || 'Close'}
           icon={<X className="w-5 h-5" />}
           size="sm"
           variant="plain"
           onClick={onClose}
         />
       </div>

       <div className="p-4 sm:p-5 space-y-4">
         <div>
           <h3 className="text-xs uppercase text-text-muted mb-2 font-semibold">
             {t('cves.affectedDevicesHeading', { count: devices.length }) || `Affected devices (${devices.length})`}
           </h3>
           {isLoading ? (
             <div className="flex items-center justify-center py-8">
               <Loader2 className="w-5 h-5 animate-spin text-text-muted" />
             </div>
           ) : devices.length === 0 ? (
             <p className="text-sm text-text-muted">{t('cves.noDevices') || 'No active matches (admins may have dismissed all of them).'}</p>
           ) : (
             <ul className="space-y-1">
               {devices.map((d) => (
                 <li
                   key={d.id}
                   className="flex items-center gap-3 px-3 py-2 bg-bg-secondary rounded-md hover:bg-bg-tertiary cursor-pointer coarse:min-h-12"
                   onClick={() => navigate(`/devices/${d.deviceId}`)}
                 >
                   <ConfidenceDot level={d.matchConfidence} />
                   <div className="flex-1 min-w-0">
                     <div className="flex items-center gap-2 text-sm text-text-primary truncate">
                       <span className="truncate">{d.deviceName}</span>
                       {d.tenantId && <TenantBadge tenantId={d.tenantId} size="sm" />}
                     </div>
                     <div className="text-[11px] text-text-muted truncate">
                       {[d.matchedVendor, d.matchedProduct, d.matchedVersion].filter(Boolean).join(' · ')}
                     </div>
                   </div>
                   <ChevronRight className="w-4 h-4 text-text-muted" />
                 </li>
               ))}
             </ul>
           )}
         </div>
       </div>
   </Drawer>
 );
}

function ConfidenceDot({ level }: { level: 'high' | 'medium' | 'low' }) {
 const { t } = useTranslation();
 const cls = level === 'high' ? 'bg-red-400' : level === 'medium' ? 'bg-yellow-400' : 'bg-gray-400';
 const label = level === 'high' ? t('cves.confidenceHigh', 'High confidence match')
   : level === 'medium' ? t('cves.confidenceMedium', 'Medium confidence match')
   : t('cves.confidenceLow', 'Low confidence — verify');
 const short = level === 'high' ? t('cves.confidenceHighShort', 'High')
   : level === 'medium' ? t('cves.confidenceMediumShort', 'Med.')
   : t('cves.confidenceLowShort', 'Low');
 return (
   <span title={label} className="inline-flex flex-col items-center gap-0.5 shrink-0">
     <span className={clsx('w-2 h-2 rounded-full shrink-0', cls)} />
     {/* Touch: the colour alone (with a hover title) carried the meaning. */}
     <span className="hidden coarse:inline text-[9px] leading-none text-text-muted">{short}</span>
   </span>
 );
}
