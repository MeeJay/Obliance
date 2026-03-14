import { create } from 'zustand';
import type { Script, ScriptCategory, ScriptSchedule } from '@obliance/shared';
import { scriptApi } from '../api/script.api';

interface ScriptStore {
  scripts: Map<number, Script>;
  categories: ScriptCategory[];
  schedules: Map<number, ScriptSchedule>;
  isLoading: boolean;

  fetchScripts: (params?: { categoryId?: number; platform?: string; search?: string }) => Promise<void>;
  fetchCategories: () => Promise<void>;
  fetchSchedules: (params?: { scriptId?: number }) => Promise<void>;
  addScript: (script: Script) => void;
  updateScript: (id: number, data: Partial<Script>) => void;
  removeScript: (id: number) => void;
  addSchedule: (schedule: ScriptSchedule) => void;
  updateSchedule: (id: number, data: Partial<ScriptSchedule>) => void;
  removeSchedule: (id: number) => void;

  getScript: (id: number) => Script | undefined;
  getScriptList: () => Script[];
  getScheduleList: () => ScriptSchedule[];
}

export const useScriptStore = create<ScriptStore>((set, get) => ({
  scripts: new Map(),
  categories: [],
  schedules: new Map(),
  isLoading: false,

  fetchScripts: async (params) => {
    set({ isLoading: true });
    try {
      const list = await scriptApi.list(params);
      const scripts = new Map<number, Script>();
      list.forEach((s) => scripts.set(s.id, s));
      set({ scripts, isLoading: false });
    } catch { set({ isLoading: false }); }
  },

  fetchCategories: async () => {
    try {
      const categories = await scriptApi.listCategories();
      set({ categories });
    } catch { /* ignore */ }
  },

  fetchSchedules: async (params) => {
    try {
      const list = await scriptApi.listSchedules(params);
      const schedules = new Map<number, ScriptSchedule>();
      list.forEach((s) => schedules.set(s.id, s));
      set({ schedules });
    } catch { /* ignore */ }
  },

  addScript: (script) => set((state) => { const scripts = new Map(state.scripts); scripts.set(script.id, script); return { scripts }; }),
  updateScript: (id, data) => set((state) => { const scripts = new Map(state.scripts); const e = scripts.get(id); if (e) scripts.set(id, { ...e, ...data }); return { scripts }; }),
  removeScript: (id) => set((state) => { const scripts = new Map(state.scripts); scripts.delete(id); return { scripts }; }),
  addSchedule: (schedule) => set((state) => { const schedules = new Map(state.schedules); schedules.set(schedule.id, schedule); return { schedules }; }),
  updateSchedule: (id, data) => set((state) => { const schedules = new Map(state.schedules); const e = schedules.get(id); if (e) schedules.set(id, { ...e, ...data }); return { schedules }; }),
  removeSchedule: (id) => set((state) => { const schedules = new Map(state.schedules); schedules.delete(id); return { schedules }; }),

  getScript: (id) => get().scripts.get(id),
  getScriptList: () => Array.from(get().scripts.values()),
  getScheduleList: () => Array.from(get().schedules.values()),
}));
