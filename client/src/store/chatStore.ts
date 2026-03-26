import { create } from 'zustand';

export interface ChatMessage {
  sender: string;
  text: string;
  timestamp: number;
  isSystem?: boolean;
}

export interface ChatSession {
  /** Unique key for this tab (e.g. `${deviceUuid}:${sessionId}`) */
  key: string;
  deviceUuid: string;
  deviceName: string;
  sessionId?: number;
  chatId: string | null;
  messages: ChatMessage[];
  isConnected: boolean;
  userClosed: boolean;
  /** Unread count (incremented when tab is not active) */
  unread: number;
}

interface ChatState {
  /** All open chat sessions (tabs) */
  sessions: ChatSession[];
  /** Key of the currently active tab */
  activeKey: string | null;
  /** Whether the chat window is visible */
  isOpen: boolean;
  /** Whether the chat window is minimized (FAB only) */
  isMinimized: boolean;
  /** Sound enabled globally */
  soundEnabled: boolean;

  // ── Actions ──
  openChat: (deviceUuid: string, deviceName: string, sessionId?: number) => void;
  closeTab: (key: string) => void;
  setActiveTab: (key: string) => void;
  toggleOpen: () => void;
  setMinimized: (v: boolean) => void;
  toggleSound: () => void;
  setChatId: (key: string, chatId: string) => void;
  setConnected: (key: string, connected: boolean) => void;
  setUserClosed: (key: string, closed: boolean) => void;
  addMessage: (key: string, msg: ChatMessage) => void;
  clearUnread: (key: string) => void;

  /** Close everything */
  closeAll: () => void;
}

function makeKey(deviceUuid: string, sessionId?: number): string {
  return sessionId ? `${deviceUuid}:${sessionId}` : deviceUuid;
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessions: [],
  activeKey: null,
  isOpen: false,
  isMinimized: false,
  soundEnabled: true,

  openChat: (deviceUuid, deviceName, sessionId) => {
    const key = makeKey(deviceUuid, sessionId);
    const { sessions } = get();
    const existing = sessions.find(s => s.key === key);
    if (existing) {
      // Already open — just switch to it
      set({ activeKey: key, isOpen: true, isMinimized: false });
      return;
    }
    const newSession: ChatSession = {
      key,
      deviceUuid,
      deviceName,
      sessionId,
      chatId: null,
      messages: [],
      isConnected: false,
      userClosed: false,
      unread: 0,
    };
    set(s => ({
      sessions: [...s.sessions, newSession],
      activeKey: key,
      isOpen: true,
      isMinimized: false,
    }));
  },

  closeTab: (key) => {
    set(s => {
      const sessions = s.sessions.filter(ss => ss.key !== key);
      let activeKey = s.activeKey;
      if (activeKey === key) {
        activeKey = sessions.length > 0 ? sessions[sessions.length - 1].key : null;
      }
      return {
        sessions,
        activeKey,
        isOpen: sessions.length > 0 ? s.isOpen : false,
        isMinimized: sessions.length > 0 ? s.isMinimized : false,
      };
    });
  },

  setActiveTab: (key) => set({ activeKey: key }),

  toggleOpen: () => set(s => ({ isOpen: !s.isOpen, isMinimized: false })),

  setMinimized: (v) => set({ isMinimized: v }),

  toggleSound: () => set(s => ({ soundEnabled: !s.soundEnabled })),

  setChatId: (key, chatId) => set(s => ({
    sessions: s.sessions.map(ss => ss.key === key ? { ...ss, chatId } : ss),
  })),

  setConnected: (key, connected) => set(s => ({
    sessions: s.sessions.map(ss => ss.key === key ? { ...ss, isConnected: connected } : ss),
  })),

  setUserClosed: (key, closed) => set(s => ({
    sessions: s.sessions.map(ss => ss.key === key ? { ...ss, userClosed: closed } : ss),
  })),

  addMessage: (key, msg) => set(s => {
    const isActive = s.activeKey === key && s.isOpen && !s.isMinimized;
    return {
      sessions: s.sessions.map(ss =>
        ss.key === key
          ? { ...ss, messages: [...ss.messages, msg], unread: isActive ? 0 : ss.unread + (msg.isSystem ? 0 : 1) }
          : ss
      ),
    };
  }),

  clearUnread: (key) => set(s => ({
    sessions: s.sessions.map(ss => ss.key === key ? { ...ss, unread: 0 } : ss),
  })),

  closeAll: () => set({ sessions: [], activeKey: null, isOpen: false, isMinimized: false }),
}));
