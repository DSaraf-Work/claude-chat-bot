import { useSettingsStore } from '../store/settings.store.js'

export function useApi() {
  const { token, runnerUrl } = useSettingsStore()

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  }

  async function get<T>(path: string): Promise<T> {
    const res = await fetch(`${runnerUrl}${path}`, { headers })
    if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`)
    return res.json() as Promise<T>
  }

  async function post<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${runnerUrl}${path}`, {
      method: 'POST',
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: { message?: string } }
      throw new Error(err.error?.message ?? `POST ${path} failed: ${res.status}`)
    }
    return res.json() as Promise<T>
  }

  async function del(path: string): Promise<void> {
    const res = await fetch(`${runnerUrl}${path}`, { method: 'DELETE', headers })
    if (!res.ok && res.status !== 204) throw new Error(`DELETE ${path} failed: ${res.status}`)
  }

  return { get, post, del }
}
