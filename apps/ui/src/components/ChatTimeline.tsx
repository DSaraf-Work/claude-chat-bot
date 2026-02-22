import { useEffect, useRef } from 'react'
import { useTimelineStore } from '../store/timeline.store.js'
import type { TimelineEvent } from '../store/timeline.store.js'

// ---------------------------------------------------------------------------
// Sub-components for each event type
// ---------------------------------------------------------------------------

function AssistantMessage({ event }: { event: TimelineEvent }) {
  const text = (event.payload['text'] as string | undefined) ?? ''
  return (
    <div style={{ padding: '10px 14px', background: '#1e293b', borderRadius: 10, maxWidth: '80%', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
      {text}
    </div>
  )
}

function ToolCard({ event }: { event: TimelineEvent }) {
  const toolName = (event.payload['toolName'] as string | undefined) ?? 'unknown tool'
  const input = event.payload['input']
  return (
    <div style={{ padding: '8px 12px', background: '#1e293b', borderLeft: '3px solid #f59e0b', borderRadius: 6, maxWidth: '80%', fontSize: 13 }}>
      <div style={{ fontWeight: 600, color: '#f59e0b', marginBottom: 4 }}>Tool: {toolName}</div>
      {input !== undefined && (
        <details style={{ cursor: 'pointer' }}>
          <summary style={{ color: '#94a3b8', fontSize: 12 }}>Input</summary>
          <pre style={{ margin: '4px 0 0', fontSize: 11, color: '#cbd5e1', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {JSON.stringify(input, null, 2)}
          </pre>
        </details>
      )}
    </div>
  )
}

function ToolOutput({ event }: { event: TimelineEvent }) {
  const content = (event.payload['content'] as string | undefined) ?? JSON.stringify(event.payload)
  const truncated = content.length > 200 ? content.slice(0, 200) + '...' : content
  return (
    <div style={{ padding: '8px 12px', background: '#1e293b', borderLeft: '3px solid #6b7280', borderRadius: 6, maxWidth: '80%', fontSize: 12, color: '#94a3b8', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
      {truncated}
    </div>
  )
}

function SystemBadge({ label }: { label: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '6px 0' }}>
      <span style={{ fontSize: 11, color: '#64748b', background: '#1e293b', padding: '3px 10px', borderRadius: 10 }}>{label}</span>
    </div>
  )
}

function ErrorBadge({ event }: { event: TimelineEvent }) {
  const message = (event.payload['message'] as string | undefined) ?? 'Unknown error'
  return (
    <div style={{ textAlign: 'center', padding: '6px 0' }}>
      <span style={{ fontSize: 11, color: '#fca5a5', background: '#450a0a', padding: '3px 10px', borderRadius: 10 }}>{message}</span>
    </div>
  )
}

function GenericCard({ event }: { event: TimelineEvent }) {
  return (
    <div style={{ padding: '8px 12px', background: '#1e293b', borderRadius: 6, maxWidth: '80%', fontSize: 12 }}>
      <div style={{ fontWeight: 600, color: '#94a3b8', marginBottom: 4 }}>{event.type}</div>
      <pre style={{ margin: 0, fontSize: 11, color: '#cbd5e1', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
        {JSON.stringify(event.payload, null, 2)}
      </pre>
    </div>
  )
}

function StreamingBubble({ text }: { text: string }) {
  return (
    <div style={{ padding: '10px 14px', background: '#1e293b', borderRadius: 10, maxWidth: '80%', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
      {text}
      <span style={{ display: 'inline-block', width: 8, animation: 'blink 1s steps(2) infinite' }}>{'\u258b'}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Render a single event
// ---------------------------------------------------------------------------

function EventRow({ event }: { event: TimelineEvent }) {
  switch (event.type) {
    case 'assistant.message':
      return <AssistantMessage event={event} />
    case 'assistant.delta':
      return null
    case 'tool.requested':
      return <ToolCard event={event} />
    case 'tool.output':
      return <ToolOutput event={event} />
    case 'session.created':
      return <SystemBadge label="Session started" />
    case 'session.ended':
      return <SystemBadge label="Session ended" />
    case 'session.error':
      return <ErrorBadge event={event} />
    case 'approval.requested':
      return null
    default:
      return <GenericCard event={event} />
  }
}

// ---------------------------------------------------------------------------
// ChatTimeline
// ---------------------------------------------------------------------------

export function ChatTimeline({ sessionId }: { sessionId: string }) {
  const events = useTimelineStore((s) => s.events[sessionId] ?? [])
  const streaming = useTimelineStore((s) => s.streaming[sessionId])
  const bottomRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom on new events or streaming changes
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [events.length, streaming?.text])

  return (
    <>
      {/* Inject blinking cursor keyframes once */}
      <style>{`@keyframes blink { 0%,100% { opacity: 1 } 50% { opacity: 0 } }`}</style>
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {events.map((evt) => (
          <EventRow key={evt.id} event={evt} />
        ))}
        {streaming != null && <StreamingBubble text={streaming.text} />}
        <div ref={bottomRef} />
      </div>
    </>
  )
}
