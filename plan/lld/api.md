# LLD: REST API Contract
_Last updated: 2026-02-22_

All endpoints require `Authorization: Bearer <token>` unless otherwise noted.

Base URL: `/api/v1`

---

## 1. Common Types

```typescript
// Standard error response
interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

// Pagination (cursor-based)
interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    nextCursor?: string;
    hasMore: boolean;
  };
}

// Standard envelope for single items
interface ApiResponse<T> {
  data: T;
}
```

---

## 2. Projects

### `GET /api/v1/projects`
List all discovered projects.

**Auth:** Required

**Query Parameters:**
```typescript
interface ListProjectsQuery {
  search?: string;          // Filter by project name (case-insensitive substring)
}
```

**Response `200 OK`:**
```typescript
interface ProjectRecord {
  id: string;
  name: string;
  path: string;
  gitRemote?: string;
  gitBranch?: string;
  isDirty: boolean;
  hasClaudeConfig: boolean;
  lastModified: string;       // ISO 8601
  sessionCount: number;
}

// Response body
interface ListProjectsResponse {
  data: ProjectRecord[];
}
```

**Example:**
```
GET /api/v1/projects?search=chatbot

200 OK
{
  "data": [
    {
      "id": "a1b2c3d4e5f6g7h8",
      "name": "claude-chat-bot",
      "path": "/Users/dev/repos/claude-chat-bot",
      "gitRemote": "git@github.com:user/claude-chat-bot.git",
      "gitBranch": "main",
      "isDirty": false,
      "hasClaudeConfig": true,
      "lastModified": "2026-02-22T10:00:00.000Z",
      "sessionCount": 3
    }
  ]
}
```

**Errors:**
| Code | Status | When |
|------|--------|------|
| `UNAUTHORIZED` | 401 | Invalid/missing token |

---

### `POST /api/v1/projects`
Add a new project root.

**Auth:** Required

**Request Body:**
```typescript
interface AddProjectRequest {
  path: string;             // Absolute path to project root
}
```

**Response `201 Created`:**
```typescript
interface AddProjectResponse {
  data: ProjectRecord;
}
```

**Example:**
```
POST /api/v1/projects
Content-Type: application/json

{ "path": "/Users/dev/repos/my-new-project" }

201 Created
{
  "data": {
    "id": "x9y8z7w6v5u4t3s2",
    "name": "my-new-project",
    "path": "/Users/dev/repos/my-new-project",
    "gitRemote": null,
    "gitBranch": null,
    "isDirty": false,
    "hasClaudeConfig": false,
    "lastModified": "2026-02-22T12:00:00.000Z",
    "sessionCount": 0
  }
}
```

**Errors:**
| Code | Status | When |
|------|--------|------|
| `VALIDATION_ERROR` | 400 | Path is not absolute or empty |
| `NOT_FOUND` | 404 | Path does not exist on disk |
| `CONFLICT` | 409 | Project root already registered |

---

### `POST /api/v1/projects/:id/clone`
Clone a repository via SSH.

**Auth:** Required

**Request Body:**
```typescript
interface CloneProjectRequest {
  repoUrl: string;          // SSH or HTTPS git URL
  targetPath: string;       // Where to clone on disk
  branch?: string;          // Branch to checkout (default: default branch)
}
```

**Response `202 Accepted`:**
```typescript
interface CloneProjectResponse {
  data: {
    projectId: string;
    status: 'cloning';
    message: string;
  };
}
```

**Errors:**
| Code | Status | When |
|------|--------|------|
| `VALIDATION_ERROR` | 400 | Invalid repo URL or target path |
| `CONFLICT` | 409 | Target path already exists |

---

## 3. Sessions

### `GET /api/v1/projects/:id/sessions`
List sessions for a project.

**Auth:** Required

**Query Parameters:**
```typescript
interface ListSessionsQuery {
  status?: 'active' | 'paused' | 'ended';
  limit?: number;           // Default: 50, max: 100
  cursor?: string;
}
```

**Response `200 OK`:**
```typescript
interface SessionRecord {
  id: string;
  projectId: string;
  mode: 'sdk' | 'pty';
  status: 'active' | 'paused' | 'ended';
  title?: string;
  runnerId: string;
  hasPendingApproval: boolean;
  hasTerminalAttached: boolean;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
}

interface ListSessionsResponse extends PaginatedResponse<SessionRecord> {}
```

**Example:**
```
GET /api/v1/projects/a1b2c3d4/sessions?status=active&limit=10

200 OK
{
  "data": [
    {
      "id": "sess_abc123",
      "projectId": "a1b2c3d4",
      "mode": "sdk",
      "status": "active",
      "title": "Refactor auth module",
      "runnerId": "runner_xyz",
      "hasPendingApproval": true,
      "hasTerminalAttached": false,
      "createdAt": "2026-02-22T09:00:00.000Z",
      "updatedAt": "2026-02-22T12:30:00.000Z",
      "lastActivityAt": "2026-02-22T12:30:00.000Z"
    }
  ],
  "pagination": {
    "nextCursor": null,
    "hasMore": false
  }
}
```

---

### `POST /api/v1/projects/:id/sessions`
Create a new session.

**Auth:** Required

**Request Body:**
```typescript
interface CreateSessionRequest {
  mode?: 'sdk' | 'pty';              // Default: 'sdk'
  title?: string;
  forkFromSnapshot?: string;          // Snapshot ID to fork from
}
```

**Response `201 Created`:**
```typescript
interface CreateSessionResponse {
  data: SessionRecord;
}
```

**Errors:**
| Code | Status | When |
|------|--------|------|
| `NOT_FOUND` | 404 | Project does not exist |
| `RUNNER_OFFLINE` | 503 | Runner is not connected |

---

### `POST /api/v1/sessions/:id/send`
Send a user message to a session.

**Auth:** Required

**Request Body:**
```typescript
interface SendMessageRequest {
  content: string;                    // Message text (supports slash commands, @mentions)
  attachments?: Array<{
    type: 'file';
    path: string;
  }>;
}
```

**Response `200 OK`:**
```typescript
interface SendMessageResponse {
  data: {
    eventId: string;                  // ID of the user.message event
    correlationId: string;            // Turn correlation ID
  };
}
```

**Example:**
```
POST /api/v1/sessions/sess_abc123/send
Content-Type: application/json

{
  "content": "Refactor the login handler to use async/await",
  "attachments": [
    { "type": "file", "path": "src/auth/login.ts" }
  ]
}

200 OK
{
  "data": {
    "eventId": "evt_msg_001",
    "correlationId": "turn_18"
  }
}
```

**Errors:**
| Code | Status | When |
|------|--------|------|
| `NOT_FOUND` | 404 | Session does not exist |
| `CONFLICT` | 409 | Session is not active (ended or paused) |
| `RUNNER_OFFLINE` | 503 | Runner is not connected |

---

### `POST /api/v1/sessions/:id/slash`
Execute a slash command.

**Auth:** Required

**Request Body:**
```typescript
interface SlashCommandRequest {
  command: string;                    // e.g., "compact", "clear"
  args?: string;                      // Optional arguments
}
```

**Response `200 OK`:**
```typescript
interface SlashCommandResponse {
  data: {
    eventId: string;
    result?: string;                  // Immediate result if available
  };
}
```

**Example:**
```
POST /api/v1/sessions/sess_abc123/slash
Content-Type: application/json

{
  "command": "compact",
  "args": "Focus on the auth module changes"
}

200 OK
{
  "data": {
    "eventId": "evt_slash_001",
    "result": "Context compacted successfully"
  }
}
```

---

### `POST /api/v1/sessions/:id/approve`
Resolve a pending approval request.

**Auth:** Required

**Request Body:**
```typescript
interface ApproveRequest {
  approvalId: string;
  decision: 'allow' | 'deny';
  persist: boolean;                   // Save rule for future use
  scope?: 'session' | 'project' | 'user'; // Required if persist=true
  modifiedArgs?: Record<string, unknown>;  // Optional: override tool args
}
```

**Response `200 OK`:**
```typescript
interface ApproveResponse {
  data: {
    approvalId: string;
    decision: 'allow' | 'deny';
    persisted: boolean;
    scope?: string;
  };
}
```

**Example:**
```
POST /api/v1/sessions/sess_abc123/approve
Content-Type: application/json

{
  "approvalId": "appr_xyz789",
  "decision": "allow",
  "persist": true,
  "scope": "project"
}

200 OK
{
  "data": {
    "approvalId": "appr_xyz789",
    "decision": "allow",
    "persisted": true,
    "scope": "project"
  }
}
```

**Errors:**
| Code | Status | When |
|------|--------|------|
| `NOT_FOUND` | 404 | Approval ID not found or already resolved |
| `CONFLICT` | 409 | Approval already resolved |
| `APPROVAL_TIMEOUT` | 408 | Approval has timed out |

---

### `POST /api/v1/sessions/:id/mode`
Switch a session between SDK and PTY mode.

**Auth:** Required

**Request Body:**
```typescript
interface SwitchModeRequest {
  mode: 'sdk' | 'pty';
  ptyOptions?: {
    useTmux?: boolean;
    cols?: number;
    rows?: number;
  };
}
```

**Response `200 OK`:**
```typescript
interface SwitchModeResponse {
  data: {
    sessionId: string;
    previousMode: 'sdk' | 'pty';
    currentMode: 'sdk' | 'pty';
  };
}
```

---

### `GET /api/v1/sessions/:id/timeline`
Fetch timeline events for a session (paginated).

**Auth:** Required

**Query Parameters:**
```typescript
interface TimelineQuery {
  after_seq?: number;        // Sequence number to paginate after
  limit?: number;            // Default: 50, max: 200
  types?: string;            // Comma-separated event types to filter
}
```

**Response `200 OK`:**
```typescript
interface TimelineResponse extends PaginatedResponse<EventEnvelope> {}

interface EventEnvelope {
  id: string;
  seq: number;                // Monotonic per-session sequence number (authoritative order)
  type: string;
  ts: string;                  // ISO 8601 (Runner clock; use seq for ordering)
  sessionId: string;
  projectId: string;
  runnerId: string;
  mode: 'sdk' | 'pty';
  correlationId: string;
  payload: Record<string, unknown>;
}
```

**Example:**
```
GET /api/v1/sessions/sess_abc123/timeline?limit=2&types=user.message,assistant.message

200 OK
{
  "data": [
    {
      "id": "evt_001",
      "seq": 1,
      "type": "user.message",
      "ts": "2026-02-22T12:00:00.000Z",
      "sessionId": "sess_abc123",
      "projectId": "proj_a1b2",
      "runnerId": "runner_xyz",
      "mode": "sdk",
      "correlationId": "turn_1",
      "payload": {
        "content": "Hello, please list files in src/"
      }
    },
    {
      "id": "evt_002",
      "seq": 2,
      "type": "assistant.message",
      "ts": "2026-02-22T12:00:05.000Z",
      "sessionId": "sess_abc123",
      "projectId": "proj_a1b2",
      "runnerId": "runner_xyz",
      "mode": "sdk",
      "correlationId": "turn_1",
      "payload": {
        "content": "Here are the files in src/..."
      }
    }
  ],
  "pagination": {
    "nextCursor": 2,
    "hasMore": true
  }
}
```

---

## 4. Plugins

### `GET /api/v1/plugins/installed`
List installed plugins.

**Auth:** Required

**Response `200 OK`:**
```typescript
interface PluginInfo {
  name: string;
  version: string;
  enabled: boolean;
  scope: string;
  capabilities: string[];
  installedAt: string;
  updatedAt: string;
}

interface ListPluginsResponse {
  data: PluginInfo[];
}
```

---

### `POST /api/v1/plugins/install`
Install a plugin.

**Auth:** Required

**Request Body:**
```typescript
interface InstallPluginRequest {
  package: string;            // Package name or URL
}
```

**Response `200 OK`:**
```typescript
interface InstallPluginResponse {
  data: {
    success: boolean;
    plugin?: PluginInfo;
    output: string;           // CLI output
  };
}
```

**Errors:**
| Code | Status | When |
|------|--------|------|
| `VALIDATION_ERROR` | 400 | Empty package name |
| `CONFLICT` | 409 | Plugin already installed |

---

### `POST /api/v1/plugins/update`
Update an installed plugin.

**Auth:** Required

**Request Body:**
```typescript
interface UpdatePluginRequest {
  name: string;
}
```

**Response `200 OK`:**
```typescript
interface UpdatePluginResponse {
  data: {
    success: boolean;
    plugin?: PluginInfo;
    output: string;
  };
}
```

---

### `POST /api/v1/plugins/uninstall`
Uninstall a plugin.

**Auth:** Required

**Request Body:**
```typescript
interface UninstallPluginRequest {
  name: string;
}
```

**Response `200 OK`:**
```typescript
interface UninstallPluginResponse {
  data: {
    success: boolean;
    output: string;
  };
}
```

---

### `POST /api/v1/plugins/enable`
Enable a plugin.

**Auth:** Required

**Request Body:**
```typescript
interface EnablePluginRequest {
  name: string;
  scope?: string;             // Scope to enable for
}
```

**Response `200 OK`:**
```typescript
interface EnablePluginResponse {
  data: {
    success: boolean;
    output: string;
  };
}
```

---

### `POST /api/v1/plugins/disable`
Disable a plugin.

**Auth:** Required

**Request Body:**
```typescript
interface DisablePluginRequest {
  name: string;
}
```

**Response `200 OK`:**
```typescript
interface DisablePluginResponse {
  data: {
    success: boolean;
    output: string;
  };
}
```

---

### `GET /api/v1/plugins/marketplaces`
List configured plugin marketplaces.

**Auth:** Required

**Response `200 OK`:**
```typescript
interface MarketplaceInfo {
  name: string;
  url: string;
  addedAt: string;
}

interface ListMarketplacesResponse {
  data: MarketplaceInfo[];
}
```

---

### `POST /api/v1/plugins/marketplaces/add`
Add a plugin marketplace.

**Auth:** Required

**Request Body:**
```typescript
interface AddMarketplaceRequest {
  url: string;
}
```

**Response `201 Created`:**
```typescript
interface AddMarketplaceResponse {
  data: MarketplaceInfo;
}
```

---

## 5. MCP

### `GET /api/v1/mcp/servers`
List MCP servers with status.

**Auth:** Required

**Response `200 OK`:**
```typescript
interface McpServerInfo {
  name: string;
  transport: 'stdio' | 'http' | 'sse';
  status: 'running' | 'stopped' | 'error';
  lastError?: string;
  config: Record<string, unknown>;
  tools?: string[];
  prompts?: string[];
  lastHealthCheck?: string;
}

interface ListMcpServersResponse {
  data: McpServerInfo[];
}
```

---

### `POST /api/v1/mcp/servers`
Add an MCP server.

**Auth:** Required

**Request Body:**
```typescript
interface AddMcpServerRequest {
  name: string;
  transport: 'stdio' | 'http' | 'sse';
  config: Record<string, unknown>;     // Transport-specific config
}
```

**Response `201 Created`:**
```typescript
interface AddMcpServerResponse {
  data: McpServerInfo;
}
```

**Errors:**
| Code | Status | When |
|------|--------|------|
| `VALIDATION_ERROR` | 400 | Invalid transport or missing config |
| `CONFLICT` | 409 | Server with this name already exists |

---

### `DELETE /api/v1/mcp/servers/:name`
Remove an MCP server.

**Auth:** Required

**Response `200 OK`:**
```typescript
interface RemoveMcpServerResponse {
  data: {
    success: boolean;
    output: string;
  };
}
```

**Errors:**
| Code | Status | When |
|------|--------|------|
| `NOT_FOUND` | 404 | Server not found |

---

### `POST /api/v1/mcp/servers/:name/auth`
Trigger or check OAuth authentication for an MCP server.

**Auth:** Required

**Response `200 OK`:**
```typescript
interface McpAuthResponse {
  data: {
    authRequired: boolean;
    authUrl?: string;            // OAuth URL to open in browser
    status: 'authenticated' | 'pending' | 'not_required';
  };
}
```

**Example:**
```
POST /api/v1/mcp/servers/github/auth

200 OK
{
  "data": {
    "authRequired": true,
    "authUrl": "https://github.com/login/oauth/authorize?client_id=...",
    "status": "pending"
  }
}
```

---

## 6. Auth (Phase 1 -- Hub only)

### `POST /api/v1/auth/token`
Issue a token pair (login).

**Auth:** Not required

**Request Body:**
```typescript
interface TokenRequest {
  grantType: 'password' | 'refresh_token';
  username?: string;          // Required for grantType=password
  password?: string;          // Required for grantType=password
  refreshToken?: string;      // Required for grantType=refresh_token
}
```

**Response `200 OK`:**
```typescript
interface TokenResponse {
  data: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;        // Seconds until access token expires
    tokenType: 'Bearer';
  };
}
```

**Errors:**
| Code | Status | When |
|------|--------|------|
| `VALIDATION_ERROR` | 400 | Missing required fields |
| `UNAUTHORIZED` | 401 | Invalid credentials or refresh token |
