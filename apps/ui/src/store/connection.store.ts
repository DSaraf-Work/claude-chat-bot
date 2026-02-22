import { create } from 'zustand'

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

interface ConnectionState {
  status: ConnectionStatus
  error: string | null
  reconnectAttempts: number
  setStatus: (status: ConnectionStatus, error?: string | null) => void
  incrementReconnect: () => void
  resetReconnect: () => void
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  status: 'disconnected',
  error: null,
  reconnectAttempts: 0,
  setStatus: (status, error = null) => set({ status, error }),
  incrementReconnect: () => set((s) => ({ reconnectAttempts: s.reconnectAttempts + 1 })),
  resetReconnect: () => set({ reconnectAttempts: 0 }),
}))
