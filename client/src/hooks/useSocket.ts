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
    socket.on(SocketEvents.DEVICE_UPDATED, (data: { device: Device }) => {
      updateDevice(data.device.id, data.device);
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
      socket.off(SocketEvents.GROUP_CREATED);
      socket.off(SocketEvents.GROUP_UPDATED);
      socket.off(SocketEvents.GROUP_DELETED);
      socket.off(SocketEvents.GROUP_MOVED);
    };
  }, [user, addDevice, updateDevice, updateDeviceMetrics, removeDevice, fetchSummary, addGroup, updateGroup, removeGroup, fetchTree, isNativeApp]);
}
