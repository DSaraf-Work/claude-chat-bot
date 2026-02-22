import type { FastifyPluginAsync } from 'fastify'
import { sessionManager } from '../sdk/session-manager.js'
import { toolApproval } from '../sdk/tool-approval.js'
import { NotFoundError, ValidationError } from '@claude-ui/shared'
import type { RunnerConfig } from '../config/schema.js'

// Simple in-memory project store (replaced by DB in M1)
const projectStore = new Map<string, { id: string; path: string; name: string }>()

interface SessionsRouterOpts {
  config: RunnerConfig
}

const sessionsRouter: FastifyPluginAsync<SessionsRouterOpts> = async (fastify, opts) => {
  // POST /api/v1/projects/:projectId/sessions -- create session
  fastify.post<{
    Params: { projectId: string }
    Body: { permissionMode?: string }
  }>(
    '/api/v1/projects/:projectId/sessions',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { projectId } = request.params
      const project = projectStore.get(projectId)
      if (!project) throw new NotFoundError('Project', projectId)

      const permissionMode = (request.body?.permissionMode ?? 'default') as
        | 'default'
        | 'acceptEdits'
        | 'bypassPermissions'
        | 'plan'
      const sessionId = sessionManager.create({
        projectId,
        projectPath: project.path,
        permissionMode,
        config: opts.config,
      })

      await reply.code(201).send({ sessionId, projectId, mode: 'sdk', status: 'idle' })
    },
  )

  // GET /api/v1/projects/:projectId/sessions
  fastify.get<{ Params: { projectId: string } }>(
    '/api/v1/projects/:projectId/sessions',
    { preHandler: [fastify.authenticate] },
    async (request) => {
      const sessions = sessionManager.listSessions(request.params.projectId)
      return {
        sessions: sessions.map(({ sessionId, projectId, permissionMode, status, sdkSessionId }) => ({
          sessionId, projectId, permissionMode, status, sdkSessionId,
        })),
      }
    },
  )

  // POST /api/v1/sessions/:sessionId/send -- send a message
  fastify.post<{
    Params: { sessionId: string }
    Body: { text: string }
  }>(
    '/api/v1/sessions/:sessionId/send',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { sessionId } = request.params
      const { text } = request.body
      if (!text?.trim()) throw new ValidationError('text is required')

      const handle = sessionManager.getHandle(sessionId)
      if (!handle) throw new NotFoundError('Session', sessionId)

      const project = projectStore.get(handle.projectId)
      if (!project) throw new NotFoundError('Project', handle.projectId)

      // Fire-and-forget -- stream events go over WebSocket
      void sessionManager.sendMessage(
        sessionId,
        text,
        project.path,
        opts.config,
        (toolName, input, { signal }) =>
          toolApproval.evaluate(
            sessionId,
            handle.projectId,
            toolName,
            input as Record<string, unknown>,
            { signal },
          ),
      )

      await reply.code(202).send({ status: 'streaming', sessionId })
    },
  )

  // POST /api/v1/sessions/:sessionId/approve -- resolve pending approval
  fastify.post<{
    Params: { sessionId: string }
    Body: {
      toolUseId: string
      decision: 'allow' | 'deny'
      scope?: 'once' | 'session' | 'project' | 'user'
      toolName: string
      modifiedInput?: Record<string, unknown>
    }
  }>(
    '/api/v1/sessions/:sessionId/approve',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { sessionId } = request.params
      const { toolUseId, decision, scope = 'once', toolName, modifiedInput } = request.body

      const handle = sessionManager.getHandle(sessionId)
      if (!handle) throw new NotFoundError('Session', sessionId)

      const resolved = toolApproval.resolve(
        toolUseId,
        decision,
        scope,
        sessionId,
        handle.projectId,
        toolName,
        modifiedInput,
      )

      if (!resolved) {
        await reply.code(404).send({
          error: {
            code: 'NOT_FOUND',
            message: `No pending approval for toolUseId: ${toolUseId}`,
          },
        })
        return
      }

      await reply.send({ status: 'resolved', decision, scope })
    },
  )

  // DELETE /api/v1/sessions/:sessionId -- end/cancel session
  fastify.delete<{ Params: { sessionId: string } }>(
    '/api/v1/sessions/:sessionId',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { sessionId } = request.params
      toolApproval.clearSessionRules(sessionId)
      sessionManager.end(sessionId)
      await reply.code(204).send()
    },
  )
}

export default sessionsRouter
export { projectStore }
