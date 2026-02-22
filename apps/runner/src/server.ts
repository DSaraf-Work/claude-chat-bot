import Fastify from 'fastify'
import { createLogger } from '@claude-ui/shared'
import type { RunnerConfig } from './config/schema.js'
import authPlugin from './auth/middleware.js'
import projectsRouter from './projects/router.js'

export async function buildServer(config: RunnerConfig) {
  const logger = createLogger({ name: 'runner', level: config.logLevel })

  const fastify = Fastify({
    logger: false, // we use our own pino instance
  })

  // Health check (no auth)
  fastify.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }))

  // Auth plugin
  await fastify.register(authPlugin, { token: config.auth.token! })

  // Routes
  await fastify.register(projectsRouter, { config, logger })

  return { fastify, logger }
}
