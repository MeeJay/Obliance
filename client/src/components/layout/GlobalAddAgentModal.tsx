import { useState, useEffect } from 'react';
import { Key, Copy, Check, ChevronDown, ChevronRight } from 'lucide-react';
import type { AgentApiKey } from '@obliance/shared';
import { deviceApi } from '@/api/device.api';
import { Button } from '@/components/common/Button';
import { useUiStore } from '@/store/uiStore';

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
      {copied ? <Check size={14} className="text-status-up" /> : <Copy size={14} />}
    </button>
  );
}

export function GlobalAddAgentModal() {
  const { addAgentModalOpen, closeAddAgentModal } = useUiStore();
  const [keys, setKeys] = useState<AgentApiKey[]>([]);
  const [agentVersion] = useState('1.0.0');
  const [expandedKeys, setExpandedKeys] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!addAgentModalOpen) return;
    deviceApi.listKeys().then((k) => {
      setKeys(k);
      setExpandedKeys(new Set(k.map(key => key.id)));
    });
  }, [addAgentModalOpen]);

  if (!addAgentModalOpen) return null;

  const toggleKey = (id: number) => {
    setExpandedKeys(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl rounded-xl border border-border bg-bg-primary shadow-2xl overflow-y-auto max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-base font-semibold text-text-primary">Add Agent</h2>
            <p className="text-xs text-text-muted mt-0.5">Agent version: {agentVersion}</p>
          </div>
          <button onClick={closeAddAgentModal} className="text-text-muted hover:text-text-primary text-xl leading-none">×</button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-3">
          {keys.length === 0 ? (
            <div className="text-center py-8">
              <Key size={28} className="mx-auto mb-2 text-text-muted" />
              <p className="text-sm text-text-muted">Create an API Key first in the Agents page</p>
            </div>
          ) : (
            keys.map(apiKey => {
              const expanded = expandedKeys.has(apiKey.id);
              const linuxCmd = deviceApi.getInstallerUrl('linux', apiKey.key);
              const macosCmd = deviceApi.getInstallerUrl('macos', apiKey.key);
              const msiUrl = `${window.location.origin}/api/agent/installer/windows.msi`;
              const origin = window.location.origin;
              const linuxOneliner = `curl -fsSL "${linuxCmd}" | bash`;
              const macosOneliner = `sudo bash -c "$(curl -fsSL '${macosCmd}')"`;
              const windowsCmd = `$m="$env:TEMP\\obliance-agent.msi"; Invoke-WebRequest "${msiUrl}" -OutFile $m -UseBasicParsing; Start-Process msiexec -ArgumentList "/i \`"$m\`" SERVERURL=\`"${origin}\`" APIKEY=\`"${apiKey.key}\`" /quiet" -Wait -Verb RunAs; Remove-Item $m`;

              return (
                <div key={apiKey.id} className="rounded-lg border border-border bg-bg-secondary">
                  <button
                    onClick={() => toggleKey(apiKey.id)}
                    className="w-full flex items-center gap-2 px-4 py-3 text-left"
                  >
                    {expanded ? <ChevronDown size={14} className="text-text-muted shrink-0" /> : <ChevronRight size={14} className="text-text-muted shrink-0" />}
                    <Key size={14} className="text-accent shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-text-primary">{apiKey.name}</span>
                      <span className="ml-2 text-xs font-mono text-text-muted">{apiKey.key.slice(0, 8)}...{apiKey.key.slice(-4)}</span>
                    </div>
                    {apiKey.lastUsedAt && (
                      <span className="text-xs text-text-muted shrink-0">Last used {new Date(apiKey.lastUsedAt).toLocaleDateString()}</span>
                    )}
                  </button>

                  {expanded && (
                    <div className="px-4 pb-4 space-y-3 border-t border-border">
                      <div>
                        <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-1.5 mt-3">Linux</p>
                        <div className="flex items-start gap-2 rounded-md bg-bg-tertiary p-3">
                          <code className="flex-1 text-xs font-mono text-text-primary break-all leading-relaxed">{linuxOneliner}</code>
                          <CopyButton text={linuxOneliner} />
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-1.5">macOS — Apple Silicon (M1 / M2 / M3 / M4)</p>
                        <div className="flex items-start gap-2 rounded-md bg-bg-tertiary p-3">
                          <code className="flex-1 text-xs font-mono text-text-primary break-all leading-relaxed">{macosOneliner}</code>
                          <CopyButton text={macosOneliner} />
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-1.5">macOS — Intel (x86_64)</p>
                        <div className="flex items-start gap-2 rounded-md bg-bg-tertiary p-3">
                          <code className="flex-1 text-xs font-mono text-text-primary break-all leading-relaxed">{macosOneliner}</code>
                          <CopyButton text={macosOneliner} />
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-1.5">Windows (PowerShell, admin)</p>
                        <div className="flex items-start gap-2 rounded-md bg-bg-tertiary p-3">
                          <code className="flex-1 text-xs font-mono text-text-primary break-all leading-relaxed">{windowsCmd}</code>
                          <CopyButton text={windowsCmd} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="px-6 pb-6">
          <Button variant="secondary" onClick={closeAddAgentModal} className="w-full">Close</Button>
        </div>
      </div>
    </div>
  );
}
