import { create } from 'zustand';

export type ShellProtocol = 'ssh' | 'cmd' | 'powershell';
export type ShellStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

/**
 * A single remote shell session. The terminal (xterm), fitAddon and
 * WebSocket live on `GlobalShellPanel`'s ref maps rather than in the store
 * (zustand doesn't like class instances) — the store only holds the
 * metadata needed to render the tab list and status chips.
 */
export interface ShellSession {
  /** Stable id for the tab — equals sessionToken. */
  id: string;
  deviceId: number;
  deviceName: string;
  protocol: ShellProtocol;
  sessionToken: string;
  /** remote_sessions.id (UUID) — needed to call /api/remote/sessions/:id/end
   *  when the user closes the tab. Different from `sessionToken`,
   *  which is the long random string used by the tunnel WS. We plumb
   *  both because the panel renders one shell per token but the REST
   *  layer keys by UUID. Optional for backwards compat — sessions
   *  created from older code paths that didn't pass it just rely on
   *  the server's WS-close handler to clean up. */
  serverSessionId?: string;
  status: ShellStatus;
  errorMsg: string;
  createdAt: number;
}

interface State {
  sessions: ShellSession[];
  activeId: string | null;
  /** true = panel visible, false = minimized to floating pill */
  isOpen: boolean;
  /**
   * Ids grouped via Ctrl+Click on tabs. When the active tab is in this
   * set and the set has >= 2 members, the panel tiles all grouped
   * terminals in a grid simultaneously. Selecting a non-grouped tab
   * falls back to single-view for that one tab (the group persists).
   */
  groupedIds: string[];
}

interface Actions {
  addSession: (s: Omit<ShellSession, 'status' | 'errorMsg' | 'createdAt'>) => void;
  removeSession: (id: string) => void;
  setActive: (id: string | null) => void;
  setStatus: (id: string, status: ShellStatus, errorMsg?: string) => void;
  toggleOpen: () => void;
  setOpen: (v: boolean) => void;
  toggleGrouped: (id: string) => void;
  clearGroup: () => void;
  clearAll: () => void;
}

export const useRemoteShellStore = create<State & Actions>((set) => ({
  sessions: [],
  activeId: null,
  isOpen: true,
  groupedIds: [],

  addSession: (s) => set((st) => ({
    sessions: [
      ...st.sessions,
      { ...s, status: 'connecting', errorMsg: '', createdAt: Date.now() },
    ],
    activeId: s.id,
    isOpen: true,
  })),

  removeSession: (id) => set((st) => {
    const next = st.sessions.filter((x) => x.id !== id);
    let nextActive = st.activeId;
    if (st.activeId === id) {
      nextActive = next.length > 0 ? next[next.length - 1].id : null;
    }
    return {
      sessions: next,
      activeId: nextActive,
      groupedIds: st.groupedIds.filter((g) => g !== id),
    };
  }),

  setActive: (id) => set({ activeId: id }),

  setStatus: (id, status, errorMsg = '') => set((st) => ({
    sessions: st.sessions.map((s) => s.id === id ? { ...s, status, errorMsg } : s),
  })),

  toggleOpen: () => set((st) => ({ isOpen: !st.isOpen })),
  setOpen: (v) => set({ isOpen: v }),

  toggleGrouped: (id) => set((st) => {
    if (st.groupedIds.includes(id)) {
      return { groupedIds: st.groupedIds.filter((g) => g !== id) };
    }
    return { groupedIds: [...st.groupedIds, id] };
  }),

  clearGroup: () => set({ groupedIds: [] }),

  clearAll: () => set({ sessions: [], activeId: null, isOpen: false, groupedIds: [] }),
}));
