import { create } from 'zustand';
import type { Command } from '@obliance/shared';
import { commandApi } from '../api/command.api';

interface CommandStore {
  // Commands keyed by device ID
  commandsByDevice: Map<number, Command[]>;
  isLoading: boolean;

  fetchDeviceCommands: (deviceId: number) => Promise<void>;
  addCommand: (command: Command) => void;
  updateCommand: (commandId: string, data: Partial<Command>) => void;

  getDeviceCommands: (deviceId: number) => Command[];
  getPendingCount: (deviceId: number) => number;
}

export const useCommandStore = create<CommandStore>((set, get) => ({
  commandsByDevice: new Map(),
  isLoading: false,

  fetchDeviceCommands: async (deviceId) => {
    set({ isLoading: true });
    try {
      const result = await commandApi.list(deviceId);
      set((state) => {
        const map = new Map(state.commandsByDevice);
        map.set(deviceId, result.items);
        return { commandsByDevice: map, isLoading: false };
      });
    } catch {
      set({ isLoading: false });
    }
  },

  addCommand: (command) => {
    set((state) => {
      const map = new Map(state.commandsByDevice);
      const existing = map.get(command.deviceId) ?? [];
      map.set(command.deviceId, [command, ...existing]);
      return { commandsByDevice: map };
    });
  },

  updateCommand: (commandId, data) => {
    set((state) => {
      const map = new Map(state.commandsByDevice);
      for (const [deviceId, cmds] of map) {
        const idx = cmds.findIndex((c) => c.id === commandId);
        if (idx !== -1) {
          const updated = [...cmds];
          updated[idx] = { ...updated[idx], ...data };
          map.set(deviceId, updated);
          break;
        }
      }
      return { commandsByDevice: map };
    });
  },

  getDeviceCommands: (deviceId) => get().commandsByDevice.get(deviceId) ?? [],
  getPendingCount: (deviceId) => {
    const cmds = get().commandsByDevice.get(deviceId) ?? [];
    return cmds.filter((c) => c.status === 'pending' || c.status === 'sent' || c.status === 'ack_running').length;
  },
}));
