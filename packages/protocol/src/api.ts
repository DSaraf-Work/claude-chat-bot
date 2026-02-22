import { z } from 'zod'
import { EventEnvelopeSchema } from './common.js'

// ---------------------------------------------------------------------------
// Common error response
// ---------------------------------------------------------------------------

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string().optional(),
  }),
})
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  gitRemote: z.string().optional(),
  gitBranch: z.string().optional(),
  isDirty: z.boolean(),
  hasClaudeConfig: z.boolean(),
  lastModified: z.string().datetime(),
  sessionCount: z.number(),
})
export type Project = z.infer<typeof ProjectSchema>

export const ListProjectsQuerySchema = z.object({
  search: z.string().optional(),
})

export const AddProjectBodySchema = z.object({
  path: z.string(),
})

export const CloneProjectBodySchema = z.object({
  repoUrl: z.string(),
  targetPath: z.string(),
  branch: z.string().optional(),
})

export const ProjectListResponseSchema = z.object({
  data: z.array(ProjectSchema),
})

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export const SessionSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  mode: z.enum(['sdk', 'pty']),
  status: z.enum(['active', 'paused', 'ended']),
  title: z.string().optional(),
  runnerId: z.string(),
  hasPendingApproval: z.boolean(),
  hasTerminalAttached: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  lastActivityAt: z.string().datetime(),
})
export type Session = z.infer<typeof SessionSchema>

export const ListSessionsQuerySchema = z.object({
  status: z.enum(['active', 'paused', 'ended']).optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
})

export const CreateSessionBodySchema = z.object({
  mode: z.enum(['sdk', 'pty']).default('sdk'),
  title: z.string().optional(),
  forkFromSnapshot: z.string().optional(),
})

export const SendMessageBodySchema = z.object({
  content: z.string().min(1),
  attachments: z
    .array(z.object({ type: z.literal('file'), path: z.string() }))
    .optional(),
})

export const SlashCommandBodySchema = z.object({
  command: z.string(),
  args: z.string().optional(),
})

export const ApproveBodySchema = z.object({
  approvalId: z.string(),
  decision: z.enum(['allow', 'deny']),
  persist: z.boolean(),
  scope: z.enum(['session', 'project', 'user']).optional(),
  modifiedArgs: z.record(z.unknown()).optional(),
})

export const SwitchModeBodySchema = z.object({
  mode: z.enum(['sdk', 'pty']),
  ptyOptions: z
    .object({
      useTmux: z.boolean().optional(),
      cols: z.number().optional(),
      rows: z.number().optional(),
    })
    .optional(),
})

export const TimelineQuerySchema = z.object({
  after_seq: z.coerce.number().optional(),
  limit: z.coerce.number().min(1).max(200).default(50),
  types: z.string().optional(),
})

export const TimelineResponseSchema = z.object({
  data: z.array(EventEnvelopeSchema),
  pagination: z.object({
    nextCursor: z.union([z.string(), z.number()]).nullable().optional(),
    hasMore: z.boolean(),
  }),
})

// ---------------------------------------------------------------------------
// MCP
// ---------------------------------------------------------------------------

export const McpServerSchema = z.object({
  name: z.string(),
  transport: z.enum(['stdio', 'http', 'sse']),
  status: z.enum(['running', 'stopped', 'error']),
  lastError: z.string().optional(),
  config: z.record(z.unknown()),
  tools: z.array(z.string()).optional(),
  prompts: z.array(z.string()).optional(),
  lastHealthCheck: z.string().optional(),
})
export type McpServer = z.infer<typeof McpServerSchema>

export const AddMcpServerBodySchema = z.object({
  name: z.string(),
  transport: z.enum(['stdio', 'http', 'sse']),
  config: z.record(z.unknown()),
})

// ---------------------------------------------------------------------------
// Plugins
// ---------------------------------------------------------------------------

export const PluginSchema = z.object({
  name: z.string(),
  version: z.string(),
  enabled: z.boolean(),
  scope: z.string(),
  capabilities: z.array(z.string()),
  installedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type Plugin = z.infer<typeof PluginSchema>

export const InstallPluginBodySchema = z.object({
  package: z.string(),
})

export const PluginActionBodySchema = z.object({
  name: z.string(),
})

export const EnablePluginBodySchema = z.object({
  name: z.string(),
  scope: z.string().optional(),
})

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const TokenRequestSchema = z.object({
  grantType: z.enum(['password', 'refresh_token']),
  username: z.string().optional(),
  password: z.string().optional(),
  refreshToken: z.string().optional(),
})

export const TokenResponseSchema = z.object({
  data: z.object({
    accessToken: z.string(),
    refreshToken: z.string(),
    expiresIn: z.number(),
    tokenType: z.literal('Bearer'),
  }),
})
