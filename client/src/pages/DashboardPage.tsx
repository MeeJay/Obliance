import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Monitor, Wifi, WifiOff, AlertTriangle, AlertCircle, Clock, RefreshCw, ArrowRight, Package, ShieldCheck } from 'lucide-react';
import { useDeviceStore } from '@/store/deviceStore';
import { DeviceStatusBadge } from '@/components/devices/DeviceStatusBadge';
import { DeviceMetricsBar } from '@/components/devices/DeviceMetricsBar';
import { OsIcon } from '@/components/devices/OsIcon';

function StatCard({ icon: Icon, label, value, color, to }: { icon: any; label: string; value: number; color: string; to?: string }) {
  const content = (
    <div className={`p-4 bg-bg-secondary border border-border rounded-xl flex items-center gap-4 hover:border-accent/50 transition-colors ${to ? 'cursor-pointer' : ''}`}>
      <div className={`p-3 rounded-lg ${color}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-2xl font-bold text-text-primary">{value}</p>
        <p className="text-sm text-text-muted">{label}</p>
      </div>
    </div>
  );
  return to ? <Link to={to}>{content}</Link> : content;
}

export function DashboardPage() {
  const { devices, fetchDevices, summary, fetchSummary } = useDeviceStore();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      await Promise.all([fetchDevices(), fetchSummary()]);
      setIsLoading(false);
    };
    load();
  }, [fetchDevices, fetchSummary]);

  const deviceList = Array.from(devices.values()).slice(0, 10);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-6 h-6 animate-spin text-text-muted" />
      </div>
    );
  }

  const s = summary;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-text-primary">Fleet Overview</h1>
        <Link
          to="/devices"
          className="flex items-center gap-2 text-sm text-accent hover:text-accent/80 transition-colors"
        >
          View all devices
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard icon={Monitor} label="Total" value={s?.total ?? 0} color="bg-blue-500/20 text-blue-400" to="/devices" />
        <StatCard icon={Wifi} label="Online" value={s?.online ?? 0} color="bg-green-500/20 text-green-400" to="/devices?status=online" />
        <StatCard icon={WifiOff} label="Offline" value={s?.offline ?? 0} color="bg-gray-500/20 text-gray-400" to="/devices?status=offline" />
        <StatCard icon={AlertTriangle} label="Warning" value={s?.warning ?? 0} color="bg-yellow-500/20 text-yellow-400" to="/devices?status=warning" />
        <StatCard icon={AlertCircle} label="Critical" value={s?.critical ?? 0} color="bg-red-500/20 text-red-400" to="/devices?status=critical" />
        <StatCard icon={Clock} label="Pending" value={s?.pending ?? 0} color="bg-purple-500/20 text-purple-400" to="/admin/devices" />
      </div>

      {/* Quick stats row */}
      {s && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 bg-bg-secondary border border-border rounded-xl flex items-center gap-4">
            <div className="p-3 rounded-lg bg-orange-500/20 text-orange-400">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xl font-bold text-text-primary">{s.pendingUpdates}</p>
              <p className="text-sm text-text-muted">Pending updates</p>
            </div>
            <Link to="/updates" className="ml-auto text-sm text-accent hover:text-accent/80">Manage →</Link>
          </div>
          {s.complianceScore !== null && (
            <div className="p-4 bg-bg-secondary border border-border rounded-xl flex items-center gap-4">
              <div className={`p-3 rounded-lg ${s.complianceScore >= 80 ? 'bg-green-500/20 text-green-400' : s.complianceScore >= 50 ? 'bg-yellow-500/20 text-yellow-400' : 'bg-red-500/20 text-red-400'}`}>
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xl font-bold text-text-primary">{s.complianceScore.toFixed(0)}%</p>
                <p className="text-sm text-text-muted">Fleet compliance score</p>
              </div>
              <Link to="/compliance" className="ml-auto text-sm text-accent hover:text-accent/80">View →</Link>
            </div>
          )}
        </div>
      )}

      {/* Recent devices */}
      <div className="bg-bg-secondary border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h2 className="font-semibold text-text-primary">Recent Devices</h2>
          <Link to="/devices" className="text-sm text-accent hover:text-accent/80">View all →</Link>
        </div>
        <div className="divide-y divide-border">
          {deviceList.length === 0 ? (
            <div className="p-8 text-center text-text-muted">
              <Monitor className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>No devices yet. Install the agent to get started.</p>
              <Link to="/download" className="mt-2 inline-block text-sm text-accent">Download agent →</Link>
            </div>
          ) : (
            deviceList.map((device) => (
              <Link
                key={device.id}
                to={`/devices/${device.id}`}
                className="flex items-center gap-4 px-4 py-3 hover:bg-bg-tertiary transition-colors"
              >
                <OsIcon osType={device.osType} className="w-4 h-4 text-text-muted shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-primary truncate">{device.displayName || device.hostname}</p>
                  <p className="text-xs text-text-muted truncate">{device.osName} · {device.ipLocal ?? device.ipPublic ?? 'unknown'}</p>
                </div>
                <DeviceMetricsBar metrics={device.latestMetrics} compact />
                <DeviceStatusBadge status={device.status} size="sm" />
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
