# UI_UX_PLAN — Screens, Flows, Interaction Details
_Last updated: 2026-02-22_

## 1) Primary UX
**Chat-first** timeline, with a **Terminal parity** tab always available.

## 2) Navigation
### Desktop
- Left sidebar: Projects + Sessions (search, filters)
- Main area: Tabs (Chat, Terminal, Files, Git, MCP, Plugins)
### Mobile
- Bottom tabs: Projects, Sessions, Chat, Terminal, More

## 3) Core screens
### 3.1 Projects
- Search
- Add root folder
- Clone via SSH wizard
- Each project card shows branch + dirty indicator

### 3.2 Sessions
- Grouped by project
- Sort by last activity
- Actions: rename, pin, tag, archive, delete, export
- Badges: needs approval / MCP error / terminal attached

### 3.3 Chat (default)
Timeline items:
- User message
- Assistant message (streaming deltas)
- Tool run cards (collapsible)
- Approval cards (inline)
- Slash results (e.g., compact markers)

Composer:
- Multiline expand
- Preserve whitespace and code fences
- Optional helpers for `/`, `!`, `@`
- Shortcuts:
  - Enter send, Shift+Enter newline (configurable)

Parity handling:
- For `/plugin` and `/mcp`, show:
  - “Run in Terminal” button (switches to Terminal tab)
  - (Optional) “Run here” if supported via CLI wrapper

### 3.4 Terminal (parity)
- xterm.js terminal
- connect/disconnect
- resize support
- optional tmux session selector
- copy/paste, search

### 3.5 Files
- Tree + quick search
- Viewer/editor with save
- “Mention in chat” action inserts `@path`

### 3.6 Git
- Status (staged/unstaged/untracked)
- Diff viewer
- Stage/unstage
- Commit editor + “Generate message”
- Push/pull

### 3.7 MCP
- Server list with status/health
- Add/remove server (transport selector)
- OAuth required → show auth URL (copy/open)
- Show exposed tools/prompts

### 3.8 Plugins
- Installed list (version, enabled, scope)
- Enable/disable per scope
- Install/update/uninstall (via CLI wrapper)
- Errors tab: plugin load failures

## 4) Approvals (global modal)
When approval requested:
- Show tool name, args preview, risk level
- Actions:
  - Allow once
  - Allow always (scope selector)
  - Deny once
  - Deny always (scope selector)
  - Modify args (advanced)
- Show “why approval required” note

## 5) Error & offline UX
- Runner offline banner with reconnect.
- Event replay on reconnect (no missing timeline).
- Tool failures: show stdout/stderr; “Open Terminal” CTA.

## 6) Multi-device control
- Session shows active runner + active controller.
- “Follow mode” (read-only) when another device controls.
- “Take control” button with confirmation.

## 7) Accessibility
- Keyboard navigation for sidebar & tabs.
- Screen reader labels for tool and approval cards.
- High-contrast and reduced motion modes.
