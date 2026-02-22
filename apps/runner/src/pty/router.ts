import type { FastifyPluginAsync } from 'fastify'
import { ptyAdapter } from './pty-adapter.js'
import { spawnInTmux, killTmuxSession } from './tmux-bridge.js'
import { NotFoundError, ValidationError } from '@claude-ui/shared'
import type { RunnerConfig } from '../config/schema.js'
import { projectStore } from '../sessions/router.js'

interface PtyRouterOpts {
  config: RunnerConfig
}

const ptyRouter: FastifyPluginAsync<PtyRouterOpts> = async (fastify, _opts) => {
  // POST /api/v1/projects/:projectId/pty-sessions -- create PTY session
  fastify.post<{
    Params: { projectId: string }
    Body: { cols?: number; rows?: number; useTmux?: boolean; command?: string }
  }>(
    '/api/v1/projects/:projectId/pty-sessions',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { projectId } = request.params
      const project = projectStore.get(projectId)
      if (!project) throw new NotFoundError('Project', projectId)

      const { cols = 220, rows = 50, useTmux = false, command = 'claude' } = request.body ?? {}

      let handle
      if (useTmux) {
        handle = await spawnInTmux(
          `sess_pty_${Date.now()}`,
          projectId,
          project.path,
          { cols, rows, command },
        )
      } else {
        const sessionId = `sess_pty_${Date.now()}`
        handle = ptyAdapter.spawn(sessionId, projectId, project.path, {
          cols,
          rows,
          shell: command === 'claude' ? process.env['SHELL'] ?? '/bin/zsh' : command,
        })
      }

      await reply.code(201).send({
        sessionId: handle.sessionId,
        projectId,
        mode: 'pty',
        pid: handle.pid,
        cols: handle.cols,
        rows: handle.rows,
        tmuxSession: handle.tmuxSessionName,
      })
    },
  )

  // POST /api/v1/pty-sessions/:sessionId/resize
  fastify.post<{
    Params: { sessionId: string }
    Body: { cols: number; rows: number }
  }>(
    '/api/v1/pty-sessions/:sessionId/resize',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { sessionId } = request.params
      const { cols, rows } = request.body
      if (!cols || !rows) throw new ValidationError('cols and rows are required')

      const handle = ptyAdapter.getHandle(sessionId)
      if (!handle) throw new NotFoundError('PTY session', sessionId)

      ptyAdapter.resize(sessionId, cols, rows)
      await reply.send({ sessionId, cols, rows })
    },
  )

  // DELETE /api/v1/pty-sessions/:sessionId
  fastify.delete<{ Params: { sessionId: string } }>(
    '/api/v1/pty-sessions/:sessionId',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { sessionId } = request.params
      const handle = ptyAdapter.getHandle(sessionId)

      if (handle?.tmuxSessionName) {
        await killTmuxSession(handle.tmuxSessionName)
      }
      ptyAdapter.kill(sessionId)

      await reply.code(204).send()
    },
  )

  // GET /api/v1/projects/:projectId/pty-sessions
  fastify.get<{ Params: { projectId: string } }>(
    '/api/v1/projects/:projectId/pty-sessions',
    { preHandler: [fastify.authenticate] },
    async (request) => {
      const sessions = ptyAdapter.listSessions(request.params.projectId)
      return { sessions }
    },
  )
}

export default ptyRouter
