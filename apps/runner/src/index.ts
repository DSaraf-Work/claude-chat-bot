import { loadConfig } from './config/loader.js'
import { buildServer } from './server.js'

async function main() {
  const config = loadConfig()
  const { fastify, logger } = await buildServer(config)

  await fastify.listen({ port: config.port, host: config.host })
  logger.info({ port: config.port, host: config.host }, 'Runner started')
}

main().catch((err: unknown) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
