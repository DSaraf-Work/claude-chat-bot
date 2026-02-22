import { useState } from 'react'
import { useSettingsStore } from './store/settings.store.js'
import { Layout } from './components/Layout.js'
import { SetupPage } from './pages/SetupPage.js'

// ChatPage will be added in M0.5c
function PlaceholderChat() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', color: '#475569' }}>
      Chat timeline coming in M0.5c
    </div>
  )
}

export function App() {
  const { token } = useSettingsStore()
  const [ready, setReady] = useState(false)

  // If token not set, show setup
  if (!token && !ready) {
    return (
      <Layout>
        <SetupPage onDone={() => setReady(true)} />
      </Layout>
    )
  }

  return (
    <Layout>
      <PlaceholderChat />
    </Layout>
  )
}
