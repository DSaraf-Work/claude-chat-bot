# LLD: Hub Service
_Last updated: 2026-02-22_

## 1. Module Structure

```
apps/hub/
  src/
    index.ts                    # Entry point, service bootstrap
    config/
      schema.ts                 # Zod config schema
      loader.ts                 # Load config from env/yaml
    auth/
      token.ts                  # JWT token issuance and validation
      middleware.ts             # Express/Fastify auth middleware
      refresh.ts                # Token refresh logic
    ws/
      gateway.ts                # WebSocket server, connection lifecycle
      connection-manager.ts     # Track connections by type (runner/ui)
      room-manager.ts           # Session-based rooms for fan-out
      protocol.ts               # Message type handlers
    sessions/
      registry.ts               # Session registry (in-memory + DB)
      router.ts                 # Route commands to correct runner
    events/
      store.ts                  # Append-only event store (Postgres)
      timeline.ts               # Timeline query with pagination
      backfill.ts               # Handle runner backfill events
    runners/
      registry.ts               # Runner registration and health
      heartbeat.ts              # Runner heartbeat monitoring
    api/
      router.ts                 # REST API router
      middleware/
        auth.ts                 # Auth middleware
        validation.ts           # Request validation (Zod)
        error-handler.ts        # Global error handler
      handlers/
        projects.ts
        sessions.ts
        plugins.ts
        mcp.ts
        auth.ts
    db/
      client.ts                 # Postgres client (Drizzle ORM)
      schema.ts                 # Drizzle schema definitions
      migrations/               # Migration files
  package.json
  tsconfig.json
```

## 2. WebSocket Gateway

### Connection Management

```typescript
type ConnectionType = 'runner' | 'ui';

interface WsConnection {
  id: string;
  type: ConnectionType;
  ws: WebSocket;
  runnerId?: string;        // Set for runner connections
  userId?: string;           // Set for authenticated UI connections
  subscribedSessions: Set<string>;
  connectedAt: Date;
  lastActivity: Date;
}

class ConnectionManager {
  private connections: Map<string, WsConnection> = new Map();
  private runnerConnections: Map<string, string> = new Map(); // runnerId -> connId
  private userConnections: Map<string, Set<string>> = new Map(); // userId -> Set<connId>

  register(ws: WebSocket, type: ConnectionType, meta: ConnectionMeta): WsConnection {
    const conn: WsConnection = {
      id: generateId('conn'),
      type,
      ws,
      runnerId: meta.runnerId,
      userId: meta.userId,
      subscribedSessions: new Set(),
      connectedAt: new Date(),
      lastActivity: new Date(),
    };

    this.connections.set(conn.id, conn);

    if (type === 'runner' && meta.runnerId) {
      this.runnerConnections.set(meta.runnerId, conn.id);
    }
    if (meta.userId) {
      if (!this.userConnections.has(meta.userId)) {
        this.userConnections.set(meta.userId, new Set());
      }
      this.userConnections.get(meta.userId)!.add(conn.id);
    }

    return conn;
  }

  remove(connId: string): void {
    const conn = this.connections.get(connId);
    if (!conn) return;

    if (conn.type === 'runner' && conn.runnerId) {
      this.runnerConnections.delete(conn.runnerId);
    }
    if (conn.userId) {
      this.userConnections.get(conn.userId)?.delete(connId);
    }
    this.connections.delete(connId);
  }

  getRunnerConnection(runnerId: string): WsConnection | undefined {
    const connId = this.runnerConnections.get(runnerId);
    return connId ? this.connections.get(connId) : undefined;
  }

  getSessionSubscribers(sessionId: string): WsConnection[] {
    return Array.from(this.connections.values()).filter(
      (c) => c.subscribedSessions.has(sessionId),
    );
  }
}
```

### Room/Channel Model

Each session is a logical "room." UI clients subscribe to rooms; runner connections automatically own rooms for their active sessions.

```typescript
class RoomManager {
  private rooms: Map<string, SessionRoom> = new Map();

  interface SessionRoom {
    sessionId: string;
    runnerId: string;            // Owning runner
    subscribers: Set<string>;     // Connection IDs
    controllerId?: string;        // Connection ID of current controller
  }

  subscribe(sessionId: string, connId: string): void {
    const room = this.rooms.get(sessionId);
    if (!room) throw new Error(`No room for session: ${sessionId}`);
    room.subscribers.add(connId);
  }

  unsubscribe(sessionId: string, connId: string): void {
    this.rooms.get(sessionId)?.subscribers.delete(connId);
  }

  /**
   * Fan out an event to all subscribers of a session.
   */
  broadcast(sessionId: string, event: EventEnvelope, excludeConnId?: string): void {
    const room = this.rooms.get(sessionId);
    if (!room) return;

    const msg = JSON.stringify({ type: 'event', event });
    for (const connId of room.subscribers) {
      if (connId === excludeConnId) continue;
      const conn = this.connectionManager.get(connId);
      if (conn && conn.ws.readyState === WebSocket.OPEN) {
        conn.ws.send(msg);
      }
    }
  }

  /**
   * Set the controlling connection for a session.
   * Only the controller can send commands (messages, approvals).
   * Other subscribers receive events in read-only "follow" mode.
   */
  setController(sessionId: string, connId: string): boolean {
    const room = this.rooms.get(sessionId);
    if (!room) return false;
    room.controllerId = connId;
    return true;
  }

  getController(sessionId: string): string | undefined {
    return this.rooms.get(sessionId)?.controllerId;
  }
}
```

### Gateway Server

```typescript
class WsGateway {
  private wss: WebSocketServer;

  start(server: http.Server): void {
    this.wss = new WebSocketServer({
      server,
      path: '/ws',
      verifyClient: (info, cb) => this.verifyClient(info, cb),
    });

    this.wss.on('connection', (ws, req) => this.handleConnection(ws, req));
  }

  /**
   * Verify auth token before upgrading to WebSocket.
   */
  private verifyClient(
    info: { req: http.IncomingMessage },
    cb: (result: boolean, code?: number, message?: string) => void,
  ): void {
    const token = this.extractToken(info.req);
    if (!token) {
      cb(false, 401, 'Missing auth token');
      return;
    }

    try {
      const payload = this.auth.verifyToken(token);
      (info.req as any).authPayload = payload;
      cb(true);
    } catch {
      cb(false, 401, 'Invalid auth token');
    }
  }

  private handleConnection(ws: WebSocket, req: http.IncomingMessage): void {
    const authPayload = (req as any).authPayload;
    const connectionType = req.url?.startsWith('/ws/runner') ? 'runner' : 'ui';

    const conn = this.connectionManager.register(ws, connectionType, {
      userId: authPayload.userId,
      runnerId: authPayload.runnerId,
    });

    ws.on('message', (data) => this.handleMessage(conn, data));
    ws.on('close', () => this.handleDisconnect(conn));
    ws.on('error', (err) => this.handleError(conn, err));
  }

  private handleMessage(conn: WsConnection, data: WebSocket.Data): void {
    const msg = JSON.parse(data.toString());
    conn.lastActivity = new Date();

    switch (msg.type) {
      // Runner messages
      case 'runner.register':
        this.handleRunnerRegister(conn, msg);
        break;
      case 'event':
        this.handleRunnerEvent(conn, msg.event);
        break;
      case 'event.backfill':
        this.handleBackfill(conn, msg);
        break;
      case 'ping':
        conn.ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
        break;

      // UI messages
      case 'session.subscribe':
        this.roomManager.subscribe(msg.sessionId, conn.id);
        break;
      case 'session.unsubscribe':
        this.roomManager.unsubscribe(msg.sessionId, conn.id);
        break;
      case 'session.command':
        this.handleUICommand(conn, msg);
        break;
      case 'session.takeControl':
        this.handleTakeControl(conn, msg);
        break;
    }
  }

  /**
   * Handle an event from a runner:
   * 1. Persist to event store
   * 2. Fan out to all UI subscribers
   */
  private async handleRunnerEvent(conn: WsConnection, event: EventEnvelope): Promise<void> {
    // Persist
    await this.eventStore.append(event);

    // Fan out to UI subscribers (not back to the runner)
    this.roomManager.broadcast(event.sessionId, event, conn.id);
  }

  /**
   * Handle a command from UI (e.g., send message, approve tool):
   * 1. Verify sender is the controller
   * 2. Forward to the owning runner
   */
  private handleUICommand(conn: WsConnection, msg: SessionCommand): void {
    const controllerId = this.roomManager.getController(msg.sessionId);
    if (controllerId !== conn.id) {
      conn.ws.send(JSON.stringify({
        type: 'error',
        code: 'NOT_CONTROLLER',
        message: 'You are not the active controller for this session',
      }));
      return;
    }

    // Forward to runner
    const room = this.roomManager.getRoom(msg.sessionId);
    if (!room) return;

    const runnerConn = this.connectionManager.getRunnerConnection(room.runnerId);
    if (runnerConn) {
      runnerConn.ws.send(JSON.stringify(msg));
    }
  }
}
```

## 3. Session Registry

### In-Memory + Postgres Backing

```typescript
interface SessionRecord {
  id: string;
  projectId: string;
  runnerId: string;
  mode: 'sdk' | 'pty';
  status: 'active' | 'paused' | 'ended';
  title?: string;
  createdAt: Date;
  updatedAt: Date;
  lastActivityAt: Date;
}

class SessionRegistry {
  private cache: Map<string, SessionRecord> = new Map();

  /**
   * Register a new session (called when runner reports session.created).
   */
  async register(session: SessionRecord): Promise<void> {
    await this.db.insert(sessions).values(session);
    this.cache.set(session.id, session);
  }

  /**
   * Update session status.
   */
  async updateStatus(sessionId: string, status: SessionRecord['status']): Promise<void> {
    await this.db
      .update(sessions)
      .set({ status, updatedAt: new Date() })
      .where(eq(sessions.id, sessionId));

    const cached = this.cache.get(sessionId);
    if (cached) {
      cached.status = status;
      cached.updatedAt = new Date();
    }
  }

  /**
   * Find which runner owns a session.
   */
  getRunner(sessionId: string): string | undefined {
    return this.cache.get(sessionId)?.runnerId;
  }

  /**
   * List sessions for a project.
   */
  async listByProject(projectId: string): Promise<SessionRecord[]> {
    return this.db
      .select()
      .from(sessions)
      .where(eq(sessions.projectId, projectId))
      .orderBy(desc(sessions.lastActivityAt));
  }

  /**
   * Warm cache from DB on startup.
   */
  async warmCache(): Promise<void> {
    const activeSessions = await this.db
      .select()
      .from(sessions)
      .where(ne(sessions.status, 'ended'));

    for (const session of activeSessions) {
      this.cache.set(session.id, session);
    }
  }
}
```

## 4. Event Store

### Append-Only Insert

```typescript
class EventStore {
  private seqCounters: Map<string, number> = new Map(); // sessionId -> lastSeq

  /**
   * Get and increment the seq counter for a session.
   */
  private nextSeq(sessionId: string): number {
    const current = this.seqCounters.get(sessionId) ?? 0;
    const next = current + 1;
    this.seqCounters.set(sessionId, next);
    return next;
  }

  /**
   * Warm seq counters from DB on startup.
   */
  async warmSeqCounters(): Promise<void> {
    const rows = await this.db
      .select({ sessionId: sessionEvents.sessionId, maxSeq: sql`MAX(${sessionEvents.seq})` })
      .from(sessionEvents)
      .groupBy(sessionEvents.sessionId);
    for (const row of rows) {
      this.seqCounters.set(row.sessionId, Number(row.maxSeq));
    }
  }

  /**
   * Append a single event. Assigns a seq number. Idempotent on event.id.
   */
  async append(event: EventEnvelope): Promise<{ seq: number }> {
    const seq = this.nextSeq(event.sessionId);
    await this.db
      .insert(sessionEvents)
      .values({
        id: event.id,
        sessionId: event.sessionId,
        projectId: event.projectId,
        seq,
        type: event.type,
        ts: new Date(event.ts),
        correlationId: event.correlationId,
        runnerId: event.runnerId,
        mode: event.mode,
        payload: event.payload,
        createdAt: new Date(),
      })
      .onConflictDoNothing({ target: sessionEvents.id });

    return { seq };
  }

  /**
   * Append a batch of events (used during backfill).
   * Events are sorted by ts and assigned sequential seq numbers.
   */
  async appendBatch(events: EventEnvelope[]): Promise<{ inserted: number; lastSeq: number }> {
    if (events.length === 0) return { inserted: 0, lastSeq: 0 };

    // Sort by ts for proper ordering
    const sorted = [...events].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
    const sessionId = sorted[0].sessionId;

    const values = sorted.map((e) => ({
      id: e.id,
      sessionId: e.sessionId,
      projectId: e.projectId,
      seq: this.nextSeq(sessionId),
      type: e.type,
      ts: new Date(e.ts),
      correlationId: e.correlationId,
      runnerId: e.runnerId,
      mode: e.mode,
      payload: e.payload,
      createdAt: new Date(),
    }));

    const result = await this.db
      .insert(sessionEvents)
      .values(values)
      .onConflictDoNothing({ target: sessionEvents.id });

    const lastSeq = values[values.length - 1].seq;
    return { inserted: result.rowCount ?? 0, lastSeq };
  }

  /**
   * Timeline query with cursor-based pagination.
   *
   * Cursor is the `seq` number. Returns events ordered by seq ASC.
   * seq is the authoritative ordering (not ts, which may have clock skew).
   */
  async timeline(
    sessionId: string,
    opts: { afterSeq?: number; limit?: number; types?: string[] },
  ): Promise<{ events: EventEnvelope[]; nextCursor?: number; hasMore: boolean }> {
    const limit = opts.limit ?? 50;

    let query = this.db
      .select()
      .from(sessionEvents)
      .where(eq(sessionEvents.sessionId, sessionId));

    // Apply cursor (seq-based)
    if (opts.afterSeq !== undefined) {
      query = query.where(gt(sessionEvents.seq, opts.afterSeq));
    }

    // Apply type filter
    if (opts.types && opts.types.length > 0) {
      query = query.where(inArray(sessionEvents.type, opts.types));
    }

    const events = await query
      .orderBy(asc(sessionEvents.seq))
      .limit(limit + 1); // Fetch one extra to check hasMore

    const hasMore = events.length > limit;
    const page = hasMore ? events.slice(0, limit) : events;
    const nextCursor = hasMore ? page[page.length - 1].seq : undefined;

    return {
      events: page.map(this.toEnvelope),
      nextCursor,
      hasMore,
    };
  }

  /**
   * Get the latest N events for a session (for initial load).
   * Returns newest first, then client reverses for display.
   */
  async latestEvents(sessionId: string, count: number = 200): Promise<EventEnvelope[]> {
    const events = await this.db
      .select()
      .from(sessionEvents)
      .where(eq(sessionEvents.sessionId, sessionId))
      .orderBy(desc(sessionEvents.seq))
      .limit(count);

    return events.reverse().map(this.toEnvelope);
  }

  /**
   * Get the current seq for a session (used for WS subscribe/replay).
   */
  getCurrentSeq(sessionId: string): number {
    return this.seqCounters.get(sessionId) ?? 0;
  }

  /**
   * Replay events since a given seq (for WS reconnect).
   */
  async replaySince(sessionId: string, afterSeq: number): Promise<EventEnvelope[]> {
    const events = await this.db
      .select()
      .from(sessionEvents)
      .where(and(
        eq(sessionEvents.sessionId, sessionId),
        gt(sessionEvents.seq, afterSeq),
      ))
      .orderBy(asc(sessionEvents.seq));

    return events.map(this.toEnvelope);
  }

  private toEnvelope(row: typeof sessionEvents.$inferSelect): EventEnvelope {
    return {
      id: row.id,
      type: row.type,
      seq: row.seq,
      ts: row.ts.toISOString(),
      sessionId: row.sessionId,
      projectId: row.projectId,
      runnerId: row.runnerId,
      mode: row.mode as 'sdk' | 'pty',
      correlationId: row.correlationId,
      payload: row.payload,
    };
  }
}
```

## 5. Auth

### Token Issuance

```typescript
import jwt from 'jsonwebtoken';

interface TokenPayload {
  sub: string;          // userId or runnerId
  type: 'user' | 'runner';
  iat: number;
  exp: number;
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;    // seconds
}

class AuthService {
  private readonly accessTokenSecret: string;
  private readonly refreshTokenSecret: string;
  private readonly accessTokenTTL = 3600;       // 1 hour
  private readonly refreshTokenTTL = 2592000;    // 30 days

  /**
   * Issue a token pair for a user (Phase 1) or runner.
   */
  issueTokens(subject: string, type: 'user' | 'runner'): TokenPair {
    const now = Math.floor(Date.now() / 1000);

    const accessToken = jwt.sign(
      { sub: subject, type, iat: now, exp: now + this.accessTokenTTL },
      this.accessTokenSecret,
      { algorithm: 'HS256' },
    );

    const refreshToken = jwt.sign(
      { sub: subject, type, iat: now, exp: now + this.refreshTokenTTL },
      this.refreshTokenSecret,
      { algorithm: 'HS256' },
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: this.accessTokenTTL,
    };
  }

  /**
   * Verify an access token. Throws on invalid/expired.
   */
  verifyToken(token: string): TokenPayload {
    return jwt.verify(token, this.accessTokenSecret) as TokenPayload;
  }

  /**
   * Refresh: verify refresh token, issue new token pair.
   */
  refreshTokens(refreshToken: string): TokenPair {
    const payload = jwt.verify(refreshToken, this.refreshTokenSecret) as TokenPayload;
    return this.issueTokens(payload.sub, payload.type);
  }
}
```

### Validation Middleware

```typescript
function authMiddleware(authService: AuthService) {
  return (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header' },
      });
    }

    const token = authHeader.slice(7);
    try {
      const payload = authService.verifyToken(token);
      req.auth = payload;
      next();
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        return res.status(401).json({
          error: { code: 'TOKEN_EXPIRED', message: 'Access token has expired' },
        });
      }
      return res.status(401).json({
        error: { code: 'INVALID_TOKEN', message: 'Invalid access token' },
      });
    }
  };
}
```

### Phase 0 Simplified Auth

In Phase 0 (no Hub), the Runner uses a static bearer token from config. No JWT issuance needed.

```typescript
function staticTokenMiddleware(expectedToken: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${expectedToken}`) {
      return res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Invalid token' },
      });
    }
    next();
  };
}
```

## 6. Runner Registration Protocol

### Handshake Sequence

```
Runner                               Hub
  |                                   |
  |--- WebSocket connect ------------>|  (with Bearer token in headers)
  |                                   |
  |--- runner.register -------------->|
  |    {                              |
  |      runnerId: "runner_abc",      |
  |      name: "macbook-pro",         |
  |      capabilities: [             |
  |        "sdk", "pty",             |
  |        "plugins", "mcp"          |
  |      ],                           |
  |      activeSessions: [            |
  |        "sess_1", "sess_2"         |
  |      ],                           |
  |      lastSeqNo: 4523              |  // Last flushed sequence number
  |    }                              |
  |                                   |
  |<-- runner.registered -------------|
  |    {                              |
  |      accepted: true,              |
  |      hubSeqNo: 4500,             |  // Hub's last known seq for this runner
  |      assignedSessions: [          |  // Sessions Hub thinks this runner owns
  |        "sess_1", "sess_2",        |
  |        "sess_3"                   |  // Session that needs re-attachment
  |      ]                            |
  |    }                              |
  |                                   |
  |--- event.backfill[] ------------>|  // Events from seqNo 4501 to 4523
  |                                   |
  |<-- backfill.ack -----------------|
  |    { lastSeqNo: 4523 }           |
  |                                   |
  |=== READY (bidirectional) =======>|
```

### Runner Health Monitoring

```typescript
class RunnerHealthMonitor {
  private readonly STALE_THRESHOLD_MS = 45000; // 3x heartbeat interval

  /**
   * Called periodically to check runner health.
   * Marks runners as offline if no heartbeat received.
   */
  async checkHealth(): Promise<void> {
    const now = Date.now();
    const runners = await this.runnerRegistry.listActive();

    for (const runner of runners) {
      const conn = this.connectionManager.getRunnerConnection(runner.id);

      if (!conn || now - conn.lastActivity.getTime() > this.STALE_THRESHOLD_MS) {
        await this.runnerRegistry.updateStatus(runner.id, 'offline');

        // Notify UI subscribers of affected sessions
        for (const sessionId of runner.activeSessions) {
          this.roomManager.broadcast(sessionId, {
            type: 'runner.offline',
            runnerId: runner.id,
            sessionId,
          });
        }
      }
    }
  }
}
```

## 7. Fan-Out

### Event Flow: Runner to UI Clients

```
Runner sends event
       |
       v
  [WsGateway.handleRunnerEvent]
       |
       +---> [EventStore.append]         // Persist to Postgres
       |
       +---> [RoomManager.broadcast]     // Fan out to subscribers
                   |
                   +---> UI Client 1 (controller, same session)
                   +---> UI Client 2 (follower, same session)
                   +---> UI Client 3 (follower, different device)
```

### Backpressure Handling

If a UI client's WebSocket send buffer grows too large (client can't keep up), the Hub will:

```typescript
class BackpressureHandler {
  private readonly MAX_BUFFERED_AMOUNT = 1024 * 1024; // 1MB

  shouldDrop(conn: WsConnection): boolean {
    return conn.ws.bufferedAmount > this.MAX_BUFFERED_AMOUNT;
  }

  /**
   * When backpressure is detected, send a "catch up" instruction
   * instead of individual events. The client then fetches missed
   * events via REST timeline API.
   */
  sendCatchUp(conn: WsConnection, sessionId: string, fromEventId: string): void {
    conn.ws.send(JSON.stringify({
      type: 'session.catchUp',
      sessionId,
      fromEventId,
      message: 'Events dropped due to backpressure. Fetch via timeline API.',
    }));
  }
}
```

## 8. REST API Implementation

### Middleware Stack

```
Request
  |
  v
[CORS]
  |
  v
[Request ID (X-Request-Id)]
  |
  v
[Auth middleware (JWT verify)]
  |
  v
[Request validation (Zod)]
  |
  v
[Route handler]
  |
  v
[Error handler]
  |
  v
Response
```

### Validation

```typescript
import { z } from 'zod';

// Each endpoint has a schema for params, body, and query
const createSessionSchema = {
  params: z.object({
    id: z.string(), // projectId
  }),
  body: z.object({
    mode: z.enum(['sdk', 'pty']).default('sdk'),
    title: z.string().optional(),
    forkFromSnapshot: z.string().optional(),
  }),
};

function validate(schema: { params?: z.ZodSchema; body?: z.ZodSchema; query?: z.ZodSchema }) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      if (schema.params) req.params = schema.params.parse(req.params);
      if (schema.body) req.body = schema.body.parse(req.body);
      if (schema.query) req.query = schema.query.parse(req.query);
      next();
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            details: err.errors,
          },
        });
      } else {
        next(err);
      }
    }
  };
}
```

### Error Shapes

All API errors follow a consistent envelope:

```typescript
interface ApiError {
  error: {
    code: string;           // Machine-readable error code
    message: string;        // Human-readable message
    details?: unknown;       // Optional: validation errors, context
    requestId?: string;      // Correlation ID for debugging
  };
}
```

Standard error codes:

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `UNAUTHORIZED` | 401 | Missing or invalid auth token |
| `TOKEN_EXPIRED` | 401 | Access token has expired |
| `FORBIDDEN` | 403 | Valid token but insufficient permissions |
| `NOT_FOUND` | 404 | Resource does not exist |
| `VALIDATION_ERROR` | 400 | Request body/params failed validation |
| `CONFLICT` | 409 | Resource already exists or state conflict |
| `RUNNER_OFFLINE` | 503 | Runner is not connected to Hub |
| `APPROVAL_TIMEOUT` | 408 | Approval request timed out |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

### Global Error Handler

```typescript
function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  const requestId = req.headers['x-request-id'] as string;

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
        requestId,
      },
    });
  }

  // Unexpected errors
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      requestId,
    },
  });
}
```
