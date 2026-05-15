import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Shield, AlertCircle, AlertTriangle, RefreshCw, Loader2, ExternalLink, X, ChevronRight, Search } from 'lucide-react';
import { clsx } from 'clsx';
import toast from 'react-hot-toast';
import { cveApi } from '@/api/cve.api';
import { useAuthStore } from '@/store/authStore';
import { TenantBadge } from '@/components/common/TenantBadge';
import type { CveAggregated, CveAffectedDevice, CveStats } from '@obliance/shared';

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
 const { isAdmin } = useAuthStore();
 const [items, setItems] = useState<CveAggregated[]>([]);
 const [stats, setStats] = useState<CveStats | null>(null);
 const [isLoading, setIsLoading] = useState(true);
 const [search, setSearch] = useState('');
 const [severity, setSeverity] = useState<string>('');
 const [kevOnly, setKevOnly] = useState(false);
 const [selectedCve, setSelectedCve] = useState<CveAggregated | null>(null);
 const [syncing, setSyncing] = useState(false);

 const load = async () => {
   setIsLoading(true);
   try {
     const [aggregated, stat] = await Promise.all([
       cveApi.listAggregated({ search: search || undefined, severity: severity || undefined, kevOnly, pageSize: 200 }),
       cveApi.getStats(),
     ]);
     setItems(aggregated.items);
     setStats(stat);
   } catch {
     toast.error(t('common.error') || 'Loading CVEs failed');
   } finally {
     setIsLoading(false);
   }
 };

 useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [severity, kevOnly]);

 // Debounced search
 useEffect(() => {
   const id = window.setTimeout(() => { void load(); }, 300);
   return () => window.clearTimeout(id);
   // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [search]);

 const handleSync = async () => {
   setSyncing(true);
   try {
     const sync = await cveApi.sync();
     toast.success(t('cves.syncDone', { upserted: sync.upserted }) || `CISA KEV: ${sync.upserted} CVEs synced`);
     const rescan = await cveApi.rescan();
     toast.success(t('cves.rescanDone', { devices: rescan.devices, matches: rescan.matches }) || `Rescan: ${rescan.devices} devices, ${rescan.matches} matches`);
     await load();
   } catch {
     toast.error(t('cves.syncFailed') || 'CVE sync failed');
   } finally {
     setSyncing(false);
   }
 };

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
       <div className="relative">
         <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-text-muted pointer-events-none" />
         <input
           type="text"
           value={search}
           onChange={(e) => setSearch(e.target.value)}
           placeholder={t('cves.searchPlaceholder') || 'CVE-ID, product, vendor…'}
           className="pl-8 pr-3 py-1.5 text-sm bg-bg-secondary border border-bg-tertiary rounded-md text-text-primary w-72 focus:outline-none focus:border-accent"
         />
       </div>
       <Chip active={kevOnly} onClick={() => setKevOnly((v) => !v)} color="text-red-400 border-red-400/40 bg-red-400/10">
         {t('cves.filterKev') || 'KEV only'}
       </Chip>
       <Chip active={severity === 'critical'} onClick={() => setSeverity(severity === 'critical' ? '' : 'critical')} color="text-red-400 border-red-400/40 bg-red-400/10">
         Critical
       </Chip>
       <Chip active={severity === 'high'} onClick={() => setSeverity(severity === 'high' ? '' : 'high')} color="text-orange-400 border-orange-400/40 bg-orange-400/10">
         High
       </Chip>
       <Chip active={severity === 'medium'} onClick={() => setSeverity(severity === 'medium' ? '' : 'medium')} color="text-yellow-400 border-yellow-400/40 bg-yellow-400/10">
         Medium
       </Chip>
       <div className="flex-1" />
       <button
         onClick={() => void load()}
         className="px-3 py-1.5 text-sm text-text-muted hover:text-text-primary border border-bg-tertiary rounded-md flex items-center gap-1.5"
         title={t('common.refresh') || 'Refresh'}
       >
         <RefreshCw className="w-3.5 h-3.5" />
         {t('common.refresh') || 'Refresh'}
       </button>
       {isAdmin() && (
         <button
           onClick={handleSync}
           disabled={syncing}
           className="px-3 py-1.5 text-sm bg-accent text-white rounded-md flex items-center gap-1.5 disabled:opacity-50"
           title={t('cves.syncTooltip') || 'Pull CISA KEV catalog + rescan the fleet'}
         >
           {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
           {t('cves.syncButton') || 'Sync CISA KEV'}
         </button>
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
       <div className="bg-bg-secondary rounded-xl overflow-hidden">
         <table className="w-full text-sm">
           <thead>
             <tr className="bg-bg-tertiary/50 text-left">
               <th className="px-3 py-2 text-xs text-text-muted uppercase">{t('cves.colCve') || 'CVE'}</th>
               <th className="px-3 py-2 text-xs text-text-muted uppercase">{t('cves.colProduct') || 'Product'}</th>
               <th className="px-3 py-2 text-xs text-text-muted uppercase">{t('cves.colSeverity') || 'Severity'}</th>
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
                     {c.kevFlag && (
                       <span title={t('cves.kevTooltip') || 'CISA Known Exploited Vulnerability'}>
                         <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                       </span>
                     )}
                     <a
                       href={`https://nvd.nist.gov/vuln/detail/${c.cveId}`}
                       target="_blank" rel="noopener noreferrer"
                       onClick={(e) => e.stopPropagation()}
                       className="font-mono text-xs text-accent hover:underline"
                     >
                       {c.cveId}
                     </a>
                     <ExternalLink className="w-3 h-3 text-text-muted/60" />
                   </div>
                   {c.name && <div className="text-xs text-text-muted truncate max-w-[420px] mt-0.5">{c.name}</div>}
                 </td>
                 <td className="px-3 py-2 text-text-primary">
                   {c.vendor ? `${c.vendor} / ` : ''}{c.product || '—'}
                 </td>
                 <td className="px-3 py-2">
                   <SeverityBadge severity={c.severity ?? 'unknown'} />
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
       </div>
     )}

     {selectedCve && (
       <AffectedDevicesDrawer cve={selectedCve} onClose={() => setSelectedCve(null)} />
     )}
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
     className={clsx(
       'px-3 py-1.5 text-xs rounded-md border transition-colors',
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

 return (
   <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-stretch justify-end" onClick={onClose}>
     <div className="w-full max-w-2xl bg-bg-primary border-l border-bg-tertiary overflow-y-auto" onClick={(e) => e.stopPropagation()}>
       <div className="sticky top-0 bg-bg-primary border-b border-bg-tertiary px-5 py-3 flex items-start gap-3">
         <div className="flex-1 min-w-0">
           <div className="flex items-center gap-2">
             {cve.kevFlag && <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />}
             <a
               href={`https://nvd.nist.gov/vuln/detail/${cve.cveId}`}
               target="_blank" rel="noopener noreferrer"
               className="font-mono text-sm text-accent hover:underline"
             >
               {cve.cveId}
             </a>
             <SeverityBadge severity={cve.severity ?? 'unknown'} />
           </div>
           {cve.name && <h2 className="text-base font-semibold text-text-primary mt-1">{cve.name}</h2>}
           {(cve.vendor || cve.product) && (
             <div className="text-xs text-text-muted mt-1">
               {cve.vendor ? `${cve.vendor} / ` : ''}{cve.product}
             </div>
           )}
         </div>
         <button onClick={onClose} className="p-1 text-text-muted hover:text-text-primary">
           <X className="w-5 h-5" />
         </button>
       </div>

       <div className="p-5 space-y-4">
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
                   className="flex items-center gap-3 px-3 py-2 bg-bg-secondary rounded-md hover:bg-bg-tertiary cursor-pointer"
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
     </div>
   </div>
 );
}

function ConfidenceDot({ level }: { level: 'high' | 'medium' | 'low' }) {
 const cls = level === 'high' ? 'bg-red-400' : level === 'medium' ? 'bg-yellow-400' : 'bg-gray-400';
 const label = level === 'high' ? 'High confidence match' : level === 'medium' ? 'Medium confidence match' : 'Low confidence — verify';
 return <span title={label} className={clsx('w-2 h-2 rounded-full shrink-0', cls)} />;
}
