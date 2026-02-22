import * as pty from 'node-pty'
import { createLogger, newEventId } from '@claude-ui/shared'
import { broadcaster } from '../ws/broadcaster.js'
import type { PtySessionHandle } from './types.js'
import type { EventEnvelope } from '@claude-ui/protocol'

const logger = createLogger({ name: 'pty:adapter' })

const RUNNER_ID = `runner_${process.pid}`

export class PtyAdapter {
  private ptySessions = new Map<string, { ptyProcess: pty.IPty; handle: PtySessionHandle }>()

  spawn(
    sessionId: string,
    projectId: string,
    projectPath: string,
    opts: { cols?: number; rows?: number; shell?: string; args?: string[] } = {},
  ): PtySessionHandle {
    const cols = opts.cols ?? 220
    const rows = opts.rows ?? 50
    const shell = opts.shell ?? process.env['SHELL'] ?? '/bin/zsh'
    const args = opts.args ?? []

    const ptyProcess = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: projectPath,
      env: { ...process.env } as Record<string, string>,
    })

    const handle: PtySessionHandle = {
      sessionId,
      projectId,
      pid: ptyProcess.pid,
      cols,
      rows,
      status: 'open',
      mode: 'raw',
    }

    // Stream PTY output -> pty.data events over WebSocket
    ptyProcess.onData((data: string) => {
      const seq = broadcaster.nextSeq(sessionId)
      const envelope: EventEnvelope = {
        id: newEventId(),
        type: 'pty.data',
        ts: new Date().toISOString(),
        sessionId,
        projectId,
        runnerId: RUNNER_ID,
        mode: 'pty',
        seq,
        payload: { data: Buffer.from(data).toString('base64') },
      }
      broadcaster.broadcast(sessionId, { type: 'event', event: envelope, seq })
    })

    ptyProcess.onExit(({ exitCode, signal }) => {
      handle.status = 'closed'
      logger.info({ sessionId, exitCode, signal }, 'PTY process exited')

      const seq = broadcaster.nextSeq(sessionId)
      const envelope: EventEnvelope = {
        id: newEventId(),
        type: 'pty.closed',
        ts: new Date().toISOString(),
        sessionId,
        projectId,
        runnerId: RUNNER_ID,
        mode: 'pty',
        seq,
        payload: { exitCode: exitCode ?? null },
      }
      broadcaster.broadcast(sessionId, { type: 'event', event: envelope, seq })
      this.ptySessions.delete(sessionId)
    })

    this.ptySessions.set(sessionId, { ptyProcess, handle })

    // Emit pty.opened event
    const seq = broadcaster.nextSeq(sessionId)
    const openedEnvelope: EventEnvelope = {
      id: newEventId(),
      type: 'pty.opened',
      ts: new Date().toISOString(),
      sessionId,
      projectId,
      runnerId: RUNNER_ID,
      mode: 'pty',
      seq,
      payload: { pid: ptyProcess.pid, cols, rows },
    }
    broadcaster.broadcast(sessionId, { type: 'event', event: openedEnvelope, seq })

    logger.info({ sessionId, pid: ptyProcess.pid, cols, rows }, 'PTY spawned')
    return handle
  }

  write(sessionId: string, data: string): void {
    const session = this.ptySessions.get(sessionId)
    if (!session || session.handle.status !== 'open') return
    session.ptyProcess.write(data)
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.ptySessions.get(sessionId)
    if (!session || session.handle.status !== 'open') return
    session.ptyProcess.resize(cols, rows)
    session.handle.cols = cols
    session.handle.rows = rows
  }

  kill(sessionId: string): void {
    const session = this.ptySessions.get(sessionId)
    if (!session) return
    try {
      session.ptyProcess.kill()
    } catch {
      // process may already be dead
    }
    this.ptySessions.delete(sessionId)
  }

  getHandle(sessionId: string): PtySessionHandle | undefined {
    return this.ptySessions.get(sessionId)?.handle
  }

  listSessions(projectId?: string): PtySessionHandle[] {
    const all = Array.from(this.ptySessions.values()).map((s) => s.handle)
    return projectId ? all.filter((h) => h.projectId === projectId) : all
  }
}

export const ptyAdapter = new PtyAdapter()
