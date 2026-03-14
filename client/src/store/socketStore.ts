import { create } from 'zustand';

export type SocketStatus = 'connected' | 'disconnected' | 'reconnecting';

interface SocketState {
  status: SocketStatus;
  setStatus: (status: SocketStatus) => void;
}

export const useSocketStore = create<SocketState>((set) => ({
  status: 'disconnected',
  setStatus: (status) => set({ status }),
}));
