import { useState, useEffect } from 'react';
import { Key, Copy, Check, ChevronDown, Monitor, Terminal, Apple } from 'lucide-react';
import type { AgentApiKey } from '@obliance/shared';
import { deviceApi } from '@/api/device.api';
import { Button } from '@/components/common/Button';
import { useUiStore } from '@/store/uiStore';
import { useTranslation } from 'react-i18next';

function CopyButton({ text }: { text: string }) {
 const [copied, setCopied] = useState(false);
 const handleCopy = async () => {
 await navigator.clipboard.writeText(text);
 setCopied(true);
 setTimeout(() => setCopied(false), 2000);
 };
 return (
 <button
 onClick={handleCopy}
 className="shrink-0 p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
 title="Copy"
 >
 {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
 </button>
 );
}

type OsTab = 'windows' | 'linux' | 'macos' | 'freebsd';

export function GlobalAddAgentModal() {
 const { t } = useTranslation();
 const { addAgentModalOpen, closeAddAgentModal } = useUiStore();
 const [keys, setKeys] = useState<AgentApiKey[]>([]);
 const [selectedKeyId, setSelectedKeyId] = useState<number | null>(null);
 const [osTab, setOsTab] = useState<OsTab>('windows');
 const [legacyWindows, setLegacyWindows] = useState<'modern' | 'oldtls' | 'legacy' | 'manual'>('modern');
 const [dropdownOpen, setDropdownOpen] = useState(false);

 useEffect(() => {
 if (!addAgentModalOpen) return;
 deviceApi.listKeys().then((k) => {
 setKeys(k);
 if (k.length === 1) setSelectedKeyId(k[0].id);
 else setSelectedKeyId(null);
 });
 }, [addAgentModalOpen]);

 if (!addAgentModalOpen) return null;

 const selectedKey = keys.find(k => k.id === selectedKeyId);

 const origin = window.location.origin;
 const linuxCmd = selectedKey ? `curl -fsSL "${deviceApi.getInstallerUrl('linux', selectedKey.key)}" | bash` : '';
 const macosCmd = selectedKey ? `sudo bash -c "$(curl -fsSL '${deviceApi.getInstallerUrl('macos', selectedKey.key)}')"` : '';
 const windowsCmdModern = selectedKey ? `$m="$env:TEMP\\obliance-agent.msi"; Invoke-WebRequest "${origin}/api/agent/installer/windows.msi" -OutFile $m -UseBasicParsing; Start-Process msiexec -ArgumentList "/i \`"$m\`" SERVERURL=\`"${origin}\`" APIKEY=\`"${selectedKey.key}\`" /quiet" -Wait -Verb RunAs; Remove-Item $m` : '';
 const windowsCmdOldTls = selectedKey ? `$m="$env:TEMP\\obliance-agent.msi"; Import-Module BitsTransfer; Start-BitsTransfer -Source "${origin}/api/agent/installer/windows.msi" -Destination $m; Start-Process msiexec -ArgumentList "/i \`"$m\`" SERVERURL=\`"${origin}\`" APIKEY=\`"${selectedKey.key}\`" /quiet" -Wait -Verb RunAs; Remove-Item $m` : '';
 // Use New-Service instead of sc.exe — PowerShell's argument splitter
 // mangles sc.exe's `binPath= "quoted path" ...` syntax (the space after
 // `=` makes every token a separate arg, so sc.exe prints help + start
 // fails with 1060). New-Service takes a single -BinaryPathName string
 // that is written verbatim into the ImagePath registry value, bypassing
 // the whole quoting mess. Available on Server 2008 R2 / PowerShell 2.0+.
 const windowsCmdLegacy = selectedKey ? `$d="C:\\Program Files\\OblianceAgent"; New-Item -ItemType Directory -Force -Path $d | Out-Null; Import-Module BitsTransfer; Start-BitsTransfer -Source "${origin}/api/agent/download/obliance-legacy.exe" -Destination "$d\\obliance-agent.exe"; New-Service -Name OblianceAgent -BinaryPathName "\`"$d\\obliance-agent.exe\`" --url ${origin} --key ${selectedKey.key}" -StartupType Automatic -DisplayName "Obliance Monitoring Agent"; Start-Service OblianceAgent` : '';
 const windowsCmd = legacyWindows === 'legacy' ? windowsCmdLegacy : legacyWindows === 'oldtls' ? windowsCmdOldTls : windowsCmdModern;
 const freebsdCmd = selectedKey ? `fetch -qo - "${deviceApi.getInstallerUrl('freebsd', selectedKey.key)}" | sh` : '';

 const osTabs: Array<{ id: OsTab; label: string; icon: React.ReactNode }> = [
 { id: 'windows', label: 'Windows', icon: <Monitor size={14} /> },
 { id: 'linux', label: 'Linux', icon: <Terminal size={14} /> },
 { id: 'macos', label: 'macOS', icon: <Apple size={14} /> },
 { id: 'freebsd', label: 'FreeBSD', icon: <Terminal size={14} /> },
 ];

 return (
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={closeAddAgentModal}>
 <div className="w-full max-w-xl rounded-xl bg-bg-primary shadow-2xl overflow-y-auto max-h-[90vh]" onClick={e => e.stopPropagation()}>
 {/* Header */}
 <div className="flex items-center justify-between px-6 py-4 ">
 <h2 className="text-base font-semibold text-text-primary">{t('addAgent.title')}</h2>
 <button onClick={closeAddAgentModal} className="text-text-muted hover:text-text-primary text-xl leading-none">&times;</button>
 </div>

 <div className="p-6 space-y-5">
 {keys.length === 0 ? (
 <div className="text-center py-8">
 <Key size={28} className="mx-auto mb-2 text-text-muted" />
 <p className="text-sm text-text-muted">{t('addAgent.noKeys')}</p>
 </div>
 ) : (
 <>
 {/* API Key selector */}
 <div className="space-y-1.5">
 <label className="text-xs font-medium text-text-muted uppercase">{t('addAgent.selectKey')}</label>
 <div className="relative">
 <button
 onClick={() => setDropdownOpen(!dropdownOpen)}
 className="w-full flex items-center gap-2 px-3 py-2.5 bg-bg-secondary rounded-lg text-sm text-left hover:border-accent/50 transition-colors"
 >
 <Key size={14} className="text-accent shrink-0" />
 {selectedKey ? (
 <div className="flex-1 min-w-0 flex items-center gap-2">
 <span className="font-medium text-text-primary">{selectedKey.name}</span>
 <code className="text-xs text-text-muted font-mono">{selectedKey.key.slice(0, 8)}...{selectedKey.key.slice(-4)}</code>
 {selectedKey.defaultGroupName && (
 <span className="text-xs text-accent">→ {selectedKey.defaultGroupName}</span>
 )}
 </div>
 ) : (
 <span className="flex-1 text-text-muted">{t('addAgent.chooseKey')}</span>
 )}
 <ChevronDown size={14} className="text-text-muted shrink-0" />
 </button>
 {dropdownOpen && (
 <div className="mt-1 bg-bg-secondary rounded-lg overflow-hidden max-h-60 overflow-y-auto">
 {keys.map(k => (
 <button
 key={k.id}
 onClick={() => { setSelectedKeyId(k.id); setDropdownOpen(false); }}
 className={`w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left transition-colors ${
 selectedKeyId === k.id ? 'bg-accent/10 text-accent' : 'text-text-primary hover:bg-bg-tertiary'
 }`}
 >
 <Key size={14} className={selectedKeyId === k.id ? 'text-accent' : 'text-text-muted'} />
 <span className="font-medium">{k.name}</span>
 <code className="text-xs text-text-muted font-mono ml-auto">{k.key.slice(0, 8)}...</code>
 {k.defaultGroupName && (
 <span className="text-xs text-text-muted">→ {k.defaultGroupName}</span>
 )}
 </button>
 ))}
 </div>
 )}
 </div>
 </div>

 {/* Install commands (only when key selected) */}
 {selectedKey && (
 <div className="space-y-3">
 {/* OS tabs */}
 <div className="flex items-center gap-1 rounded-lg bg-bg-secondary p-1 border border-transparent">
 {osTabs.map(tab => (
 <button
 key={tab.id}
 onClick={() => setOsTab(tab.id)}
 className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
 osTab === tab.id ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary'
 }`}
 >
 {tab.icon}
 {tab.label}
 </button>
 ))}
 </div>

 {/* Command block */}
 <div className="rounded-lg bg-bg-secondary overflow-hidden">
 {osTab === 'windows' && (
 <div className="p-4 space-y-2">
 <div className="flex items-center justify-between gap-2">
 <p className="text-xs font-medium text-text-muted">
 {legacyWindows === 'legacy' ? 'Run in PowerShell (admin) — Server 2008 R2 / 2012'
 : legacyWindows === 'oldtls' ? 'Run in PowerShell (admin) — Server 2012 / 2016 (TLS fix)'
 : legacyWindows === 'manual' ? (t('addAgent.manualHint') || 'Download the wizard EXE, copy it to the target box (USB / RDP clipboard / share), double-click. MSI is embedded — no internet required on the target.')
 : t('addAgent.windowsHint')}
 </p>
 <select
 value={legacyWindows}
 onChange={e => setLegacyWindows(e.target.value as any)}
 className="text-[11px] bg-bg-tertiary rounded px-1.5 py-1 text-text-muted"
 >
 <option value="modern">Windows 10+</option>
 <option value="oldtls">Server 2012/2016</option>
 <option value="legacy">Server 2008 R2</option>
 <option value="manual">Manual / offline (wizard)</option>
 </select>
 </div>
 {legacyWindows === 'manual' ? (
 // Offline-friendly path: a download button → wizard.exe pre-baked
 // with this tenant's selected API key + the current server URL.
 // The wizard reads the tail blob at startup so the two text fields
 // land already filled in.
 <div className="flex items-center justify-between gap-2 rounded-md bg-bg-tertiary p-3">
 <div className="flex-1 text-xs text-text-secondary">
 <div className="font-medium text-text-primary mb-0.5">
 {t('addAgent.manualWizardTitle') || 'Obliance Install Wizard'}
 </div>
 <div className="text-text-muted leading-relaxed">
 {t('addAgent.manualWizardDescription') ||
 'EXE with MSI embedded. Pre-filled with the selected API key. Run on the target — fields are editable for last-minute corrections.'}
 </div>
 </div>
 {selectedKey ? (
 <a
 href={`/api/agent/installer/wizard.exe?keyId=${selectedKey.id}`}
 download="obliance-installer-wizard.exe"
 className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-accent text-white hover:bg-accent/80 transition-colors"
 >
 {t('addAgent.manualDownload') || 'Download wizard'}
 </a>
 ) : (
 <button
 disabled
 title={t('addAgent.pickKeyFirst') || 'Pick an API key first'}
 className="shrink-0 px-3 py-1.5 text-xs font-medium rounded-md bg-bg-secondary text-text-muted cursor-not-allowed"
 >
 {t('addAgent.manualDownload') || 'Download wizard'}
 </button>
 )}
 </div>
 ) : (
 <div className="flex items-start gap-2 rounded-md bg-bg-tertiary p-3">
 <code className="flex-1 text-xs font-mono text-text-primary break-all leading-relaxed">{windowsCmd}</code>
 <CopyButton text={windowsCmd} />
 </div>
 )}
 </div>
 )}
 {osTab === 'linux' && (
 <div className="p-4 space-y-2">
 <p className="text-xs font-medium text-text-muted">{t('addAgent.linuxHint')}</p>
 <div className="flex items-start gap-2 rounded-md bg-bg-tertiary p-3">
 <code className="flex-1 text-xs font-mono text-text-primary break-all leading-relaxed">{linuxCmd}</code>
 <CopyButton text={linuxCmd} />
 </div>
 </div>
 )}
 {osTab === 'macos' && (
 <div className="p-4 space-y-2">
 <p className="text-xs font-medium text-text-muted">{t('addAgent.macosHint')}</p>
 <div className="flex items-start gap-2 rounded-md bg-bg-tertiary p-3">
 <code className="flex-1 text-xs font-mono text-text-primary break-all leading-relaxed">{macosCmd}</code>
 <CopyButton text={macosCmd} />
 </div>
 </div>
 )}
 {osTab === 'freebsd' && (
 <div className="p-4 space-y-2">
 <p className="text-xs font-medium text-text-muted">{t('addAgent.freebsdHint')}</p>
 <div className="flex items-start gap-2 rounded-md bg-bg-tertiary p-3">
 <code className="flex-1 text-xs font-mono text-text-primary break-all leading-relaxed">{freebsdCmd}</code>
 <CopyButton text={freebsdCmd} />
 </div>
 </div>
 )}
 </div>
 </div>
 )}
 </>
 )}
 </div>

 <div className="px-6 pb-6">
 <Button variant="secondary" onClick={closeAddAgentModal} className="w-full">{t('common.close')}</Button>
 </div>
 </div>
 </div>
 );
}
