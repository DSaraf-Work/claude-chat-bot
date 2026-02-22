// Prefixed IDs for readability in logs
export function newEventId(): string {
  return `evt_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`
}
export function newSessionId(): string {
  return `sess_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
}
export function newProjectId(): string {
  return `proj_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
}
export function newRunnerId(): string {
  return `runner_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
}
export function newCorrelationId(): string {
  return `turn_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}
