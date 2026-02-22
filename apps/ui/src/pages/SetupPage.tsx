import { useState } from 'react'
import { useSettingsStore } from '../store/settings.store.js'

export function SetupPage({ onDone }: { onDone: () => void }) {
  const { setToken, setRunnerUrl, runnerUrl } = useSettingsStore()
  const [tokenInput, setTokenInput] = useState('')
  const [urlInput, setUrlInput] = useState(runnerUrl)
  const [error, setError] = useState('')

  const handleConnect = async () => {
    setError('')
    try {
      const res = await fetch(`${urlInput}/health`)
      if (!res.ok) throw new Error('Runner not reachable')
      setToken(tokenInput.trim())
      setRunnerUrl(urlInput.trim())
      onDone()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
      <div style={{ background: '#1e293b', borderRadius: 12, padding: 32, width: 360 }}>
        <h2 style={{ margin: '0 0 20px', fontSize: 18 }}>Connect to Runner</h2>
        <label style={{ display: 'block', marginBottom: 12 }}>
          <span style={{ fontSize: 12, color: '#94a3b8' }}>Runner URL</span>
          <input
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px 12px', borderRadius: 6, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', boxSizing: 'border-box' }}
          />
        </label>
        <label style={{ display: 'block', marginBottom: 20 }}>
          <span style={{ fontSize: 12, color: '#94a3b8' }}>Bearer Token</span>
          <input
            type="password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="Paste token from ~/.claude-ui/config.json"
            style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px 12px', borderRadius: 6, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', boxSizing: 'border-box' }}
          />
        </label>
        {error && <p style={{ color: '#ef4444', fontSize: 13, margin: '0 0 12px' }}>{error}</p>}
        <button
          onClick={handleConnect}
          style={{ width: '100%', padding: '10px', borderRadius: 6, border: 'none', background: '#6366f1', color: '#fff', fontWeight: 600, cursor: 'pointer' }}
        >
          Connect
        </button>
      </div>
    </div>
  )
}
