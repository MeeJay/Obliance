import { create } from 'zustand';
import type { Device, DeviceStatus, FleetSummary, DeviceMetrics } from '@obliance/shared';
import { deviceApi } from '../api/device.api';

interface DeviceStore {
  devices: Map<number, Device>;
  summary: FleetSummary | null;
  isLoading: boolean;

  // Actions
  fetchDevices: (params?: { groupId?: number; status?: string; search?: string }) => Promise<void>;
  fetchSummary: () => Promise<void>;
  fetchDevice: (id: number) => Promise<Device | null>;
  addDevice: (device: Device) => void;
  updateDevice: (id: number, data: Partial<Device>) => void;
  updateDeviceMetrics: (id: number, metrics: DeviceMetrics) => void;
  removeDevice: (id: number) => void;

  // Getters
  getDevice: (id: number) => Device | undefined;
  getDeviceList: () => Device[];
  getDevicesByGroup: (groupId: number | null) => Device[];
  getDevicesByStatus: (status: DeviceStatus) => Device[];
}

export const useDeviceStore = create<DeviceStore>((set, get) => ({
  devices: new Map(),
  summary: null,
  isLoading: false,

  fetchDevices: async (params) => {
    set({ isLoading: true });
    try {
      const list = await deviceApi.list(params);
      const devices = new Map<number, Device>();
      list.forEach((d) => devices.set(d.id, d));
      set({ devices, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  fetchSummary: async () => {
    try {
      const summary = await deviceApi.getSummary();
      set({ summary });
    } catch { /* ignore */ }
  },

  fetchDevice: async (id) => {
    try {
      const device = await deviceApi.getById(id);
      set((state) => {
        const devices = new Map(state.devices);
        devices.set(device.id, device);
        return { devices };
      });
      return device;
    } catch { return null; }
  },

  addDevice: (device) => {
    set((state) => {
      const devices = new Map(state.devices);
      devices.set(device.id, device);
      return { devices };
    });
  },

  updateDevice: (id, data) => {
    set((state) => {
      const devices = new Map(state.devices);
      const existing = devices.get(id);
      if (existing) devices.set(id, { ...existing, ...data });
      return { devices };
    });
  },

  updateDeviceMetrics: (id, metrics) => {
    set((state) => {
      const devices = new Map(state.devices);
      const existing = devices.get(id);
      if (existing) devices.set(id, { ...existing, latestMetrics: metrics });
      return { devices };
    });
  },

  removeDevice: (id) => {
    set((state) => {
      const devices = new Map(state.devices);
      devices.delete(id);
      return { devices };
    });
  },

  getDevice: (id) => get().devices.get(id),
  getDeviceList: () => Array.from(get().devices.values()),
  getDevicesByGroup: (groupId) => Array.from(get().devices.values()).filter((d) => d.groupId === groupId),
  getDevicesByStatus: (status) => Array.from(get().devices.values()).filter((d) => d.status === status),
}));
