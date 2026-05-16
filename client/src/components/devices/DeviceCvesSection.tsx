import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, ExternalLink, Loader2, X, ChevronDown, ChevronRight, Bug } from 'lucide-react';
import { clsx } from 'clsx';
import toast from 'react-hot-toast';
import { cveApi } from '@/api/cve.api';
import { useAuthStore } from '@/store/authStore';
import type { DeviceCve } from '@obliance/shared';

// Same GHSA/NVD dispatch as CvesPage — keep them in sync if you move
// this into a shared util later.
function cveDetailUrl(cveId: string): string {
  if (cveId?.startsWith('GHSA-')) return `https://github.com/advisories/${cveId}`;
  return `https://nvd.nist.gov/vuln/detail/${cveId}`;
}

// Per-device CVE list embedded in the Compliance tab of DeviceDetailPage.
//
// Lazy-loaded so we don't fetch /cves/device/:id for users who never open
// the Compliance tab. Admin sees a "Dismiss" button per match (mark as
// false positive) — the server hides dismissed rows from future lists
// AND prevents the matcher from recreating them on rescan.

const SEVERITY_CLR: Record<string, string> = {
 critical: 'text-red-400 bg-red-400/10 border-red-400/30',
 high:     'text-orange-400 bg-orange-400/10 border-orange-400/30',
 medium:   'text-yellow-400 bg-yellow-400/10 border-yellow-400/30',
 low:      'text-blue-400 bg-blue-400/10 border-blue-400/30',
 unknown:  'text-gray-400 bg-gray-400/10 border-gray-400/30',
};

const CONFIDENCE_CLR: Record<string, string> = {
 high:   'bg-red-400',
 medium: 'bg-yellow-400',
 low:    'bg-gray-400',
};

interface Props {
 deviceId: number;
}

export function DeviceCvesSection({ deviceId }: Props) {
 const { t } = useTranslation();
 const { isAdmin } = useAuthStore();
 const [items, setItems] = useState<DeviceCve[]>([]);
 const [isLoading, setIsLoading] = useState(true);
 const [collapsed, setCollapsed] = useState(false);

 const load = async () => {
   setIsLoading(true);
   try {
     setItems(await cveApi.listForDevice(deviceId));
   } catch {
     // 403 if the user doesn't have cve:read — section just stays empty/silent
   } finally {
     setIsLoading(false);
   }
 };

 useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [deviceId]);

 const handleDismiss = async (dcId: number) => {
   try {
     await cveApi.dismiss(dcId);
     setItems((prev) => prev.filter((x) => x.id !== dcId));
     toast.success(t('cves.dismissed') || 'Match dismissed');
   } catch {
     toast.error(t('common.error') || 'Dismiss failed');
   }
 };

 if (isLoading) {
   return (
     <div className="rounded-xl bg-bg-secondary p-4 flex items-center gap-2 text-text-muted">
       <Loader2 className="w-4 h-4 animate-spin" />
       <span className="text-sm">{t('cves.loadingSection') || 'Loading CVE matches…'}</span>
     </div>
   );
 }

 // Hide entirely when there are no matches — no point in a "0 CVE" panel
 // taking real estate above the compliance grid. The Security page (or a
 // future tab) is where the absence of CVE matches is meaningful.
 if (items.length === 0) return null;

 const kevCount = items.filter((x) => x.cve.kevFlag).length;

 return (
   <div className="rounded-xl bg-bg-secondary overflow-hidden border border-red-400/20">
     <button
       onClick={() => setCollapsed((v) => !v)}
       className="w-full flex items-center gap-3 px-4 py-3 hover:bg-bg-tertiary/30 transition-colors text-left"
     >
       <Bug className="w-5 h-5 text-red-400 shrink-0" />
       <div className="flex-1 min-w-0">
         <div className="text-sm font-semibold text-text-primary">
           {t('cves.deviceSectionTitle', { count: items.length }) || `${items.length} CVE match${items.length > 1 ? 'es' : ''} on this device`}
         </div>
         {kevCount > 0 && (
           <div className="text-xs text-red-400 mt-0.5">
             {t('cves.deviceSectionKev', { count: kevCount }) || `${kevCount} actively exploited (CISA KEV)`}
           </div>
         )}
       </div>
       {collapsed ? <ChevronRight className="w-4 h-4 text-text-muted" /> : <ChevronDown className="w-4 h-4 text-text-muted" />}
     </button>

     {!collapsed && (
       <div className="border-t border-bg-tertiary divide-y divide-bg-tertiary/50">
         {items.map((it) => (
           <div key={it.id} className="px-4 py-3 flex items-start gap-3">
             <span
               title={`${it.matchConfidence} confidence match`}
               className={clsx('w-2 h-2 rounded-full shrink-0 mt-1.5', CONFIDENCE_CLR[it.matchConfidence] ?? CONFIDENCE_CLR.medium)}
             />
             <div className="flex-1 min-w-0">
               <div className="flex items-center gap-2 flex-wrap">
                 {it.cve.kevFlag && (
                   <span title={t('cves.kevTooltip') || 'CISA Known Exploited Vulnerability'}>
                     <AlertCircle className="w-3.5 h-3.5 text-red-400" />
                   </span>
                 )}
                 <a
                   href={cveDetailUrl(it.cve.cveId)}
                   target="_blank" rel="noopener noreferrer"
                   className="font-mono text-xs text-accent hover:underline flex items-center gap-1"
                 >
                   {it.cve.cveId}
                   <ExternalLink className="w-3 h-3" />
                 </a>
                 <span className={clsx('px-2 py-0.5 text-[10px] uppercase font-semibold rounded-full border', SEVERITY_CLR[it.cve.severity ?? 'unknown'])}>
                   {it.cve.severity ?? 'unknown'}
                 </span>
                 {it.cve.dueDate && (
                   <span className="text-[11px] text-text-muted">
                     {t('cves.due') || 'Due'} {new Date(it.cve.dueDate).toLocaleDateString()}
                   </span>
                 )}
               </div>
               {it.cve.name && (
                 <div className="text-sm text-text-primary mt-1">{it.cve.name}</div>
               )}
               <div className="text-[11px] text-text-muted mt-1 truncate">
                 {t('cves.matchedAs') || 'Matched via'}: {[it.matchedVendor, it.matchedProduct, it.matchedVersion].filter(Boolean).join(' · ') || '—'}
               </div>
               {it.cve.firstPatchedVersion && (
                 <div className="text-[11px] mt-1">
                   <span className="text-text-muted">{t('cves.patchedIn') || 'Patched in'}: </span>
                   <span className="text-green-400 font-mono">{it.cve.firstPatchedVersion}</span>
                 </div>
               )}
               {it.cve.requiredAction && (
                 <div className="text-[11px] text-text-muted mt-1 italic">
                   {t('cves.requiredAction') || 'CISA action'}: {it.cve.requiredAction}
                 </div>
               )}
             </div>
             {isAdmin() && (
               <button
                 onClick={() => handleDismiss(it.id)}
                 className="p-1 text-text-muted hover:text-text-primary shrink-0"
                 title={t('cves.dismissTooltip') || 'Mark as false positive (won\'t recreate on next scan)'}
               >
                 <X className="w-3.5 h-3.5" />
               </button>
             )}
           </div>
         ))}
       </div>
     )}
   </div>
 );
}
