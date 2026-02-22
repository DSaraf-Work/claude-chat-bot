import { z } from 'zod'

// ---------------------------------------------------------------------------
// Session events
// ---------------------------------------------------------------------------

export const SessionCreatedPayloadSchema = z.object({
  projectId: z.string(),
  mode: z.enum(['sdk', 'pty']),
  worktree: z.string().optional(),
})

export const SessionResumedPayloadSchema = z.object({
  fromSnapshotId: z.string().optional(),
})

export const SessionForkedPayloadSchema = z.object({
  fromSessionId: z.string(),
  fromSeq: z.number(),
})

export const SessionEndedPayloadSchema = z.object({
  reason: z.enum(['user', 'error', 'timeout']),
})

export const SessionErrorPayloadSchema = z.object({
  code: z.string(),
  message: z.string(),
  stack: z.string().optional(),
})

// ---------------------------------------------------------------------------
// Chat events
// ---------------------------------------------------------------------------

export const UserMessagePayloadSchema = z.object({
  text: z.string(),
  attachments: z.array(z.string()).optional(),
})

export const AssistantDeltaPayloadSchema = z.object({
  delta: z.string(),
  seq: z.number(),
})

export const AssistantMessagePayloadSchema = z.object({
  text: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
})

// ---------------------------------------------------------------------------
// Tool / approval events
// ---------------------------------------------------------------------------

export const ToolRequestedPayloadSchema = z.object({
  toolName: z.string(),
  toolUseId: z.string(),
  input: z.record(z.unknown()),
})

export const ApprovalRequestedPayloadSchema = z.object({
  toolName: z.string(),
  toolUseId: z.string(),
  input: z.record(z.unknown()),
  permissionMode: z.string(),
})

export const ApprovalResolvedPayloadSchema = z.object({
  toolUseId: z.string(),
  decision: z.enum(['allow', 'deny']),
  scope: z.enum(['once', 'session', 'project', 'user']),
  modifiedInput: z.record(z.unknown()).optional(),
})

export const ToolOutputPayloadSchema = z.object({
  toolUseId: z.string(),
  content: z.string(),
  isError: z.boolean(),
})

export const ToolCompletedPayloadSchema = z.object({
  toolUseId: z.string(),
  durationMs: z.number(),
})

// ---------------------------------------------------------------------------
// Slash events
// ---------------------------------------------------------------------------

export const SlashInvokedPayloadSchema = z.object({
  command: z.string(),
  args: z.string(),
})

export const SlashResultPayloadSchema = z.object({
  command: z.string(),
  output: z.string(),
  isError: z.boolean(),
})

// ---------------------------------------------------------------------------
// MCP events
// ---------------------------------------------------------------------------

export const McpStatusPayloadSchema = z.object({
  serverName: z.string(),
  status: z.enum(['connected', 'disconnected', 'error']),
  lastError: z.string().optional(),
})

export const McpOAuthRequiredPayloadSchema = z.object({
  serverName: z.string(),
  authUrl: z.string(),
})

// ---------------------------------------------------------------------------
// PTY events
// ---------------------------------------------------------------------------

export const PtyOpenedPayloadSchema = z.object({
  pid: z.number(),
  cols: z.number(),
  rows: z.number(),
})

export const PtyDataPayloadSchema = z.object({
  data: z.string(),
})

export const PtyClosedPayloadSchema = z.object({
  exitCode: z.number().nullable(),
})

// ---------------------------------------------------------------------------
// Workspace events
// ---------------------------------------------------------------------------

export const FsChangedPayloadSchema = z.object({
  paths: z.array(z.string()),
  changeType: z.enum(['created', 'modified', 'deleted']),
})

export const GitStatusPayloadSchema = z.object({
  branch: z.string(),
  isDirty: z.boolean(),
  ahead: z.number(),
  behind: z.number(),
})

// ---------------------------------------------------------------------------
// Discriminated union event schemas (type + payload)
// ---------------------------------------------------------------------------

const baseEvent = {
  id: z.string(),
  seq: z.number(),
  ts: z.string().datetime(),
  sessionId: z.string(),
  projectId: z.string(),
  runnerId: z.string(),
  mode: z.enum(['sdk', 'pty'] as const),
  correlationId: z.string().optional(),
}

export const SessionCreatedEventSchema = z.object({
  ...baseEvent,
  type: z.literal('session.created'),
  payload: SessionCreatedPayloadSchema,
})

export const SessionResumedEventSchema = z.object({
  ...baseEvent,
  type: z.literal('session.resumed'),
  payload: SessionResumedPayloadSchema,
})

export const SessionForkedEventSchema = z.object({
  ...baseEvent,
  type: z.literal('session.forked'),
  payload: SessionForkedPayloadSchema,
})

export const SessionEndedEventSchema = z.object({
  ...baseEvent,
  type: z.literal('session.ended'),
  payload: SessionEndedPayloadSchema,
})

export const SessionErrorEventSchema = z.object({
  ...baseEvent,
  type: z.literal('session.error'),
  payload: SessionErrorPayloadSchema,
})

export const UserMessageEventSchema = z.object({
  ...baseEvent,
  type: z.literal('user.message'),
  payload: UserMessagePayloadSchema,
})

export const AssistantDeltaEventSchema = z.object({
  ...baseEvent,
  type: z.literal('assistant.delta'),
  payload: AssistantDeltaPayloadSchema,
})

export const AssistantMessageEventSchema = z.object({
  ...baseEvent,
  type: z.literal('assistant.message'),
  payload: AssistantMessagePayloadSchema,
})

export const ToolRequestedEventSchema = z.object({
  ...baseEvent,
  type: z.literal('tool.requested'),
  payload: ToolRequestedPayloadSchema,
})

export const ApprovalRequestedEventSchema = z.object({
  ...baseEvent,
  type: z.literal('approval.requested'),
  payload: ApprovalRequestedPayloadSchema,
})

export const ApprovalResolvedEventSchema = z.object({
  ...baseEvent,
  type: z.literal('approval.resolved'),
  payload: ApprovalResolvedPayloadSchema,
})

export const ToolOutputEventSchema = z.object({
  ...baseEvent,
  type: z.literal('tool.output'),
  payload: ToolOutputPayloadSchema,
})

export const ToolCompletedEventSchema = z.object({
  ...baseEvent,
  type: z.literal('tool.completed'),
  payload: ToolCompletedPayloadSchema,
})

export const SlashInvokedEventSchema = z.object({
  ...baseEvent,
  type: z.literal('slash.invoked'),
  payload: SlashInvokedPayloadSchema,
})

export const SlashResultEventSchema = z.object({
  ...baseEvent,
  type: z.literal('slash.result'),
  payload: SlashResultPayloadSchema,
})

export const McpStatusEventSchema = z.object({
  ...baseEvent,
  type: z.literal('mcp.status'),
  payload: McpStatusPayloadSchema,
})

export const McpOAuthRequiredEventSchema = z.object({
  ...baseEvent,
  type: z.literal('mcp.oauth.required'),
  payload: McpOAuthRequiredPayloadSchema,
})

export const PtyOpenedEventSchema = z.object({
  ...baseEvent,
  type: z.literal('pty.opened'),
  payload: PtyOpenedPayloadSchema,
})

export const PtyDataEventSchema = z.object({
  ...baseEvent,
  type: z.literal('pty.data'),
  payload: PtyDataPayloadSchema,
})

export const PtyClosedEventSchema = z.object({
  ...baseEvent,
  type: z.literal('pty.closed'),
  payload: PtyClosedPayloadSchema,
})

export const FsChangedEventSchema = z.object({
  ...baseEvent,
  type: z.literal('fs.changed'),
  payload: FsChangedPayloadSchema,
})

export const GitStatusEventSchema = z.object({
  ...baseEvent,
  type: z.literal('git.status'),
  payload: GitStatusPayloadSchema,
})

// ---------------------------------------------------------------------------
// Discriminated union of all events
// ---------------------------------------------------------------------------

export const AnyEventSchema = z.discriminatedUnion('type', [
  SessionCreatedEventSchema,
  SessionResumedEventSchema,
  SessionForkedEventSchema,
  SessionEndedEventSchema,
  SessionErrorEventSchema,
  UserMessageEventSchema,
  AssistantDeltaEventSchema,
  AssistantMessageEventSchema,
  ToolRequestedEventSchema,
  ApprovalRequestedEventSchema,
  ApprovalResolvedEventSchema,
  ToolOutputEventSchema,
  ToolCompletedEventSchema,
  SlashInvokedEventSchema,
  SlashResultEventSchema,
  McpStatusEventSchema,
  McpOAuthRequiredEventSchema,
  PtyOpenedEventSchema,
  PtyDataEventSchema,
  PtyClosedEventSchema,
  FsChangedEventSchema,
  GitStatusEventSchema,
])
export type AnyEvent = z.infer<typeof AnyEventSchema>
