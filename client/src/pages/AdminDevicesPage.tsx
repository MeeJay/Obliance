import { useState, useEffect, useCallback } from 'react';
import { Key, Plus, Trash2, Check, X, Monitor, RefreshCw, Copy } from 'lucide-react';
import { deviceApi } from '@/api/device.api';
import type { AgentApiKey, Device } from '@obliance/shared';
import toast from 'react-hot-toast';

export function AdminDevicesPage() {
  const [keys, setKeys] = useState<AgentApiKey[]>([]);
  const [pendingDevices, setPendingDevices] = useState<Device[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newKeyName, setNewKeyName] = useState('');
  const [isCreatingKey, setIsCreatingKey] = useState(false);
  const [showNewKey, setShowNewKey] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [keysData, devicesData] = await Promise.all([
        deviceApi.listKeys(),
        deviceApi.list({ approvalStatus: 'pending' }),
      ]);
      setKeys(keysData);
      setPendingDevices(devicesData);
    } catch {
      toast.error('Failed to load data');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) return;
    setIsCreatingKey(true);
    try {
      const key = await deviceApi.createKey(newKeyName.trim());
      setShowNewKey(key.key);
      setNewKeyName('');
      await loadData();
      toast.success('API key created');
    } catch {
      toast.error('Failed to create key');
    } finally {
      setIsCreatingKey(false);
    }
  };

  const handleDeleteKey = async (id: number) => {
    if (!confirm('Delete this API key? Any agents using it will no longer be able to connect.')) return;
    try {
      await deviceApi.deleteKey(id);
      await loadData();
      toast.success('API key deleted');
    } catch {
      toast.error('Failed to delete key');
    }
  };

  const handleApprove = async (id: number) => {
    try {
      await deviceApi.approve(id);
      setPendingDevices(prev => prev.filter(d => d.id !== id));
      toast.success('Device approved');
    } catch {
      toast.error('Failed to approve device');
    }
  };

  const handleRefuse = async (id: number) => {
    try {
      await deviceApi.refuse(id);
      setPendingDevices(prev => prev.filter(d => d.id !== id));
      toast.success('Device refused');
    } catch {
      toast.error('Failed to refuse device');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-6 h-6 animate-spin text-text-muted" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold text-text-primary">Device Management</h1>

      {/* API Keys */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
          <Key className="w-5 h-5" />
          API Keys
        </h2>

        {showNewKey && (
          <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-lg space-y-2">
            <p className="text-sm font-medium text-green-400">New key created — copy it now, it won't be shown again:</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-sm font-mono bg-bg-tertiary p-2 rounded text-text-primary">{showNewKey}</code>
              <button
                onClick={() => { navigator.clipboard.writeText(showNewKey); toast.success('Copied!'); }}
                className="p-2 hover:bg-bg-tertiary rounded transition-colors"
              >
                <Copy className="w-4 h-4" />
              </button>
            </div>
            <button onClick={() => setShowNewKey(null)} className="text-xs text-text-muted hover:text-text-primary">Dismiss</button>
          </div>
        )}

        <div className="flex gap-2">
          <input
            type="text"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="Key name (e.g. Production)"
            className="flex-1 px-3 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
            onKeyDown={(e) => e.key === 'Enter' && handleCreateKey()}
          />
          <button
            onClick={handleCreateKey}
            disabled={isCreatingKey || !newKeyName.trim()}
            className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent/80 disabled:opacity-50 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Create
          </button>
        </div>

        <div className="space-y-2">
          {keys.length === 0 && (
            <p className="text-text-muted text-sm">No API keys created yet.</p>
          )}
          {keys.map((key) => (
            <div key={key.id} className="flex items-center justify-between p-3 bg-bg-secondary border border-border rounded-lg">
              <div>
                <p className="text-sm font-medium text-text-primary">{key.name || 'Unnamed key'}</p>
                <p className="text-xs text-text-muted">
                  Created {new Date(key.createdAt).toLocaleDateString()}
                  {key.lastUsedAt && ` · Last used ${new Date(key.lastUsedAt).toLocaleDateString()}`}
                </p>
              </div>
              <button
                onClick={() => handleDeleteKey(key.id)}
                className="p-2 text-text-muted hover:text-red-400 hover:bg-red-400/10 rounded transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Pending Devices */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
          <Monitor className="w-5 h-5" />
          Pending Devices
          {pendingDevices.length > 0 && (
            <span className="ml-2 px-2 py-0.5 text-xs bg-yellow-500/20 text-yellow-400 rounded-full">{pendingDevices.length}</span>
          )}
        </h2>

        {pendingDevices.length === 0 ? (
          <p className="text-text-muted text-sm">No devices awaiting approval.</p>
        ) : (
          <div className="space-y-2">
            {pendingDevices.map((device) => (
              <div key={device.id} className="flex items-center justify-between p-4 bg-bg-secondary border border-border rounded-lg">
                <div>
                  <p className="text-sm font-medium text-text-primary">{device.hostname}</p>
                  <p className="text-xs text-text-muted">
                    {device.osType} · {device.ipLocal ?? device.ipPublic ?? 'unknown IP'}
                    {device.agentVersion && ` · Agent v${device.agentVersion}`}
                  </p>
                  <p className="text-xs text-text-muted">Registered {new Date(device.createdAt).toLocaleString()}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleApprove(device.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500/20 text-green-400 border border-green-500/30 rounded-lg hover:bg-green-500/30 transition-colors text-sm"
                  >
                    <Check className="w-4 h-4" />
                    Approve
                  </button>
                  <button
                    onClick={() => handleRefuse(device.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg hover:bg-red-500/20 transition-colors text-sm"
                  >
                    <X className="w-4 h-4" />
                    Refuse
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
