# LLD: Frontend
_Last updated: 2026-02-22_

## 1. Component Tree

```
App
  AuthProvider                          # JWT token management, login redirect
  WebSocketProvider                     # WS connection lifecycle, event dispatch
  ThemeProvider                         # Design tokens, dark/light mode
  Router
    Layout
      Sidebar                           # Desktop: left panel
        ProjectList                     # Search, add root, project cards
          ProjectCard                   # Branch, dirty indicator, session count
        SessionList                     # Grouped by project, sorted by activity
          SessionCard                   # Status badge, title, last message preview
          SessionActions                # Rename, pin, archive, delete, export
      MainArea
        TabBar                          # Chat | Terminal | Files | Git | MCP | Plugins
        TabContent
          ChatView                      # Default tab
            Timeline                    # Virtualized list of timeline items
              UserMessageItem           # User message bubble
              AssistantMessageItem      # Streaming delta assembly, markdown render
              ToolRequestItem           # Collapsible tool card (name, args, output)
              ApprovalItem              # Inline approval card (decision + scope)
              SlashResultItem           # Compact markers, slash output
              ErrorItem                 # Error display with "Open Terminal" CTA
            Composer                    # Message input area
              ComposerInput             # Multiline textarea, paste handler
              ComposerToolbar           # Slash helper, file mention, send button
          TerminalView                  # Terminal parity tab
            XTermContainer              # xterm.js instance
            TerminalToolbar             # Connect/disconnect, tmux selector, resize
          FilesView                     # File browser
            FileTree                    # Tree navigator
            FileViewer                  # Read-only viewer / editor
          GitView                       # Git operations
            GitStatus                   # Staged/unstaged/untracked
            DiffViewer                  # Diff display
            CommitEditor                # Commit message + push
          McpView                       # MCP management panel
            McpServerList               # Server list with status indicators
            McpAddForm                  # Add server (transport selector)
            McpOAuthBanner              # OAuth URL display
          PluginsView                   # Plugin management panel
            PluginList                  # Installed plugins with toggles
            PluginInstallForm           # Install from marketplace
            PluginErrorsTab             # Plugin load failures
      ApprovalModal                     # Global modal for approval requests
        ApprovalDetails                 # Tool name, args, risk level
        ApprovalActions                 # Allow/deny once, allow/deny always
        ScopeSelector                   # Session/project/user scope picker
      StatusBar                         # Runner connection status, session info
      NotificationToast                 # Approval alerts, errors, reconnect status
    MobileLayout                        # Bottom tabs for mobile
      BottomTabBar                      # Projects | Sessions | Chat | Terminal | More
```

## 2. State Management

### Global State (Zustand)

Zustand is chosen for its minimal boilerplate and React-friendly API.

```typescript
// stores/session-store.ts
interface SessionStore {
  // Current state
  activeProjectId: string | null;
  activeSessionId: string | null;
  sessions: Map<string, SessionRecord>;
  projects: Map<string, ProjectRecord>;

  // Actions
  setActiveProject: (projectId: string) => void;
  setActiveSession: (sessionId: string) => void;
  addSession: (session: SessionRecord) => void;
  updateSession: (sessionId: string, update: Partial<SessionRecord>) => void;
  setProjects: (projects: ProjectRecord[]) => void;
}

// stores/timeline-store.ts
interface TimelineStore {
  // Per-session timeline data
  timelines: Map<string, TimelineState>;

  interface TimelineState {
    events: EventEnvelope[];
    streamingDelta: string;           // Accumulating assistant delta text
    pendingApprovals: Map<string, ApprovalRequest>;
    isLoading: boolean;
    hasMore: boolean;                  // For infinite scroll / load older
    cursor: string | null;
  }

  // Actions
  appendEvent: (sessionId: string, event: EventEnvelope) => void;
  appendDelta: (sessionId: string, delta: string) => void;
  finalizeDelta: (sessionId: string, message: AssistantMessage) => void;
  addApproval: (sessionId: string, approval: ApprovalRequest) => void;
  resolveApproval: (sessionId: string, approvalId: string, decision: string) => void;
  loadOlderEvents: (sessionId: string) => Promise<void>;
  clearTimeline: (sessionId: string) => void;
}

// stores/connection-store.ts
interface ConnectionStore {
  wsState: 'disconnected' | 'connecting' | 'connected';
  runnerStatus: 'online' | 'offline' | 'unknown';
  controllerStatus: 'controller' | 'follower' | 'none';
  lastError: string | null;

  setWsState: (state: ConnectionStore['wsState']) => void;
  setRunnerStatus: (status: ConnectionStore['runnerStatus']) => void;
  setControllerStatus: (status: ConnectionStore['controllerStatus']) => void;
}

// stores/settings-store.ts
interface SettingsStore {
  theme: 'light' | 'dark' | 'system';
  sendOnEnter: boolean;               // Enter=send vs Shift+Enter=send
  terminalFontSize: number;
  permissionMode: 'default' | 'plan' | 'acceptEdits' | 'dontAsk';

  setTheme: (theme: SettingsStore['theme']) => void;
  setSendOnEnter: (value: boolean) => void;
}
```

### Local Component State

The following state is kept local to components (not in Zustand):

- Composer text input value and cursor position
- Collapsed/expanded state of tool cards
- File tree expanded nodes
- Tab selection within panels (e.g., MCP sub-tabs)
- Modal open/closed state (except approval modal which is driven by store)
- xterm.js terminal instance ref

## 3. WebSocket Client

### Connection Hook

```typescript
// hooks/useWebSocket.ts

interface UseWebSocketReturn {
  state: 'disconnected' | 'connecting' | 'connected';
  send: (msg: WsOutgoingMessage) => void;
  subscribe: (sessionId: string) => void;
  unsubscribe: (sessionId: string) => void;
}

function useWebSocket(): UseWebSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number>();
  const reconnectAttemptRef = useRef(0);

  const { wsState, setWsState } = useConnectionStore();
  const { appendEvent, appendDelta, finalizeDelta, addApproval } = useTimelineStore();
  const token = useAuthStore((s) => s.accessToken);

  const connect = useCallback(() => {
    if (!token) return;
    setWsState('connecting');

    const ws = new WebSocket(`${WS_BASE_URL}/ws?token=${token}`);

    ws.onopen = () => {
      setWsState('connected');
      reconnectAttemptRef.current = 0;
    };

    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      handleIncomingMessage(msg);
    };

    ws.onclose = () => {
      setWsState('disconnected');
      scheduleReconnect();
    };

    ws.onerror = () => {
      ws.close();
    };

    wsRef.current = ws;
  }, [token]);

  const handleIncomingMessage = useCallback((msg: WsIncomingMessage) => {
    switch (msg.type) {
      case 'event': {
        const event = msg.event as EventEnvelope;
        switch (event.type) {
          case 'assistant.delta':
            appendDelta(event.sessionId, event.payload.delta);
            break;
          case 'assistant.message':
            finalizeDelta(event.sessionId, event.payload);
            break;
          case 'approval.requested':
            addApproval(event.sessionId, event.payload);
            break;
          default:
            appendEvent(event.sessionId, event);
        }
        break;
      }
      case 'runner.offline':
        useConnectionStore.getState().setRunnerStatus('offline');
        break;
      case 'session.catchUp':
        // Re-fetch timeline via REST
        useTimelineStore.getState().loadOlderEvents(msg.sessionId);
        break;
    }
  }, []);

  const scheduleReconnect = useCallback(() => {
    const attempt = reconnectAttemptRef.current++;
    const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
    const jitteredDelay = delay * (0.5 + Math.random() * 0.5);
    reconnectTimeoutRef.current = window.setTimeout(connect, jitteredDelay);
  }, [connect]);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
      clearTimeout(reconnectTimeoutRef.current);
    };
  }, [connect]);

  const send = useCallback((msg: WsOutgoingMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  return { state: wsState, send, subscribe, unsubscribe };
}
```

## 4. Chat Timeline

### Virtualized List

Uses `@tanstack/react-virtual` for efficient rendering of potentially thousands of timeline items.

```typescript
// components/Timeline.tsx

function Timeline({ sessionId }: { sessionId: string }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const { events, streamingDelta, isLoading, hasMore } = useTimelineStore(
    (s) => s.timelines.get(sessionId) ?? EMPTY_TIMELINE,
  );

  // Build renderable items from events
  const items = useMemo(() => buildTimelineItems(events, streamingDelta), [events, streamingDelta]);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => estimateItemHeight(items[index]),
    overscan: 10,
  });

  // Auto-scroll to bottom on new messages
  const isAtBottom = useRef(true);
  useEffect(() => {
    if (isAtBottom.current && items.length > 0) {
      virtualizer.scrollToIndex(items.length - 1, { align: 'end' });
    }
  }, [items.length]);

  // Infinite scroll: load older events when scrolled to top
  const handleScroll = useCallback(() => {
    const el = parentRef.current;
    if (!el) return;
    isAtBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 50;

    if (el.scrollTop < 100 && hasMore && !isLoading) {
      useTimelineStore.getState().loadOlderEvents(sessionId);
    }
  }, [sessionId, hasMore, isLoading]);

  return (
    <div ref={parentRef} onScroll={handleScroll} className="timeline-scroll">
      <div style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtualItem) => (
          <div
            key={virtualItem.key}
            ref={virtualizer.measureElement}
            data-index={virtualItem.index}
            style={{
              position: 'absolute',
              top: virtualItem.start,
              width: '100%',
            }}
          >
            <TimelineItem item={items[virtualItem.index]} />
          </div>
        ))}
      </div>
    </div>
  );
}
```

### Streaming Delta Assembly

```typescript
/**
 * Assembles streaming deltas into a live-updating assistant message.
 * Deltas arrive as incremental text chunks via assistant.delta events.
 */
function buildTimelineItems(
  events: EventEnvelope[],
  streamingDelta: string,
): TimelineItem[] {
  const items: TimelineItem[] = [];
  let currentToolGroup: ToolGroupItem | null = null;

  for (const event of events) {
    switch (event.type) {
      case 'user.message':
        items.push({ type: 'user-message', event });
        break;

      case 'assistant.message':
        items.push({ type: 'assistant-message', event });
        break;

      case 'tool.requested':
        currentToolGroup = {
          type: 'tool-group',
          toolId: event.payload.toolId,
          toolName: event.payload.toolName,
          args: event.payload.args,
          events: [event],
          status: 'requested',
        };
        items.push(currentToolGroup);
        break;

      case 'approval.requested':
        if (currentToolGroup?.toolId === event.payload.toolId) {
          currentToolGroup.events.push(event);
          currentToolGroup.status = 'awaiting-approval';
        } else {
          items.push({ type: 'approval', event });
        }
        break;

      case 'approval.resolved':
        if (currentToolGroup) {
          currentToolGroup.events.push(event);
          currentToolGroup.status = event.payload.decision === 'allow' ? 'approved' : 'denied';
        }
        break;

      case 'tool.output':
        if (currentToolGroup?.toolId === event.payload.toolId) {
          currentToolGroup.events.push(event);
          currentToolGroup.output = event.payload.output;
        }
        break;

      case 'tool.completed':
        if (currentToolGroup?.toolId === event.payload.toolId) {
          currentToolGroup.events.push(event);
          currentToolGroup.status = 'completed';
          currentToolGroup = null;
        }
        break;

      case 'slash.invoked':
      case 'slash.result':
        items.push({ type: 'slash', event });
        break;

      case 'session.error':
        items.push({ type: 'error', event });
        break;
    }
  }

  // Append streaming delta as a partial assistant message
  if (streamingDelta.length > 0) {
    items.push({
      type: 'assistant-streaming',
      content: streamingDelta,
    });
  }

  return items;
}
```

### Tool Event Cards

```typescript
function ToolRequestItem({ item }: { item: ToolGroupItem }) {
  const [expanded, setExpanded] = useState(false);

  const statusIcon = {
    requested: <Spinner />,
    'awaiting-approval': <AlertIcon />,
    approved: <Spinner />,
    denied: <XIcon />,
    completed: <CheckIcon />,
  }[item.status];

  return (
    <div className="tool-card">
      <div className="tool-card-header" onClick={() => setExpanded(!expanded)}>
        {statusIcon}
        <span className="tool-name">{item.toolName}</span>
        <span className="tool-status">{item.status}</span>
        <ChevronIcon direction={expanded ? 'down' : 'right'} />
      </div>
      {expanded && (
        <div className="tool-card-body">
          <div className="tool-args">
            <CodeBlock language="json">{JSON.stringify(item.args, null, 2)}</CodeBlock>
          </div>
          {item.output && (
            <div className="tool-output">
              <CodeBlock>{item.output}</CodeBlock>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

## 5. Approval Modal

### Decision UI

```typescript
function ApprovalModal() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const pendingApprovals = useTimelineStore(
    (s) => s.timelines.get(activeSessionId ?? '')?.pendingApprovals ?? new Map(),
  );

  // Show modal for the oldest pending approval
  const [approvalId, approval] = [...pendingApprovals.entries()][0] ?? [];
  if (!approval) return null;

  return (
    <Modal open={true} onClose={() => {}}>
      <ApprovalContent approval={approval} approvalId={approvalId} />
    </Modal>
  );
}

function ApprovalContent({
  approval,
  approvalId,
}: {
  approval: ApprovalRequest;
  approvalId: string;
}) {
  const [scope, setScope] = useState<'session' | 'project' | 'user'>('session');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { send } = useWebSocket();

  const handleDecision = async (decision: 'allow' | 'deny', persist: boolean) => {
    setIsSubmitting(true);

    // Optimistic UI: resolve immediately in local state
    useTimelineStore.getState().resolveApproval(
      approval.sessionId,
      approvalId,
      decision,
    );

    // Send to server
    await fetch(`/api/v1/sessions/${approval.sessionId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        approvalId,
        decision,
        persist,
        scope: persist ? scope : undefined,
      }),
    });

    setIsSubmitting(false);
  };

  const riskColors = { low: 'green', medium: 'yellow', high: 'red' };

  return (
    <div className="approval-content">
      <h3>Tool Approval Required</h3>

      <div className="approval-details">
        <div className="tool-name">{approval.toolName}</div>
        <RiskBadge level={approval.riskLevel} />
        <div className="tool-args">
          <CodeBlock language="json">
            {JSON.stringify(approval.args, null, 2)}
          </CodeBlock>
        </div>
      </div>

      <div className="approval-actions">
        <Button onClick={() => handleDecision('allow', false)} disabled={isSubmitting}>
          Allow Once
        </Button>
        <Button onClick={() => handleDecision('deny', false)} disabled={isSubmitting}>
          Deny Once
        </Button>
        <Divider />
        <ScopeSelector value={scope} onChange={setScope} />
        <Button onClick={() => handleDecision('allow', true)} disabled={isSubmitting}>
          Always Allow ({scope})
        </Button>
        <Button onClick={() => handleDecision('deny', true)} disabled={isSubmitting}>
          Always Deny ({scope})
        </Button>
      </div>
    </div>
  );
}
```

### Scope Selector

```typescript
function ScopeSelector({
  value,
  onChange,
}: {
  value: 'session' | 'project' | 'user';
  onChange: (scope: 'session' | 'project' | 'user') => void;
}) {
  return (
    <div className="scope-selector" role="radiogroup" aria-label="Approval scope">
      {(['session', 'project', 'user'] as const).map((scope) => (
        <label key={scope} className="scope-option">
          <input
            type="radio"
            name="scope"
            value={scope}
            checked={value === scope}
            onChange={() => onChange(scope)}
          />
          <span>{scope === 'user' ? 'All projects' : `This ${scope}`}</span>
        </label>
      ))}
    </div>
  );
}
```

## 6. xterm.js Integration

```typescript
// components/XTermContainer.tsx
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';

function XTermContainer({ sessionId }: { sessionId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const { send } = useWebSocket();
  const { terminalFontSize } = useSettingsStore();

  // Initialize terminal
  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: terminalFontSize,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: getTerminalTheme(),
      scrollback: 10000,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(searchAddon);
    term.loadAddon(webLinksAddon);

    term.open(containerRef.current);
    fitAddon.fit();

    // Send user keystrokes to runner PTY
    term.onData((data: string) => {
      send({
        type: 'session.command',
        sessionId,
        command: 'pty.input',
        payload: { data },
      });
    });

    // Send resize events
    term.onResize(({ cols, rows }) => {
      send({
        type: 'session.command',
        sessionId,
        command: 'pty.resize',
        payload: { cols, rows },
      });
    });

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    return () => {
      term.dispose();
    };
  }, [sessionId]);

  // Handle incoming PTY data
  useEffect(() => {
    const unsubscribe = useTimelineStore.subscribe((state) => {
      const timeline = state.timelines.get(sessionId);
      if (!timeline) return;

      // Listen for pty.data events
      const lastEvent = timeline.events[timeline.events.length - 1];
      if (lastEvent?.type === 'pty.data' && termRef.current) {
        const bytes = atob(lastEvent.payload.data);
        termRef.current.write(bytes);
      }
    });

    return unsubscribe;
  }, [sessionId]);

  // Resize observer
  useEffect(() => {
    if (!containerRef.current || !fitAddonRef.current) return;

    const observer = new ResizeObserver(() => {
      fitAddonRef.current?.fit();
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="xterm-container">
      <div ref={containerRef} className="xterm-terminal" />
    </div>
  );
}
```

## 7. MCP Panel

```typescript
function McpView() {
  const [servers, setServers] = useState<McpServerInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);

  // Fetch servers on mount and poll for health
  useEffect(() => {
    fetchServers();
    const interval = setInterval(fetchServers, 15000); // Poll every 15s
    return () => clearInterval(interval);
  }, []);

  const fetchServers = async () => {
    const res = await fetch('/api/v1/mcp/servers');
    const data = await res.json();
    setServers(data.servers);
    setIsLoading(false);
  };

  return (
    <div className="mcp-panel">
      <div className="mcp-header">
        <h2>MCP Servers</h2>
        <Button onClick={() => setShowAddForm(true)}>Add Server</Button>
      </div>

      {servers.map((server) => (
        <McpServerCard key={server.name} server={server} onRefresh={fetchServers} />
      ))}

      {showAddForm && (
        <McpAddForm onClose={() => setShowAddForm(false)} onAdded={fetchServers} />
      )}
    </div>
  );
}

function McpServerCard({ server, onRefresh }: { server: McpServerInfo; onRefresh: () => void }) {
  const statusColors = { running: 'green', stopped: 'gray', error: 'red' };

  const handleRemove = async () => {
    await fetch(`/api/v1/mcp/servers/${server.name}`, { method: 'DELETE' });
    onRefresh();
  };

  const handleAuth = async () => {
    const res = await fetch(`/api/v1/mcp/servers/${server.name}/auth`, { method: 'POST' });
    const data = await res.json();
    if (data.authUrl) {
      window.open(data.authUrl, '_blank');
    }
  };

  return (
    <div className="mcp-server-card">
      <StatusDot color={statusColors[server.status]} />
      <span className="server-name">{server.name}</span>
      <span className="server-transport">{server.transport}</span>
      {server.status === 'error' && (
        <span className="server-error">{server.lastError}</span>
      )}
      {server.tools && (
        <div className="server-tools">
          {server.tools.map((t) => <Badge key={t}>{t}</Badge>)}
        </div>
      )}
      <div className="server-actions">
        {server.status === 'error' && server.lastError?.includes('oauth') && (
          <Button size="sm" onClick={handleAuth}>Authenticate</Button>
        )}
        <Button size="sm" variant="danger" onClick={handleRemove}>Remove</Button>
      </div>
    </div>
  );
}

function McpAddForm({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [name, setName] = useState('');
  const [transport, setTransport] = useState<'stdio' | 'http' | 'sse'>('stdio');
  const [config, setConfig] = useState('');

  const handleSubmit = async () => {
    await fetch('/api/v1/mcp/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, transport, config: JSON.parse(config) }),
    });
    onAdded();
    onClose();
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
      <Input label="Server Name" value={name} onChange={setName} />
      <Select label="Transport" value={transport} onChange={setTransport}
        options={[
          { value: 'stdio', label: 'stdio' },
          { value: 'http', label: 'HTTP' },
          { value: 'sse', label: 'SSE' },
        ]}
      />
      <Textarea label="Config (JSON)" value={config} onChange={setConfig} />
      <Button type="submit">Add Server</Button>
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
    </form>
  );
}
```

## 8. Plugins Panel

```typescript
function PluginsView() {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchPlugins();
  }, []);

  const fetchPlugins = async () => {
    const res = await fetch('/api/v1/plugins/installed');
    const data = await res.json();
    setPlugins(data.plugins);
    setIsLoading(false);
  };

  const handleToggle = async (pluginName: string, enabled: boolean) => {
    const action = enabled ? 'enable' : 'disable';
    await fetch(`/api/v1/plugins/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: pluginName }),
    });
    fetchPlugins();
  };

  const handleInstall = async (packageName: string) => {
    await fetch('/api/v1/plugins/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ package: packageName }),
    });
    fetchPlugins();
  };

  return (
    <div className="plugins-panel">
      <div className="plugins-header">
        <h2>Plugins</h2>
      </div>

      {plugins.map((plugin) => (
        <PluginCard
          key={plugin.name}
          plugin={plugin}
          onToggle={(enabled) => handleToggle(plugin.name, enabled)}
        />
      ))}

      <PluginInstallForm onInstall={handleInstall} />
    </div>
  );
}

function PluginCard({
  plugin,
  onToggle,
}: {
  plugin: PluginInfo;
  onToggle: (enabled: boolean) => void;
}) {
  return (
    <div className="plugin-card">
      <div className="plugin-info">
        <span className="plugin-name">{plugin.name}</span>
        <span className="plugin-version">v{plugin.version}</span>
        <span className="plugin-scope">{plugin.scope}</span>
      </div>
      <Toggle checked={plugin.enabled} onChange={onToggle} />
      {plugin.capabilities.length > 0 && (
        <div className="plugin-caps">
          {plugin.capabilities.map((c) => <Badge key={c}>{c}</Badge>)}
        </div>
      )}
    </div>
  );
}
```

## 9. Routing

```typescript
// routes.tsx
const routes = [
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <Navigate to="/projects" /> },
      {
        path: 'projects',
        element: <ProjectListPage />,
      },
      {
        path: 'projects/:projectId',
        element: <ProjectDetailPage />,
        children: [
          { path: 'sessions', element: <SessionListPage /> },
        ],
      },
      {
        path: 'sessions/:sessionId',
        element: <SessionPage />,
        children: [
          { index: true, element: <Navigate to="chat" /> },
          { path: 'chat', element: <ChatView /> },
          { path: 'terminal', element: <TerminalView /> },
          { path: 'files', element: <FilesView /> },
          { path: 'git', element: <GitView /> },
          { path: 'mcp', element: <McpView /> },
          { path: 'plugins', element: <PluginsView /> },
        ],
      },
      {
        path: 'settings',
        element: <SettingsPage />,
      },
    ],
  },
];
```

## 10. Theme / Design Tokens

```typescript
// theme/tokens.ts
export const tokens = {
  colors: {
    // Semantic colors
    bg: { primary: 'var(--bg-primary)', secondary: 'var(--bg-secondary)', tertiary: 'var(--bg-tertiary)' },
    text: { primary: 'var(--text-primary)', secondary: 'var(--text-secondary)', muted: 'var(--text-muted)' },
    border: { default: 'var(--border-default)', subtle: 'var(--border-subtle)' },
    accent: { default: 'var(--accent)', hover: 'var(--accent-hover)' },
    status: {
      success: 'var(--status-success)',
      warning: 'var(--status-warning)',
      error: 'var(--status-error)',
      info: 'var(--status-info)',
    },
    risk: {
      low: 'var(--risk-low)',        // green
      medium: 'var(--risk-medium)',  // yellow/amber
      high: 'var(--risk-high)',      // red
    },
  },
  spacing: {
    xs: '4px', sm: '8px', md: '16px', lg: '24px', xl: '32px', xxl: '48px',
  },
  radius: {
    sm: '4px', md: '8px', lg: '12px', full: '9999px',
  },
  fontSize: {
    xs: '11px', sm: '13px', md: '14px', lg: '16px', xl: '20px', xxl: '24px',
  },
  fontFamily: {
    sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    mono: 'Menlo, Monaco, "Courier New", monospace',
  },
};

// CSS custom properties for light/dark mode
// :root (light)
const lightTheme = {
  '--bg-primary': '#ffffff',
  '--bg-secondary': '#f5f5f5',
  '--bg-tertiary': '#ebebeb',
  '--text-primary': '#1a1a1a',
  '--text-secondary': '#666666',
  '--text-muted': '#999999',
  '--border-default': '#e0e0e0',
  '--border-subtle': '#f0f0f0',
  '--accent': '#2563eb',
  '--accent-hover': '#1d4ed8',
  '--status-success': '#16a34a',
  '--status-warning': '#d97706',
  '--status-error': '#dc2626',
  '--status-info': '#2563eb',
  '--risk-low': '#16a34a',
  '--risk-medium': '#d97706',
  '--risk-high': '#dc2626',
};

// [data-theme="dark"]
const darkTheme = {
  '--bg-primary': '#0a0a0a',
  '--bg-secondary': '#171717',
  '--bg-tertiary': '#262626',
  '--text-primary': '#fafafa',
  '--text-secondary': '#a3a3a3',
  '--text-muted': '#737373',
  '--border-default': '#333333',
  '--border-subtle': '#262626',
  '--accent': '#3b82f6',
  '--accent-hover': '#60a5fa',
  '--status-success': '#22c55e',
  '--status-warning': '#f59e0b',
  '--status-error': '#ef4444',
  '--status-info': '#3b82f6',
  '--risk-low': '#22c55e',
  '--risk-medium': '#f59e0b',
  '--risk-high': '#ef4444',
};
```

### Dark Mode Implementation

```typescript
// hooks/useTheme.ts
function useTheme() {
  const theme = useSettingsStore((s) => s.theme);

  useEffect(() => {
    const root = document.documentElement;

    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const apply = (e: MediaQueryListEvent | MediaQueryList) => {
        root.setAttribute('data-theme', e.matches ? 'dark' : 'light');
      };
      apply(mediaQuery);
      mediaQuery.addEventListener('change', apply);
      return () => mediaQuery.removeEventListener('change', apply);
    }

    root.setAttribute('data-theme', theme);
  }, [theme]);
}
```
