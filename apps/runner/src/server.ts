import Fastify from 'fastify'
import { createLogger } from '@claude-ui/shared'
import type { RunnerConfig } from './config/schema.js'
import authPlugin from './auth/middleware.js'
import projectsRouter from './projects/router.js'
import sessionsRouter from './sessions/router.js'
import ptyRouter from './pty/router.js'
import { attachWebSocketServer } from './ws/server.js'
import { ptyAdapter } from './pty/pty-adapter.js'

export async function buildServer(config: RunnerConfig) {
  const logger = createLogger({ name: 'runner', level: config.logLevel })

  // Warm up node-pty native addon so the first real spawn doesn't fail.
  // posix_spawnp can fail on the very first call; pre-initializing the addon prevents this.
  try {
    const warmUpId = '__warmup__'
    ptyAdapter.spawn(warmUpId, '__warmup_project__', '/tmp')
    ptyAdapter.kill(warmUpId)
    logger.debug('node-pty warm-up complete')
  } catch (err) {
    logger.warn({ err }, 'node-pty warm-up failed (non-fatal)')
  }

  const fastify = Fastify({
    logger: false, // we use our own pino instance
  })

  // Allow DELETE (and other methods) to send Content-Type: application/json
  // with an empty body without triggering FST_ERR_CTP_EMPTY_JSON_BODY.
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    function (_req, body, done) {
      if (body === '' || body === null || body === undefined) {
        done(null, undefined)
        return
      }
      try {
        done(null, JSON.parse(body as string))
      } catch (err) {
        done(err as Error, undefined)
      }
    },
  )

  // Health check (no auth)
  fastify.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }))

  // Auth plugin
  await fastify.register(authPlugin, { token: config.auth.token! })

  // Routes
  await fastify.register(projectsRouter, { config, logger })
  await fastify.register(sessionsRouter, { config })
  await fastify.register(ptyRouter, { config })

  // WebSocket server (token auth on HTTP upgrade)
  const wss = attachWebSocketServer(fastify, config.auth.token!)

  return { fastify, logger, wss }
}
