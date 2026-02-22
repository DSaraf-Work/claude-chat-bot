export interface PtySessionHandle {
  sessionId: string
  projectId: string
  pid: number
  cols: number
  rows: number
  status: 'open' | 'closed'
  // Whether this is a raw pty or tmux-attached pty
  mode: 'raw' | 'tmux'
  tmuxSessionName?: string
}
