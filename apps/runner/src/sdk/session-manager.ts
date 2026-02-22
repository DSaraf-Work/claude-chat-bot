import { query } from '@anthropic-ai/claude-agent-sdk'
import type { Query } from '@anthropic-ai/claude-agent-sdk'
import { createLogger, newSessionId, newCorrelationId } from '@claude-ui/shared'
import { adaptSdkMessage, emitEvent } from './stream-adapter.js'
import type { SdkSessionHandle, PermissionMode } from './types.js'
import type { RunnerConfig } from '../config/schema.js'

const logger = createLogger({ name: 'sdk:session-manager' })

const RUNNER_ID = `runner_${process.pid}`

export interface CreateSessionOpts {
  projectId: string
  projectPath: string
  permissionMode?: PermissionMode
  config: RunnerConfig
  canUseTool?: (toolName: string, input: unknown, opts: { signal: AbortSignal }) => Promise<unknown>
}

export class SessionManager {
  private sessions = new Map<string, SdkSessionHandle>()

  create(opts: CreateSessionOpts): string {
    const sessionId = newSessionId()
    const handle: SdkSessionHandle = {
      sessionId,
      projectId: opts.projectId,
      sdkSessionId: null,
      activeQuery: null,
      abortController: null,
      permissionMode: opts.permissionMode ?? 'default',
      status: 'idle',
    }
    this.sessions.set(sessionId, handle)
    return sessionId
  }

  getHandle(sessionId: string): SdkSessionHandle | undefined {
    return this.sessions.get(sessionId)
  }

  async sendMessage(
    sessionId: string,
    text: string,
    projectPath: string,
    config: RunnerConfig,
    canUseTool: (toolName: string, input: unknown, opts: { signal: AbortSignal }) => Promise<unknown>,
  ): Promise<void> {
    const handle = this.sessions.get(sessionId)
    if (!handle) throw new Error(`Session ${sessionId} not found`)
    if (handle.status === 'streaming') throw new Error(`Session ${sessionId} is already streaming`)

    const abortController = new AbortController()
    handle.abortController = abortController
    handle.status = 'streaming'

    const ctx = {
      sessionId,
      projectId: handle.projectId,
      runnerId: RUNNER_ID,
      correlationId: newCorrelationId(),
    }

    try {
      const queryOpts = {
        prompt: text,
        options: {
          cwd: projectPath,
          permissionMode: handle.permissionMode,
          settingSources: config.sdk?.settingSources ?? ['project'],
          includePartialMessages: true,
          maxTurns: config.sdk?.maxTurns ?? 10,
          ...(handle.sdkSessionId ? { resume: handle.sdkSessionId } : {}),
          canUseTool,
          hooks: {
            PostToolUse: [{
              hooks: [async (input: unknown) => {
                const post = input as { tool_name: string; tool_response: string }
                emitEvent(ctx, 'tool.output', {
                  toolName: post.tool_name,
                  content: post.tool_response,
                  isError: false,
                })
                return {}
              }],
            }],
          },
        },
      }

      const queryGen = query(queryOpts) as Query

      handle.activeQuery = queryGen

      for await (const msg of queryGen) {
        adaptSdkMessage(msg, ctx, (sdkId) => {
          handle.sdkSessionId = sdkId
          this.sessions.set(sessionId, handle)
        })
      }
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') {
        logger.info({ sessionId }, 'Session turn aborted')
        emitEvent(ctx, 'session.error', { code: 'aborted', message: 'Turn cancelled by user' })
      } else {
        logger.error({ err, sessionId }, 'SDK stream error')
        emitEvent(ctx, 'session.error', { code: 'stream_error', message: String(err) })
      }
    } finally {
      handle.status = 'idle'
      handle.activeQuery = null
      handle.abortController = null
    }
  }

  interrupt(sessionId: string): void {
    const handle = this.sessions.get(sessionId)
    if (!handle?.abortController) return
    handle.abortController.abort()
  }

  end(sessionId: string): void {
    this.interrupt(sessionId)
    this.sessions.delete(sessionId)
  }

  listSessions(projectId?: string): SdkSessionHandle[] {
    const all = Array.from(this.sessions.values())
    return projectId ? all.filter((s) => s.projectId === projectId) : all
  }
}

export const sessionManager = new SessionManager()
