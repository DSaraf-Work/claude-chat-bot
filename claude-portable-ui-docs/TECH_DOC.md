# TECH_DOC — Architecture, APIs, Event Protocol
_Last updated: 2026-02-22_

## 1) Architecture overview
Two deployable components:

1. **Runner** (macOS local service)
   - Agent SDK runtime for structured chat+tools
   - CLI PTY adapter for exact Claude Code REPL parity
   - Workspace services (fs/git/ssh), MCP connectivity, plugin management wrappers

2. **Hub** (optional in v1, required for outside-network multi-device)
   - Auth, users (teams later)
   - Session registry + routing
   - Append-only event store (timeline)
   - WebSocket gateway for UIs and runners

### Data flow
- UI connects to Hub (or directly to Runner in Phase 0).
- Runner executes and streams events (SDK) or PTY bytes (CLI).
- Hub persists events and fans out to all subscribed clients.

## 2) Modes
### SDK Mode (default)
- Runs Claude Agent SDK sessions.
- Emits **typed events**: deltas, tool requests, approvals, tool output.

### Parity Mode (PTY)
- Spawns `claude` interactive REPL in a PTY (optionally inside tmux).
- Streams raw terminal bytes to xterm.js.
- Used for exact `/plugin` marketplace TUI, interactive `/mcp` flows, and any edge cases.

## 3) Event protocol (WebSocket)
Single envelope for all events:

```json
{
  "id": "evt_...",
  "type": "assistant.delta",
  "ts": "2026-02-22T12:34:56.123Z",
  "sessionId": "sess_...",
  "projectId": "proj_...",
  "runnerId": "runner_...",
  "mode": "sdk",
  "correlationId": "turn_17",
  "payload": {}
}
```

### Minimum event types
**Session**: `session.created|resumed|forked|ended|error`  
**Chat**: `user.message`, `assistant.delta`, `assistant.message`  
**Tools/approvals**: `tool.requested`, `approval.requested`, `approval.resolved`, `tool.output`, `tool.completed`  
**Slash**: `slash.invoked`, `slash.result`  
**MCP**: `mcp.status`, `mcp.oauth.required`  
**PTY**: `pty.opened`, `pty.data`, `pty.closed`  
**Workspace**: `fs.changed`, `git.status`  

## 4) REST API (v1)
### Projects
- `GET /api/v1/projects`
- `POST /api/v1/projects` (add root/project)
- `POST /api/v1/projects/:id/clone`

### Sessions
- `GET /api/v1/projects/:id/sessions`
- `POST /api/v1/projects/:id/sessions` (create)
- `POST /api/v1/sessions/:id/send`
- `POST /api/v1/sessions/:id/slash`
- `POST /api/v1/sessions/:id/approve`
- `POST /api/v1/sessions/:id/mode` (sdk↔pty)
- `GET /api/v1/sessions/:id/timeline`

### Plugins
- `GET /api/v1/plugins/installed`
- `POST /api/v1/plugins/install|update|uninstall|enable|disable`
- `GET /api/v1/plugins/marketplaces`
- `POST /api/v1/plugins/marketplaces/add`

### MCP
- `GET /api/v1/mcp/servers`
- `POST /api/v1/mcp/servers`
- `DELETE /api/v1/mcp/servers/:name`
- `POST /api/v1/mcp/servers/:name/auth`

## 5) Persistence
Use Postgres in Hub (even if local at first) for clean path to teams.

Tables (core):
- `projects`, `sessions`
- `session_events` (append-only timeline)
- `session_snapshots` (compact markers, later restore points)
- `approvals` (audit)
- `runner_registry`
- `plugin_state`, `mcp_state`
- `credentials` (encrypted)

Runner maintains a local disk buffer for events while offline and backfills to Hub on reconnect.

## 6) Runner internals
### Project discovery
- Scan configured roots.
- Optional: also read Claude Code “recent projects” from `~/.claude/projects` to show prior sessions.

### Agent SDK runtime
- Create session per (projectId, sessionId).
- Configure `settingSources=['project']` to load repo-specific `.claude/` conventions.
- Stream:
  - assistant deltas
  - tool calls/output
- Implement `canUseTool` to pause and request approval from UI.

### CLI wrappers (plugins/MCP)
- For parity with existing CLI configs, call:
  - `claude plugin ...`
  - `claude mcp ...`
- Parse stdout JSON where possible; otherwise treat as text and surface in UI.

### PTY adapter
- Spawn `claude` inside PTY.
- Optionally spawn `tmux new-session -A -s <name> claude`.
- WS relays:
  - PTY output bytes → `pty.data`
  - UI keystrokes → PTY stdin
  - resize events

## 7) Security
- Phase 0: default private (localhost/LAN); token required.
- Multi-device: prefer Tailscale; or Hub with outbound runner tunnel (no inbound ports).
- Workspace allowlist to avoid arbitrary FS access.
- Approval rules stored with scope (session/project/user).

## 8) Observability
- Correlation IDs per turn/tool.
- Persist timeline events for replay.
- Metrics: WS latency, reconnect rates, tool error rates, approval duration.

## 9) Testing
- Contract tests for event schema.
- Integration tests for approval pause/resume.
- E2E tests with Playwright (create session → tool call → approval → compact → switch to terminal).
