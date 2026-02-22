import { WebSocket } from 'ws'
import type { WsServerMessage } from '@claude-ui/protocol'

export class Broadcaster {
  // sessionId -> Set of WebSocket clients subscribed
  private subscriptions = new Map<string, Set<WebSocket>>()
  // sessionId -> monotonic seq counter
  private seqCounters = new Map<string, number>()

  subscribe(sessionId: string, ws: WebSocket): void {
    if (!this.subscriptions.has(sessionId)) {
      this.subscriptions.set(sessionId, new Set())
    }
    this.subscriptions.get(sessionId)!.add(ws)
  }

  unsubscribe(sessionId: string, ws: WebSocket): void {
    this.subscriptions.get(sessionId)?.delete(ws)
    if (this.subscriptions.get(sessionId)?.size === 0) {
      this.subscriptions.delete(sessionId)
    }
  }

  unsubscribeAll(ws: WebSocket): void {
    for (const [sessionId, clients] of this.subscriptions) {
      clients.delete(ws)
      if (clients.size === 0) this.subscriptions.delete(sessionId)
    }
  }

  nextSeq(sessionId: string): number {
    const next = (this.seqCounters.get(sessionId) ?? 0) + 1
    this.seqCounters.set(sessionId, next)
    return next
  }

  broadcast(sessionId: string, message: WsServerMessage): void {
    const clients = this.subscriptions.get(sessionId)
    if (!clients || clients.size === 0) return
    const json = JSON.stringify(message)
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(json)
      }
    }
  }

  broadcastToAll(message: WsServerMessage): void {
    const json = JSON.stringify(message)
    for (const clients of this.subscriptions.values()) {
      for (const ws of clients) {
        if (ws.readyState === WebSocket.OPEN) ws.send(json)
      }
    }
  }
}

// Singleton -- shared across the process
export const broadcaster = new Broadcaster()
