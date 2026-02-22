# Claude Portable UI

A **portable web UI** to run [Claude Code](https://claude.ai/code) on your local Mac runner — with chat + timeline as the default experience and an always-available terminal parity tab that is 1:1 with the Claude Code REPL.

Access your coding sessions from any device (phone, tablet, secondary laptop) over LAN or a secure tunnel.

---

## Overview

| Layer | Description |
|---|---|
| **Runner** | macOS local service — Agent SDK runtime + CLI PTY adapter + workspace services |
| **Hub** _(optional v1)_ | Auth, session registry, event store, WebSocket gateway for multi-device |
| **UI** | Web frontend — chat timeline, approvals, MCP panel, plugins panel, terminal tab |

### Modes

- **SDK Mode** (default) — structured streaming via Claude Agent SDK; typed events for deltas, tool calls, approvals.
- **Parity Mode (PTY)** — spawns the `claude` REPL in a PTY, relayed to xterm.js; used for exact `/plugin`, `/mcp`, and edge-case CLI flows.

---

## Features (MVP — Phase 0)

- **Projects** — discover/add local roots; clone via SSH; show git remote/branch/dirty state.
- **Sessions** — create, resume, fork, end; search across sessions.
- **Chat timeline** — streaming assistant responses; tool events; error states.
- **Approvals** — allow/deny once or always (scope: session / project / user); modify args (advanced).
- **Slash commands** — `/compact` in SDK mode; `/mcp` & `/plugin` via terminal tab.
- **MCP panel** — list/add/remove servers (stdio/http/sse); health checks; OAuth flow.
- **Plugins panel** — list installed; enable/disable; install/update/uninstall via CLI wrapper.
- **Terminal parity tab** — embedded xterm attaches to `claude` REPL (optionally tmux); reconnect without losing state.

---

## Roadmap

| Phase | Scope |
|---|---|
| **0** | Local runner, LAN / Tailscale access |
| **1** | Hub service for outside-network multi-device access |
| **2** | Teams, workspaces, RBAC, runner pools |

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                        UI                           │
│  Chat Timeline │ Approvals │ MCP │ Plugins │ xterm  │
└────────────────────────┬────────────────────────────┘
                         │ WebSocket / REST
              ┌──────────▼──────────┐
              │         Hub          │  (optional Phase 1+)
              │  Auth · Registry ·  │
              │  Event Store · WS   │
              └──────────┬──────────┘
                         │
              ┌──────────▼──────────┐
              │        Runner        │
              │  Agent SDK · PTY    │
              │  FS/Git/SSH · MCP   │
              └─────────────────────┘
```

**Event protocol** — all events share a single JSON envelope over WebSocket:

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

---

## Docs

Design documents live in [`claude-portable-ui-docs/`](./claude-portable-ui-docs/):

| File | Contents |
|---|---|
| [`PRD.md`](./claude-portable-ui-docs/PRD.md) | Product requirements, personas, milestones, success metrics |
| [`TECH_DOC.md`](./claude-portable-ui-docs/TECH_DOC.md) | Architecture, event protocol, REST API, persistence, security |
| [`UI_UX_PLAN.md`](./claude-portable-ui-docs/UI_UX_PLAN.md) | UI layout, component design, interaction patterns |

---

## Security

- Phase 0: private by default (localhost / LAN); token required.
- Multi-device: prefer Tailscale; or Hub with outbound runner tunnel (no inbound ports needed).
- Workspace allowlist to prevent arbitrary filesystem access.
- Approval rules stored with explicit scope (session / project / user).

---

## Status

> Early design phase — implementation not yet started.
