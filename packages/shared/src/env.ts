export function requireEnv(key: string): string {
  const val = process.env[key]
  if (val === undefined || val === '') {
    throw new Error(`Required environment variable '${key}' is not set`)
  }
  return val
}

export function getEnv(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue
}

export function getEnvInt(key: string, defaultValue: number): number {
  const val = process.env[key]
  if (val === undefined) return defaultValue
  const n = parseInt(val, 10)
  if (isNaN(n)) throw new Error(`Environment variable '${key}' must be an integer, got: '${val}'`)
  return n
}
