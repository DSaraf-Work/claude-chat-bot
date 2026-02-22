# LLD: Database Schema
_Last updated: 2026-02-22_

## 1. Overview

- **Database:** PostgreSQL 16+
- **ORM:** Drizzle ORM (TypeScript-native, schema-as-code)
- **Migrations:** Drizzle Kit (`drizzle-kit generate` + `drizzle-kit migrate`)
- **Connection pooling:** Built-in `pg` pool or PgBouncer for production

---

## 2. CREATE TABLE Statements

### `projects`

```sql
CREATE TABLE projects (
  id              TEXT PRIMARY KEY,                    -- Deterministic hash of absolute path
  name            TEXT NOT NULL,                       -- Directory name
  path            TEXT NOT NULL UNIQUE,                -- Absolute filesystem path
  git_remote      TEXT,                                -- origin remote URL
  git_branch      TEXT,                                -- Current branch
  is_dirty        BOOLEAN NOT NULL DEFAULT false,      -- Has uncommitted changes
  has_claude_config BOOLEAN NOT NULL DEFAULT false,    -- Has .claude/ directory
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_projects_name ON projects (name);
CREATE INDEX idx_projects_updated_at ON projects (updated_at DESC);
```

### `sessions`

```sql
CREATE TABLE sessions (
  id              TEXT PRIMARY KEY,                    -- e.g., "sess_abc123"
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  runner_id       TEXT NOT NULL,                       -- Runner that owns this session
  mode            TEXT NOT NULL CHECK (mode IN ('sdk', 'pty')),
  status          TEXT NOT NULL CHECK (status IN ('active', 'paused', 'ended'))
                  DEFAULT 'active',
  title           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sessions_project_id ON sessions (project_id);
CREATE INDEX idx_sessions_runner_id ON sessions (runner_id);
CREATE INDEX idx_sessions_status ON sessions (status);
CREATE INDEX idx_sessions_last_activity ON sessions (last_activity_at DESC);
CREATE INDEX idx_sessions_project_status ON sessions (project_id, status);
```

### `session_events`

This is the highest-volume table. Append-only.

```sql
CREATE TABLE session_events (
  id              TEXT PRIMARY KEY,                    -- e.g., "evt_abc123"
  session_id      TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  project_id      TEXT NOT NULL,                       -- Denormalized for query efficiency
  seq             BIGINT NOT NULL,                     -- Monotonic per-session sequence number (assigned by Hub)
  type            TEXT NOT NULL,                       -- e.g., "assistant.delta", "tool.requested"
  ts              TIMESTAMPTZ NOT NULL,                -- Event timestamp (from source/Runner clock)
  correlation_id  TEXT,                                -- Groups events in a turn (e.g., "turn_17")
  runner_id       TEXT NOT NULL,
  mode            TEXT NOT NULL CHECK (mode IN ('sdk', 'pty')),
  payload         JSONB NOT NULL DEFAULT '{}',         -- Type-specific event data
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()   -- When Hub received this event
);

-- Primary query: timeline for a session, ordered by seq (authoritative order)
CREATE INDEX idx_session_events_timeline
  ON session_events (session_id, seq ASC);

-- Legacy/secondary ordering by timestamp
CREATE INDEX idx_session_events_ts
  ON session_events (session_id, ts ASC, id ASC);

-- Filter by event type within a session
CREATE INDEX idx_session_events_type
  ON session_events (session_id, type, seq ASC);

-- Correlation ID lookup (all events in a turn)
CREATE INDEX idx_session_events_correlation
  ON session_events (session_id, correlation_id)
  WHERE correlation_id IS NOT NULL;

-- Unique constraint on (session_id, seq) for ordering guarantee
CREATE UNIQUE INDEX idx_session_events_session_seq
  ON session_events (session_id, seq);

-- Backfill deduplication (idempotent insert)
-- Already covered by PRIMARY KEY on id
```

### `session_snapshots`

```sql
CREATE TABLE session_snapshots (
  id              TEXT PRIMARY KEY,                    -- e.g., "snap_abc123"
  session_id      TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  type            TEXT NOT NULL CHECK (type IN ('compact', 'fork', 'checkpoint')),
  context_summary TEXT,                                -- Human-readable summary of context at this point
  event_id        TEXT REFERENCES session_events(id),  -- Event that triggered this snapshot
  metadata        JSONB NOT NULL DEFAULT '{}',         -- Additional snapshot data
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_session_snapshots_session
  ON session_snapshots (session_id, created_at DESC);
```

### `approvals`

Audit trail for every approval decision made.

```sql
CREATE TABLE approvals (
  id              TEXT PRIMARY KEY,                    -- e.g., "appr_abc123"
  session_id      TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  event_id        TEXT REFERENCES session_events(id),  -- The approval.requested event
  tool_name       TEXT NOT NULL,
  args            JSONB NOT NULL DEFAULT '{}',
  decision        TEXT NOT NULL CHECK (decision IN ('allow', 'deny')),
  scope           TEXT CHECK (scope IN ('session', 'project', 'user')),
  persist         BOOLEAN NOT NULL DEFAULT false,
  decided_by      TEXT,                                -- userId (Phase 1)
  decided_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_approvals_session ON approvals (session_id, created_at DESC);
CREATE INDEX idx_approvals_tool ON approvals (tool_name, scope);

-- Lookup persisted rules by scope
CREATE INDEX idx_approvals_scope_lookup
  ON approvals (tool_name, scope, decision)
  WHERE persist = true;
```

### `runner_registry`

```sql
CREATE TABLE runner_registry (
  id              TEXT PRIMARY KEY,                    -- e.g., "runner_abc123"
  name            TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('online', 'offline', 'draining'))
                  DEFAULT 'offline',
  capabilities    TEXT[] NOT NULL DEFAULT '{}',        -- e.g., ['sdk', 'pty', 'plugins', 'mcp']
  last_heartbeat  TIMESTAMPTZ,
  ip_address      TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_runner_status ON runner_registry (status);
```

### `plugin_state`

```sql
CREATE TABLE plugin_state (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  plugin_name     TEXT NOT NULL,
  version         TEXT NOT NULL,
  enabled         BOOLEAN NOT NULL DEFAULT true,
  scope           TEXT NOT NULL DEFAULT 'user',        -- 'user', 'project', etc.
  scope_id        TEXT,                                -- projectId if scope='project'
  config          JSONB NOT NULL DEFAULT '{}',
  installed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_plugin_state_unique
  ON plugin_state (plugin_name, scope, COALESCE(scope_id, ''));
CREATE INDEX idx_plugin_state_scope ON plugin_state (scope, scope_id);
```

### `mcp_state`

```sql
CREATE TABLE mcp_state (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  server_name     TEXT NOT NULL UNIQUE,
  transport       TEXT NOT NULL CHECK (transport IN ('stdio', 'http', 'sse')),
  config          JSONB NOT NULL DEFAULT '{}',         -- Transport-specific config
  status          TEXT NOT NULL CHECK (status IN ('running', 'stopped', 'error'))
                  DEFAULT 'stopped',
  last_error      TEXT,
  tools           TEXT[] DEFAULT '{}',                  -- Discovered tool names
  prompts         TEXT[] DEFAULT '{}',                  -- Discovered prompt names
  auth_status     TEXT CHECK (auth_status IN ('authenticated', 'pending', 'not_required'))
                  DEFAULT 'not_required',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_mcp_state_status ON mcp_state (status);
```

### `credentials`

```sql
CREATE TABLE credentials (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  owner_type      TEXT NOT NULL CHECK (owner_type IN ('user', 'project', 'runner', 'mcp')),
  owner_id        TEXT NOT NULL,                       -- ID of the owning entity
  key             TEXT NOT NULL,                       -- Credential identifier (e.g., "api_key")
  encrypted_value BYTEA NOT NULL,                      -- AES-256-GCM encrypted value
  iv              BYTEA NOT NULL,                      -- Initialization vector for decryption
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  rotated_at      TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_credentials_unique
  ON credentials (owner_type, owner_id, key);
CREATE INDEX idx_credentials_owner ON credentials (owner_type, owner_id);
```

---

## 3. Relationships (ASCII ERD)

```
                        +-------------------+
                        |    projects       |
                        |-------------------|
                        | id (PK)           |
                        | name              |
                        | path (UNIQUE)     |
                        | git_remote        |
                        | git_branch        |
                        | is_dirty          |
                        | has_claude_config |
                        | created_at        |
                        | updated_at        |
                        +--------+----------+
                                 |
                                 | 1:N
                                 v
                        +-------------------+
                        |    sessions       |
                        |-------------------|
                        | id (PK)           |
                        | project_id (FK)---|-----> projects.id
                        | runner_id         |-----> runner_registry.id
                        | mode              |
                        | status            |
                        | title             |
                        | created_at        |
                        | updated_at        |
                        | last_activity_at  |
                        +--------+----------+
                                 |
                   +-------------+-------------+
                   |             |             |
                   | 1:N         | 1:N         | 1:N
                   v             v             v
          +-----------------+ +----------+ +------------------+
          | session_events  | | approvals| | session_snapshots |
          |-----------------|  |----------|  |------------------|
          | id (PK)         | | id (PK)  | | id (PK)          |
          | session_id (FK) | | session_id| | session_id (FK)  |
          | project_id      | | event_id  | | type             |
          | type            | | tool_name | | context_summary  |
          | ts              | | args      | | event_id (FK)    |
          | correlation_id  | | decision  | | metadata         |
          | runner_id       | | scope     | | created_at       |
          | mode            | | persist   | +------------------+
          | payload (JSONB) | | decided_by|
          | created_at      | | decided_at|
          +-----------------+ | created_at|
                              +----------+

  +-------------------+   +---------------+   +---------------+   +--------------+
  | runner_registry   |   | plugin_state  |   | mcp_state     |   | credentials  |
  |-------------------|   |---------------|   |---------------|   |--------------|
  | id (PK)           |   | id (PK)       |   | id (PK)       |   | id (PK)      |
  | name              |   | plugin_name   |   | server_name   |   | owner_type   |
  | status            |   | version       |   | transport     |   | owner_id     |
  | capabilities      |   | enabled       |   | config (JSONB)|   | key          |
  | last_heartbeat    |   | scope         |   | status        |   | encrypted_   |
  | ip_address        |   | scope_id      |   | last_error    |   |   value       |
  | metadata (JSONB)  |   | config (JSONB)|   | tools         |   | iv           |
  | created_at        |   | installed_at  |   | prompts       |   | created_at   |
  | updated_at        |   | updated_at    |   | auth_status   |   | rotated_at   |
  +-------------------+   +---------------+   | created_at    |   +--------------+
                                               | updated_at    |
                                               +---------------+
```

---

## 4. Drizzle ORM Schema

```typescript
// db/schema.ts
import { pgTable, text, boolean, timestamp, jsonb, index, uniqueIndex, check } from 'drizzle-orm/pg-core';

export const projects = pgTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  path: text('path').notNull().unique(),
  gitRemote: text('git_remote'),
  gitBranch: text('git_branch'),
  isDirty: boolean('is_dirty').notNull().default(false),
  hasClaudeConfig: boolean('has_claude_config').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_projects_name').on(table.name),
  index('idx_projects_updated_at').on(table.updatedAt),
]);

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  runnerId: text('runner_id').notNull(),
  mode: text('mode').notNull(),           // 'sdk' | 'pty'
  status: text('status').notNull().default('active'), // 'active' | 'paused' | 'ended'
  title: text('title'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_sessions_project_id').on(table.projectId),
  index('idx_sessions_runner_id').on(table.runnerId),
  index('idx_sessions_status').on(table.status),
  index('idx_sessions_last_activity').on(table.lastActivityAt),
  index('idx_sessions_project_status').on(table.projectId, table.status),
]);

export const sessionEvents = pgTable('session_events', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  projectId: text('project_id').notNull(),
  seq: bigint('seq', { mode: 'number' }).notNull(),  // Monotonic per-session, assigned by Hub
  type: text('type').notNull(),
  ts: timestamp('ts', { withTimezone: true }).notNull(),
  correlationId: text('correlation_id'),
  runnerId: text('runner_id').notNull(),
  mode: text('mode').notNull(),
  payload: jsonb('payload').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_session_events_timeline').on(table.sessionId, table.seq),
  uniqueIndex('idx_session_events_session_seq').on(table.sessionId, table.seq),
  index('idx_session_events_type').on(table.sessionId, table.type, table.seq),
  index('idx_session_events_correlation').on(table.sessionId, table.correlationId),
]);

export const sessionSnapshots = pgTable('session_snapshots', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),           // 'compact' | 'fork' | 'checkpoint'
  contextSummary: text('context_summary'),
  eventId: text('event_id').references(() => sessionEvents.id),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_session_snapshots_session').on(table.sessionId, table.createdAt),
]);

export const approvals = pgTable('approvals', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  eventId: text('event_id').references(() => sessionEvents.id),
  toolName: text('tool_name').notNull(),
  args: jsonb('args').notNull().default({}),
  decision: text('decision').notNull(),   // 'allow' | 'deny'
  scope: text('scope'),                    // 'session' | 'project' | 'user'
  persist: boolean('persist').notNull().default(false),
  decidedBy: text('decided_by'),
  decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_approvals_session').on(table.sessionId, table.createdAt),
  index('idx_approvals_tool').on(table.toolName, table.scope),
  index('idx_approvals_scope_lookup').on(table.toolName, table.scope, table.decision),
]);

export const runnerRegistry = pgTable('runner_registry', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  status: text('status').notNull().default('offline'), // 'online' | 'offline' | 'draining'
  capabilities: text('capabilities').array().notNull().default([]),
  lastHeartbeat: timestamp('last_heartbeat', { withTimezone: true }),
  ipAddress: text('ip_address'),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_runner_status').on(table.status),
]);

export const pluginState = pgTable('plugin_state', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  pluginName: text('plugin_name').notNull(),
  version: text('version').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  scope: text('scope').notNull().default('user'),
  scopeId: text('scope_id'),
  config: jsonb('config').notNull().default({}),
  installedAt: timestamp('installed_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('idx_plugin_state_unique').on(table.pluginName, table.scope, table.scopeId),
  index('idx_plugin_state_scope').on(table.scope, table.scopeId),
]);

export const mcpState = pgTable('mcp_state', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  serverName: text('server_name').notNull().unique(),
  transport: text('transport').notNull(),   // 'stdio' | 'http' | 'sse'
  config: jsonb('config').notNull().default({}),
  status: text('status').notNull().default('stopped'), // 'running' | 'stopped' | 'error'
  lastError: text('last_error'),
  tools: text('tools').array().default([]),
  prompts: text('prompts').array().default([]),
  authStatus: text('auth_status').default('not_required'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_mcp_state_status').on(table.status),
]);

export const credentials = pgTable('credentials', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  ownerType: text('owner_type').notNull(), // 'user' | 'project' | 'runner' | 'mcp'
  ownerId: text('owner_id').notNull(),
  key: text('key').notNull(),
  encryptedValue: text('encrypted_value').notNull(), // Base64-encoded AES-256-GCM ciphertext
  iv: text('iv').notNull(),                           // Base64-encoded IV
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  rotatedAt: timestamp('rotated_at', { withTimezone: true }),
}, (table) => [
  uniqueIndex('idx_credentials_unique').on(table.ownerType, table.ownerId, table.key),
  index('idx_credentials_owner').on(table.ownerType, table.ownerId),
]);
```

---

## 5. Migration Strategy

### Tooling

Use **Drizzle Kit** for migrations:

```bash
# Generate a migration from schema changes
npx drizzle-kit generate

# Apply pending migrations
npx drizzle-kit migrate

# Push schema directly (development only)
npx drizzle-kit push
```

### Migration Workflow

1. Developer modifies `db/schema.ts`
2. Run `drizzle-kit generate` to create a SQL migration file in `db/migrations/`
3. Review the generated SQL
4. Commit both the schema change and migration file
5. On deployment, run `drizzle-kit migrate` before starting the service

### Migration File Convention

```
db/migrations/
  0001_initial_schema.sql
  0002_add_session_snapshots_metadata.sql
  0003_add_credentials_rotation.sql
  ...
```

### Rollback Strategy

Drizzle Kit does not auto-generate rollback migrations. For each migration, maintain a manual down migration if needed:

```
db/migrations/
  0001_initial_schema.sql
  0001_initial_schema.down.sql    # Manual rollback
```

---

## 6. Key Queries

### Timeline Fetch with Cursor (forward pagination)

```sql
-- Fetch next 50 events after cursor seq 450
SELECT *
FROM session_events
WHERE session_id = 'sess_123'
  AND seq > 450
ORDER BY seq ASC
LIMIT 50;
```

### Latest N Events (initial load)

```sql
-- Get the last 200 events for a session, ordered by seq (authoritative)
SELECT * FROM session_events
WHERE session_id = 'sess_123'
ORDER BY seq DESC
LIMIT 200;

-- Client reverses the result for display order
```

### Approval Lookup by Scope (for rule matching)

```sql
-- Find persisted approval rules for a tool, ordered by specificity
SELECT * FROM approvals
WHERE tool_name = 'bash'
  AND persist = true
  AND (
    (scope = 'session' AND session_id = 'sess_123')
    OR (scope = 'project' AND session_id IN (
      SELECT id FROM sessions WHERE project_id = 'proj_abc'
    ))
    OR (scope = 'user')
  )
ORDER BY
  CASE scope
    WHEN 'session' THEN 1
    WHEN 'project' THEN 2
    WHEN 'user' THEN 3
  END,
  decided_at DESC
LIMIT 1;
```

### Session List by Project (sorted by activity)

```sql
SELECT s.*,
  EXISTS (
    SELECT 1 FROM session_events se
    WHERE se.session_id = s.id AND se.type = 'approval.requested'
    AND NOT EXISTS (
      SELECT 1 FROM session_events se2
      WHERE se2.session_id = s.id
        AND se2.type = 'approval.resolved'
        AND se2.payload->>'approvalId' = se.payload->>'approvalId'
    )
  ) AS has_pending_approval
FROM sessions s
WHERE s.project_id = 'proj_abc'
  AND s.status != 'ended'
ORDER BY s.last_activity_at DESC
LIMIT 50;
```

### Event Count per Session (for session cards)

```sql
SELECT session_id, COUNT(*) as event_count
FROM session_events
WHERE session_id = ANY(ARRAY['sess_1', 'sess_2', 'sess_3'])
GROUP BY session_id;
```

### Idempotent Event Insert (backfill)

```sql
-- Used during runner backfill: insert if not exists
INSERT INTO session_events (id, session_id, project_id, type, ts, correlation_id, runner_id, mode, payload)
VALUES ('evt_xyz', 'sess_123', 'proj_abc', 'assistant.delta', '2026-02-22T12:00:00Z', 'turn_1', 'runner_1', 'sdk', '{"delta": "hello"}')
ON CONFLICT (id) DO NOTHING;
```

### Runner Active Sessions

```sql
SELECT s.* FROM sessions s
WHERE s.runner_id = 'runner_abc'
  AND s.status = 'active';
```

---

## 7. Performance Considerations

### `session_events` Table Growth

This table is append-only and will be the largest table. Strategies for managing growth:

1. **Partitioning by month:** Use Postgres declarative partitioning on `created_at` to keep individual partition sizes manageable.

```sql
CREATE TABLE session_events (
  ...
) PARTITION BY RANGE (created_at);

CREATE TABLE session_events_2026_02 PARTITION OF session_events
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
```

2. **Archival:** Move events from sessions with status='ended' and older than N days to a cold storage table or external storage.

3. **Index-only scans:** The `idx_session_events_timeline` index covers the most common query pattern, enabling index-only scans when only `id`, `ts`, and `session_id` are needed.

### Connection Pooling

Configure the Postgres client pool:

```typescript
const pool = {
  min: 2,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
};
```

### JSONB Indexing

If queries on `payload` fields become common (e.g., searching tool names within events), add GIN indexes:

```sql
CREATE INDEX idx_session_events_payload_gin
  ON session_events USING GIN (payload);
```

Only add this if query patterns justify it, as GIN indexes increase write cost.
