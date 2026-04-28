import { create } from 'zustand';

interface UiState {
  sidebarOpen: boolean;
  sidebarWidth: number;
  sidebarFloating: boolean;
  /** Obli Design v1: sidebar shrinks to 64 px icon-only column instead of
   *  hiding entirely. Persisted so the choice survives reloads + cross-app
   *  navigation (every Obli* uses the same key per the design spec). */
  sidebarCollapsed: boolean;
  addAgentModalOpen: boolean;

  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarWidth: (width: number) => void;
  toggleSidebarFloating: () => void;
  toggleSidebarCollapsed: () => void;
  openAddAgentModal: () => void;
  closeAddAgentModal: () => void;
}

const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 600;
const STORAGE_KEY_WIDTH     = 'ov-sidebar-width';
const STORAGE_KEY_FLOATING  = 'ov-sidebar-floating';
const STORAGE_KEY_COLLAPSED = 'obli:sidebar-collapsed';

function loadSavedWidth(): number {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_WIDTH);
    if (saved) {
      const w = parseInt(saved, 10);
      if (!isNaN(w) && w >= MIN_SIDEBAR_WIDTH && w <= MAX_SIDEBAR_WIDTH) return w;
    }
  } catch {
    // localStorage unavailable
  }
  return 280;
}

function loadSavedFloating(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY_FLOATING) === 'true';
  } catch {
    return false;
  }
}
function loadSavedCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY_COLLAPSED) === 'true';
  } catch {
    return false;
  }
}

export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: true,
  sidebarWidth: loadSavedWidth(),
  sidebarFloating: loadSavedFloating(),
  sidebarCollapsed: loadSavedCollapsed(),
  addAgentModalOpen: false,

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  openAddAgentModal: () => set({ addAgentModalOpen: true }),
  closeAddAgentModal: () => set({ addAgentModalOpen: false }),
  toggleSidebarFloating: () => set((s) => {
    const next = !s.sidebarFloating;
    try { localStorage.setItem(STORAGE_KEY_FLOATING, String(next)); } catch { /* ignore */ }
    return { sidebarFloating: next };
  }),
  toggleSidebarCollapsed: () => set((s) => {
    const next = !s.sidebarCollapsed;
    try { localStorage.setItem(STORAGE_KEY_COLLAPSED, String(next)); } catch { /* ignore */ }
    return { sidebarCollapsed: next };
  }),
  setSidebarWidth: (width) => {
    const clamped = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, width));
    try {
      localStorage.setItem(STORAGE_KEY_WIDTH, String(clamped));
    } catch {
      // localStorage unavailable
    }
    set({ sidebarWidth: clamped });
  },
}));
