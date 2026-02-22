import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { RunnerConfigSchema, type RunnerConfig } from './schema.js'

const CONFIG_DIR = path.join(os.homedir(), '.claude-ui')
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')

function expandHome(p: string): string {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p
}

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

export function loadConfig(): RunnerConfig {
  // Ensure config dir exists
  fs.mkdirSync(CONFIG_DIR, { recursive: true })

  // Read existing config or start empty
  let raw: Record<string, unknown> = {}
  if (fs.existsSync(CONFIG_FILE)) {
    raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) as Record<string, unknown>
  }

  // Env var overlays (explicit env always wins)
  if (process.env['ANTHROPIC_API_KEY']) {
    const anthropic = (raw['anthropic'] as Record<string, unknown> | undefined) ?? {}
    raw['anthropic'] = { ...anthropic, apiKey: process.env['ANTHROPIC_API_KEY'] }
  }
  if (process.env['RUNNER_PORT']) {
    raw['port'] = parseInt(process.env['RUNNER_PORT'], 10)
  }
  if (process.env['LOG_LEVEL']) {
    raw['logLevel'] = process.env['LOG_LEVEL']
  }

  // Parse and validate
  const parsed = RunnerConfigSchema.parse(raw)

  // Generate token on first run and persist
  if (!parsed.auth.token) {
    parsed.auth.token = generateToken()
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ ...raw, auth: { token: parsed.auth.token } }, null, 2))
    console.log(`[claude-ui] Generated auth token. Config saved to ${CONFIG_FILE}`)
    console.log(`[claude-ui] Bearer token: ${parsed.auth.token}`)
  }

  // Expand ~ in paths
  parsed.db.path = expandHome(parsed.db.path)

  return parsed
}

export { CONFIG_DIR, CONFIG_FILE }
