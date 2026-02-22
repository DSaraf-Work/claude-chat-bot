import { createLogger, newEventId } from '@claude-ui/shared'
import { broadcaster } from '../ws/broadcaster.js'

const logger = createLogger({ name: 'sdk:tool-approval' })

type PermissionResult =
  | { behavior: 'allow'; updatedInput: Record<string, unknown> }
  | { behavior: 'deny'; message: string; interrupt?: boolean }

export type ApprovalScope = 'once' | 'session' | 'project' | 'user'

interface StoredRule {
  decision: 'allow' | 'deny'
  scope: ApprovalScope
  toolName: string
  projectId?: string | undefined
  sessionId?: string | undefined
}

interface PendingApproval {
  resolve: (result: PermissionResult) => void
  reject: (err: Error) => void
  timeoutHandle: ReturnType<typeof setTimeout>
}

const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

export class ToolApproval {
  private pending = new Map<string, PendingApproval>()
  private rules: StoredRule[] = []

  private findRule(
    sessionId: string,
    projectId: string,
    toolName: string,
  ): StoredRule | undefined {
    // Most-specific match wins: session > project > user
    return (
      this.rules.find(
        (r) => r.toolName === toolName && r.scope === 'session' && r.sessionId === sessionId,
      ) ??
      this.rules.find(
        (r) => r.toolName === toolName && r.scope === 'project' && r.projectId === projectId,
      ) ??
      this.rules.find((r) => r.toolName === toolName && r.scope === 'user')
    )
  }

  /** Called by SDK's canUseTool callback -- suspends the agent loop */
  async evaluate(
    sessionId: string,
    projectId: string,
    toolName: string,
    input: Record<string, unknown>,
    options: { signal: AbortSignal },
  ): Promise<PermissionResult> {
    const rule = this.findRule(sessionId, projectId, toolName)
    if (rule) {
      logger.debug(
        { sessionId, toolName, decision: rule.decision, scope: rule.scope },
        'Rule match',
      )
      if (rule.decision === 'allow') return { behavior: 'allow', updatedInput: input }
      return { behavior: 'deny', message: `Denied by ${rule.scope} rule` }
    }

    return this.requestApproval(sessionId, projectId, toolName, input, options.signal)
  }

  private requestApproval(
    sessionId: string,
    projectId: string,
    toolName: string,
    input: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<PermissionResult> {
    const toolUseId = newEventId()
    const runnerId = `runner_${process.pid}`

    // Emit approval.requested over WebSocket
    const seq = broadcaster.nextSeq(sessionId)
    broadcaster.broadcast(sessionId, {
      type: 'event',
      seq,
      event: {
        id: newEventId(),
        type: 'approval.requested',
        ts: new Date().toISOString(),
        sessionId,
        projectId,
        runnerId,
        mode: 'sdk' as const,
        seq,
        payload: { toolName, toolUseId, input, permissionMode: 'default' },
      },
    })

    return new Promise<PermissionResult>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.pending.delete(toolUseId)
        logger.warn({ sessionId, toolName, toolUseId }, 'Approval timed out -- auto-denying')
        resolve({ behavior: 'deny', message: 'Approval timed out' })
      }, APPROVAL_TIMEOUT_MS)

      // Clean up if SDK aborts
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timeoutHandle)
          this.pending.delete(toolUseId)
          reject(new Error('AbortError'))
        },
        { once: true },
      )

      this.pending.set(toolUseId, { resolve, reject, timeoutHandle })
    })
  }

  /** Called by POST /sessions/:id/approve HTTP handler */
  resolve(
    toolUseId: string,
    decision: 'allow' | 'deny',
    scope: ApprovalScope,
    sessionId: string,
    projectId: string,
    toolName: string,
    modifiedInput?: Record<string, unknown>,
  ): boolean {
    const pending = this.pending.get(toolUseId)
    if (!pending) return false

    clearTimeout(pending.timeoutHandle)
    this.pending.delete(toolUseId)

    // Persist rule if not 'once'
    if (scope !== 'once') {
      this.rules.push({
        decision,
        scope,
        toolName,
        sessionId: scope === 'session' ? sessionId : undefined,
        projectId: scope === 'project' ? projectId : undefined,
      })
    }

    if (decision === 'allow') {
      pending.resolve({ behavior: 'allow', updatedInput: modifiedInput ?? {} })
    } else {
      pending.resolve({ behavior: 'deny', message: 'User denied this action' })
    }
    return true
  }

  /** Remove all rules for a given session (cleanup on session end) */
  clearSessionRules(sessionId: string): void {
    this.rules = this.rules.filter(
      (r) => !(r.scope === 'session' && r.sessionId === sessionId),
    )
  }
}

export const toolApproval = new ToolApproval()
