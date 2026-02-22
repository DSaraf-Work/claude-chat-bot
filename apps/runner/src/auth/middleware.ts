import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import fp from 'fastify-plugin'
import { UnauthorizedError } from '@claude-ui/shared'

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

const authPlugin: FastifyPluginAsync<{ token: string }> = async (fastify, opts) => {
  fastify.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization
    if (!header || !header.startsWith('Bearer ')) {
      const err = new UnauthorizedError('Bearer token required')
      await reply.code(401).send({ error: { code: err.code, message: err.message } })
      return
    }
    const token = header.slice(7)
    if (token !== opts.token) {
      const err = new UnauthorizedError('Invalid token')
      await reply.code(401).send({ error: { code: err.code, message: err.message } })
      return
    }
  })
}

export default fp(authPlugin, { name: 'auth' })
