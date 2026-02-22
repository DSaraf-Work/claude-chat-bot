# PRD — Portable UI for Claude Code (SDK-first + CLI Parity)
_Last updated: 2026-02-22_

## 1) One-liner
A **portable web UI** to run Claude Code on your **local Mac runner** (repos, SSH, MCP, plugins), with **chat+timeline** as default and an always-available **terminal parity tab** that is 1:1 with the Claude Code REPL.

## 2) Goals
- **Ditto user input semantics** to Claude Code interactive mode (slash commands, prefixes, multiline/paste).
- Support core Claude Code workflows: explore repo, edit files, run commands, use MCP tools, commit & push.
- **Exact parity** for `/plugin`, `/mcp`, `/compact`, and approval modes.
- **Multi-device** access (phone/laptop) via secure tunnel / hub.
- Build an **extensible platform** (teams later).

## 3) Non-goals (MVP)
- Rebuild Claude’s marketplace discovery logic (wrap CLI commands initially).
- Replace tmux workflows completely (bridge them).
- Full enterprise multi-tenant SaaS in v1.

## 4) Users & scenarios
### Personas
- Solo power user (primary)
- Team leads / platform owners (later)
### Top scenarios
1. Start a new session on a repo from phone.
2. Continue a long-running session while away from laptop.
3. Approve/deny tool runs; persist “don’t ask again” rules.
4. Run `/compact` with instructions and continue.
5. Manage MCP servers + OAuth auth steps.
6. Install/enable plugins and verify they’re active.
7. Open Terminal tab when a flow needs exact REPL behavior.

## 5) Product principles
- **Truth is the CLI** for parity commands; UI never breaks workflows.
- **SDK-first** for structured streaming + better UX.
- **Secure by default** (private network / outbound tunnel).
- **Local-first** (reuse your installed MCPs/plugins and SSH keys).

## 6) Scope & milestones
### Phase 0 (Local runner, LAN/Tailscale)
- Projects: discover/add roots; clone via SSH.
- Sessions: create/resume/fork/end; session search.
- Chat timeline: streaming; tool events; errors.
- Approvals: allow/deny once; allow/deny persist (session/project/user).
- Slash: `/compact` supported in SDK mode; `/mcp` & `/plugin` available via Terminal parity tab.
- MCP panel: list/add/remove; show health; OAuth URL copy/open.
- Plugins panel: list installed; enable/disable; install/update/uninstall via CLI wrapper.
- Terminal parity: embedded xterm attaches to `claude` (optionally tmux).

### Phase 1 (Hub for “outside network” multi-device)
- Hub service: auth, session registry, event store.
- Runner maintains outbound connection; UI connects to hub.
- Timeline persistence and replay.

### Phase 2 (Teams)
- Teams/workspaces/RBAC.
- Per-team plugin/MCP policy and secrets isolation.
- Runner pools (per-team runner/container).

## 7) Functional requirements
### Projects
- Scan configured roots; show git remote/branch/dirty state.
- Add root; remove root; clone repository via SSH.
- Open project settings (`CLAUDE.md`, `.claude/*`).

### Sessions
- Create session (SDK or parity).
- Resume session; fork from snapshot.
- Timeline of:
  - user/assistant messages
  - tool calls + outputs
  - approvals
  - slash command results

### Chat input parity
- Preserve whitespace/code fences.
- Recognize but do not rewrite:
  - `/...` slash commands
  - `! ...` shell prefix
  - `@path` mentions
- Multiline compose; paste handling.

### Approvals & permission modes
- Modes supported:
  - `default`, `plan`, `acceptEdits`
  - `dontAsk`/`bypassPermissions` (advanced/admin)
- Approval choices:
  - allow once / deny once
  - allow always / deny always (scope: session/project/user)
  - modify args (advanced)

### `/compact`
- Execute with optional user instructions.
- Store compact snapshot marker in timeline.

### MCP
- List/add/remove; transport: stdio/http/sse.
- Health checks; show last error.
- OAuth: surface auth URL; re-check status.

### Plugins
- List installed and enabled scopes.
- Install/update/uninstall/enable/disable via CLI wrapper.
- Show plugin capabilities (commands/skills/hooks/MCP/LSP) when parseable.

### Terminal parity
- xterm tab attaches to `claude` REPL (pty).
- Optionally attach to tmux session.
- Reconnect without losing state.

## 8) Non-functional requirements
- Security: auth required; outbound tunnel supported.
- Reliability: reconnect + resume; no lost events.
- Performance: <2s load for last 200 timeline events.
- Observability: structured logs, correlation IDs, audit trail.

## 9) Success metrics
- 95% sessions usable without opening Terminal tab.
- Approval median decision time < 10 seconds.
- Reconnect success rate > 99%.
