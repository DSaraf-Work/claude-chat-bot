import { create } from 'zustand'

export interface Session {
  sessionId: string
  projectId: string
  permissionMode: string
  status: string
  sdkSessionId: string | null
  mode: 'sdk' | 'pty'
}

interface SessionState {
  sessions: Record<string, Session>  // sessionId → Session
  activeSessionId: string | null
  upsertSession: (session: Session) => void
  setActiveSession: (sessionId: string | null) => void
  removeSession: (sessionId: string) => void
}

export const useSessionStore = create<SessionState>((set) => ({
  sessions: {},
  activeSessionId: null,
  upsertSession: (session) =>
    set((s) => ({ sessions: { ...s.sessions, [session.sessionId]: session } })),
  setActiveSession: (sessionId) => set({ activeSessionId: sessionId }),
  removeSession: (sessionId) =>
    set((s) => {
      const { [sessionId]: _, ...rest } = s.sessions
      return { sessions: rest }
    }),
}))
