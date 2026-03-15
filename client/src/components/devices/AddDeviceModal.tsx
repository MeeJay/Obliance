import { useState, useEffect, useCallback } from 'react';
import { X, Copy, Check, ChevronDown, ChevronRight, Monitor } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { deviceApi } from '@/api/device.api';
import apiClient from '@/api/client';
import type { AgentApiKey } from '@obliance/shared';
import toast from 'react-hot-toast';

interface Props {
  onClose: () => void;
}

type Platform = 'linux' | 'macosSilicon' | 'macosIntel' | 'windows';

const PLATFORMS: Platform[] = ['linux', 'macosSilicon', 'macosIntel', 'windows'];

function buildCommand(platform: Platform, origin: string, apiKey: string): string {
  switch (platform) {
    case 'linux':
      return `curl -fsSL "${origin}/api/agent/installer/linux?key=${apiKey}" | bash`;
    case 'macosSilicon':
      return `sudo bash -c "$(curl -fsSL '${origin}/api/agent/installer/macos?key=${apiKey}')"`;
    case 'macosIntel':
      return `sudo bash -c "$(curl -fsSL '${origin}/api/agent/installer/macos?key=${apiKey}')"`;
    case 'windows':
      return `$m="$env:TEMP\\obliance-agent.msi"; Invoke-WebRequest "${origin}/api/agent/download/obliance-agent.msi" -UseBasicParsing -OutFile $m; Start-Process msiexec -ArgumentList "/i \`"$m\`" SERVERURL=\`"${origin}\`" APIKEY=\`"${apiKey}\`" /quiet" -Wait -Verb RunAs; Remove-Item $m`;
  }
}

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
      className="flex-shrink-0 p-1.5 rounded hover:bg-bg-primary transition-colors text-text-muted hover:text-text-primary"
      title="Copy"
    >
      {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
    </button>
  );
}

function KeySection({ apiKey, origin, t }: { apiKey: AgentApiKey; origin: string; t: (k: string, o?: object) => string }) {
  const [expanded, setExpanded] = useState(true);
  const truncatedKey = `${apiKey.key.slice(0, 8)}...${apiKey.key.slice(-4)}`;

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Key header */}
      <button
        className="w-full flex items-center gap-2 px-4 py-3 bg-bg-secondary hover:bg-bg-tertiary transition-colors text-left"
        onClick={() => setExpanded(e => !e)}
      >
        {expanded ? <ChevronDown className="w-4 h-4 text-text-muted flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-text-muted flex-shrink-0" />}
        <Monitor className="w-4 h-4 text-accent flex-shrink-0" />
        <span className="font-medium text-text-primary">{apiKey.name || 'Unnamed key'}</span>
        <code className="text-xs text-text-muted font-mono ml-1">{truncatedKey}</code>
        <span className="ml-auto text-xs text-text-muted">{t('devices.addModal.deviceCount', { count: apiKey.deviceCount })}</span>
      </button>

      {expanded && (
        <div className="bg-bg-primary divide-y divide-border">
          {PLATFORMS.map((platform) => {
            const command = buildCommand(platform, origin, apiKey.key);
            return (
              <div key={platform} className="px-4 py-3 space-y-1.5">
                <p className="text-xs font-semibold tracking-wider text-text-muted uppercase">
                  {t(`devices.addModal.${platform}`)}
                </p>
                <div className="flex items-start gap-2 bg-bg-secondary rounded-md p-2.5">
                  <code className="flex-1 text-xs font-mono text-text-primary break-all leading-relaxed">{command}</code>
                  <CopyButton text={command} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function AddDeviceModal({ onClose }: Props) {
  const { t } = useTranslation();
  const [keys, setKeys] = useState<AgentApiKey[]>([]);
  const [agentVersion, setAgentVersion] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const origin = window.location.origin;

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [keysData, versionRes] = await Promise.all([
        deviceApi.listKeys(),
        apiClient.get<{ version: string }>('/agent/version').catch(() => ({ data: { version: '' } })),
      ]);
      setKeys(keysData);
      setAgentVersion(versionRes.data?.version ?? '');
    } catch {
      toast.error(t('common.error'));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-2xl bg-bg-secondary border border-border rounded-xl shadow-2xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-border flex-shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">{t('devices.addModal.title')}</h2>
            {agentVersion && (
              <p className="text-xs text-text-muted mt-0.5">
                {t('devices.addModal.agentVersion', { version: agentVersion })}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-bg-tertiary transition-colors text-text-muted hover:text-text-primary"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            </div>
          ) : keys.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-10">{t('devices.addModal.noKeys')}</p>
          ) : (
            keys.map(key => (
              <KeySection key={key.id} apiKey={key} origin={origin} t={t} />
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-border flex-shrink-0">
          <button
            onClick={onClose}
            className="w-full py-2.5 bg-bg-tertiary text-text-primary rounded-lg hover:bg-border transition-colors text-sm font-medium"
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
