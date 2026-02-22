# Research Document -- Portable UI for Claude Code
_Generated: 2026-02-22_

This document is a comprehensive analysis of the specification pack (PRD, TECH_DOC, UI_UX_PLAN) for the Portable UI for Claude Code project. It is intended to feed directly into HLD and LLD authoring.

---

## 1. Product Vision

### What It Is
A **portable web-based UI** that wraps Claude Code's local Mac runner, exposing the full power of Claude Code (repos, SSH, MCP, plugins) through a rich chat + timeline interface. It also provides an always-available **terminal parity tab** that is a 1:1 mirror of the Claude Code interactive REPL.

### Who It Is For
- **Primary persona (Phase 0-1):** Solo power users who already use Claude Code on the CLI and want multi-device access, richer UX for approvals/tools, and the ability to continue sessions from a phone or secondary machine.
- **Secondary persona (Phase 2):** Team leads and platform owners who want shared runner pools, RBAC, and per-team policy enforcement.

### Core Value Proposition
1. **Multi-device access** -- start a session on a laptop, continue from a phone.
2. **Richer interaction model** -- structured chat timeline with inline tool cards, approval modals, and collapsible outputs instead of raw terminal scrollback.
3. **No loss of power** -- terminal parity tab guarantees 100% of CLI behavior is still available.
4. **SDK-first architecture** -- typed, structured events enable better UX, persistence, replay, and future extensibility (teams, audit trails).

### Product Principles
- **Truth is the CLI** -- parity commands must never break existing Claude Code workflows.
- **SDK-first** -- structured streaming is the default; PTY is the escape hatch.
- **Secure by default** -- private network, outbound tunnel, auth required.
- **Local-first** -- reuses the user's installed MCPs, plugins, SSH keys, and Claude configs.

---

## 2. User Personas and Key Scenarios

### Personas

| Persona | Phase | Description |
|---------|-------|-------------|
| Solo power user | 0-1 | Uses Claude Code daily for repo exploration, editing, commits. Wants to approve tool runs from phone, continue sessions remotely. |
| Team lead / platform owner | 2 | Manages a team that shares runners and needs RBAC, secrets isolation, and plugin policy. |

### Top Scenarios (from PRD Section 4)

1. **Start a new session on a repo from phone** -- requires multi-device access, project discovery, session creation.
2. **Continue a long-running session while away from laptop** -- requires session persistence, event replay, reconnect.
3. **Approve/deny tool runs; persist "don't ask again" rules** -- requires approval modal with scope selectors (session / project / user).
4. **Run `/compact` with instructions and continue** -- requires SDK-mode slash command support, compact snapshot markers.
5. **Manage MCP servers + OAuth auth steps** -- requires MCP panel with health checks, transport config, OAuth URL surfacing.
6. **Install/enable plugins and verify they're active** -- requires plugin panel with CLI wrapper calls.
7. **Open Terminal tab when a flow needs exact REPL behavior** -- requires PTY adapter, xterm.js, optional tmux attachment.

---

## 3. System Components

### 3.1 Runner (macOS local service)

**Responsibilities:**
- Host the Claude Agent SDK runtime (structured chat + tools).
- Host the CLI PTY adapter for terminal parity mode.
- Provide workspace services: filesystem access, git operations, SSH.
- Manage MCP server connectivity and plugin lifecycle (via CLI wrappers).
- Maintain a local disk buffer for events when offline; backfill to Hub on reconnect.
- Scan configured project roots and optionally read `~/.claude/projects` for prior session discovery.

**Key internals:**
- Creates one Agent SDK session per (projectId, sessionId) pair.
- Configures `settingSources=['project']` to load repo-specific `.claude/` conventions.
- Streams assistant deltas and tool calls/output.
- Implements `canUseTool` callback to pause execution and request approval from the UI.
- CLI wrappers call `claude plugin ...` and `claude mcp ...` subcommands, parsing JSON stdout where possible.
- PTY adapter spawns `claude` in a pseudo-terminal, optionally inside `tmux new-session -A -s <name> claude`.

**Boundaries:**
- Runner does NOT handle user auth (that's Hub's job in Phase 1+).
- Runner does NOT persist events long-term (that's Hub's event store); it only buffers locally for offline resilience.

### 3.2 Hub (optional Phase 0, required Phase 1+)

**Responsibilities:**
- User authentication and authorization.
- Session registry and routing (which runner owns which session).
- Append-only event store for timeline persistence and replay.
- WebSocket gateway -- fans out events from runners to all subscribed UI clients.
- (Phase 2) Teams, workspaces, RBAC, secrets isolation.

**Boundaries:**
- Hub does NOT execute Claude Code -- it is a relay and persistence layer.
- Hub does NOT directly access the user's filesystem or repos.

### 3.3 UI (Web application)

**Responsibilities:**
- Render chat timeline with streaming deltas, tool cards, approval modals.
- Provide project/session management (sidebar navigation, search, filters).
- Embed xterm.js for terminal parity tab.
- Provide MCP and plugin management panels.
- Provide file browser, git status/diff/commit views.
- Handle multi-device control (follow mode, take control).

**Boundaries:**
- UI does NOT execute any commands -- it sends requests to Runner (or Hub) and renders responses.
- UI connects either directly to Runner (Phase 0, LAN/Tailscale) or via Hub (Phase 1+).

### Component Topology

```
Phase 0:  UI <--WS/REST--> Runner (localhost / LAN / Tailscale)

Phase 1:  UI <--WS/REST--> Hub <--WS--> Runner (outbound tunnel)
                            |
                        Postgres
```

---

## 4. Tech Signals from Docs

The docs intentionally leave most tech-stack decisions open, but the following signals are present:

| Signal | Source | Detail |
|--------|--------|--------|
| **Postgres** | TECH_DOC S5 | "Use Postgres in Hub (even if local at first) for clean path to teams." |
| **Claude Agent SDK** | TECH_DOC S2, S6 | Runner uses the Agent SDK for structured chat + tools. |
| **xterm.js** | TECH_DOC S6, UI_UX S3.4 | Terminal parity tab uses xterm.js. |
| **WebSocket** | TECH_DOC S3 | Primary real-time protocol between all components. |
| **PTY** | TECH_DOC S6 | Runner spawns `claude` in a pseudo-terminal. |
| **tmux** | TECH_DOC S6 | Optional tmux session attachment for PTY mode. |
| **Tailscale** | TECH_DOC S7 | Preferred multi-device networking in Phase 0. |
| **Playwright** | TECH_DOC S9 | E2E testing framework. |
| **JSON stdout parsing** | TECH_DOC S6 | CLI wrappers parse JSON from `claude plugin/mcp` commands. |
| **Outbound tunnel** | TECH_DOC S7 | Runner connects outbound to Hub (no inbound ports). |
| **macOS** | TECH_DOC S1 | Runner is described as a "macOS local service." |

### Stack NOT specified (decisions needed)
- Frontend framework (React, Vue, Svelte, etc.)
- Backend language/runtime for Runner (Node.js, Python, Go, etc.) -- though Agent SDK likely constrains this to TypeScript/Node.
- Backend language/runtime for Hub.
- ORM or query builder for Postgres.
- WebSocket library (ws, socket.io, etc.).
- Build tooling, bundler, monorepo structure.
- CI/CD pipeline.
- PTY library (node-pty, etc.).
- Auth mechanism (JWT, session cookies, API keys).
- CSS framework or design system.

---

## 5. Event Protocol Deep Dive

### Envelope Structure

Every event shares a common envelope:

```json
{
  "id":            "evt_...",         // Unique event ID
  "type":          "assistant.delta", // Dot-namespaced event type
  "ts":            "ISO-8601",        // Timestamp
  "sessionId":     "sess_...",        // Owning session
  "projectId":     "proj_...",        // Owning project
  "runnerId":      "runner_...",      // Source runner
  "mode":          "sdk" | "pty",     // Which mode produced this event
  "correlationId": "turn_17",         // Groups related events (e.g., all events in one turn)
  "payload":       {}                 // Type-specific payload (unspecified per-type)
}
```

### Event Types (Complete Catalog)

| Domain | Event Type | When Emitted |
|--------|-----------|--------------|
| **Session** | `session.created` | New session started |
| | `session.resumed` | Existing session resumed |
| | `session.forked` | Session forked from snapshot |
| | `session.ended` | Session terminated |
| | `session.error` | Unrecoverable session error |
| **Chat** | `user.message` | User sends a message |
| | `assistant.delta` | Streaming token chunk from assistant |
| | `assistant.message` | Complete assistant message (after streaming) |
| **Tools/Approvals** | `tool.requested` | Agent wants to use a tool |
| | `approval.requested` | Tool requires user approval |
| | `approval.resolved` | User approved/denied the tool |
| | `tool.output` | Tool execution produced output |
| | `tool.completed` | Tool execution finished |
| **Slash** | `slash.invoked` | Slash command issued |
| | `slash.result` | Slash command completed with result |
| **MCP** | `mcp.status` | MCP server status change (up/down/error) |
| | `mcp.oauth.required` | MCP server needs OAuth authentication |
| **PTY** | `pty.opened` | PTY session started |
| | `pty.data` | Raw terminal bytes from PTY |
| | `pty.closed` | PTY session ended |
| **Workspace** | `fs.changed` | File system change detected |
| | `git.status` | Git status update |

### Key Flows

**SDK Chat Turn:**
```
user.message -> assistant.delta (N times) -> assistant.message
```

**Tool Execution with Approval:**
```
tool.requested -> approval.requested -> [UI pause] -> approval.resolved -> tool.output -> tool.completed
```

**Slash Command:**
```
slash.invoked -> slash.result
```

**PTY Session:**
```
pty.opened -> pty.data (continuous) -> pty.closed
```

### Observations
- The `correlationId` field (`turn_17`) is crucial for grouping events within a single user turn. This is essential for timeline rendering and replay.
- `assistant.delta` vs `assistant.message`: deltas are streaming chunks; `assistant.message` is the finalized complete message. The UI needs both for streaming display + final persistence.
- The tool lifecycle has 5 distinct events, allowing the UI to show granular state: "waiting for tool" -> "needs approval" -> "approved/denied" -> "running" -> "done".
- PTY events (`pty.data`) carry raw bytes, not structured data. These are opaque to the timeline and only meaningful to xterm.js.

---

## 6. REST API Surface

### Projects Domain

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/projects` | List all discovered projects |
| POST | `/api/v1/projects` | Add a new project root |
| POST | `/api/v1/projects/:id/clone` | Clone a repository via SSH |

### Sessions Domain

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/projects/:id/sessions` | List sessions for a project |
| POST | `/api/v1/projects/:id/sessions` | Create a new session |
| POST | `/api/v1/sessions/:id/send` | Send a user message |
| POST | `/api/v1/sessions/:id/slash` | Execute a slash command |
| POST | `/api/v1/sessions/:id/approve` | Resolve an approval request |
| POST | `/api/v1/sessions/:id/mode` | Switch between SDK and PTY mode |
| GET | `/api/v1/sessions/:id/timeline` | Fetch timeline events (paginated) |

### Plugins Domain

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/plugins/installed` | List installed plugins |
| POST | `/api/v1/plugins/install` | Install a plugin |
| POST | `/api/v1/plugins/update` | Update a plugin |
| POST | `/api/v1/plugins/uninstall` | Uninstall a plugin |
| POST | `/api/v1/plugins/enable` | Enable a plugin |
| POST | `/api/v1/plugins/disable` | Disable a plugin |
| GET | `/api/v1/plugins/marketplaces` | List configured marketplaces |
| POST | `/api/v1/plugins/marketplaces/add` | Add a marketplace |

### MCP Domain

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/mcp/servers` | List MCP servers with status |
| POST | `/api/v1/mcp/servers` | Add an MCP server |
| DELETE | `/api/v1/mcp/servers/:name` | Remove an MCP server |
| POST | `/api/v1/mcp/servers/:name/auth` | Trigger/check OAuth for a server |

### Observations
- Total of **18 REST endpoints** across 4 domains.
- Sessions are nested under projects for creation/listing but are top-level for interaction (send, approve, etc.). This implies sessions have globally unique IDs.
- Plugin operations (install/update/uninstall/enable/disable) are all POST to separate sub-paths rather than using a single endpoint with an action body. This is a design choice that simplifies routing but creates many endpoints.
- No explicit endpoints for: user auth (Phase 1), teams/RBAC (Phase 2), runner management, or file browsing (may use WebSocket or be unspecified).
- No explicit pagination parameters documented for `GET /sessions/:id/timeline` despite the NFR of "<2s load for last 200 events."

---

## 7. Persistence Model

### Tables (from TECH_DOC Section 5)

| Table | Purpose | Inferred Fields |
|-------|---------|-----------------|
| `projects` | Registered project roots | id, path, name, git_remote, git_branch, created_at, updated_at |
| `sessions` | Chat/PTY sessions | id, project_id (FK), mode (sdk/pty), status, title, created_at, updated_at, last_activity_at |
| `session_events` | Append-only timeline events | id, session_id (FK), type, ts, correlation_id, runner_id, mode, payload (JSONB), created_at |
| `session_snapshots` | Compact markers, restore points | id, session_id (FK), type (compact/fork), context_summary, created_at |
| `approvals` | Audit trail for approval decisions | id, session_id (FK), event_id (FK), tool_name, args, decision, scope, created_at |
| `runner_registry` | Known runners | id, name, status, last_heartbeat, capabilities, created_at |
| `plugin_state` | Plugin installation/enablement state | id, plugin_name, version, enabled, scope, installed_at, updated_at |
| `mcp_state` | MCP server configuration and status | id, server_name, transport, config (JSONB), status, last_error, created_at, updated_at |
| `credentials` | Encrypted credentials/secrets | id, owner_type, owner_id, key, encrypted_value, created_at |

### Relationships (Inferred)

```
projects 1--* sessions
sessions 1--* session_events
sessions 1--* session_snapshots
sessions 1--* approvals
session_events 1--? approvals (event_id FK)
```

### Key Characteristics
- **`session_events` is append-only** -- critical for timeline integrity and replay. This table will be the highest-write-volume table.
- **`credentials` uses encryption at rest** -- the docs say "encrypted" but do not specify the encryption mechanism.
- **JSONB payloads** are implied for `session_events.payload` to store heterogeneous event data without schema changes per event type.
- **No explicit `users` table** is listed, though Hub auth implies one will be needed in Phase 1.
- **No explicit `teams` or `workspaces` table** -- Phase 2 concern.

### Runner Local Buffer
The Runner maintains a **local disk buffer** for events while offline. This is a separate concern from the Postgres persistence and will need its own storage mechanism (likely SQLite, flat files, or an embedded queue). The backfill-to-Hub-on-reconnect flow must handle deduplication and ordering.

---

## 8. Security Model

### Phase 0 (LAN/Tailscale)
- **Default private**: Runner binds to localhost or LAN only.
- **Token required**: Even on LAN, a bearer token or similar credential is needed to connect.
- **Tailscale preferred**: For multi-device access without exposing ports, Tailscale provides a private overlay network with built-in identity.

### Phase 1 (Hub + Tunnel)
- **Outbound runner tunnel**: Runner connects outbound to Hub -- no inbound ports need to be opened on the user's network. This is a critical security property.
- **Hub handles auth**: Users authenticate to Hub; Hub proxies to Runner.
- **Auth mechanism unspecified**: No mention of OAuth, JWT, session cookies, or any specific auth protocol.

### Workspace Allowlist
- **Filesystem access is constrained** to an allowlist of project roots. The Runner should not allow arbitrary filesystem access outside configured roots.
- This is important for preventing the UI from becoming a general-purpose remote file manager.

### Approval Scopes
Approval decisions can be persisted at three scopes:
1. **Session** -- applies only to the current session.
2. **Project** -- applies to all sessions in the current project.
3. **User** -- applies globally for the user.

These scopes create a hierarchy: user > project > session. The precedence rules are not explicitly documented but should be: most-specific scope wins, with user-level as the broadest fallback.

### Permission Modes
- `default` -- normal approval flow.
- `plan` -- Claude can only read/plan, not execute.
- `acceptEdits` -- file edits auto-approved, other tools still need approval.
- `dontAsk` / `bypassPermissions` -- advanced/admin modes, auto-approve everything.

### Credentials
- Encrypted storage in `credentials` table.
- No specification of key management, rotation, or access control for credentials.

---

## 9. Phased Roadmap

### Phase 0 -- Local Runner, LAN/Tailscale

**Scope:**
- Runner runs as a local macOS service.
- UI connects directly to Runner (localhost, LAN, or Tailscale).
- No Hub required.

**Features:**
- Project discovery (scan roots, add/remove roots, clone via SSH).
- Session management (create, resume, fork, end, search).
- Chat timeline with streaming, tool event cards, error display.
- Approval modal (allow/deny once, allow/deny always with scope selector).
- `/compact` support in SDK mode.
- `/mcp` and `/plugin` available via Terminal parity tab.
- MCP panel (list, add, remove, health check, OAuth URL).
- Plugins panel (list, enable/disable, install/update/uninstall via CLI wrapper).
- Terminal parity tab (xterm.js attached to `claude` PTY, optional tmux).

**What's NOT in Phase 0:**
- No Hub, no remote access beyond LAN/Tailscale.
- No persistent event store beyond Runner's local buffer.
- No user auth (token-based access only).
- No timeline replay across devices.

### Phase 1 -- Hub for Multi-Device Access

**Scope:**
- Hub service deployed (can be self-hosted or cloud).
- Runner maintains outbound WebSocket connection to Hub.
- UI connects to Hub instead of directly to Runner.

**Features:**
- User authentication via Hub.
- Session registry and routing (Hub knows which Runner owns which session).
- Append-only event store in Postgres (timeline persistence).
- Timeline replay on reconnect or new device.
- Runner offline buffering with backfill on reconnect.

**What's NOT in Phase 1:**
- No teams, workspaces, or RBAC.
- No multi-runner pooling.
- No per-team secrets isolation.

### Phase 2 -- Teams

**Scope:**
- Multi-tenant team support.

**Features:**
- Teams and workspaces with RBAC.
- Per-team plugin/MCP policy and secrets isolation.
- Runner pools (per-team runner allocation, possibly containerized).

---

## 10. Open Questions and Spec Gaps

The following items are **not specified** in the docs and will require decisions during implementation.

### Architecture & Stack
1. **Frontend framework**: React? Vue? Svelte? Solid? The docs do not specify.
2. **Runner runtime**: Node.js is strongly implied by Agent SDK (TypeScript), but not confirmed.
3. **Hub runtime**: Could differ from Runner. Not specified.
4. **Monorepo structure**: No guidance on package organization.
5. **Build tooling / bundler**: Vite? Webpack? Turbopack?

### Real-Time Protocol Details
6. **WebSocket sub-protocol**: Is there a handshake? How does the client subscribe to a session's events?
7. **WebSocket reconnection strategy**: Exponential backoff? Sequence numbers for gap detection?
8. **Event ordering guarantees**: Are events ordered by `ts`? By insertion order? What happens with clock skew between Runner and Hub?
9. **Backpressure / flow control**: What happens if the UI can't keep up with event throughput?

### Auth & Security
10. **Auth mechanism for Phase 0**: Is the token static (config file) or dynamic? How is it generated and distributed?
11. **Auth mechanism for Phase 1**: OAuth2? JWT? API keys? Session cookies?
12. **Token refresh / rotation**: Not specified.
13. **Workspace allowlist implementation**: Is it enforced in Runner? In Hub? Both?
14. **Credential encryption**: What key management system? AES-256? At-rest only or in-transit too?

### Persistence
15. **Timeline pagination**: How is `GET /sessions/:id/timeline` paginated? Cursor-based? Offset-based?
16. **Event retention / archival**: Is there a TTL on events? Can old sessions be archived?
17. **Local buffer format**: SQLite? WAL files? JSON lines?
18. **Backfill deduplication**: How does Hub handle duplicate events from Runner reconnect?
19. **Snapshot content**: What exactly is stored in `session_snapshots`? The full conversation context? A summary?

### UI/UX
20. **Mobile app or responsive web**: Is the phone experience a PWA, native app, or just responsive web?
21. **Offline UI behavior**: Can the UI function at all when Runner is unreachable?
22. **Theme / design system**: No visual design specs provided.
23. **Notification system**: How is the user alerted to approval requests when not looking at the UI?

### Operational
24. **Runner lifecycle management**: How is the Runner started/stopped? Is it a daemon? A systemd/launchd service?
25. **Hub deployment model**: Docker? Kubernetes? Bare metal?
26. **Upgrade / migration strategy**: How are schema migrations handled?
27. **Logging / monitoring stack**: Structured logs are mentioned but no specific tooling.

### API Design
28. **Error response format**: No standard error envelope documented.
29. **Request/response schemas**: No JSON schemas for any endpoint.
30. **Versioning strategy**: `/api/v1/` is used but no deprecation or migration policy.
31. **Rate limiting**: Not mentioned.
32. **File browser API**: The UI_UX_PLAN describes a Files tab but no REST endpoints exist for file operations.
33. **Git operations API**: The UI_UX_PLAN describes a Git tab but no REST endpoints exist for git operations.

---

## 11. Risk Areas

### 11.1 PTY Bridging (High Complexity)

**Risk**: Spawning `claude` in a PTY and relaying bytes over WebSocket introduces multiple failure modes:
- PTY lifecycle management (spawn, resize, kill, reconnect).
- Raw byte encoding issues (UTF-8 boundary splits, control sequences).
- tmux session management adds another layer of complexity.
- Reconnecting to a PTY without losing state requires careful buffering or tmux.

**Mitigation**: Use a well-tested PTY library (e.g., node-pty). tmux provides built-in session persistence. Consider making tmux the default rather than optional.

### 11.2 Approval Pause/Resume (High Complexity)

**Risk**: The `canUseTool` callback must pause the Agent SDK's execution loop until the UI responds. This creates:
- A blocking wait that could timeout or deadlock if the UI disconnects.
- State management complexity: the Runner must track pending approvals and correlate responses.
- Multi-device scenarios: what if two devices are connected and both try to approve?
- Scope persistence: evaluating hierarchical scope rules (session < project < user) correctly.

**Mitigation**: Implement approval requests as first-class state with timeouts and conflict resolution. Only one device should be the "controller" at a time (as suggested by "take control" UX).

### 11.3 Offline Buffering and Backfill (Medium Complexity)

**Risk**: The Runner buffers events locally when Hub is unreachable and backfills on reconnect. This creates:
- Ordering issues: events may arrive at Hub out of order.
- Deduplication: the same events could be sent multiple times.
- Storage growth: unbounded local buffer if Runner is offline for extended periods.
- Consistency: the Hub's event store and Runner's buffer must converge.

**Mitigation**: Use monotonic sequence numbers per session. Implement idempotent event insertion in Hub (unique on `event.id`). Set a maximum buffer size with oldest-event eviction.

### 11.4 Multi-Device Sync (Medium Complexity)

**Risk**: Multiple UI clients connected to the same session creates:
- "Follow mode" vs "controller" state machine complexity.
- Race conditions on approval resolution (two devices approve/deny simultaneously).
- Timeline divergence if events are delivered out of order to different clients.
- "Take control" UX requires mutual exclusion with graceful handoff.

**Mitigation**: Hub acts as single source of truth. Controller status is a Hub-managed lock. Approvals are idempotent (first response wins, subsequent responses are no-ops).

### 11.5 Agent SDK Integration (Medium Complexity)

**Risk**: The Agent SDK is the foundation of SDK mode. Risks include:
- SDK API stability: the SDK may evolve, breaking the Runner's integration.
- `canUseTool` callback semantics: the exact API for pausing/resuming execution may have constraints not yet understood.
- Session management: creating/resuming/forking SDK sessions may have limitations.
- `settingSources` configuration: project-specific settings may conflict or fail to load.

**Mitigation**: Pin SDK versions. Write comprehensive contract tests for the SDK integration surface. Maintain a thin adapter layer to isolate SDK changes.

### 11.6 CLI Wrapper Fragility (Low-Medium Complexity)

**Risk**: Plugin and MCP management rely on wrapping `claude plugin ...` and `claude mcp ...` CLI commands:
- CLI output format may change between Claude Code versions.
- JSON parsing of stdout is fragile if the CLI mixes structured and unstructured output.
- Error handling for CLI failures is ad-hoc.

**Mitigation**: Parse defensively. Fall back to showing raw output in the UI when parsing fails. Track Claude Code version and adapt parsers.

### 11.7 WebSocket Reliability (Low-Medium Complexity)

**Risk**: WebSocket is the sole real-time channel:
- Connection drops on mobile (network switches, sleep).
- Large payloads (e.g., tool output with many lines) may hit message size limits.
- Need for reliable delivery (no lost events) conflicts with WebSocket's at-most-once semantics.

**Mitigation**: Implement sequence-number-based gap detection. On reconnect, replay missed events from Hub's event store (or Runner's buffer in Phase 0). Consider chunking large payloads.

### 11.8 Security Surface Area (Low-Medium Risk)

**Risk**: The system exposes filesystem, git, and shell access through a web interface:
- A compromised auth token grants full access to the user's projects and shell.
- The workspace allowlist is the only FS access control, and its enforcement is unspecified.
- PTY mode gives raw shell access, bypassing any tool-level approval controls.

**Mitigation**: Treat the auth token as a high-value secret. Enforce workspace allowlist at the Runner API layer (not just the UI). Consider rate-limiting and audit logging for sensitive operations.

---

## Summary

The spec pack describes a well-scoped, phased product with a clear architecture. The core technical challenge is bridging two execution modes (SDK structured events and PTY raw bytes) through a unified timeline UI, while maintaining security and multi-device reliability. The Phase 0 scope is achievable with careful attention to the approval pause/resume flow and PTY bridging. Phase 1's main challenge is the Hub's event store and offline backfill. Phase 2 is largely a product/policy layer on top of a solid Phase 1 foundation.

The biggest spec gaps are around auth mechanisms, real-time protocol details (reconnection, ordering, backpressure), and the exact API for file/git operations in the UI. These will need to be resolved in the HLD.
