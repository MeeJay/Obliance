import { create } from 'zustand';
import { useIsCoarsePointer, useLayoutMode } from '@/hooks/useMediaQuery';

interface UiState {
  sidebarOpen: boolean;
  sidebarWidth: number;
  sidebarFloating: boolean;
  /** Obli Design v1: sidebar shrinks to 64 px icon-only column instead of
   *  hiding entirely. Persisted so the choice survives reloads + cross-app
   *  navigation (every Obli* uses the same key per the design spec). */
  sidebarCollapsed: boolean;
  /** Off-canvas navigation drawer used below 1024 px (docs/obli-mobile.md §4).
   *  Forced by the layout mode, so it is NEVER persisted. */
  mobileNavOpen: boolean;
  addAgentModalOpen: boolean;

  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarWidth: (width: number) => void;
  toggleSidebarFloating: () => void;
  toggleSidebarCollapsed: () => void;
  setMobileNavOpen: (open: boolean) => void;
  toggleMobileNav: () => void;
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
  mobileNavOpen: false,
  addAgentModalOpen: false,

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setMobileNavOpen: (open) => set({ mobileNavOpen: open }),
  toggleMobileNav: () => set((s) => ({ mobileNavOpen: !s.mobileNavOpen })),
  openAddAgentModal: () => set({ addAgentModalOpen: true }),
  closeAddAgentModal: () => set({ addAgentModalOpen: false }),
  // Floating and collapsed are mutually exclusive — leaving both on makes
  // the AppLayout draw the 260 px floating overlay AND a 64 px sidebar
  // inside it, so the drop-shadow extends to the wrong width. Whenever
  // we toggle one ON, we forcibly turn the other OFF and persist both.
  toggleSidebarFloating: () => set((s) => {
    const next = !s.sidebarFloating;
    try {
      localStorage.setItem(STORAGE_KEY_FLOATING, String(next));
      if (next) localStorage.setItem(STORAGE_KEY_COLLAPSED, 'false');
    } catch { /* ignore */ }
    return { sidebarFloating: next, sidebarCollapsed: next ? false : s.sidebarCollapsed };
  }),
  toggleSidebarCollapsed: () => set((s) => {
    const next = !s.sidebarCollapsed;
    try {
      localStorage.setItem(STORAGE_KEY_COLLAPSED, String(next));
      if (next) localStorage.setItem(STORAGE_KEY_FLOATING, 'false');
    } catch { /* ignore */ }
    return { sidebarCollapsed: next, sidebarFloating: next ? false : s.sidebarFloating };
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

// ── Effective sidebar presentation (docs/obli-mobile.md §4) ─────────────────

export type SidebarPresentation = 'drawer' | 'pinned' | 'collapsed' | 'floating';

export interface EffectiveSidebar {
  presentation: SidebarPresentation;
  /** Below 1024 px: the sidebar lives in an off-canvas Drawer (hamburger). */
  isDrawer: boolean;
  /** Auto-hide (hover strip) mode actually in use. */
  floating: boolean;
  /** 64 px icon rail actually in use. */
  collapsed: boolean;
  /** Mouse resize handles are offered. */
  resizable: boolean;
  /** The Float / Pin toggle is offered (it needs a hovering pointer). */
  canFloat: boolean;
}

/**
 * The sidebar mode the shell must render, derived from the persisted desktop
 * preferences AND the current device. Forced states (drawer below lg, no
 * floating / resizing on a touch screen) are computed here and never written
 * back to localStorage — the stored preferences are shared across Obli apps
 * and must survive a visit from a phone or a tablet untouched.
 */
export function useEffectiveSidebar(): EffectiveSidebar {
  const mode = useLayoutMode();
  const coarse = useIsCoarsePointer();
  const floatingPref = useUiStore((s) => s.sidebarFloating);
  const collapsedPref = useUiStore((s) => s.sidebarCollapsed);

  if (mode !== 'desktop') {
    return {
      presentation: 'drawer',
      isDrawer: true,
      floating: false,
      collapsed: false,
      resizable: false,
      canFloat: false,
    };
  }

  // Floating opens on mouse-enter of an 8 px edge strip: unusable (and in the
  // Android back-gesture zone) on a touch screen → fall back to pinned.
  const floating = floatingPref && !coarse;
  const collapsed = collapsedPref && !floating;
  return {
    presentation: floating ? 'floating' : collapsed ? 'collapsed' : 'pinned',
    isDrawer: false,
    floating,
    collapsed,
    resizable: !coarse && !collapsed,
    canFloat: !coarse,
  };
}
