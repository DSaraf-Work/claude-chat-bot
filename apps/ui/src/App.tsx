import { useState } from 'react'
import { useSettingsStore } from './store/settings.store.js'
import { Layout } from './components/Layout.js'
import { SetupPage } from './pages/SetupPage.js'
import { useWebSocket } from './hooks/index.js'
import { ChatPage } from './pages/ChatPage.js'

function ConnectedApp() {
  useWebSocket() // starts WS connection for entire app lifetime
  return <ChatPage />
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
      <ConnectedApp />
    </Layout>
  )
}
