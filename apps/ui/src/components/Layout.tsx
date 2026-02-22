import type { ReactNode } from 'react'
import { useConnectionStore } from '../store/connection.store.js'

const statusColors: Record<string, string> = {
  connected: '#22c55e',
  connecting: '#f59e0b',
  disconnected: '#6b7280',
  error: '#ef4444',
}

export function Layout({ children }: { children: ReactNode }) {
  const { status } = useConnectionStore()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'system-ui, sans-serif', background: '#0f172a', color: '#e2e8f0' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 20px', borderBottom: '1px solid #1e293b', background: '#0f172a' }}>
        <span style={{ fontWeight: 700, fontSize: '16px', letterSpacing: '-0.3px' }}>Claude Portable UI</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#94a3b8' }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: statusColors[status] ?? '#6b7280' }} />
          {status}
        </div>
      </header>
      <main style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>{children}</main>
    </div>
  )
}
