import { WebSocketServer } from 'ws'
import type { FastifyInstance } from 'fastify'
import { createLogger } from '@claude-ui/shared'
import { handleConnection } from './connection.js'

const logger = createLogger({ name: 'ws:server' })

export function attachWebSocketServer(fastify: FastifyInstance, token: string): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true })

  // Intercept HTTP upgrade requests for WebSocket
  fastify.server.on('upgrade', (request, socket, head) => {
    // Auth via ?token= query param
    const url = new URL(request.url ?? '', 'http://localhost')
    const providedToken = url.searchParams.get('token')

    if (providedToken !== token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      logger.warn('WebSocket connection rejected -- invalid token')
      return
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request)
    })
  })

  wss.on('connection', (ws) => {
    logger.debug('New WebSocket connection')
    handleConnection(ws)
  })

  wss.on('error', (err) => {
    logger.error({ err }, 'WebSocket server error')
  })

  return wss
}
