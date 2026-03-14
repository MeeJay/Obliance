import { useEffect, useState, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, RefreshCw, Monitor, Check, Trash2, ChevronRight } from 'lucide-react';
import { useDeviceStore } from '@/store/deviceStore';
import { useAuthStore } from '@/store/authStore';
import { DeviceStatusBadge } from '@/components/devices/DeviceStatusBadge';
import { DeviceMetricsBar } from '@/components/devices/DeviceMetricsBar';
import { OsIcon } from '@/components/devices/OsIcon';
import { deviceApi } from '@/api/device.api';
import toast from 'react-hot-toast';

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All' },
  { value: 'online', label: 'Online' },
  { value: 'offline', label: 'Offline' },
  { value: 'warning', label: 'Warning' },
  { value: 'critical', label: 'Critical' },
  { value: 'pending', label: 'Pending Approval' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'suspended', label: 'Suspended' },
];

export function DeviceListPage() {
  const { devices, isLoading, fetchDevices } = useDeviceStore();
  const { isAdmin } = useAuthStore();
  const [searchParams] = useSearchParams();

  const [search, setSearch] = useState('');
  const [selectedStatus, setSelectedStatus] = useState(searchParams.get('status') ?? '');
  const [selectedGroupId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isBulkActioning, setIsBulkActioning] = useState(false);

  const load = useCallback(() => {
    fetchDevices({
      search: search || undefined,
      status: selectedStatus || undefined,
      groupId: selectedGroupId ?? undefined,
    });
  }, [fetchDevices, search, selectedStatus, selectedGroupId]);

  useEffect(() => { load(); }, [load]);

  const deviceList = Array.from(devices.values());

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === deviceList.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(deviceList.map((d) => d.id)));
    }
  };

  const handleBulkApprove = async () => {
    if (selectedIds.size === 0) return;
    setIsBulkActioning(true);
    try {
      await deviceApi.bulkApprove(Array.from(selectedIds));
      setSelectedIds(new Set());
      load();
      toast.success(`${selectedIds.size} devices approved`);
    } catch {
      toast.error('Failed to approve devices');
    } finally {
      setIsBulkActioning(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} devices? This cannot be undone.`)) return;
    setIsBulkActioning(true);
    try {
      await deviceApi.bulkDelete(Array.from(selectedIds));
      setSelectedIds(new Set());
      load();
      toast.success(`${selectedIds.size} devices deleted`);
    } catch {
      toast.error('Failed to delete devices');
    } finally {
      setIsBulkActioning(false);
    }
  };

  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-text-primary">Devices</h1>
        <button onClick={load} className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-secondary rounded-lg transition-colors">
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search devices..."
            className="w-full pl-9 pr-3 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent text-sm"
          />
        </div>
        <select
          value={selectedStatus}
          onChange={(e) => setSelectedStatus(e.target.value)}
          className="px-3 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent text-sm"
        >
          {STATUS_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
      </div>

      {/* Bulk actions */}
      {selectedIds.size > 0 && isAdmin() && (
        <div className="flex items-center gap-3 p-3 bg-accent/10 border border-accent/30 rounded-lg">
          <span className="text-sm text-text-primary">{selectedIds.size} selected</span>
          <button
            onClick={handleBulkApprove}
            disabled={isBulkActioning}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500/20 text-green-400 border border-green-500/30 rounded text-sm hover:bg-green-500/30 transition-colors"
          >
            <Check className="w-3.5 h-3.5" />
            Approve
          </button>
          <button
            onClick={handleBulkDelete}
            disabled={isBulkActioning}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 text-red-400 border border-red-500/20 rounded text-sm hover:bg-red-500/20 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="ml-auto text-sm text-text-muted hover:text-text-primary"
          >
            Clear
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-bg-secondary border border-border rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <RefreshCw className="w-5 h-5 animate-spin text-text-muted" />
          </div>
        ) : deviceList.length === 0 ? (
          <div className="p-12 text-center">
            <Monitor className="w-10 h-10 mx-auto mb-3 text-text-muted opacity-50" />
            <p className="text-text-muted">No devices found</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {isAdmin() && (
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.size === deviceList.length && deviceList.length > 0}
                      onChange={selectAll}
                      className="rounded"
                    />
                  </th>
                )}
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Device</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide hidden md:table-cell">OS</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide hidden lg:table-cell">Metrics</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide hidden md:table-cell">Last seen</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {deviceList.map((device) => (
                <tr key={device.id} className="hover:bg-bg-tertiary transition-colors">
                  {isAdmin() && (
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(device.id)}
                        onChange={() => toggleSelect(device.id)}
                        className="rounded"
                        onClick={(e) => e.stopPropagation()}
                      />
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <Link to={`/devices/${device.id}`} className="flex items-center gap-2.5 group">
                      <OsIcon osType={device.osType} className="w-4 h-4 text-text-muted shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-text-primary group-hover:text-accent truncate">
                          {device.displayName || device.hostname}
                        </p>
                        <p className="text-xs text-text-muted truncate">
                          {device.ipLocal ?? device.ipPublic ?? '—'}
                        </p>
                      </div>
                    </Link>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className="text-xs text-text-muted">{device.osName ?? device.osType}</span>
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    <DeviceMetricsBar metrics={device.latestMetrics} compact />
                  </td>
                  <td className="px-4 py-3">
                    <DeviceStatusBadge status={device.status} size="sm" />
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className="text-xs text-text-muted">
                      {device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString() : '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Link to={`/devices/${device.id}`} className="p-1 text-text-muted hover:text-text-primary transition-colors">
                      <ChevronRight className="w-4 h-4" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
