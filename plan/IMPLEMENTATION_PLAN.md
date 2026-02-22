# Implementation Plan -- Portable UI for Claude Code
_Generated: 2026-02-22_

This document is the complete, actionable implementation plan. It references the PRD, TECH_DOC, UI_UX_PLAN, HLD, and LLD documents under `plan/`.

---

## 1. Tech Stack Summary Table

| Layer | Technology | Version | Rationale |
|-------|-----------|---------|-----------|
| Runner runtime | Node.js | 20 LTS | Native Agent SDK support (TypeScript); mature PTY (node-pty); event-loop model fits streaming I/O workload |
| Hub runtime | Node.js | 20 LTS | Same runtime as Runner; shared `@claude-ui/protocol` and `@claude-ui/shared` packages eliminate type drift |
| UI framework | React | 18/19 | Largest ecosystem; excellent streaming/delta re-render support; Zustand for state management |
| UI build tool | Vite | 6.x | Fast HMR; optimized SPA builds; no SSR needed (pure client-side app) |
| Shared protocol package | `@claude-ui/protocol` (Zod + TS) | workspace | Single source of truth for event envelopes, API schemas, WS messages; Zod for runtime validation + type inference |
| Database (Phase 0) | SQLite via better-sqlite3 | -- | Zero-setup embedded DB for single-user local event buffer and replay |
| Database (Phase 1+) | PostgreSQL | 16+ | Multi-client concurrent writes; JSONB; append-only event store; clean path to teams |
| ORM / query builder | Drizzle ORM + Drizzle Kit | 0.3x+ | Type-safe SQL-first approach; lightweight runtime; excellent migration tooling |
| WebSocket library | ws | 8.x | Lightweight; full control over custom protocol (sequence numbers, subscriptions, gap detection) |
| HTTP framework | Fastify | 5.x | Fast; schema-based validation; plugin ecosystem; TypeScript-friendly |
| Auth (Phase 0) | Static bearer token | -- | Minimal friction for single user; generated on first run, stored in `~/.claude-ui/config.json` |
| Auth (Phase 1+) | JWT (jose library) | -- | Stateless verification; access + refresh token pair; RBAC claims in Phase 2 |
| Terminal emulator | xterm.js + addons (fit, web-links, search) | 5.x | Only production-grade web terminal emulator |
| PTY library | node-pty | 1.x | Only actively maintained Node.js PTY library; macOS support |
| Testing (unit) | Vitest | -- | Fast; native ESM + TypeScript; compatible with Vite |
| Testing (integration) | Vitest + Supertest | -- | Approval pause/resume, event store, runner-hub protocol |
| Testing (E2E) | Playwright | -- | Cross-browser; scenarios from PRD (1-7) |
| Logging | Pino | 9.x | Structured JSON logging; low overhead |
| CI/CD | GitHub Actions | -- | Per-PR checks; on-merge builds; E2E pipeline |
| Containerization | Docker + Docker Compose | -- | Hub deployment; Postgres sidecar; optional Runner containerization in Phase 2 |
| Monorepo tooling | pnpm + Turborepo | -- | Fast installs; strict isolation; dependency-aware build orchestration |
| State management (UI) | Zustand | 5.x | Lightweight (1KB); no boilerplate; works with React concurrent features |
| Validation | Zod | 3.x | Runtime validation + TypeScript type inference; shared across all packages |

---

## 2. Monorepo Setup

### Package Manager: pnpm

pnpm provides fast, disk-efficient installs with strict dependency isolation (no phantom dependencies).

### Build Orchestration: Turborepo

Turborepo respects the dependency graph: `turbo run build` builds `packages/*` first, then `apps/*`.

### Exact Directory Structure

```
claude-chat-bot/
  package.json                     # Root: pnpm workspace config, scripts
  pnpm-workspace.yaml              # Workspace definition
  turbo.json                       # Turborepo pipeline config
  tsconfig.base.json               # Shared base TS config
  .eslintrc.cjs                    # Shared ESLint config
  .prettierrc                      # Shared Prettier config
  .github/
    workflows/
      ci.yml                       # PR checks (typecheck, lint, unit, integration)
      deploy.yml                   # On-merge: build, E2E, deploy

  apps/
    runner/
      package.json                 # @claude-ui/runner
      tsconfig.json                # extends ../../tsconfig.base.json
      src/
        index.ts                   # Entry point, service bootstrap
        server.ts                  # Fastify HTTP + WS server setup
        config/
          schema.ts                # Zod config schema + defaults
          loader.ts                # Load YAML + env overlay
        sdk/
          session-manager.ts       # Create/resume/fork/end SDK sessions
          stream-adapter.ts        # Convert SDK stream to protocol events
          tool-approval.ts         # canUseTool: approval pause/resume
          slash-handler.ts         # Execute slash commands (/compact)
        pty/
          pty-adapter.ts           # Spawn claude PTY, relay bytes
          tmux-bridge.ts           # tmux session management
          resize-handler.ts        # Terminal resize events
        discovery/
          project-scanner.ts       # Scan configured roots for projects
          claude-projects.ts       # Read ~/.claude/projects
        cli/
          plugin-wrapper.ts        # Call `claude plugin ...`, parse output
          mcp-wrapper.ts           # Call `claude mcp ...`, parse output
        ws/
          ws-server.ts             # Phase 0: direct WS server for UI
          ws-client.ts             # Phase 1: WS client to Hub
          heartbeat.ts             # Ping/pong
          reconnect.ts             # Exponential backoff
        buffer/
          event-buffer.ts          # Offline event queue (JSONL on disk)
          flush.ts                 # Flush buffer to Hub on reconnect
        api/
          router.ts                # Fastify route registration
          middleware.ts            # Auth token validation
          handlers/
            projects.ts
            sessions.ts
            plugins.ts
            mcp.ts
        events/
          envelope.ts              # Event envelope factory
          emitter.ts               # Internal event bus (EventEmitter3)
        auth/
          static-token.ts          # Phase 0 static bearer token
      tests/
        unit/
        integration/

    hub/
      package.json                 # @claude-ui/hub
      tsconfig.json
      src/
        index.ts                   # Entry point
        server.ts                  # Fastify HTTP + WS server
        config/
          schema.ts
          loader.ts
        auth/
          token.ts                 # JWT issuance + validation
          middleware.ts            # Fastify auth middleware
          refresh.ts               # Token refresh
        ws/
          gateway.ts               # WebSocket server, connection lifecycle
          connection-manager.ts    # Track runner/ui connections
          room-manager.ts          # Session-based rooms for fan-out
          protocol.ts              # Message type handlers
        sessions/
          registry.ts              # Session registry (cache + DB)
          router.ts                # Route commands to correct runner
        events/
          store.ts                 # Append-only event store (Postgres)
          timeline.ts              # Timeline query with cursor pagination
          backfill.ts              # Handle runner backfill events
        runners/
          registry.ts              # Runner registration + health
          heartbeat.ts             # Runner heartbeat monitoring
        api/
          router.ts
          handlers/
            projects.ts
            sessions.ts
            plugins.ts
            mcp.ts
            auth.ts
        db/
          client.ts                # Drizzle ORM client setup
          schema.ts                # Drizzle schema definitions
          migrations/              # Generated migration files
      tests/
        unit/
        integration/

    ui/
      package.json                 # @claude-ui/web
      tsconfig.json
      vite.config.ts
      index.html
      src/
        main.tsx                   # React entry point
        App.tsx                    # Root component, routing, providers
        components/                # Shared UI components (Button, Modal, Badge, etc.)
        features/
          chat/                    # Chat timeline, message composer
            Timeline.tsx
            Composer.tsx
            TimelineItem.tsx
            AssistantMessage.tsx
            ToolRequestItem.tsx
          terminal/                # xterm.js terminal tab
            XTermContainer.tsx
            TerminalToolbar.tsx
          projects/                # Project browser, settings
          sessions/                # Session list, management
          approvals/               # Approval modal + scope selector
          files/                   # File browser, editor
          git/                     # Git status, diff, commit
          mcp/                     # MCP server management
          plugins/                 # Plugin management
        hooks/
          useWebSocket.ts          # WebSocket connection hook
          useTheme.ts              # Dark/light mode
        stores/
          session-store.ts         # Zustand: projects + sessions
          timeline-store.ts        # Zustand: per-session timeline
          connection-store.ts      # Zustand: WS + runner status
          settings-store.ts        # Zustand: user preferences
        services/
          api-client.ts            # REST API client (fetch wrapper)
          ws-client.ts             # WebSocket client service
        styles/
          tokens.ts                # Design tokens
          themes.ts                # Light + dark CSS variables
          global.css               # Base styles
      tests/
        unit/
        e2e/                       # Playwright tests

  packages/
    shared/
      package.json                 # @claude-ui/shared
      tsconfig.json
      src/
        index.ts
        types.ts                   # Domain types (Project, Session, etc.)
        constants.ts               # Shared constants (timeouts, limits)
        utils.ts                   # Shared utilities (ID generation, time formatting)

    protocol/
      package.json                 # @claude-ui/protocol
      tsconfig.json
      src/
        index.ts                   # Re-exports everything
        envelope.ts                # EventEnvelope type + Zod schema
        events/                    # Per-domain event types + Zod schemas
          session.ts
          chat.ts
          tools.ts
          slash.ts
          mcp.ts
          pty.ts
          workspace.ts
        api/                       # REST API request/response types + Zod schemas
          projects.ts
          sessions.ts
          plugins.ts
          mcp.ts
          auth.ts
        ws/                        # WebSocket message types
          messages.ts
          schemas.ts

  docker/
    docker-compose.yml             # Hub + Postgres for local dev
    Dockerfile.hub                 # Hub production image

  plan/                            # Design docs (this file, HLD, LLD, etc.)
```

### TypeScript Config Strategy

**`tsconfig.base.json`** (root): shared compiler options.

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "composite": true,
    "paths": {
      "@claude-ui/shared": ["./packages/shared/src"],
      "@claude-ui/protocol": ["./packages/protocol/src"]
    }
  }
}
```

Each package/app `tsconfig.json` extends the base and adds its own `include`, `outDir`, and `references`.

### Workspace Configuration

**`pnpm-workspace.yaml`:**
```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

**`turbo.json`:**
```jsonc
{
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "test": {
      "dependsOn": ["build"]
    },
    "lint": {},
    "typecheck": {
      "dependsOn": ["^build"]
    }
  }
}
```

---

## 3. Phase 0 -- Local Runner (MVP)

### M0.1: Monorepo Scaffold + Shared Protocol Package

**Description:** Initialize the monorepo structure, install tooling, create the shared packages with all event types and API contracts.

**Tasks:**
1. Initialize pnpm workspace with `pnpm-workspace.yaml`, root `package.json`, `.npmrc`
2. Add Turborepo (`turbo.json`), base `tsconfig.base.json`, ESLint, Prettier configs
3. Create `packages/shared/` with domain types (`Project`, `Session`, `SessionHandle`, etc.) and utility functions (ID generation, time helpers)
4. Create `packages/protocol/` with:
   - `envelope.ts`: `EventEnvelope` type + Zod schema
   - `events/*.ts`: all 17 event types with Zod schemas (session, chat, tools, slash, mcp, pty, workspace)
   - `api/*.ts`: all REST API request/response types with Zod schemas (projects, sessions, plugins, mcp)
   - `ws/*.ts`: WebSocket message types (subscribe, unsubscribe, ping/pong, event, command)
5. Add `vitest` as test runner; write unit tests for Zod schemas (valid/invalid payloads)
6. Verify `turbo run build` succeeds for both packages

**Acceptance criteria:**
- `pnpm install` succeeds from root
- `turbo run build` builds both packages with no errors
- `turbo run test` passes all schema validation tests
- All event types from TECH_DOC Section 3 are represented with Zod schemas
- All API contracts from TECH_DOC Section 4 are represented

**Dependencies:** None (first milestone)

---

### M0.2: Runner -- Project Discovery + Basic HTTP Server + Auth

**Description:** Create the Runner app with project scanning, Fastify HTTP server, static token auth, and the projects REST API.

**Tasks:**
1. Create `apps/runner/` with Fastify server setup (`server.ts`, `index.ts`)
2. Implement config loading (`config/schema.ts`, `config/loader.ts`) with Zod validation
3. Implement static bearer token auth middleware
4. Implement `ProjectScanner` (scan configured roots, optionally read `~/.claude/projects`)
5. Implement REST endpoints: `GET /api/v1/projects`, `POST /api/v1/projects`, `POST /api/v1/projects/:id/clone`
6. Serve the UI SPA as static files from Fastify (placeholder index.html for now)
7. Generate auth token on first run; store in `~/.claude-ui/config.json`; display in console
8. Write unit tests for project scanner; integration tests for API endpoints

**Acceptance criteria:**
- Runner starts on configured port (default 3100), logs the auth token
- `GET /api/v1/projects` returns discovered projects with git metadata
- `POST /api/v1/projects` adds a new root and rescans
- Unauthenticated requests receive 401
- Config loads from YAML with env overlay

**Dependencies:** M0.1

---

### M0.3: Runner -- Agent SDK Integration (Create Session, Stream Chat, Receive Messages)

**Description:** Integrate the Claude Agent SDK to create sessions, send messages, and stream assistant responses as protocol events.

**Tasks:**
1. Implement `SessionManager` (create, resume, fork, end sessions)
2. Implement `StreamAdapter` to convert SDK stream events to `EventEnvelope` objects
3. Implement the internal event bus (`EventEmitter3`) to decouple SDK events from transport
4. Implement REST endpoints: `POST /api/v1/projects/:id/sessions`, `GET /api/v1/projects/:id/sessions`, `POST /api/v1/sessions/:id/send`
5. Implement Phase 0 WebSocket server: client connects, subscribes to a session, receives events
6. Wire up: user message via REST -> SDK.sendMessage() -> stream assistant.delta events -> assistant.message event -> all sent over WS
7. Implement correlation IDs (one per user turn)
8. Write integration test: create session, send message, verify delta + message events arrive over WS

**Acceptance criteria:**
- A client can create an SDK session for a project
- Sending a message produces streaming `assistant.delta` events followed by `assistant.message`
- Events arrive over WebSocket with correct envelope fields
- Session state (active/paused/ended) is tracked correctly

**Dependencies:** M0.2

---

### M0.4: Runner -- Tool Approval Pause/Resume

**Description:** Implement the `canUseTool` callback that pauses the SDK, emits `approval.requested`, waits for UI response, and resumes.

**Tasks:**
1. Implement `ToolApproval` class with `evaluate()`, `requestApproval()`, `resolveApproval()`
2. Implement permission mode support: `default`, `plan`, `acceptEdits`, `dontAsk`/`bypassPermissions`
3. Implement approval rule persistence (in-memory for Phase 0) with scope hierarchy: session > project > user
4. Implement approval timeout (5 minutes, auto-deny)
5. Implement REST endpoint: `POST /api/v1/sessions/:id/approve`
6. Implement risk level assessment (high/medium/low based on tool name)
7. Emit `tool.requested`, `approval.requested`, `approval.resolved`, `tool.output`, `tool.completed` events
8. Write integration test: trigger tool call -> verify approval.requested arrives -> send approval -> verify tool executes -> verify tool.output + tool.completed

**Acceptance criteria:**
- SDK execution pauses when a tool needs approval
- `approval.requested` event is emitted with tool name, args, risk level
- `POST /approve` resolves the pending approval and resumes SDK
- "Allow always (project)" persists the rule and auto-approves future calls for the same tool in the same project
- Timeout auto-denies after 5 minutes

**Dependencies:** M0.3

---

### M0.5: UI -- Scaffold, WebSocket Connection, Basic Chat Timeline

**Description:** Create the React/Vite UI app with WebSocket connection and a basic chat timeline that renders streaming messages.

**Tasks:**
1. Create `apps/ui/` with Vite + React + TypeScript scaffold
2. Implement Zustand stores: `session-store`, `timeline-store`, `connection-store`, `settings-store`
3. Implement `useWebSocket` hook with connect, reconnect (exponential backoff), subscribe/unsubscribe
4. Implement `WebSocketProvider` context that wraps the app
5. Implement basic `Layout` with sidebar (project list, session list) and main area
6. Implement `Timeline` component with `@tanstack/react-virtual` for virtualized rendering
7. Implement `buildTimelineItems` to convert events into renderable items (user messages, assistant messages, tool cards)
8. Implement `AssistantMessageItem` with streaming delta assembly and markdown rendering
9. Implement `Composer` with multiline textarea, Enter to send, Shift+Enter for newline
10. Implement light/dark theme with CSS custom properties
11. Wire up: type message in composer -> POST /send -> see streaming response in timeline
12. Add `react-router-dom` routing per the route structure in frontend LLD

**Acceptance criteria:**
- UI loads in browser, connects to Runner via WebSocket
- Project list and session list render in sidebar
- Creating a session and sending a message shows streaming assistant response
- Timeline auto-scrolls on new messages
- Theme toggle works (light/dark)

**Dependencies:** M0.3

---

### M0.6: UI -- Approval UI

**Description:** Add the approval modal that surfaces when the Runner requests tool approval, with scope selectors and persist options.

**Tasks:**
1. Implement `ApprovalModal` component (global modal, triggered by `approval.requested` events)
2. Implement `ApprovalContent` with tool name, args preview (JSON code block), risk level badge
3. Implement `ScopeSelector` (session / project / user radio group)
4. Implement approval actions: Allow Once, Deny Once, Always Allow (scope), Always Deny (scope)
5. Wire up: click action -> POST /approve -> optimistic UI update -> receive `approval.resolved` event
6. Implement inline `ApprovalItem` in timeline (shows decision after resolution)
7. Implement `ToolRequestItem` as a collapsible card showing tool name, args, output, and status progression

**Acceptance criteria:**
- When a tool needs approval, a modal appears with tool details and risk level
- User can allow/deny once or always (with scope selection)
- Decision is reflected in the timeline as an inline card
- Tool output appears in the collapsible card after execution

**Dependencies:** M0.4, M0.5

---

### M0.7: Runner -- PTY Adapter + xterm.js in UI (Terminal Tab)

**Description:** Implement the PTY adapter in Runner and the xterm.js terminal tab in the UI for CLI parity mode.

**Tasks:**
1. Implement `PtyAdapter` class: spawn `claude` PTY (node-pty), relay output as `pty.data` events (base64 encoded)
2. Implement `TmuxBridge`: optionally spawn inside tmux for session persistence
3. Implement `resize-handler`: handle terminal resize events from UI
4. Implement PTY reconnect: if tmux is enabled, reattach to existing tmux session
5. Implement REST endpoint: `POST /api/v1/sessions/:id/mode` (switch between sdk/pty)
6. Emit `pty.opened`, `pty.data`, `pty.closed` events over WebSocket
7. Implement `XTermContainer` React component: initialize xterm.js, wire to WS for input/output
8. Implement `TerminalToolbar`: connect/disconnect button, tmux session selector
9. Handle resize: `ResizeObserver` on container -> `FitAddon.fit()` -> send resize event to Runner
10. Add Terminal tab to the tab bar navigation

**Acceptance criteria:**
- Switching to Terminal tab opens a PTY to `claude` REPL
- Keystrokes are sent to Runner; terminal output renders in xterm.js
- Terminal resizes correctly when the browser window changes
- With tmux enabled, disconnecting and reconnecting preserves terminal state
- PTY session can be killed from the toolbar

**Dependencies:** M0.3, M0.5

---

### M0.8: UI -- MCP Panel + Plugin Panel (Read-Only First)

**Description:** Add read-only MCP and plugin management panels that display current state from the Runner.

**Tasks:**
1. Implement `McpView`: fetch `GET /api/v1/mcp/servers`, render server list with status indicators (running/stopped/error)
2. Implement `McpServerCard` with status dot, transport badge, tool list, error display
3. Implement `PluginsView`: fetch `GET /api/v1/plugins/installed`, render plugin list with version, scope, enabled toggle
4. Implement `PluginCard` with enable/disable toggle, version, capabilities badges
5. Add MCP and Plugins tabs to the tab bar
6. Poll MCP server status every 15 seconds for health updates

**Acceptance criteria:**
- MCP tab shows all configured MCP servers with their status
- Plugins tab shows all installed plugins with their enabled state
- Server errors are displayed inline
- Panels auto-refresh on interval

**Dependencies:** M0.5

---

### M0.9: Runner -- MCP Management CLI Wrappers

**Description:** Implement full MCP management via CLI wrappers and expose through REST API and UI.

**Tasks:**
1. Implement `McpWrapper` class: `listServers()`, `addServer()`, `removeServer()`, `triggerAuth()`
2. Implement REST endpoints: `POST /api/v1/mcp/servers`, `DELETE /api/v1/mcp/servers/:name`, `POST /api/v1/mcp/servers/:name/auth`
3. Implement JSON stdout parsing with fallback to text parsing
4. Add OAuth URL surfacing: when auth is required, return the auth URL to the UI
5. Update `McpView` in UI: add `McpAddForm` (server name, transport selector, config JSON input)
6. Add remove button to `McpServerCard`
7. Add "Authenticate" button for servers with OAuth errors

**Acceptance criteria:**
- User can add an MCP server from the UI (name, transport, config)
- User can remove an MCP server
- OAuth-required servers show an "Authenticate" button that opens the auth URL
- Server list updates after add/remove operations

**Dependencies:** M0.8

---

### M0.10: Runner -- Plugin Management CLI Wrappers

**Description:** Implement full plugin management via CLI wrappers and expose through REST API and UI.

**Tasks:**
1. Implement `PluginWrapper` class: `listInstalled()`, `install()`, `update()`, `uninstall()`, `setEnabled()`
2. Implement REST endpoints: `POST /api/v1/plugins/install`, `POST /api/v1/plugins/update`, `POST /api/v1/plugins/uninstall`, `POST /api/v1/plugins/enable`, `POST /api/v1/plugins/disable`
3. Implement marketplace endpoints: `GET /api/v1/plugins/marketplaces`, `POST /api/v1/plugins/marketplaces/add`
4. Update `PluginsView` in UI: add install form, update/uninstall buttons, enable/disable toggles
5. Surface plugin capabilities (commands, skills, hooks, MCP, LSP) when parseable from CLI output

**Acceptance criteria:**
- User can install a plugin by package name
- User can enable/disable, update, and uninstall plugins
- Plugin list refreshes after operations
- CLI errors are surfaced in the UI

**Dependencies:** M0.8

---

### M0.11: /compact Support

**Description:** Implement `/compact` slash command support in SDK mode.

**Tasks:**
1. Implement `SlashHandler` class: parse slash commands, route to appropriate handler
2. Implement `/compact` handler: call Agent SDK compact with optional user instructions
3. Implement REST endpoint: `POST /api/v1/sessions/:id/slash`
4. Emit `slash.invoked` and `slash.result` events
5. Store compact snapshot marker in session (in-memory for Phase 0)
6. Implement `SlashResultItem` in UI timeline (shows compact marker with summary)
7. Update `Composer` to detect `/` prefix and show helper suggestions

**Acceptance criteria:**
- User can type `/compact Focus on auth module` in the composer
- Compact executes and a snapshot marker appears in the timeline
- `slash.result` event shows success message
- Conversation context is compacted; subsequent messages work correctly

**Dependencies:** M0.3, M0.5

---

### M0.12: Polish, E2E Tests, Phase 0 Release

**Description:** End-to-end integration, polish, and release preparation.

**Tasks:**
1. Implement `StatusBar` component: runner connection status, active session info
2. Implement `NotificationToast` for approval alerts, errors, reconnect status
3. Implement error and offline UX: runner offline banner, reconnect indicator
4. Implement WebSocket reconnect with sequence number tracking and event replay
5. Implement `GET /api/v1/sessions/:id/timeline` with cursor-based pagination for initial load and infinite scroll
6. Implement Runner health endpoint: `GET /health` returning status, uptime, version, active sessions
7. Add keyboard navigation for sidebar and tabs (accessibility)
8. Add screen reader labels for tool and approval cards
9. Write Playwright E2E tests for PRD scenarios:
   - Scenario 1: Start a new session on a project
   - Scenario 3: Approve/deny tool runs with "always" scope
   - Scenario 4: Run `/compact` and continue
   - Scenario 7: Open Terminal tab for REPL behavior
10. Performance: verify <2s load for last 200 timeline events
11. Documentation: write a README with setup instructions, config reference

**Acceptance criteria:**
- All 4 E2E scenarios pass in Playwright
- Timeline loads last 200 events in under 2 seconds
- WebSocket reconnects automatically after disconnect
- Status bar shows real-time connection status
- Runner can be started with `pnpm --filter @claude-ui/runner start`
- UI can be built with `pnpm --filter @claude-ui/web build`

**Dependencies:** M0.1-M0.11

---

## 4. Phase 1 -- Hub (Multi-Device)

### M1.1: Hub Scaffold + Auth + Runner Registration

**Description:** Create the Hub service with JWT auth, Fastify server, and runner registration protocol.

**Tasks:**
1. Create `apps/hub/` with Fastify server setup
2. Implement JWT auth service: `issueTokens()`, `verifyToken()`, `refreshTokens()` using jose library
3. Implement auth middleware (JWT validation on all routes)
4. Implement auth endpoints: `POST /api/v1/auth/token` (password grant + refresh grant)
5. Implement `RunnerRegistry`: register, deregister, update status, list active runners
6. Implement WebSocket gateway: accept runner connections, verify auth, handle `runner.register` handshake
7. Implement runner heartbeat monitoring: mark offline after 3x heartbeat interval (45s)
8. Setup Docker Compose: Hub + PostgreSQL for local development

**Acceptance criteria:**
- Hub starts and accepts JWT-authenticated connections
- Runner can register via WebSocket handshake
- Hub tracks runner status (online/offline)
- Runner heartbeat failure marks runner as offline
- `POST /auth/token` issues access + refresh token pair

**Dependencies:** M0.12

---

### M1.2: Event Store (Postgres) + Timeline Replay

**Description:** Implement the append-only event store in PostgreSQL with Drizzle ORM.

**Tasks:**
1. Implement Drizzle schema for all tables: `projects`, `sessions`, `session_events`, `session_snapshots`, `approvals`, `runner_registry`, `plugin_state`, `mcp_state`, `credentials`
2. Generate initial migration with Drizzle Kit
3. Implement `EventStore` class: `append()`, `appendBatch()`, `timeline()`, `latestEvents()`
4. Implement cursor-based pagination for timeline queries
5. Implement idempotent insert (ON CONFLICT DO NOTHING on event.id)
6. Implement `SessionRegistry` with in-memory cache + Postgres backing
7. Write integration tests: insert events, query timeline with cursor pagination, verify ordering

**Acceptance criteria:**
- All tables created via migration
- Events persist to Postgres with correct JSONB payloads
- Timeline query returns events in (ts, id) order with cursor pagination
- Idempotent insert handles duplicate event IDs gracefully
- Session registry caches active sessions in memory

**Dependencies:** M1.1

---

### M1.3: WebSocket Gateway + Fan-Out

**Description:** Implement the Hub's WebSocket gateway that accepts UI clients and fans out events from runners.

**Tasks:**
1. Implement `ConnectionManager`: track connections by type (runner/ui), map runners to sessions
2. Implement `RoomManager`: session-based rooms, subscribe/unsubscribe, broadcast
3. Implement controller lock: one UI client is "controller" per session, others are "followers"
4. Implement "take control" handoff between devices
5. Wire up event flow: Runner sends event -> Hub persists to EventStore -> Hub broadcasts to room subscribers
6. Implement backpressure handling: detect slow clients, send `session.catchUp` instruction
7. Implement UI client WS message handling: subscribe, unsubscribe, session.command, session.takeControl

**Acceptance criteria:**
- UI client can subscribe to a session and receive live events
- Multiple UI clients connected to the same session all receive events
- Only the controller can send commands; followers see events in read-only mode
- "Take control" transfers controller status
- Slow clients receive catch-up instruction instead of dropped events

**Dependencies:** M1.2

---

### M1.4: Runner Outbound Connection to Hub

**Description:** Update the Runner to establish an outbound WebSocket connection to Hub and relay events.

**Tasks:**
1. Implement Runner `WsClient`: connect to Hub via WSS, send `runner.register` handshake
2. Implement exponential backoff reconnection with jitter
3. Implement heartbeat: send ping every 15s, close connection if no pong within 30s
4. Wire up event flow: Runner emits event -> if Hub connected, send over WS; else buffer locally
5. Implement `EventBuffer`: append events to JSONL file when Hub is offline
6. Implement `BufferFlusher`: on Hub reconnect, send buffered events as `event.backfill` batches
7. Hub handles backfill: insert with idempotent upsert, send `backfill.ack`

**Acceptance criteria:**
- Runner connects outbound to Hub on startup (no inbound ports required)
- Events flow from Runner through Hub to UI clients
- Runner reconnects automatically after Hub disconnection
- Events buffered during offline are flushed on reconnect
- Duplicate events from backfill are handled gracefully (no duplicates in timeline)

**Dependencies:** M1.3

---

### M1.5: UI Connects to Hub (Not Runner Directly)

**Description:** Update the UI to connect to Hub instead of directly to Runner.

**Tasks:**
1. Update `api-client.ts` and `ws-client.ts` to use Hub URL (configurable: direct Runner or Hub)
2. Implement JWT-based auth flow in UI: login form, store tokens, auto-refresh before expiry
3. Implement `AuthProvider` context: manage access/refresh tokens, redirect to login when expired
4. Update WebSocket connection to include JWT in connection params
5. Add connection mode indicator in StatusBar: "Direct (LAN)" vs "Hub (remote)"
6. Test multi-device: two browser tabs connected to the same session via Hub

**Acceptance criteria:**
- UI connects to Hub, authenticates with JWT
- Events from Runner arrive at UI through Hub
- Token refresh happens transparently before expiry
- Two browser tabs see the same session in real-time
- "Follow mode" indicator appears on the non-controller tab

**Dependencies:** M1.3, M1.4

---

### M1.6: Session Persistence + Resume After Disconnect

**Description:** Implement session resume with full timeline replay after reconnect.

**Tasks:**
1. Implement `lastEventSeq` tracking in UI: store highest received sequence number
2. On WebSocket reconnect: send `subscribe { sessionId, lastEventSeq }` to Hub
3. Hub replays events from EventStore where `seq > lastEventSeq`
4. Implement gap detection: if Hub's oldest available event has `seq > lastEventSeq + 1`, return `subscribe.error` with `reason: "gap"`
5. On gap: UI falls back to `GET /sessions/:id/timeline` for full reload
6. Implement session resume: `POST /api/v1/sessions/:id/resume` restarts the SDK session
7. Test: disconnect Runner, send events, reconnect, verify all events appear in UI

**Acceptance criteria:**
- After WebSocket reconnect, UI replays any missed events seamlessly
- No events are lost during disconnect/reconnect cycle
- Gap detection triggers full timeline reload when necessary
- Sessions can be resumed after Runner restart

**Dependencies:** M1.5

---

## 5. Phase 2 -- Teams (Outline Only)

### M2.1: User Management + Teams
- Add `users` and `teams` tables to Postgres
- Implement user registration, login, profile management
- Implement team creation, member invitation, member removal
- Add `team_id` foreign key to sessions and projects

### M2.2: RBAC + Permissions
- Add `roles` and `team_member_roles` tables
- Implement role-based access control: admin, member, viewer
- Enforce RBAC on all Hub API endpoints
- Add RBAC claims to JWT tokens
- Implement per-team approval policies (which tools require approval, default scopes)

### M2.3: Workspaces + Runner Pools
- Add `workspaces` table (logical grouping within a team)
- Implement runner pool management: assign runners to teams/workspaces
- Hub load-balances session creation across available runners in a pool
- Implement per-team plugin/MCP policy enforcement

### M2.4: Secrets Isolation
- Implement per-team encryption keys for `credentials` table
- Runner only decrypts secrets for its assigned team
- Add secrets management UI (add/remove/rotate credentials per team)

### M2.5: Audit + Compliance
- Implement comprehensive audit logging for all team actions
- Add audit log viewer in UI (admin only)
- Export audit logs for compliance

---

## 6. Testing Strategy

### Unit Tests (Vitest)

| Package | What to Test |
|---------|-------------|
| `@claude-ui/protocol` | Zod schema validation (valid + invalid payloads for all 17 event types, all API schemas); envelope factory; ID generation |
| `@claude-ui/shared` | Utility functions; type guards; constants |
| `@claude-ui/runner` | `ProjectScanner` (mock fs); `ToolApproval` rule matching + scope hierarchy; `PluginWrapper`/`McpWrapper` output parsing; config schema validation; event envelope creation |
| `@claude-ui/hub` | `SessionRegistry` cache behavior; `ConnectionManager` add/remove/lookup; `RoomManager` subscribe/broadcast; `EventStore` query building; JWT issuance/validation; backpressure detection |
| `@claude-ui/web` | `buildTimelineItems` (event grouping logic); `useWebSocket` hook (mock WS); Zustand store actions; component rendering (React Testing Library) for `ApprovalModal`, `ToolRequestItem`, `Composer` |

### Integration Tests (Vitest + Supertest)

| Scenario | Components | What to Verify |
|----------|-----------|---------------|
| Approval pause/resume | Runner (SDK + ToolApproval + API) | Tool call triggers approval.requested; POST /approve resolves it; SDK resumes; tool.output + tool.completed arrive |
| Event store CRUD | Hub (EventStore + Postgres) | Append, idempotent insert, timeline query with cursor, latest events, type filtering |
| Runner-Hub protocol | Runner (WsClient) + Hub (Gateway) | Registration handshake, event relay, backfill after reconnect, heartbeat timeout |
| REST API validation | Runner or Hub (Fastify + Zod) | Invalid payloads return 400 with VALIDATION_ERROR; missing auth returns 401 |
| Session lifecycle | Runner (SessionManager + SDK) | Create -> send message -> receive events -> fork -> end |

### E2E Tests (Playwright)

Based on PRD scenarios 1-7:

| Scenario | Steps | Assertions |
|----------|-------|------------|
| **S1: New session from browser** | Open UI -> select project -> create session -> send message | Timeline shows user message + streaming assistant response |
| **S2: Continue session after disconnect** | Send message -> kill WS -> reconnect | Timeline shows all events including ones during disconnect |
| **S3: Approve tool with "always" scope** | Trigger tool call -> approve with "always (project)" -> trigger same tool again | First call shows modal; second call auto-approves without modal |
| **S4: /compact** | Send messages to build context -> type `/compact Focus on X` -> send another message | Compact marker appears in timeline; subsequent message works |
| **S5: MCP management** | Navigate to MCP tab -> add server -> verify status -> remove server | Server appears in list with status; removed server disappears |
| **S6: Plugin management** | Navigate to Plugins tab -> toggle enable/disable -> verify state | Plugin enabled state toggles correctly |
| **S7: Terminal parity** | Switch to Terminal tab -> type command -> see output | xterm.js renders terminal output; keystrokes work |

### Contract Tests

- Validate every event emitted by Runner conforms to the Zod schema in `@claude-ui/protocol`
- Validate every API response from Runner and Hub conforms to the response Zod schema
- Run contract tests as part of integration test suite
- Use Zod `.parse()` on actual runtime data to catch drift between code and schema

---

## 7. CI/CD Pipeline

### GitHub Actions Workflow

#### Per-PR: `ci.yml`

```yaml
name: CI
on: [pull_request]

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: pnpm install --frozen-lockfile
      - run: turbo run typecheck
      - run: turbo run lint
      - run: turbo run test          # Unit + integration tests

  integration:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_DB: claude_ui_test
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
        ports: ['5432:5432']
        options: --health-cmd pg_isready --health-interval 10s --health-timeout 5s --health-retries 5
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: pnpm install --frozen-lockfile
      - run: turbo run test:integration
        env:
          DATABASE_URL: postgres://test:test@localhost:5432/claude_ui_test
```

#### On Merge to Main: `deploy.yml`

```yaml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: pnpm install --frozen-lockfile
      - run: turbo run build

  e2e:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: pnpm install --frozen-lockfile
      - run: npx playwright install --with-deps
      - run: turbo run build
      - run: turbo run test:e2e

  docker:
    needs: [build, e2e]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/build-push-action@v5
        with:
          context: .
          file: docker/Dockerfile.hub
          push: true
          tags: ghcr.io/${{ github.repository }}/hub:latest
```

### Deployment Targets

| Component | Phase 0 | Phase 1 |
|-----------|---------|---------|
| Runner | Manual start: `node dist/index.js` or launchd service on macOS | Same (runs on user's machine) |
| Hub | N/A | Docker container (self-hosted VPS, cloud VM, or cloud service) |
| Postgres | N/A (SQLite local buffer) | Docker sidecar or managed Postgres (e.g., Neon, Supabase, RDS) |
| UI | Static files served by Runner | Static files served by Runner or CDN |

---

## 8. Development Kickoff Checklist

Step-by-step instructions for day 1:

1. **Prerequisites**
   - [ ] Install Node.js 20 LTS
   - [ ] Install pnpm: `npm install -g pnpm`
   - [ ] Install Claude Code CLI (for PTY mode and CLI wrappers)
   - [ ] Ensure `claude` command is available in PATH
   - [ ] (Optional) Install tmux for persistent terminal sessions
   - [ ] (Optional) Install Docker + Docker Compose for Hub development

2. **Clone and Setup**
   - [ ] Clone the repository
   - [ ] Run `pnpm install` from root
   - [ ] Verify `turbo run build` succeeds with no errors

3. **Start M0.1 -- Protocol Package**
   - [ ] Create `packages/protocol/` and `packages/shared/`
   - [ ] Define `EventEnvelope` type and Zod schema in `packages/protocol/src/envelope.ts`
   - [ ] Define all 17 event types with Zod schemas under `packages/protocol/src/events/`
   - [ ] Define all API request/response types with Zod schemas under `packages/protocol/src/api/`
   - [ ] Write and pass unit tests for all schemas
   - [ ] Verify `turbo run build && turbo run test` passes

4. **Start M0.2 -- Runner Skeleton**
   - [ ] Create `apps/runner/` with Fastify server
   - [ ] Implement config loading from `runner.config.yaml`
   - [ ] Implement static token auth middleware
   - [ ] Implement project scanner
   - [ ] Implement `GET /api/v1/projects` endpoint
   - [ ] Verify Runner starts and responds to authenticated requests

5. **Continue with M0.3 through M0.12**
   - Follow the milestone ordering above
   - Each milestone builds on the previous; never skip ahead
   - Run `turbo run test` after each milestone to verify nothing is broken
   - Commit at the end of each milestone with a clear message referencing the milestone number

6. **Development Commands**
   ```bash
   # Install dependencies
   pnpm install

   # Build all packages and apps
   turbo run build

   # Run all tests
   turbo run test

   # Start Runner in dev mode (with HMR)
   pnpm --filter @claude-ui/runner dev

   # Start UI in dev mode (with HMR)
   pnpm --filter @claude-ui/web dev

   # Start Hub in dev mode (Phase 1)
   pnpm --filter @claude-ui/hub dev

   # Start Hub + Postgres via Docker Compose (Phase 1)
   docker compose -f docker/docker-compose.yml up

   # Run E2E tests
   pnpm --filter @claude-ui/web test:e2e

   # Typecheck all packages
   turbo run typecheck

   # Lint all packages
   turbo run lint

   # Generate DB migration (Phase 1)
   pnpm --filter @claude-ui/hub drizzle-kit generate

   # Apply DB migration (Phase 1)
   pnpm --filter @claude-ui/hub drizzle-kit migrate
   ```
