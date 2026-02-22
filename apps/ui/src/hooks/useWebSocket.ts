import { useEffect, useRef, useCallback } from 'react'
import { useConnectionStore } from '../store/connection.store.js'
import { useTimelineStore } from '../store/timeline.store.js'
import { useSettingsStore } from '../store/settings.store.js'
import { RUNNER_WS_URL } from '../config.js'

const PING_INTERVAL_MS = 25_000
const BASE_RECONNECT_MS = 1_000
const MAX_RECONNECT_MS = 30_000

function backoff(attempt: number): number {
  return Math.min(BASE_RECONNECT_MS * 2 ** attempt, MAX_RECONNECT_MS)
}

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)
  const subscribedSessions = useRef<Set<string>>(new Set())

  const { setStatus, incrementReconnect, resetReconnect, reconnectAttempts } = useConnectionStore()
  const { appendDelta, commitStreaming, appendEvent, setPendingApproval } = useTimelineStore()
  const { token } = useSettingsStore()

  const connect = useCallback(() => {
    if (!token) return
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    setStatus('connecting')
    const ws = new WebSocket(`${RUNNER_WS_URL}/?token=${encodeURIComponent(token)}`)
    wsRef.current = ws

    ws.onopen = () => {
      if (!mountedRef.current) { ws.close(); return }
      setStatus('connected')
      resetReconnect()

      // Re-subscribe to all sessions after reconnect
      for (const sessionId of subscribedSessions.current) {
        ws.send(JSON.stringify({ type: 'subscribe', sessionId }))
      }

      // Ping keepalive
      pingRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping', ts: new Date().toISOString() }))
        }
      }, PING_INTERVAL_MS)
    }

    ws.onmessage = (e: MessageEvent) => {
      let msg: { type: string; event?: { type: string; sessionId: string; payload: Record<string, unknown>; id: string; ts: string; seq: number }; seq?: number }
      try {
        msg = JSON.parse(e.data as string) as typeof msg
      } catch {
        return
      }

      if (msg.type === 'pong') return // keepalive ack

      if (msg.type === 'event' && msg.event) {
        const evt = msg.event
        const { sessionId, type: evtType, payload } = evt

        switch (evtType) {
          case 'assistant.delta':
            appendDelta(sessionId, (payload['delta'] as string) ?? '')
            break

          case 'assistant.message':
            commitStreaming(sessionId)
            appendEvent(sessionId, { id: evt.id, type: evtType, ts: evt.ts, payload, seq: evt.seq })
            break

          case 'approval.requested':
            setPendingApproval(sessionId, evt as Parameters<typeof setPendingApproval>[1])
            appendEvent(sessionId, { id: evt.id, type: evtType, ts: evt.ts, payload, seq: evt.seq })
            break

          case 'approval.resolved':
            setPendingApproval(sessionId, null)
            appendEvent(sessionId, { id: evt.id, type: evtType, ts: evt.ts, payload, seq: evt.seq })
            break

          default:
            appendEvent(sessionId, { id: evt.id, type: evtType, ts: evt.ts, payload, seq: evt.seq })
        }
      }
    }

    ws.onclose = () => {
      if (pingRef.current) clearInterval(pingRef.current)
      if (!mountedRef.current) return
      setStatus('disconnected')
      // Exponential backoff reconnect
      const delay = backoff(reconnectAttempts)
      incrementReconnect()
      reconnectRef.current = setTimeout(() => {
        if (mountedRef.current) connect()
      }, delay)
    }

    ws.onerror = () => {
      setStatus('error', 'WebSocket error')
    }
  }, [token, reconnectAttempts, setStatus, resetReconnect, incrementReconnect, appendDelta, commitStreaming, appendEvent, setPendingApproval])

  useEffect(() => {
    mountedRef.current = true
    connect()
    return () => {
      mountedRef.current = false
      if (pingRef.current) clearInterval(pingRef.current)
      if (reconnectRef.current) clearTimeout(reconnectRef.current)
      wsRef.current?.close()
    }
  }, [connect])

  const subscribe = useCallback((sessionId: string) => {
    subscribedSessions.current.add(sessionId)
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'subscribe', sessionId }))
    }
  }, [])

  const unsubscribe = useCallback((sessionId: string) => {
    subscribedSessions.current.delete(sessionId)
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'unsubscribe', sessionId }))
    }
  }, [])

  const sendPtyStdin = useCallback((sessionId: string, data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'pty.stdin', sessionId, data }))
    }
  }, [])

  return { subscribe, unsubscribe, sendPtyStdin }
}
