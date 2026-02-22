import { create } from 'zustand'
import type { EventEnvelope } from '@claude-ui/protocol'

export interface TimelineEvent {
  id: string
  type: string
  ts: string
  payload: Record<string, unknown>
  seq: number
}

// In-progress streaming message (deltas accumulate here)
export interface StreamingMessage {
  sessionId: string
  text: string
  startedAt: string
}

interface TimelineState {
  // sessionId → ordered events
  events: Record<string, TimelineEvent[]>
  // sessionId → current streaming text
  streaming: Record<string, StreamingMessage | null>
  // sessionId → pending approval event
  pendingApproval: Record<string, EventEnvelope | null>

  appendEvent: (sessionId: string, event: TimelineEvent) => void
  appendDelta: (sessionId: string, delta: string) => void
  commitStreaming: (sessionId: string) => void
  setPendingApproval: (sessionId: string, event: EventEnvelope | null) => void
  clearTimeline: (sessionId: string) => void
}

export const useTimelineStore = create<TimelineState>((set) => ({
  events: {},
  streaming: {},
  pendingApproval: {},

  appendEvent: (sessionId, event) =>
    set((s) => ({
      events: {
        ...s.events,
        [sessionId]: [...(s.events[sessionId] ?? []), event],
      },
    })),

  appendDelta: (sessionId, delta) =>
    set((s) => {
      const current = s.streaming[sessionId]
      return {
        streaming: {
          ...s.streaming,
          [sessionId]: current
            ? { ...current, text: current.text + delta }
            : { sessionId, text: delta, startedAt: new Date().toISOString() },
        },
      }
    }),

  commitStreaming: (sessionId) =>
    set((s) => ({
      streaming: { ...s.streaming, [sessionId]: null },
    })),

  setPendingApproval: (sessionId, event) =>
    set((s) => ({
      pendingApproval: { ...s.pendingApproval, [sessionId]: event },
    })),

  clearTimeline: (sessionId) =>
    set((s) => ({
      events: { ...s.events, [sessionId]: [] },
      streaming: { ...s.streaming, [sessionId]: null },
      pendingApproval: { ...s.pendingApproval, [sessionId]: null },
    })),
}))
