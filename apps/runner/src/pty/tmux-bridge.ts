import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createLogger } from '@claude-ui/shared'
import { ptyAdapter } from './pty-adapter.js'
import type { PtySessionHandle } from './types.js'

const execFileAsync = promisify(execFile)
const logger = createLogger({ name: 'pty:tmux' })

async function tmuxSessionExists(name: string): Promise<boolean> {
  try {
    await execFileAsync('tmux', ['has-session', '-t', name])
    return true
  } catch {
    return false
  }
}

export async function spawnInTmux(
  sessionId: string,
  projectId: string,
  projectPath: string,
  opts: { cols?: number; rows?: number; command?: string } = {},
): Promise<PtySessionHandle> {
  const tmuxSessionName = `claude-ui-${sessionId.slice(0, 12)}`
  const command = opts.command ?? 'claude'

  const exists = await tmuxSessionExists(tmuxSessionName)

  // Spawn the PTY process running tmux
  const handle = ptyAdapter.spawn(sessionId, projectId, projectPath, {
    ...(opts.cols != null ? { cols: opts.cols } : {}),
    ...(opts.rows != null ? { rows: opts.rows } : {}),
    shell: 'tmux',
    args: exists
      ? ['attach-session', '-t', tmuxSessionName]
      : ['new-session', '-s', tmuxSessionName, command],
  })

  handle.mode = 'tmux'
  handle.tmuxSessionName = tmuxSessionName

  logger.info({ sessionId, tmuxSessionName, exists }, exists ? 'Attached to tmux' : 'Created tmux session')
  return handle
}

export async function killTmuxSession(tmuxSessionName: string): Promise<void> {
  try {
    await execFileAsync('tmux', ['kill-session', '-t', tmuxSessionName])
  } catch {
    // already gone
  }
}
