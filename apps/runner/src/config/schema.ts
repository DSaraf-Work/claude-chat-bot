import { z } from 'zod'

export const RunnerConfigSchema = z.object({
  port: z.number().int().min(1024).max(65535).default(3001),
  host: z.string().default('127.0.0.1'),
  logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),

  auth: z.object({
    // Bearer token for API access. Generated on first run if not set.
    token: z.string().min(32).optional(),
  }).default({}),

  projects: z.object({
    // Directories to scan for git repos
    roots: z.array(z.string()).default([]),
    // Also import from ~/.claude/projects (Claude Code session history)
    importClaudeProjects: z.boolean().default(true),
    // Max depth when scanning roots for git repos
    scanDepth: z.number().int().min(1).max(5).default(3),
  }).default({}),

  anthropic: z.object({
    // Falls back to ANTHROPIC_API_KEY env var
    apiKey: z.string().optional(),
    model: z.string().default('claude-sonnet-4-5'),
  }).default({}),

  db: z.object({
    // Path to SQLite DB file (Phase 0)
    path: z.string().default('~/.claude-ui/runner.db'),
  }).default({}),

  sdk: z.object({
    settingSources: z.array(z.enum(['user', 'project', 'local'])).default(['project']),
    maxTurns: z.number().int().min(1).max(100).default(10),
    allowedTools: z.array(z.string()).optional(),
    model: z.string().default('claude-sonnet-4-5'),
  }).default({}),
})

export type RunnerConfig = z.infer<typeof RunnerConfigSchema>
