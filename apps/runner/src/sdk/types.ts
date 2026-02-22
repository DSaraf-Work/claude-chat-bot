import type { Query } from '@anthropic-ai/claude-agent-sdk'

export interface SdkSessionHandle {
  // Our internal session ID (runner-assigned)
  sessionId: string
  projectId: string
  // SDK's own session_id (needed for resume/fork)
  sdkSessionId: string | null // null until system init received
  // The active Query generator for the current turn
  activeQuery: Query | null
  // AbortController for cancelling the current turn
  abortController: AbortController | null
  // Permission mode
  permissionMode: PermissionMode
  status: 'idle' | 'streaming' | 'waiting_approval' | 'ended'
}

export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'
