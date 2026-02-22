import pino from 'pino'

export interface LoggerOptions {
  name: string
  level?: string
  pretty?: boolean
}

export function createLogger(opts: LoggerOptions): pino.Logger {
  const usePretty = opts.pretty ?? process.env['NODE_ENV'] !== 'production'
  const base: pino.LoggerOptions = {
    name: opts.name,
    level: opts.level ?? process.env['LOG_LEVEL'] ?? 'info',
  }
  if (usePretty) {
    base.transport = { target: 'pino-pretty', options: { colorize: true } }
  }
  return pino(base)
}

export type Logger = pino.Logger
