import { WebSocket } from 'ws'
import { WsClientMessageSchema } from '@claude-ui/protocol'
import { createLogger } from '@claude-ui/shared'
import { broadcaster } from './broadcaster.js'

const logger = createLogger({ name: 'ws:connection' })

export function handleConnection(ws: WebSocket): void {
  ws.on('message', (data) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(data.toString())
    } catch {
      ws.send(JSON.stringify({ type: 'error', code: 'PARSE_ERROR', message: 'Invalid JSON' }))
      return
    }

    const result = WsClientMessageSchema.safeParse(parsed)
    if (!result.success) {
      ws.send(JSON.stringify({ type: 'error', code: 'INVALID_MESSAGE', message: result.error.message }))
      return
    }

    const msg = result.data
    switch (msg.type) {
      case 'subscribe': {
        broadcaster.subscribe(msg.sessionId, ws)
        const ack = {
          type: 'ack' as const,
          subscribedSessionId: msg.sessionId,
          currentSeq: 0, // TODO: return actual seq from event store in M1
        }
        ws.send(JSON.stringify(ack))
        logger.debug({ sessionId: msg.sessionId }, 'Client subscribed')
        break
      }
      case 'unsubscribe': {
        broadcaster.unsubscribe(msg.sessionId, ws)
        logger.debug({ sessionId: msg.sessionId }, 'Client unsubscribed')
        break
      }
      case 'ping': {
        ws.send(JSON.stringify({ type: 'pong', ts: msg.ts }))
        break
      }
    }
  })

  ws.on('close', () => {
    broadcaster.unsubscribeAll(ws)
    logger.debug('Client disconnected')
  })

  ws.on('error', (err) => {
    logger.warn({ err }, 'WebSocket error')
    broadcaster.unsubscribeAll(ws)
  })
}
