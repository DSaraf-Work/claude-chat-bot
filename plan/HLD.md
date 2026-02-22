# High-Level Design -- Portable UI for Claude Code
_Generated: 2026-02-22_

This document describes the high-level architecture, technology choices, data flows, and deployment topology for the Portable UI for Claude Code project. It is informed by the PRD, TECH_DOC, UI_UX_PLAN, and RESEARCH documents.

---

## 1. System Context Diagram

```
+-------------------+          +-------------------+
|                   |          |                   |
|   User / Browser  |          |  User / Mobile    |
|   (Desktop)       |          |  (Phone/Tablet)   |
|                   |          |                   |
+--------+----------+          +--------+----------+
         |                              |
         |  HTTPS / WSS                 |  HTTPS / WSS
         |                              |
         v                              v
+--------+------------------------------+----------+
|                                                   |
|                     HUB (Phase 1+)                |
|  +-------------+  +-----------+  +-------------+  |
|  | Auth &      |  | WebSocket |  | REST API    |  |
|  | Session     |  | Gateway   |  | Gateway     |  |
|  | Registry    |  |           |  |             |  |
|  +------+------+  +-----+-----+  +------+------+  |
|         |               |               |          |
|         +-------+-------+-------+-------+          |
|                 |                                   |
|          +------+------+                            |
|          |  Postgres   |                            |
|          |  (Events,   |                            |
|          |   Sessions, |                            |
|          |   Projects) |                            |
|          +-------------+                            |
+-------------------+-------------------------------+
                    |
                    | WSS (outbound from Runner)
                    |
+-------------------+-------------------------------+
|                                                   |
|                  RUNNER (macOS)                    |
|  +-------------+  +-------------+  +----------+   |
|  | Agent SDK   |  | PTY Adapter |  | CLI      |   |
|  | Runtime     |  | (node-pty)  |  | Wrappers |   |
|  | (Sessions)  |  |             |  | (plugin, |   |
|  +------+------+  +------+------+  |  mcp)    |   |
|         |                |          +----+-----+   |
|         v                v               |         |
|  +------+------+  +------+------+        |         |
|  | Claude      |  | claude REPL |        |         |
|  | Agent SDK   |  | (PTY/tmux)  |        v         |
|  +------+------+  +-------------+  +-----+------+  |
|         |                          | claude CLI  |  |
|         v                          +-------------+  |
|  +------+------+                                    |
|  | Claude API  | <--- HTTPS (Anthropic API) -----+  |
|  | (Anthropic) |                                     |
|  +-------------+                                     |
|                                                      |
|  +-------------+  +-------------+  +-----------+     |
|  | Local FS    |  | Git Repos   |  | SSH Hosts |     |
|  | (Projects)  |  | (.git)      |  | (Remote)  |     |
|  +-------------+  +-------------+  +-----------+     |
+------------------------------------------------------+

Phase 0 (no Hub):
  User/Browser <--- WSS/HTTPS ---> Runner (localhost / LAN / Tailscale)
```

### External Actors

| Actor | Protocol | Description |
|-------|----------|-------------|
| User/Browser (Desktop) | HTTPS, WSS | Primary UI client |
| User/Mobile (Phone/Tablet) | HTTPS, WSS | Secondary UI client (responsive web / PWA) |
| Claude API (Anthropic) | HTTPS | LLM inference via Agent SDK |
| Git Remotes | SSH/HTTPS | Push/pull operations for project repos |
| SSH Hosts | SSH | Remote host access for workspace operations |
| MCP Servers | stdio/HTTP/SSE | External tool servers managed by Runner |

---

## 2. Component Overview

### 2.1 Runner

| Attribute | Value |
|-----------|-------|
| **Purpose** | Executes Claude Code sessions (SDK structured + PTY raw), manages workspace access, MCP servers, and plugins |
| **Deployment Unit** | Single-process macOS service (launchd or manual) |
| **Language/Runtime** | **TypeScript on Node.js (v20 LTS)** |

**Justification:** The Claude Agent SDK is a TypeScript/JavaScript library. Running the Runner on Node.js avoids FFI bridges and provides first-class SDK integration. Node.js has mature PTY support via `node-pty`, excellent WebSocket libraries, and strong filesystem APIs. The Runner's workload (streaming I/O, event relay, PTY management) maps well to Node.js's event-loop model.

### 2.2 Hub

| Attribute | Value |
|-----------|-------|
| **Purpose** | Auth gateway, session registry, append-only event store, WebSocket fan-out relay |
| **Deployment Unit** | Docker container or standalone binary; deployable on LAN, VPS, or cloud |
| **Language/Runtime** | **TypeScript on Node.js (v20 LTS)** |

**Justification:** Using the same runtime as Runner allows shared packages (event types, protocol schemas, validation logic) in a monorepo. Hub's workload is I/O-bound (WebSocket relay, Postgres writes), which Node.js handles well. A single language across the stack reduces cognitive overhead and simplifies hiring/onboarding.

### 2.3 UI

| Attribute | Value |
|-----------|-------|
| **Purpose** | Renders chat timeline, approval modals, terminal parity tab, file/git browsers, MCP/plugin panels |
| **Deployment Unit** | Static SPA bundle served by Runner (Phase 0) or a CDN/static host (Phase 1+) |
| **Language/Runtime** | **TypeScript + React + Vite** |

**Justification:** React has the largest ecosystem for complex, stateful UIs with streaming data. The chat timeline requires fine-grained re-renders for streaming deltas, which React's reconciliation handles well. Vite provides fast HMR during development and optimized builds for production. A Vite SPA (rather than Next.js SSR) is chosen because the UI is a client-side application with no SEO requirements, no server-side data fetching, and connects to Runner/Hub via WebSocket and REST. SSR adds complexity without benefit here.

---

## 3. Technology Stack Decisions

### 3.1 Runner Runtime: Node.js

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| **Node.js** | Native Agent SDK support; mature PTY (node-pty); shared language with UI | Single-threaded; PTY can be CPU-bound for large outputs | **Selected** |
| Bun | Faster startup; compatible with Node APIs | Less mature; node-pty compatibility uncertain; smaller ecosystem for native modules | Rejected |
| Python | Good subprocess/PTY support | Agent SDK is TypeScript; two-language stack; no shared types | Rejected |

### 3.2 Hub Runtime: Node.js

Same runtime as Runner. Shared `@claude-ui/protocol` and `@claude-ui/shared` packages eliminate type drift between components.

### 3.3 UI Framework: React + Vite SPA

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| **React + Vite** | Largest ecosystem; excellent streaming support; Vite fast builds | Bundle size; React learning curve (mitigated: widely known) | **Selected** |
| Next.js | SSR, file routing | SSR not needed for this use case; adds server complexity | Rejected |
| Vue + Vite | Smaller bundle; good reactivity | Smaller ecosystem for terminal/chat components | Rejected |
| Svelte | Smallest bundle; compiled reactivity | Smallest ecosystem; fewer ready-made components | Rejected |

### 3.4 Database: PostgreSQL with Drizzle ORM

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| **Drizzle** | Type-safe; SQL-first (not abstracted); lightweight; great migration tooling | Newer than alternatives | **Selected** |
| Prisma | Popular; great DX | Heavy runtime; query engine binary; overkill for append-only workload | Rejected |
| Knex | Mature query builder | Less type safety; more boilerplate | Rejected |
| Raw pg | Maximum control | No type safety; manual migrations | Rejected |

**Rationale:** Drizzle provides TypeScript type safety with minimal runtime overhead. Its SQL-first approach is a good fit for the append-only event store pattern where we need precise control over queries (cursor pagination, JSONB operations). Drizzle Kit handles migrations cleanly.

### 3.5 WebSocket: ws (native)

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| **ws** | Lightweight; no bloat; full control over protocol | Manual reconnect/rooms logic | **Selected** |
| Socket.io | Auto-reconnect; rooms; fallback transport | Heavy; opinionated; adds abstraction over a protocol we need to control precisely | Rejected |

**Rationale:** The event protocol has specific requirements (sequence numbers, gap detection, session subscriptions) that are better served by a thin WebSocket layer with custom logic than by Socket.io's opinionated abstractions. The `ws` library is the de facto standard for Node.js WebSocket servers.

### 3.6 Terminal: xterm.js + xterm-addon-fit + xterm-addon-web-links

Standard choice. xterm.js is the only production-grade terminal emulator for the web. Addons provide responsive resizing and clickable URLs.

### 3.7 PTY: node-pty

Standard choice. node-pty is the only actively maintained PTY library for Node.js. It supports macOS, handles spawn/resize/kill, and integrates naturally with the Node.js event loop.

### 3.8 Authentication

| Phase | Mechanism | Details |
|-------|-----------|---------|
| **Phase 0** | **Static bearer token** | Generated on Runner startup, displayed in console, stored in `~/.claude-ui/config.json`. Client sends in `Authorization: Bearer <token>` header on HTTP and as first WS message. Simple, sufficient for single-user LAN/Tailscale. |
| **Phase 1** | **JWT (short-lived access + refresh tokens)** | Hub issues JWTs on login. Access token (15 min) sent in headers. Refresh token (7 days) in httpOnly cookie. Hub validates on every request. Runner trusts Hub-signed tokens. |
| **Phase 2** | **JWT + RBAC claims** | Team/role claims embedded in JWT. Hub enforces RBAC policies. |

**Rationale:** Phase 0 needs minimal friction for a single user. A static token avoids an auth server while still preventing unauthorized access. Phase 1 introduces JWTs because Hub needs stateless verification of user identity across multiple Runners. JWTs carry claims (userId, runnerId scopes) without a session store lookup.

### 3.9 Tunneling: Tailscale (Phase 0), Outbound WebSocket (Phase 1)

- **Phase 0:** Tailscale creates a private overlay network. Runner binds to the Tailscale IP. No port forwarding or firewall changes needed. Users access via `https://<tailscale-hostname>:<port>`.
- **Phase 1:** Runner establishes an outbound WSS connection to Hub. No inbound ports on the user's network. Hub reverse-proxies commands to Runner through this tunnel.

---

## 4. Data Flow Diagrams

### 4.1 SDK Mode: Chat Turn

```
User/Browser                    Hub (Phase 1)              Runner                    Claude API
     |                              |                        |                           |
     |-- user.message (REST) ------>|                        |                           |
     |                              |-- forward (WS) ------->|                           |
     |                              |                        |-- SDK.sendMessage() ----->|
     |                              |                        |                           |
     |                              |                        |<-- streaming tokens ------|
     |                              |<-- assistant.delta ----|                           |
     |<-- assistant.delta (WS) ----|                        |                           |
     |<-- assistant.delta (WS) ----|<-- assistant.delta ----|                           |
     |       ... (N deltas) ...     |                        |                           |
     |                              |                        |<-- message complete ------|
     |                              |<-- assistant.message --|                           |
     |<-- assistant.message (WS) --|                        |                           |
     |                              |                        |                           |
     |                              |-- persist events ----->|                           |
     |                              |   (Postgres)           |                           |
```

**Phase 0 variant:** UI sends REST directly to Runner; Runner responds with events over WebSocket. No Hub in the path.

### 4.2 PTY Mode: Terminal Session

```
User/Browser (xterm.js)         Hub (Phase 1)              Runner
     |                              |                        |
     |-- pty.open (WS) ----------->|                        |
     |                              |-- forward (WS) ------->|
     |                              |                        |-- spawn claude PTY ---+
     |                              |                        |   (node-pty / tmux)   |
     |                              |                        |                       |
     |                              |<-- pty.opened ---------|                       |
     |<-- pty.opened (WS) ---------|                        |                       |
     |                              |                        |                       |
     |-- keystrokes (WS) --------->|-- forward (WS) ------->|-- write to PTY stdin  |
     |                              |                        |                       |
     |                              |<-- pty.data -----------|<-- PTY stdout bytes --+
     |<-- pty.data (WS) ----------|                        |
     |   (render in xterm.js)      |                        |
     |                              |                        |
     |-- resize event (WS) ------->|-- forward (WS) ------->|-- PTY resize -------->|
     |                              |                        |                       |
     |-- disconnect --------------->|                        |-- (PTY stays alive    |
     |                              |                        |    if tmux attached)  |
     |-- reconnect ---------------->|                        |                       |
     |                              |<-- pty.data (replay) --|<-- tmux scrollback ---+
     |<-- pty.data (WS) ----------|                        |
```

### 4.3 Approval Flow

```
Runner                          Hub                         User/Browser
  |                              |                              |
  |-- Agent SDK wants to call ---|                              |
  |   tool (canUseTool fires)    |                              |
  |                              |                              |
  |-- tool.requested ----------->|-- tool.requested (WS) ----->|
  |-- approval.requested ------->|-- approval.requested (WS) ->|
  |                              |                              |
  |   [Runner execution PAUSED]  |                              |-- Show approval modal
  |                              |                              |   (tool name, args,
  |                              |                              |    risk level)
  |                              |                              |
  |                              |<-- POST /approve ------------|  User decides
  |<-- approval.resolved --------|-- approval.resolved (WS) -->|
  |                              |                              |
  |   [Runner execution RESUMED] |                              |-- Update card: approved
  |                              |                              |
  |-- tool.output -------------->|-- tool.output (WS) -------->|-- Show output
  |-- tool.completed ----------->|-- tool.completed (WS) ----->|-- Mark complete
```

**Key details:**
- Runner blocks in `canUseTool` callback via a Promise that resolves when `approval.resolved` is received.
- Timeout: if no approval within 5 minutes, Runner auto-denies and emits `approval.resolved` with `decision: "denied"` and `reason: "timeout"`.
- Multi-device: only the "controller" device can approve. Other devices see the modal in read-only "follow mode."
- Scope persistence: if the user selects "allow always (project)," the decision is stored in the `approvals` table and future `canUseTool` checks for the same tool in that project are auto-resolved without UI prompts.

---

## 5. WebSocket Event Architecture

### 5.1 Connection Lifecycle

```
Client                          Server (Hub or Runner)
  |                                  |
  |-- WSS connect ------------------>|
  |                                  |-- validate auth token
  |<-- connection.ack { clientId } --|
  |                                  |
  |-- subscribe { sessionId,         |
  |     lastEventSeq } ------------>|
  |                                  |-- lookup session
  |                                  |-- if lastEventSeq provided:
  |                                  |      replay events since seq
  |<-- event (replayed, N times) ---|
  |<-- subscribe.ack { currentSeq }--|
  |                                  |
  |   ... live event stream ...      |
  |<-- event { seq, ... } ----------|
  |                                  |
  |-- unsubscribe { sessionId } --->|
  |<-- unsubscribe.ack -------------|
  |                                  |
  |-- ping (every 30s) ------------>|
  |<-- pong ------------------------|
```

### 5.2 Subscription Model

- A client subscribes to **one session at a time** (the active session in the UI).
- Hub maintains a subscription map: `sessionId -> Set<clientId>`.
- When a Runner emits an event for a session, Hub looks up all subscribed clients and fans out.
- Runner-to-Hub connection: the Runner subscribes to **all its own sessions** (it needs to receive approval responses and user messages).

### 5.3 Reconnect and Replay Strategy

1. **Sequence numbers:** Every event within a session gets a monotonically increasing `seq` number assigned by the authoritative store (Hub in Phase 1, Runner in Phase 0).
2. **Client tracks `lastSeq`:** The UI stores the highest `seq` it has processed.
3. **On reconnect:** Client sends `subscribe { sessionId, lastEventSeq }`. Server replays all events with `seq > lastEventSeq`.
4. **Gap detection:** If the server's oldest available event has `seq > lastEventSeq + 1`, it indicates a gap. Server responds with `subscribe.error { reason: "gap", oldestAvailableSeq }`. Client must do a full timeline reload via `GET /api/v1/sessions/:id/timeline`.
5. **Exponential backoff:** Client reconnects with jittered exponential backoff: 1s, 2s, 4s, 8s, max 30s.
6. **Heartbeat:** Client sends `ping` every 30 seconds. If no `pong` received within 10 seconds, client considers connection dead and initiates reconnect.

### 5.4 Event Ordering Guarantees

- **Within a session:** Events are strictly ordered by `seq`. The authoritative store (Hub or Runner) assigns `seq` at write time.
- **Across sessions:** No ordering guarantee. Each session has its own sequence space.
- **Runner-to-Hub backfill:** When a Runner reconnects after being offline, it sends buffered events with their original `id` and `ts`. Hub inserts them with idempotent upsert (unique on `event.id`), then assigns `seq` in `ts` order to maintain timeline consistency.
- **Clock skew:** The `ts` field uses the Runner's clock. The `seq` field (assigned by Hub) is the authoritative ordering. Clients must sort by `seq`, not `ts`.

---

## 6. Deployment Topology per Phase

### Phase 0: Runner Only

```
+-------------------------------------------------------+
|  User's Mac                                            |
|                                                        |
|  +------------------+     +-------------------------+  |
|  |  Runner           |     |  Embedded UI Server     |  |
|  |  (Node.js)        |     |  (serves static SPA)    |  |
|  |                   |     +-------------------------+  |
|  |  +-------------+  |                                  |
|  |  | Agent SDK   |  |     +-------------------------+  |
|  |  +-------------+  |     |  SQLite (local buffer)  |  |
|  |  | PTY Adapter |  |     +-------------------------+  |
|  |  +-------------+  |                                  |
|  |  | REST API    |  |                                  |
|  |  +-------------+  |                                  |
|  |  | WS Server   |  |                                  |
|  |  +-------------+  |                                  |
|  +------------------+                                  |
|         ^                                              |
+---------+----------------------------------------------+
          | localhost:3000 or LAN IP or Tailscale IP
          |
    +-----+-----+
    | Browser /  |
    | Phone      |
    | (via LAN / |
    |  Tailscale)|
    +-----------+
```

**Details:**
- Runner serves the UI SPA as static files (built Vite output).
- Runner exposes REST and WebSocket on a single port (default 3000).
- Local buffer uses **SQLite** (via `better-sqlite3`) for event persistence and replay within Phase 0. This is simpler than Postgres for a single-user local deployment and requires no external service.
- Auth: static bearer token generated on first run, stored in `~/.claude-ui/config.json`.
- Multi-device access: user configures Tailscale or accesses via LAN IP.

### Phase 1: Hub + Runner

```
+---------------------------+          +---------------------------+
|  Cloud / VPS / LAN Host   |          |  User's Mac              |
|                           |          |                           |
|  +---------------------+  |          |  +---------------------+  |
|  |  Hub (Node.js)      |  |          |  |  Runner (Node.js)   |  |
|  |                     |  |          |  |                     |  |
|  |  +---------------+  |  |  WSS     |  |  +---------------+  |  |
|  |  | WS Gateway    |<-+--+---------+--+->| WS Client     |  |  |
|  |  +---------------+  |  | (outbound|  |  +---------------+  |  |
|  |  | REST Gateway  |  |  |  from    |  |  | Agent SDK     |  |  |
|  |  +---------------+  |  |  Runner) |  |  +---------------+  |  |
|  |  | Auth (JWT)    |  |  |          |  |  | PTY Adapter   |  |  |
|  |  +---------------+  |  |          |  |  +---------------+  |  |
|  |  | Session       |  |  |          |  |  | Local Buffer  |  |  |
|  |  |  Registry     |  |  |          |  |  |  (SQLite)     |  |  |
|  |  +---------------+  |  |          |  |  +---------------+  |  |
|  +----------+----------+  |          |  +---------------------+  |
|             |              |          +---------------------------+
|  +----------+----------+  |
|  |  PostgreSQL         |  |
|  |  (events, sessions, |  |
|  |   users, approvals) |  |
|  +---------------------+  |
+---------------------------+
       ^           ^
       |           |
  +----+----+ +----+----+
  | Browser | | Phone   |
  | (Home)  | | (Mobile)|
  +---------+ +---------+
```

**Details:**
- Runner initiates an outbound WSS connection to Hub on startup. No inbound ports on the user's network.
- Hub authenticates Runner via a registration token (exchanged during initial setup).
- UI clients connect to Hub. Hub routes requests to the appropriate Runner based on session registry.
- Hub persists all events to Postgres. Runner continues to buffer locally in SQLite for offline resilience.
- On Runner reconnect, Runner sends buffered events to Hub for backfill.

### Phase 2: Multi-Runner, Multi-Team

```
+-----------------------------------------------------------+
|  Hub (Cloud)                                               |
|                                                            |
|  +-------------+  +-------------+  +-------------------+  |
|  | Auth + RBAC |  | Team/       |  | Runner Pool       |  |
|  | (JWT +      |  | Workspace   |  | Manager           |  |
|  |  claims)    |  | Registry    |  |                   |  |
|  +-------------+  +-------------+  +-------------------+  |
|                                                            |
|  +---------------------------------------------------+    |
|  |  PostgreSQL (multi-tenant: teams, users, RBAC,    |    |
|  |   per-team secrets, audit logs)                    |    |
|  +---------------------------------------------------+    |
+-----------------------------------------------------------+
       ^           ^           ^
       |           |           |
  +----+----+ +----+----+ +----+----+
  | Runner  | | Runner  | | Runner  |
  | (Team A)| | (Team A)| | (Team B)|
  +---------+ +---------+ +---------+
```

**Details:**
- Multiple Runners can serve the same team. Hub load-balances session creation across available Runners.
- RBAC: team admins control who can access which projects, approve tools, manage plugins.
- Secrets isolation: per-team encryption keys for credentials. Runner only decrypts secrets for its assigned team.
- Runner pools may be containerized (Docker) for isolation, but this is a Phase 2 concern.

---

## 7. Monorepo Structure

**Tooling:** pnpm workspaces + Turborepo

```
claude-chat-bot/
|-- package.json                    # Root: pnpm workspace config
|-- pnpm-workspace.yaml
|-- turbo.json                      # Turborepo pipeline config
|-- tsconfig.base.json              # Shared TS config
|
|-- apps/
|   |-- runner/
|   |   |-- package.json
|   |   |-- tsconfig.json
|   |   |-- src/
|   |   |   |-- index.ts            # Entry point
|   |   |   |-- server.ts           # HTTP + WS server setup
|   |   |   |-- sdk/                # Agent SDK integration
|   |   |   |-- pty/                # PTY adapter (node-pty, tmux)
|   |   |   |-- api/                # REST route handlers
|   |   |   |-- ws/                 # WebSocket handlers
|   |   |   |-- services/           # Business logic (projects, sessions, approvals, plugins, mcp)
|   |   |   |-- cli/                # CLI wrappers (claude plugin, claude mcp)
|   |   |   |-- buffer/             # Local SQLite event buffer
|   |   |   +-- auth/               # Token validation
|   |   +-- tests/
|   |
|   |-- hub/
|   |   |-- package.json
|   |   |-- tsconfig.json
|   |   |-- src/
|   |   |   |-- index.ts            # Entry point
|   |   |   |-- server.ts           # HTTP + WS server setup
|   |   |   |-- api/                # REST route handlers
|   |   |   |-- ws/                 # WebSocket gateway (fan-out)
|   |   |   |-- services/           # Business logic (sessions, events, auth)
|   |   |   |-- db/                 # Drizzle schema, migrations, queries
|   |   |   |-- auth/               # JWT issuance, validation, RBAC
|   |   |   +-- registry/           # Runner registry, session routing
|   |   +-- tests/
|   |
|   +-- ui/
|       |-- package.json
|       |-- tsconfig.json
|       |-- vite.config.ts
|       |-- index.html
|       |-- src/
|       |   |-- main.tsx            # React entry point
|       |   |-- App.tsx             # Root component, routing
|       |   |-- components/         # Shared UI components
|       |   |-- features/           # Feature modules
|       |   |   |-- chat/           # Chat timeline, message composer
|       |   |   |-- terminal/       # xterm.js terminal tab
|       |   |   |-- projects/       # Project browser, settings
|       |   |   |-- sessions/       # Session list, management
|       |   |   |-- approvals/      # Approval modal
|       |   |   |-- files/          # File browser, editor
|       |   |   |-- git/            # Git status, diff, commit
|       |   |   |-- mcp/            # MCP server management
|       |   |   +-- plugins/        # Plugin management
|       |   |-- hooks/              # Custom React hooks
|       |   |-- stores/             # State management (zustand)
|       |   |-- services/           # API client, WebSocket client
|       |   +-- styles/             # Global styles, theme
|       +-- tests/
|
|-- packages/
|   |-- shared/
|   |   |-- package.json
|   |   |-- tsconfig.json
|   |   +-- src/
|   |       |-- index.ts
|   |       |-- types.ts            # Shared domain types (Project, Session, etc.)
|   |       |-- constants.ts        # Shared constants
|   |       +-- utils.ts            # Shared utility functions
|   |
|   +-- protocol/
|       |-- package.json
|       |-- tsconfig.json
|       +-- src/
|           |-- index.ts
|           |-- envelope.ts         # Event envelope type + zod schema
|           |-- events/             # Per-domain event types + zod schemas
|           |   |-- session.ts
|           |   |-- chat.ts
|           |   |-- tools.ts
|           |   |-- slash.ts
|           |   |-- mcp.ts
|           |   |-- pty.ts
|           |   +-- workspace.ts
|           |-- api/                # REST API request/response types + zod schemas
|           |   |-- projects.ts
|           |   |-- sessions.ts
|           |   |-- plugins.ts
|           |   +-- mcp.ts
|           +-- ws/                 # WebSocket message types (subscribe, ack, etc.)
|               |-- messages.ts
|               +-- schemas.ts
|
+-- plan/                           # Design docs (this file, LLD, etc.)
```

**Key decisions:**
- **pnpm** for fast, disk-efficient installs with strict dependency isolation.
- **Turborepo** for build orchestration: `turbo run build` builds packages first, then apps (respecting dependency graph).
- **`@claude-ui/protocol`** is the single source of truth for all event types, API schemas, and WebSocket messages. Both Runner, Hub, and UI import from this package, ensuring type consistency.
- **`@claude-ui/shared`** contains domain types and utilities that are not protocol-specific.
- **Zod schemas** in `protocol` serve double duty: runtime validation (API input, WebSocket messages) and TypeScript type inference (`z.infer<typeof schema>`).

---

## 8. Key Architectural Decisions and Trade-offs

### ADR-1: SDK-First with PTY Escape Hatch

**Context:** Claude Code offers both a programmatic SDK (structured events) and an interactive REPL (terminal). The UI needs to support both.

**Options:**
1. PTY-only: wrap everything in a terminal. Simplest, but no structured UI.
2. SDK-only: use only the Agent SDK. Cleanest, but some CLI features (plugin marketplace TUI, interactive MCP flows) are not available via SDK.
3. **SDK-first with PTY escape hatch:** Default to SDK for structured chat; provide a terminal tab for anything the SDK cannot handle.

**Decision:** Option 3. The SDK provides typed events that enable rich UI (streaming, tool cards, approvals). The PTY tab is always available as a fallback. This gives the best UX while maintaining 100% CLI parity.

**Trade-off:** Two execution modes means two codepaths for session management, event handling, and reconnection. This is manageable because the modes are cleanly separated: SDK events go to the chat timeline, PTY bytes go to xterm.js.

### ADR-2: Single WebSocket Connection per Client

**Context:** The client needs real-time events for chat, tools, PTY, and workspace changes.

**Options:**
1. Multiple WebSocket connections (one per concern).
2. **Single multiplexed WebSocket connection** with event type routing.
3. Server-Sent Events for one-way, REST for commands.

**Decision:** Option 2. A single WSS connection reduces connection overhead, simplifies auth, and avoids mobile connection limits. All events share the same envelope format; the `type` field routes to the correct handler.

**Trade-off:** A single connection means PTY data (high-throughput bytes) shares bandwidth with chat events (low-throughput structured data). Mitigation: PTY data is only sent when the terminal tab is active (client subscribes/unsubscribes to PTY stream).

### ADR-3: SQLite for Phase 0 Local Buffer, Postgres for Phase 1+ Hub

**Context:** Events need to be persisted for replay and offline resilience.

**Options:**
1. Postgres everywhere (even Phase 0).
2. File-based storage (JSON lines) for Phase 0.
3. **SQLite for Phase 0, Postgres for Phase 1+.**

**Decision:** Option 3. SQLite requires zero setup, is embedded in the Runner process, and handles the Phase 0 workload (single user, single runner) with ease. Postgres is introduced in Phase 1 when Hub needs multi-client concurrent writes, proper indexing, and JSONB queries. The event schema is identical in both; only the storage backend differs.

**Trade-off:** Two storage backends means some query logic duplication. Mitigation: the `@claude-ui/protocol` package defines the event schema; storage adapters implement a common interface (`EventStore`).

### ADR-4: Zustand for UI State Management

**Context:** The UI has complex state: active session, streaming deltas, approval queue, terminal state, WebSocket connection status.

**Options:**
1. React Context + useReducer.
2. Redux Toolkit.
3. **Zustand.**
4. Jotai / Recoil.

**Decision:** Option 3. Zustand is lightweight (1KB), has no boilerplate, works well with React concurrent features, and supports derived state. It is simpler than Redux for this application's state shape (a few top-level stores: session, chat, terminal, connection).

**Trade-off:** Less structured than Redux (no enforced action/reducer pattern). Acceptable for a team of 1-3 developers.

### ADR-5: Outbound Tunnel (Runner -> Hub) Rather Than Inbound

**Context:** Phase 1 requires Runner and Hub to communicate. Runner is behind a NAT/firewall.

**Options:**
1. Port forwarding / UPnP (inbound to Runner).
2. VPN (Tailscale, WireGuard).
3. **Outbound WebSocket from Runner to Hub.**
4. HTTP long-polling.

**Decision:** Option 3. The Runner initiates a persistent WSS connection to Hub. This works through NATs, firewalls, and proxies without configuration. Hub sends commands to Runner over this same connection (reverse request pattern).

**Trade-off:** Hub must manage persistent Runner connections and route requests accordingly. This is standard for push-based architectures and well-understood.

### ADR-6: Approval Timeout with Auto-Deny

**Context:** When the Agent SDK's `canUseTool` fires, Runner must wait for a human decision. If the user is unreachable (phone locked, network down), the Runner is stuck.

**Options:**
1. Wait indefinitely.
2. **Auto-deny after timeout (5 minutes).**
3. Auto-approve after timeout.

**Decision:** Option 2. Indefinite waiting risks resource leaks and stuck sessions. Auto-approve is dangerous (could execute destructive tools). Auto-deny is safe: the agent can re-request the tool or adjust its approach.

**Trade-off:** Users who step away for more than 5 minutes may find their session's tool request was denied. The UI shows a clear "timed out -- denied" indicator and the user can re-send the message to retry.

### ADR-7: Cursor-Based Pagination for Timeline

**Context:** `GET /sessions/:id/timeline` must load events efficiently. Sessions can have thousands of events.

**Options:**
1. Offset-based pagination.
2. **Cursor-based pagination (using `seq`).**

**Decision:** Option 2. Cursor-based pagination using the `seq` field is immune to insertion-skew problems (new events arriving while paginating). The client requests `?after_seq=N&limit=50` and receives the next 50 events. This is also consistent with the WebSocket replay mechanism, which uses the same `seq` field.

**Trade-off:** No random-access page jumping. Acceptable for a timeline UI where users scroll chronologically.

### ADR-8: Controller Lock for Multi-Device Approval

**Context:** Multiple devices may be connected to the same session. Only one should be able to approve/deny tool requests.

**Options:**
1. First response wins (race condition).
2. **Explicit controller lock with "take control" handoff.**
3. Broadcast approval to all devices, merge responses.

**Decision:** Option 2. One device is the "controller" (can send messages, approve tools). Other devices are in "follow mode" (read-only timeline). "Take control" transfers the lock. This prevents conflicting approvals and provides clear UX.

**Trade-off:** Follow-mode users cannot interact until they take control. This is intentional: it prevents confusion when multiple people try to drive the same session.

---

## 9. Non-Functional Requirements Mapping

### 9.1 Performance: <2s Load for Last 200 Events

| Concern | Solution |
|---------|----------|
| Initial timeline load | `GET /sessions/:id/timeline?limit=200` returns the most recent 200 events. Postgres index on `(session_id, seq)` ensures fast retrieval. SQLite equivalent for Phase 0. |
| Streaming deltas | WebSocket delivers `assistant.delta` events with <50ms latency (LAN). No batching; events are sent immediately. |
| UI rendering | React virtualized list (`react-window` or `@tanstack/virtual`) for long timelines. Only visible items are rendered in the DOM. |
| Asset loading | Vite-built SPA with code splitting per feature route. Initial bundle <200KB gzipped. xterm.js loaded lazily on terminal tab open. |

### 9.2 Reliability: >99% Reconnect Success

| Concern | Solution |
|---------|----------|
| WebSocket drops | Jittered exponential backoff (1s-30s). Client-side reconnect with `lastSeq` for gap-free replay. |
| Runner offline | Local SQLite buffer stores events. On reconnect to Hub, backfill with idempotent upsert. No events lost. |
| PTY reconnect | tmux as default for PTY sessions. On reconnect, `tmux attach` restores full terminal state. Without tmux, PTY session is lost (documented limitation). |
| Approval timeout | 5-minute timeout with auto-deny. Session remains usable; user can retry. |
| Hub failure | Runner continues operating independently (Phase 0 mode). Events buffered locally. UI can connect directly to Runner if Hub is unreachable (fallback mode). |

### 9.3 Security

| Concern | Solution |
|---------|----------|
| Auth | Phase 0: static bearer token. Phase 1: JWT with short-lived access tokens. Phase 2: JWT + RBAC claims. |
| Transport | WSS (TLS) for all WebSocket connections. HTTPS for all REST. Self-signed certs acceptable for LAN; Let's Encrypt for Hub. |
| Workspace isolation | Runner enforces an allowlist of project roots. API requests for paths outside the allowlist are rejected at the Router/middleware layer. |
| PTY security | PTY mode provides raw shell access. This is equivalent to the user's terminal. The bearer token / JWT is the access gate. |
| Credential storage | Phase 1: `credentials` table uses AES-256-GCM encryption. Key derived from a master secret in Hub's environment config. Phase 0: no credential storage (user's local Claude config is used directly). |
| Rate limiting | Phase 1: Hub applies rate limits per authenticated user (100 req/min REST, 1000 msg/min WS). Phase 0: no rate limiting (single user). |
| Audit trail | All approval decisions persisted in `approvals` table with tool name, args, decision, scope, and timestamp. |

### 9.4 Observability

| Concern | Solution |
|---------|----------|
| Structured logging | All components use structured JSON logging (pino). Fields: `timestamp`, `level`, `component`, `sessionId`, `correlationId`, `message`, `data`. |
| Correlation IDs | Every user turn generates a `correlationId` (e.g., `turn_17`). All events in that turn carry the same ID. Logs include it for cross-component tracing. |
| Metrics | Runner and Hub expose Prometheus-compatible metrics: WS connection count, event throughput, approval latency (p50/p95/p99), reconnect count, error rate. |
| Health checks | `GET /health` on Runner and Hub returns `{ status: "ok", uptime, version, activeSessions }`. Used for monitoring and Hub's runner registry heartbeat. |
| Timeline replay | The append-only event store is itself an audit log. Any session can be replayed from `seq=0` for debugging or compliance. |

---

## Appendix: Technology Summary

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Node.js | 20 LTS |
| Language | TypeScript | 5.x |
| UI Framework | React | 18/19 |
| UI Build | Vite | 6.x |
| State Management | Zustand | 5.x |
| Terminal | xterm.js | 5.x |
| PTY | node-pty | 1.x |
| WebSocket | ws | 8.x |
| HTTP Framework | Fastify | 5.x |
| ORM | Drizzle | 0.3x+ |
| Database (Phase 0) | SQLite (better-sqlite3) | -- |
| Database (Phase 1+) | PostgreSQL | 16+ |
| Validation | Zod | 3.x |
| Monorepo | pnpm + Turborepo | -- |
| Testing | Vitest + Playwright | -- |
| Logging | Pino | 9.x |
| Auth (Phase 0) | Static bearer token | -- |
| Auth (Phase 1+) | JWT (jose library) | -- |
