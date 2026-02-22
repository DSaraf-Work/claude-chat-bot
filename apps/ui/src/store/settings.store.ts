import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { TOKEN_STORAGE_KEY } from '../config.js'

interface SettingsState {
  token: string
  runnerUrl: string
  setToken: (token: string) => void
  setRunnerUrl: (url: string) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      token: '',
      runnerUrl: 'http://localhost:3001',
      setToken: (token) => set({ token }),
      setRunnerUrl: (url) => set({ runnerUrl: url }),
    }),
    { name: TOKEN_STORAGE_KEY },
  ),
)
