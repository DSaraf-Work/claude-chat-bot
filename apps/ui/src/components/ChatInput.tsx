import { useState, useCallback } from 'react'
import type { KeyboardEvent } from 'react'
import { useApi } from '../hooks/useApi.js'

interface ChatInputProps {
  sessionId: string
  disabled?: boolean
}

export function ChatInput({ sessionId, disabled }: ChatInputProps) {
  const api = useApi()
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isDisabled = disabled === true || sending

  const handleSend = useCallback(async () => {
    const trimmed = text.trim()
    if (trimmed === '' || isDisabled) return

    setSending(true)
    setError(null)
    try {
      await api.post(`/api/v1/sessions/${sessionId}/send`, { text: trimmed })
      setText('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message')
    } finally {
      setSending(false)
    }
  }, [text, isDisabled, api, sessionId])

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  return (
    <div style={{ borderTop: '1px solid #334155', background: '#1e293b', padding: '12px 16px' }}>
      {error != null && (
        <div style={{ marginBottom: '8px', padding: '6px 10px', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid #ef4444', borderRadius: '4px', color: '#fca5a5', fontSize: '13px' }}>
          {error}
        </div>
      )}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
        <textarea
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isDisabled}
          placeholder={isDisabled ? 'Waiting...' : 'Send a message...'}
          style={{
            flex: 1,
            resize: 'vertical',
            background: '#0f172a',
            color: '#e2e8f0',
            border: '1px solid #334155',
            borderRadius: '6px',
            padding: '10px 12px',
            fontSize: '14px',
            fontFamily: 'system-ui, sans-serif',
            lineHeight: '1.5',
            outline: 'none',
            opacity: isDisabled ? 0.6 : 1,
          }}
        />
        <button
          disabled={isDisabled || text.trim() === ''}
          onClick={() => void handleSend()}
          style={{
            padding: '10px 20px',
            borderRadius: '6px',
            border: 'none',
            background: '#3b82f6',
            color: '#fff',
            fontWeight: 600,
            fontSize: '14px',
            cursor: isDisabled || text.trim() === '' ? 'not-allowed' : 'pointer',
            opacity: isDisabled || text.trim() === '' ? 0.5 : 1,
            whiteSpace: 'nowrap',
          }}
        >
          Send
        </button>
      </div>
    </div>
  )
}
