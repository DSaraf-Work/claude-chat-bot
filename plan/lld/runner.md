# LLD: Runner Service
_Last updated: 2026-02-22_

## 1. Module Structure

```
apps/runner/
  src/
    index.ts                  # Entry point, service bootstrap
    config/
      schema.ts               # Zod config schema + defaults
      loader.ts               # Load YAML + env overlay
    sdk/
      session-manager.ts      # Create/resume/fork/end SDK sessions
      stream-adapter.ts       # Convert SDK stream events to protocol events
      tool-approval.ts        # canUseTool implementation, approval pause/resume
      slash-handler.ts        # Execute slash commands (/compact, etc.)
    pty/
      pty-adapter.ts          # Spawn claude PTY, relay bytes
      tmux-bridge.ts          # tmux session management (create, attach, list)
      resize-handler.ts       # Handle terminal resize events
    discovery/
      project-scanner.ts      # Scan configured roots for projects
      claude-projects.ts      # Read ~/.claude/projects for prior sessions
    cli/
      plugin-wrapper.ts       # Call `claude plugin ...`, parse output
      mcp-wrapper.ts          # Call `claude mcp ...`, parse output
    ws/
      ws-client.ts            # WebSocket client to Hub (or direct UI)
      heartbeat.ts            # Ping/pong + heartbeat interval
      reconnect.ts            # Exponential backoff reconnection
    buffer/
      event-buffer.ts         # Offline event queue
      flush.ts                # Flush buffer to Hub on reconnect
    api/
      router.ts               # Express/Fastify router (Phase 0 direct mode)
      middleware.ts            # Auth token validation
      handlers/
        projects.ts
        sessions.ts
        plugins.ts
        mcp.ts
    events/
      envelope.ts             # Event envelope factory
      types.ts                # TypeScript types for all event payloads
      emitter.ts              # Internal event bus (EventEmitter3)
  runner.config.yaml          # Default config template
  package.json
  tsconfig.json
```

## 2. Configuration

### Config Schema (Zod)

```typescript
import { z } from 'zod';

export const RunnerConfigSchema = z.object({
  runner: z.object({
    id: z.string().default(() => `runner_${randomId()}`),
    name: z.string().default('default'),
    port: z.number().default(3100),
    host: z.string().default('127.0.0.1'),
  }),
  auth: z.object({
    token: z.string().min(32),       // Bearer token for API/WS access
    tokenFile: z.string().optional(), // Alternative: read from file
  }),
  projects: z.object({
    roots: z.array(z.string()).default([]),           // Absolute paths to scan
    scanClaudeProjects: z.boolean().default(true),    // Read ~/.claude/projects
    excludePatterns: z.array(z.string()).default(['node_modules', '.git']),
  }),
  hub: z.object({
    enabled: z.boolean().default(false),
    url: z.string().url().optional(),                 // wss://hub.example.com
    reconnect: z.object({
      initialDelayMs: z.number().default(1000),
      maxDelayMs: z.number().default(30000),
      multiplier: z.number().default(2),
      jitter: z.boolean().default(true),
    }),
    heartbeatIntervalMs: z.number().default(15000),
  }),
  pty: z.object({
    shell: z.string().default('/bin/zsh'),
    useTmux: z.boolean().default(false),
    tmuxSocketPath: z.string().optional(),
    scrollbackLines: z.number().default(10000),
  }),
  buffer: z.object({
    maxEvents: z.number().default(50000),
    storagePath: z.string().default('~/.claude-runner/buffer'),
  }),
  sdk: z.object({
    approvalTimeoutMs: z.number().default(300000),    // 5 min default
    settingSources: z.array(z.string()).default(['project']),
  }),
});

export type RunnerConfig = z.infer<typeof RunnerConfigSchema>;
```

### Config Loading Order

1. Load `runner.config.yaml` from working directory or `~/.claude-runner/config.yaml`
2. Overlay environment variables: `RUNNER_PORT`, `RUNNER_AUTH_TOKEN`, `RUNNER_HUB_URL`, etc.
3. Validate with Zod schema; fail fast on invalid config.

## 3. Agent SDK Session Lifecycle

### Session Manager

```typescript
interface SessionHandle {
  sessionId: string;
  projectId: string;
  mode: 'sdk' | 'pty';
  status: 'active' | 'paused' | 'ended';
  createdAt: Date;
  lastActivityAt: Date;
}

class SessionManager {
  private sessions: Map<string, SessionHandle> = new Map();
  private sdkSessions: Map<string, AgentSDKSession> = new Map();
  private ptySessions: Map<string, PtyHandle> = new Map();

  async create(projectId: string, opts: CreateSessionOpts): Promise<SessionHandle>;
  async resume(sessionId: string): Promise<SessionHandle>;
  async fork(sessionId: string, snapshotId: string): Promise<SessionHandle>;
  async end(sessionId: string): Promise<void>;
  async switchMode(sessionId: string, mode: 'sdk' | 'pty'): Promise<void>;
  get(sessionId: string): SessionHandle | undefined;
  listByProject(projectId: string): SessionHandle[];
}
```

### SDK Session Lifecycle

```
create(projectId, opts)
  |
  v
[Load project .claude/ settings]
  |
  v
[Create Agent SDK session with settingSources=['project']]
  |
  v
[Register in sessions map]
  |
  v
[Emit session.created event]
  |
  v
[Ready for user.message]
  |
  +---> send(message) ---> [Stream assistant.delta events] ---> [assistant.message]
  |                              |
  |                         [Tool requested?]
  |                              |
  |                    yes: tool.requested event
  |                              |
  |                    [canUseTool check]
  |                         |         |
  |                    auto-approve   needs-approval
  |                         |              |
  |                    [execute]    [approval.requested]
  |                         |              |
  |                         |         [PAUSE SDK]
  |                         |              |
  |                         |         [Wait for resolution]
  |                         |              |
  |                         |         [approval.resolved]
  |                         |              |
  |                         |    approved?--+--denied?
  |                         |       |            |
  |                         |  [execute]   [skip tool]
  |                         |       |            |
  |                         +-------+------------+
  |                              |
  |                    [tool.output event]
  |                    [tool.completed event]
  |                              |
  |                    [Continue SDK loop]
  |
  +---> end() ---> [session.ended event] ---> [Cleanup]
```

### SDK Session Creation Detail

```typescript
async createSDKSession(projectId: string, sessionId: string): Promise<void> {
  const project = this.projectScanner.getProject(projectId);

  const session = await agentSDK.createSession({
    projectPath: project.path,
    sessionId,
    settingSources: this.config.sdk.settingSources,
    canUseTool: (tool, args) => this.toolApproval.evaluate(sessionId, tool, args),
  });

  // Wire up event streaming
  session.on('assistant:delta', (delta) => {
    this.emitEvent('assistant.delta', sessionId, projectId, {
      delta: delta.text,
      index: delta.index,
    });
  });

  session.on('assistant:message', (message) => {
    this.emitEvent('assistant.message', sessionId, projectId, {
      content: message.content,
      model: message.model,
      usage: message.usage,
    });
  });

  session.on('tool:requested', (tool) => {
    this.emitEvent('tool.requested', sessionId, projectId, {
      toolId: tool.id,
      toolName: tool.name,
      args: tool.args,
    });
  });

  session.on('tool:output', (tool) => {
    this.emitEvent('tool.output', sessionId, projectId, {
      toolId: tool.id,
      output: tool.output,
      isError: tool.isError,
    });
  });

  this.sdkSessions.set(sessionId, session);
}
```

## 4. `canUseTool` Implementation

### Approval Flow

The `canUseTool` callback is the mechanism by which the Runner pauses the Agent SDK and requests user approval.

```typescript
interface ApprovalRule {
  toolName: string;          // Glob pattern: "bash", "write_file", "*"
  decision: 'allow' | 'deny';
  scope: 'session' | 'project' | 'user';
  scopeId: string;           // sessionId, projectId, or userId
  argsPattern?: string;      // Optional: match specific args
  createdAt: Date;
}

interface PendingApproval {
  approvalId: string;
  sessionId: string;
  toolName: string;
  args: Record<string, unknown>;
  resolve: (decision: ApprovalDecision) => void;
  reject: (error: Error) => void;
  timeoutHandle: NodeJS.Timeout;
  requestedAt: Date;
}

interface ApprovalDecision {
  decision: 'allow' | 'deny';
  persist: boolean;
  scope?: 'session' | 'project' | 'user';
  modifiedArgs?: Record<string, unknown>;
}

class ToolApproval {
  private rules: ApprovalRule[] = [];
  private pending: Map<string, PendingApproval> = new Map();
  private permissionMode: PermissionMode = 'default';

  /**
   * Called by Agent SDK canUseTool callback.
   * Returns a Promise that resolves when the user makes a decision.
   */
  async evaluate(
    sessionId: string,
    tool: ToolRequest,
    args: Record<string, unknown>,
  ): Promise<boolean> {
    // 1. Check permission mode
    if (this.permissionMode === 'dontAsk' || this.permissionMode === 'bypassPermissions') {
      return true;
    }
    if (this.permissionMode === 'plan') {
      return false; // Deny all tool execution in plan mode
    }
    if (this.permissionMode === 'acceptEdits' && isEditTool(tool.name)) {
      return true;
    }

    // 2. Check persisted approval rules (most specific first)
    const matchingRule = this.findMatchingRule(sessionId, tool.name, args);
    if (matchingRule) {
      return matchingRule.decision === 'allow';
    }

    // 3. No matching rule: pause and request approval from UI
    const decision = await this.requestApproval(sessionId, tool, args);

    // 4. Persist rule if requested
    if (decision.persist && decision.scope) {
      this.rules.push({
        toolName: tool.name,
        decision: decision.decision,
        scope: decision.scope,
        scopeId: this.getScopeId(sessionId, decision.scope),
        createdAt: new Date(),
      });
    }

    return decision.decision === 'allow';
  }

  /**
   * Creates a pending approval and emits approval.requested event.
   * Returns a Promise that blocks until the UI resolves the approval.
   */
  private requestApproval(
    sessionId: string,
    tool: ToolRequest,
    args: Record<string, unknown>,
  ): Promise<ApprovalDecision> {
    return new Promise((resolve, reject) => {
      const approvalId = generateId('appr');

      const timeoutHandle = setTimeout(() => {
        this.pending.delete(approvalId);
        reject(new Error(`Approval timeout for tool ${tool.name}`));
      }, this.config.sdk.approvalTimeoutMs);

      this.pending.set(approvalId, {
        approvalId,
        sessionId,
        toolName: tool.name,
        args,
        resolve,
        reject,
        timeoutHandle,
        requestedAt: new Date(),
      });

      // Emit event to UI
      this.eventEmitter.emit('approval.requested', {
        approvalId,
        sessionId,
        toolName: tool.name,
        args,
        riskLevel: this.assessRisk(tool.name, args),
      });
    });
  }

  /**
   * Called when UI sends POST /sessions/:id/approve
   */
  resolveApproval(approvalId: string, decision: ApprovalDecision): void {
    const pending = this.pending.get(approvalId);
    if (!pending) {
      throw new Error(`No pending approval: ${approvalId}`);
    }

    clearTimeout(pending.timeoutHandle);
    this.pending.delete(approvalId);
    pending.resolve(decision);

    this.eventEmitter.emit('approval.resolved', {
      approvalId,
      sessionId: pending.sessionId,
      toolName: pending.toolName,
      decision: decision.decision,
      scope: decision.scope,
      persist: decision.persist,
    });
  }

  /**
   * Rule matching with scope precedence: session > project > user
   */
  private findMatchingRule(
    sessionId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): ApprovalRule | undefined {
    const session = this.sessionManager.get(sessionId);
    if (!session) return undefined;

    // Priority order: session-specific, then project, then user
    const scopes: Array<{ scope: 'session' | 'project' | 'user'; id: string }> = [
      { scope: 'session', id: sessionId },
      { scope: 'project', id: session.projectId },
      { scope: 'user', id: 'default' },
    ];

    for (const { scope, id } of scopes) {
      const rule = this.rules.find(
        (r) =>
          r.scope === scope &&
          r.scopeId === id &&
          matchGlob(r.toolName, toolName),
      );
      if (rule) return rule;
    }

    return undefined;
  }

  private assessRisk(toolName: string, args: Record<string, unknown>): 'low' | 'medium' | 'high' {
    const highRisk = ['bash', 'execute_command', 'run_terminal_command'];
    const mediumRisk = ['write_file', 'edit_file', 'delete_file'];
    if (highRisk.includes(toolName)) return 'high';
    if (mediumRisk.includes(toolName)) return 'medium';
    return 'low';
  }
}
```

## 5. PTY Adapter

### Spawn Strategy

```typescript
import * as pty from 'node-pty';

interface PtyHandle {
  sessionId: string;
  process: pty.IPty;
  cols: number;
  rows: number;
  useTmux: boolean;
  tmuxSessionName?: string;
}

class PtyAdapter {
  private handles: Map<string, PtyHandle> = new Map();

  /**
   * Spawn a PTY for a session.
   * If tmux is enabled, spawns inside a tmux session for persistence.
   */
  async spawn(sessionId: string, projectPath: string, opts: PtySpawnOpts): Promise<PtyHandle> {
    const cols = opts.cols ?? 120;
    const rows = opts.rows ?? 40;

    let command: string;
    let args: string[];

    if (this.config.pty.useTmux || opts.useTmux) {
      // Spawn inside tmux for session persistence across reconnects
      const tmuxName = `claude-${sessionId.slice(0, 8)}`;
      command = 'tmux';
      args = ['new-session', '-A', '-s', tmuxName, 'claude'];
    } else {
      // Direct spawn
      command = 'claude';
      args = [];
    }

    const process = pty.spawn(command, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: projectPath,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      },
    });

    const handle: PtyHandle = {
      sessionId,
      process,
      cols,
      rows,
      useTmux: this.config.pty.useTmux || opts.useTmux || false,
      tmuxSessionName: this.config.pty.useTmux ? `claude-${sessionId.slice(0, 8)}` : undefined,
    };

    // Wire up data relay
    process.onData((data: string) => {
      this.eventEmitter.emit('pty.data', {
        sessionId,
        data: Buffer.from(data).toString('base64'), // Base64 encode for WS transport
      });
    });

    process.onExit(({ exitCode, signal }) => {
      this.handles.delete(sessionId);
      this.eventEmitter.emit('pty.closed', {
        sessionId,
        exitCode,
        signal,
      });
    });

    this.handles.set(sessionId, handle);

    this.eventEmitter.emit('pty.opened', {
      sessionId,
      cols,
      rows,
      useTmux: handle.useTmux,
    });

    return handle;
  }

  /**
   * Write user input to PTY stdin.
   */
  write(sessionId: string, data: string): void {
    const handle = this.handles.get(sessionId);
    if (!handle) throw new Error(`No PTY for session: ${sessionId}`);
    handle.process.write(data);
  }

  /**
   * Handle terminal resize.
   */
  resize(sessionId: string, cols: number, rows: number): void {
    const handle = this.handles.get(sessionId);
    if (!handle) throw new Error(`No PTY for session: ${sessionId}`);
    handle.process.resize(cols, rows);
    handle.cols = cols;
    handle.rows = rows;
  }

  /**
   * Reconnect to existing tmux session (no state loss).
   */
  async reconnect(sessionId: string, cols: number, rows: number): Promise<PtyHandle> {
    const tmuxName = `claude-${sessionId.slice(0, 8)}`;

    // Check if tmux session exists
    const { stdout } = await exec(`tmux has-session -t ${tmuxName} 2>/dev/null && echo yes || echo no`);
    if (stdout.trim() !== 'yes') {
      throw new Error(`No tmux session found: ${tmuxName}`);
    }

    // Attach to existing tmux session
    const process = pty.spawn('tmux', ['attach-session', '-t', tmuxName], {
      name: 'xterm-256color',
      cols,
      rows,
    });

    const handle: PtyHandle = {
      sessionId,
      process,
      cols,
      rows,
      useTmux: true,
      tmuxSessionName: tmuxName,
    };

    process.onData((data: string) => {
      this.eventEmitter.emit('pty.data', {
        sessionId,
        data: Buffer.from(data).toString('base64'),
      });
    });

    this.handles.set(sessionId, handle);
    return handle;
  }

  /**
   * Kill a PTY session.
   */
  kill(sessionId: string): void {
    const handle = this.handles.get(sessionId);
    if (!handle) return;
    handle.process.kill();
    this.handles.delete(sessionId);
  }
}
```

## 6. Project Discovery

### Scan Algorithm

```typescript
interface DiscoveredProject {
  id: string;              // Deterministic hash of absolute path
  name: string;            // Directory name
  path: string;            // Absolute path
  gitRemote?: string;      // origin remote URL
  gitBranch?: string;      // Current branch
  isDirty: boolean;        // Has uncommitted changes
  hasClaudeConfig: boolean; // Has .claude/ directory
  lastModified: Date;
}

class ProjectScanner {
  private projects: Map<string, DiscoveredProject> = new Map();

  /**
   * Full scan: configured roots + optional ~/.claude/projects
   */
  async scan(): Promise<DiscoveredProject[]> {
    const results: DiscoveredProject[] = [];

    // 1. Scan configured roots
    for (const root of this.config.projects.roots) {
      const expanded = expandTilde(root);
      if (!await pathExists(expanded)) continue;

      const entries = await readdir(expanded, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (this.config.projects.excludePatterns.some(p => minimatch(entry.name, p))) continue;

        const projectPath = path.join(expanded, entry.name);
        const project = await this.inspectProject(projectPath);
        if (project) results.push(project);
      }
    }

    // 2. Optionally read ~/.claude/projects for prior sessions
    if (this.config.projects.scanClaudeProjects) {
      const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');
      if (await pathExists(claudeProjectsDir)) {
        const entries = await readdir(claudeProjectsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          // Claude stores projects as encoded paths
          const decodedPath = decodeClaudeProjectPath(entry.name);
          if (decodedPath && !results.some(p => p.path === decodedPath)) {
            const project = await this.inspectProject(decodedPath);
            if (project) results.push(project);
          }
        }
      }
    }

    // Update cache
    for (const project of results) {
      this.projects.set(project.id, project);
    }

    return results;
  }

  /**
   * Inspect a single directory for project metadata.
   */
  private async inspectProject(projectPath: string): Promise<DiscoveredProject | null> {
    if (!await pathExists(projectPath)) return null;

    const id = createHash('sha256').update(projectPath).digest('hex').slice(0, 16);
    const name = path.basename(projectPath);
    const hasClaudeConfig = await pathExists(path.join(projectPath, '.claude'));

    let gitRemote: string | undefined;
    let gitBranch: string | undefined;
    let isDirty = false;

    try {
      const { stdout: remote } = await exec('git remote get-url origin', { cwd: projectPath });
      gitRemote = remote.trim();

      const { stdout: branch } = await exec('git branch --show-current', { cwd: projectPath });
      gitBranch = branch.trim();

      const { stdout: status } = await exec('git status --porcelain', { cwd: projectPath });
      isDirty = status.trim().length > 0;
    } catch {
      // Not a git repo, or git not available
    }

    const stat = await fsStat(projectPath);

    return {
      id,
      name,
      path: projectPath,
      gitRemote,
      gitBranch,
      isDirty,
      hasClaudeConfig,
      lastModified: stat.mtime,
    };
  }

  getProject(id: string): DiscoveredProject | undefined {
    return this.projects.get(id);
  }
}
```

## 7. CLI Wrappers

### Plugin Wrapper

```typescript
interface PluginInfo {
  name: string;
  version: string;
  enabled: boolean;
  scope: string;
  capabilities: string[];
}

class PluginWrapper {
  /**
   * List installed plugins by calling `claude plugin list --json`.
   */
  async listInstalled(): Promise<PluginInfo[]> {
    const { stdout, stderr, exitCode } = await execWithTimeout(
      'claude plugin list --json',
      { timeout: 10000 },
    );

    if (exitCode !== 0) {
      throw new CLIError('plugin list', stderr);
    }

    try {
      return JSON.parse(stdout) as PluginInfo[];
    } catch {
      // Fallback: parse text output line by line
      return this.parseTextPluginList(stdout);
    }
  }

  /**
   * Install a plugin.
   */
  async install(packageName: string): Promise<{ success: boolean; output: string }> {
    const { stdout, stderr, exitCode } = await execWithTimeout(
      `claude plugin install ${shellEscape(packageName)}`,
      { timeout: 60000 },
    );
    return { success: exitCode === 0, output: exitCode === 0 ? stdout : stderr };
  }

  /**
   * Enable/disable a plugin.
   */
  async setEnabled(pluginName: string, enabled: boolean): Promise<{ success: boolean; output: string }> {
    const action = enabled ? 'enable' : 'disable';
    const { stdout, stderr, exitCode } = await execWithTimeout(
      `claude plugin ${action} ${shellEscape(pluginName)}`,
      { timeout: 10000 },
    );
    return { success: exitCode === 0, output: exitCode === 0 ? stdout : stderr };
  }

  async update(pluginName: string): Promise<{ success: boolean; output: string }>;
  async uninstall(pluginName: string): Promise<{ success: boolean; output: string }>;

  /**
   * List configured marketplaces.
   */
  async listMarketplaces(): Promise<Array<{ name: string; url: string }>>;
  async addMarketplace(url: string): Promise<{ success: boolean; output: string }>;
}
```

### MCP Wrapper

```typescript
interface McpServerInfo {
  name: string;
  transport: 'stdio' | 'http' | 'sse';
  status: 'running' | 'stopped' | 'error';
  lastError?: string;
  config: Record<string, unknown>;
  tools?: string[];
  prompts?: string[];
}

class McpWrapper {
  async listServers(): Promise<McpServerInfo[]> {
    const { stdout, stderr, exitCode } = await execWithTimeout(
      'claude mcp list --json',
      { timeout: 10000 },
    );
    if (exitCode !== 0) throw new CLIError('mcp list', stderr);
    try {
      return JSON.parse(stdout);
    } catch {
      return this.parseTextMcpList(stdout);
    }
  }

  async addServer(name: string, config: McpServerConfig): Promise<{ success: boolean; output: string }> {
    // Build CLI args from config
    const args = this.buildMcpAddArgs(name, config);
    const { stdout, stderr, exitCode } = await execWithTimeout(
      `claude mcp add ${args}`,
      { timeout: 15000 },
    );
    return { success: exitCode === 0, output: exitCode === 0 ? stdout : stderr };
  }

  async removeServer(name: string): Promise<{ success: boolean; output: string }>;
  async triggerAuth(name: string): Promise<{ authUrl?: string; output: string }>;
}
```

## 8. Offline Event Buffer

### Queue Structure

Events are buffered locally using **SQLite** (`better-sqlite3`) when the Hub connection is unavailable. SQLite provides ACID guarantees, efficient range queries, and requires no external process.

```typescript
import Database from 'better-sqlite3';

interface BufferedEvent {
  seqNo: number;            // Monotonic per-runner sequence number
  event: EventEnvelope;     // The full event envelope
  bufferedAt: string;       // ISO 8601
  flushed: boolean;
}

class EventBuffer {
  private db: Database.Database;
  private seqNo: number = 0;

  constructor(config: BufferConfig) {
    const dbPath = path.join(expandTilde(config.storagePath), 'buffer.db');
    this.db = new Database(dbPath);

    // Create table if not exists
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS buffered_events (
        seq_no INTEGER PRIMARY KEY,
        event_id TEXT NOT NULL UNIQUE,
        event_json TEXT NOT NULL,
        buffered_at TEXT NOT NULL DEFAULT (datetime('now')),
        flushed INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_buffered_unflushed
        ON buffered_events (flushed, seq_no) WHERE flushed = 0;
    `);

    // Load last sequence number
    const row = this.db.prepare('SELECT MAX(seq_no) as max_seq FROM buffered_events').get() as any;
    this.seqNo = row?.max_seq ?? 0;
  }

  /**
   * Append an event to the buffer.
   * Called for every event when Hub is offline (or always in Phase 0).
   */
  append(event: EventEnvelope): number {
    const seqNo = ++this.seqNo;
    this.db.prepare(
      `INSERT OR IGNORE INTO buffered_events (seq_no, event_id, event_json, buffered_at, flushed)
       VALUES (?, ?, ?, datetime('now'), 0)`,
    ).run(seqNo, event.id, JSON.stringify(event));

    // Enforce max buffer size: evict oldest flushed events
    const count = (this.db.prepare('SELECT COUNT(*) as c FROM buffered_events').get() as any).c;
    if (count > this.config.maxEvents) {
      this.db.prepare(
        `DELETE FROM buffered_events WHERE seq_no IN (
          SELECT seq_no FROM buffered_events WHERE flushed = 1 ORDER BY seq_no ASC LIMIT ?
        )`,
      ).run(count - this.config.maxEvents);
    }

    return seqNo;
  }

  /**
   * Read all unflushed events in order for backfill.
   */
  readUnflushed(): BufferedEvent[] {
    const rows = this.db.prepare(
      'SELECT seq_no, event_json, buffered_at, flushed FROM buffered_events WHERE flushed = 0 ORDER BY seq_no ASC',
    ).all() as any[];

    return rows.map((r) => ({
      seqNo: r.seq_no,
      event: JSON.parse(r.event_json),
      bufferedAt: r.buffered_at,
      flushed: false,
    }));
  }

  /**
   * Mark events as flushed after successful Hub delivery.
   */
  markFlushed(upToSeqNo: number): void {
    this.db.prepare(
      'UPDATE buffered_events SET flushed = 1 WHERE seq_no <= ? AND flushed = 0',
    ).run(upToSeqNo);
  }

  /**
   * Read events for Phase 0 timeline replay (no Hub).
   * Returns events for a given session, ordered by seq.
   */
  readBySession(sessionId: string, afterSeq?: number, limit: number = 200): EventEnvelope[] {
    let query = 'SELECT event_json FROM buffered_events WHERE flushed = 0';
    const params: any[] = [];

    if (afterSeq !== undefined) {
      query += ' AND seq_no > ?';
      params.push(afterSeq);
    }

    query += ' ORDER BY seq_no ASC LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(query).all(...params) as any[];
    return rows
      .map((r) => JSON.parse(r.event_json) as EventEnvelope)
      .filter((e) => e.sessionId === sessionId);
  }
}
```

### Flush-on-Reconnect

```typescript
class BufferFlusher {
  constructor(
    private buffer: EventBuffer,
    private wsClient: WsClient,
  ) {}

  /**
   * Called when Hub connection is re-established.
   * Sends all unflushed events in order, then resumes live streaming.
   */
  async flush(): Promise<{ flushed: number; errors: number }> {
    const unflushed = await this.buffer.readUnflushed();
    let flushed = 0;
    let errors = 0;

    // Send in batches to avoid overwhelming the Hub
    const BATCH_SIZE = 100;
    for (let i = 0; i < unflushed.length; i += BATCH_SIZE) {
      const batch = unflushed.slice(i, i + BATCH_SIZE);
      try {
        await this.wsClient.sendBatch(
          batch.map((b) => ({
            type: 'event.backfill',
            seqNo: b.seqNo,
            event: b.event,
          })),
        );
        await this.buffer.markFlushed(batch[batch.length - 1].seqNo);
        flushed += batch.length;
      } catch (err) {
        errors += batch.length;
        break; // Stop on first error, retry on next reconnect
      }
    }

    return { flushed, errors };
  }
}
```

## 9. WebSocket Client to Hub

### Connection Management

```typescript
type WsState = 'disconnected' | 'connecting' | 'connected' | 'registering' | 'ready';

class WsClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private state: WsState = 'disconnected';
  private reconnectAttempt: number = 0;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private lastPong: number = 0;

  async connect(): Promise<void> {
    if (this.state !== 'disconnected') return;
    this.state = 'connecting';

    const url = `${this.config.hub.url}/ws/runner`;
    this.ws = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${this.config.auth.token}`,
        'X-Runner-Id': this.config.runner.id,
      },
    });

    this.ws.on('open', () => this.handleOpen());
    this.ws.on('message', (data) => this.handleMessage(data));
    this.ws.on('close', (code, reason) => this.handleClose(code, reason.toString()));
    this.ws.on('error', (err) => this.handleError(err));
  }

  private async handleOpen(): Promise<void> {
    this.state = 'registering';
    this.reconnectAttempt = 0;

    // Send registration handshake
    this.send({
      type: 'runner.register',
      runnerId: this.config.runner.id,
      runnerName: this.config.runner.name,
      capabilities: ['sdk', 'pty', 'plugins', 'mcp'],
      activeSessions: this.sessionManager.listAll().map((s) => s.sessionId),
    });

    this.startHeartbeat();
  }

  private handleMessage(data: WebSocket.Data): void {
    const msg = JSON.parse(data.toString());

    switch (msg.type) {
      case 'runner.registered':
        this.state = 'ready';
        this.emit('ready');
        // Flush buffered events
        this.bufferFlusher.flush();
        break;

      case 'pong':
        this.lastPong = Date.now();
        break;

      case 'session.command':
        // Hub forwarding a UI command to this runner
        this.emit('command', msg);
        break;

      default:
        this.emit('message', msg);
    }
  }

  private handleClose(code: number, reason: string): void {
    this.state = 'disconnected';
    this.stopHeartbeat();
    this.scheduleReconnect();
  }

  /**
   * Exponential backoff with jitter.
   */
  private scheduleReconnect(): void {
    const { initialDelayMs, maxDelayMs, multiplier, jitter } = this.config.hub.reconnect;
    let delay = initialDelayMs * Math.pow(multiplier, this.reconnectAttempt);
    delay = Math.min(delay, maxDelayMs);

    if (jitter) {
      delay = delay * (0.5 + Math.random() * 0.5);
    }

    this.reconnectAttempt++;
    setTimeout(() => this.connect(), delay);
  }

  /**
   * Heartbeat: send ping every N ms, disconnect if no pong within 2x interval.
   */
  private startHeartbeat(): void {
    this.lastPong = Date.now();
    this.heartbeatInterval = setInterval(() => {
      if (Date.now() - this.lastPong > this.config.hub.heartbeatIntervalMs * 2) {
        // No pong received, connection is dead
        this.ws?.close(4000, 'heartbeat timeout');
        return;
      }
      this.send({ type: 'ping', ts: Date.now() });
    }, this.config.hub.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Send an event. If not connected, buffer it.
   */
  sendEvent(event: EventEnvelope): void {
    if (this.state === 'ready') {
      this.send({ type: 'event', event });
    } else {
      this.eventBuffer.append(event);
    }
  }

  private send(msg: unknown): void {
    this.ws?.send(JSON.stringify(msg));
  }
}
```

### Registration Handshake Sequence

```
Runner                          Hub
  |                              |
  |--- WS connect -------------->|
  |                              |
  |--- runner.register --------->|  { runnerId, capabilities, activeSessions }
  |                              |
  |<-- runner.registered --------|  { assignedSessions, config }
  |                              |
  |--- event.backfill[] -------->|  (flush offline buffer)
  |                              |
  |<-- backfill.ack -------------|  { lastSeqNo }
  |                              |
  |<== READY (bidirectional) ===>|
  |                              |
  |--- ping -------------------->|  (every heartbeatIntervalMs)
  |<-- pong ---------------------|
```
