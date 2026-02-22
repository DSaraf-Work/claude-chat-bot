import { useState, useEffect, useCallback } from 'react'
import { useApi, useWebSocket } from '../hooks/index.js'
import { useSessionStore } from '../store/session.store.js'
import { ChatTimeline } from '../components/ChatTimeline.js'

// ---------------------------------------------------------------------------
// Types for API responses
// ---------------------------------------------------------------------------

interface ApiProject {
  id: string
  name: string
  path: string
  sessionCount: number
}

interface ApiSession {
  id: string
  projectId: string
  mode: 'sdk' | 'pty'
  status: string
  title?: string
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

function Sidebar() {
  const api = useApi()
  const { subscribe } = useWebSocket()
  const { sessions, activeSessionId, upsertSession, setActiveSession } = useSessionStore()

  const [projects, setProjects] = useState<ApiProject[]>([])
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null)
  const [projectSessions, setProjectSessions] = useState<Record<string, ApiSession[]>>({})
  const [loading, setLoading] = useState(false)

  // Load projects on mount
  useEffect(() => {
    let cancelled = false
    api.get<{ data: ApiProject[] }>('/api/v1/projects')
      .then((res) => {
        if (!cancelled) setProjects(res.data)
      })
      .catch(() => {
        // silently ignore
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleProjectClick = useCallback((projectId: string) => {
    if (expandedProjectId === projectId) {
      setExpandedProjectId(null)
      return
    }
    setExpandedProjectId(projectId)
    // Fetch sessions for this project
    api.get<{ data: ApiSession[] }>(`/api/v1/projects/${projectId}/sessions`)
      .then((res) => {
        setProjectSessions((prev) => ({ ...prev, [projectId]: res.data }))
      })
      .catch(() => {
        // silently ignore
      })
  }, [api, expandedProjectId])

  const handleNewSession = useCallback(async (projectId: string) => {
    setLoading(true)
    try {
      const res = await api.post<ApiSession>(`/api/v1/projects/${projectId}/sessions`, { mode: 'sdk' })
      upsertSession({
        sessionId: res.id,
        projectId: res.projectId,
        mode: res.mode,
        status: res.status,
        permissionMode: 'default',
        sdkSessionId: null,
      })
      setActiveSession(res.id)
      subscribe(res.id)
      // Add to project sessions list
      setProjectSessions((prev) => ({
        ...prev,
        [projectId]: [...(prev[projectId] ?? []), res],
      }))
    } catch {
      // silently ignore
    } finally {
      setLoading(false)
    }
  }, [api, upsertSession, setActiveSession, subscribe])

  const handleSessionClick = useCallback((sessionId: string) => {
    setActiveSession(sessionId)
    subscribe(sessionId)
  }, [setActiveSession, subscribe])

  return (
    <div style={{ width: 240, minWidth: 240, background: '#1e293b', borderRight: '1px solid #334155', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
      <div style={{ padding: '14px 16px 10px', fontWeight: 600, fontSize: 13, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        Projects
      </div>
      {projects.map((project) => (
        <div key={project.id}>
          <div
            onClick={() => handleProjectClick(project.id)}
            style={{
              padding: '8px 16px',
              cursor: 'pointer',
              fontSize: 13,
              color: expandedProjectId === project.id ? '#e2e8f0' : '#94a3b8',
              background: expandedProjectId === project.id ? '#334155' : 'transparent',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span style={{ fontSize: 10 }}>{expandedProjectId === project.id ? '\u25BC' : '\u25B6'}</span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.name}</span>
          </div>
          {expandedProjectId === project.id && (
            <div style={{ paddingLeft: 12 }}>
              {(projectSessions[project.id] ?? []).map((sess) => {
                const isActive = activeSessionId === sess.id
                // Also check if we have a local session for this
                const localSess = sessions[sess.id]
                const label = sess.title ?? localSess?.sessionId?.slice(0, 8) ?? sess.id.slice(0, 8)
                return (
                  <div
                    key={sess.id}
                    onClick={() => handleSessionClick(sess.id)}
                    style={{
                      padding: '6px 16px',
                      cursor: 'pointer',
                      fontSize: 12,
                      color: isActive ? '#e2e8f0' : '#64748b',
                      background: isActive ? '#475569' : 'transparent',
                      borderRadius: 4,
                      margin: '1px 4px',
                    }}
                  >
                    {label}
                  </div>
                )
              })}
              <div
                onClick={() => { if (!loading) void handleNewSession(project.id) }}
                style={{
                  padding: '6px 16px',
                  cursor: loading ? 'wait' : 'pointer',
                  fontSize: 12,
                  color: '#6366f1',
                  margin: '2px 4px',
                }}
              >
                + New session
              </div>
            </div>
          )}
        </div>
      ))}
      {projects.length === 0 && (
        <div style={{ padding: '12px 16px', fontSize: 12, color: '#475569' }}>No projects found</div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ChatView
// ---------------------------------------------------------------------------

function ChatView() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId)

  if (!activeSessionId) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', fontSize: 14 }}>
        Select or create a session
      </div>
    )
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <ChatTimeline sessionId={activeSessionId} />
      {/* ChatInput inserted by M0.5d */}
      <div id="chat-input-slot" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// ChatPage
// ---------------------------------------------------------------------------

export function ChatPage() {
  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      <Sidebar />
      <ChatView />
    </div>
  )
}
