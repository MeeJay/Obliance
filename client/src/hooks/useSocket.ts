import { useEffect } from 'react';
import { getSocket } from '../socket/socketClient';
import { useDeviceStore } from '../store/deviceStore';
import { useGroupStore } from '../store/groupStore';
import { useAuthStore } from '../store/authStore';
import { useLiveAlertsStore } from '../store/liveAlertsStore';
import { SocketEvents } from '@obliance/shared';
import type { Device, DeviceMetrics, DeviceGroup, LiveAlert } from '@obliance/shared';

/** Notify the native desktop app overlay (if running inside Electron). */
function notifyNative(type: 'device_alert' | 'device_ok' | 'device_critical') {
  window.dispatchEvent(new CustomEvent('obliance:notify', { detail: { type } }));
}

export function useSocket() {
  const { user } = useAuthStore();
  const { addDevice, updateDevice, updateDeviceMetrics, removeDevice, fetchSummary } = useDeviceStore();
  const { addGroup, updateGroup, removeGroup, fetchTree } = useGroupStore();

  const isNativeApp = typeof window !== 'undefined' &&
    !!(window as Window & { __obliance_is_native_app?: boolean }).__obliance_is_native_app;

  useEffect(() => {
    if (!user) return;

    const socket = getSocket();
    if (!socket) return;

    // ── Live alerts (notifications) ────────────────────────────────────────────
    socket.on(SocketEvents.NOTIFICATION_NEW, (alert: LiveAlert) => {
      useLiveAlertsStore.getState().addAlertFromServer(alert);
    });

    // ── Device lifecycle ───────────────────────────────────────────────────────
    // The server emits DEVICE_UPDATED with multiple payload shapes depending
    // on the originating code path. Accept them all:
    //   1. { device: Device }                 — full device wrapper
    //   2. Device                             — full device object
    //   3. { id|deviceId, ...partial fields } — partial patch
    socket.on(SocketEvents.DEVICE_UPDATED, (data: any) => {
      if (!data) return;
      if (data.device && typeof data.device === 'object' && data.device.id) {
        updateDevice(data.device.id, data.device);
        return;
      }
      const id: number | undefined = data.id ?? data.deviceId;
      if (!id || typeof id !== 'number') return;
      // Strip the id keys from the patch; keep everything else.
      const { id: _id, deviceId: _deviceId, ...patch } = data;
      // If the payload looks like a full device (has hostname + uuid), take it as-is.
      // Otherwise treat it as a partial.
      updateDevice(id, patch);
    });

    socket.on(SocketEvents.DEVICE_METRICS_PUSHED, (data: { deviceId: number; metrics: DeviceMetrics }) => {
      updateDeviceMetrics(data.deviceId, data.metrics);
    });

    socket.on(SocketEvents.DEVICE_ONLINE, (data: { deviceId: number; device?: Partial<Device> }) => {
      if (data.device) {
        updateDevice(data.deviceId, { ...data.device, status: 'online' });
      } else {
        updateDevice(data.deviceId, { status: 'online' });
      }
      fetchSummary();

      if (isNativeApp) notifyNative('device_ok');
    });

    socket.on(SocketEvents.DEVICE_OFFLINE, (data: { deviceId: number; device?: Partial<Device> }) => {
      if (data.device) {
        updateDevice(data.deviceId, { ...data.device, status: 'offline' });
      } else {
        updateDevice(data.deviceId, { status: 'offline' });
      }
      fetchSummary();

      if (isNativeApp) notifyNative('device_alert');

      // Auto-expand the device's group in the sidebar when it goes offline
      const store = useDeviceStore.getState();
      const device = store.getDevice(data.deviceId);
      if (device?.groupId) {
        useGroupStore.getState().expandGroup(device.groupId);
        useGroupStore.getState().expandAncestors(device.groupId);
      }
    });

    socket.on(SocketEvents.DEVICE_APPROVED, (data: { device: Device }) => {
      addDevice(data.device);
      fetchSummary();
    });

    socket.on(SocketEvents.DEVICE_DELETED, (data: { deviceId: number }) => {
      removeDevice(data.deviceId);
      fetchSummary();
    });

    // ── Custom metrics ─────────────────────────────────────────────────────────
    // Update the device row in the store so any rendered grid / detail page
    // refreshes its metric chips without a manual reload.
    socket.on('CUSTOM_METRIC_UPDATED', (data: { deviceId: number; scheduleId: number; name?: string; value?: string; unit?: string | null; status?: string }) => {
      if (!data?.deviceId || !data?.scheduleId) return;
      const store = useDeviceStore.getState();
      const dev = store.devices.get(data.deviceId);
      if (!dev) return;
      const list = ((dev as any).customMetrics ?? []) as Array<{ scheduleId: number; name: string; value: string; unit: string | null; status: string }>;
      const idx = list.findIndex((m) => m.scheduleId === data.scheduleId);
      let next = list.slice();
      if (idx >= 0) {
        next[idx] = {
          ...next[idx],
          name: data.name ?? next[idx].name,
          value: data.value ?? next[idx].value,
          unit: data.unit ?? next[idx].unit,
          status: data.status ?? next[idx].status,
        };
      } else if (data.name && data.value !== undefined) {
        next.push({
          scheduleId: data.scheduleId,
          name: data.name,
          value: data.value,
          unit: data.unit ?? null,
          status: data.status ?? 'ok',
        });
      }
      updateDevice(data.deviceId, { customMetrics: next } as any);
    });

    // ── Group events ───────────────────────────────────────────────────────────
    socket.on(SocketEvents.GROUP_CREATED, (data: { group: DeviceGroup }) => {
      addGroup(data.group);
      fetchTree();
    });
    socket.on(SocketEvents.GROUP_UPDATED, (data: { group: DeviceGroup }) => {
      updateGroup(data.group.id, data.group);
      fetchTree();
    });
    socket.on(SocketEvents.GROUP_DELETED, (data: { groupId: number }) => {
      removeGroup(data.groupId);
      fetchTree();
    });
    socket.on(SocketEvents.GROUP_MOVED, (data: { group: DeviceGroup }) => {
      updateGroup(data.group.id, data.group);
      fetchTree();
    });

    return () => {
      socket.off(SocketEvents.NOTIFICATION_NEW);
      socket.off(SocketEvents.DEVICE_UPDATED);
      socket.off(SocketEvents.DEVICE_METRICS_PUSHED);
      socket.off(SocketEvents.DEVICE_ONLINE);
      socket.off(SocketEvents.DEVICE_OFFLINE);
      socket.off(SocketEvents.DEVICE_APPROVED);
      socket.off(SocketEvents.DEVICE_DELETED);
      socket.off('CUSTOM_METRIC_UPDATED');
      socket.off(SocketEvents.GROUP_CREATED);
      socket.off(SocketEvents.GROUP_UPDATED);
      socket.off(SocketEvents.GROUP_DELETED);
      socket.off(SocketEvents.GROUP_MOVED);
    };
  }, [user, addDevice, updateDevice, updateDeviceMetrics, removeDevice, fetchSummary, addGroup, updateGroup, removeGroup, fetchTree, isNativeApp]);
}
