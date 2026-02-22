import { useState } from 'react'
import type { EventEnvelope } from '@claude-ui/protocol'
import { useApi } from '../hooks/useApi.js'

interface ApprovalModalProps {
  sessionId: string
  approval: EventEnvelope
  onResolved: () => void
}

export function ApprovalModal({ sessionId, approval, onResolved }: ApprovalModalProps) {
  const api = useApi()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const payload = approval.payload as { toolName?: string; toolUseId?: string; input?: Record<string, unknown> }
  const toolName = payload.toolName ?? 'unknown'
  const toolUseId = payload.toolUseId ?? ''
  const input = payload.input ?? {}

  async function handleDecision(decision: 'allow' | 'deny') {
    setLoading(true)
    setError(null)
    try {
      await api.post(`/api/v1/sessions/${sessionId}/approve`, {
        toolUseId,
        decision,
        scope: 'once',
        toolName,
      })
      onResolved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#1e293b', borderRadius: '8px', border: '1px solid #334155', padding: '24px', maxWidth: '480px', width: '100%', color: '#e2e8f0' }}>
        <h2 style={{ margin: '0 0 16px', fontSize: '18px', fontWeight: 600 }}>Tool Approval Required</h2>

        <div style={{ marginBottom: '12px' }}>
          <span style={{ fontFamily: 'monospace', fontSize: '13px', background: '#334155', padding: '4px 8px', borderRadius: '4px', color: '#93c5fd' }}>
            {toolName}
          </span>
        </div>

        <pre style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '4px', padding: '12px', fontSize: '12px', fontFamily: 'monospace', overflowY: 'auto', maxHeight: '200px', margin: '0 0 16px', color: '#cbd5e1', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {JSON.stringify(input, null, 2)}
        </pre>

        {error != null && (
          <div style={{ marginBottom: '12px', padding: '8px 12px', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid #ef4444', borderRadius: '4px', color: '#fca5a5', fontSize: '13px' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          <button
            disabled={loading}
            onClick={() => void handleDecision('deny')}
            style={{ padding: '8px 20px', borderRadius: '6px', border: 'none', cursor: loading ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: '14px', background: '#dc2626', color: '#fff', opacity: loading ? 0.6 : 1 }}
          >
            Deny
          </button>
          <button
            disabled={loading}
            onClick={() => void handleDecision('allow')}
            style={{ padding: '8px 20px', borderRadius: '6px', border: 'none', cursor: loading ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: '14px', background: '#16a34a', color: '#fff', opacity: loading ? 0.6 : 1 }}
          >
            Allow
          </button>
        </div>
      </div>
    </div>
  )
}
