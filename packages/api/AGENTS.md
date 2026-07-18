# @atlas/api — AI Rules

## Responsibility

Fastify 5 HTTP server on port 4001 (dev) / 5001 (prod). Owns:
- SQLite database (better-sqlite3, path: `<workspace data dir>/atlas.db` — Windows: `%APPDATA%/Atlas/`, macOS/Linux: `~/.config/Atlas/`)
- All REST API routes
- Server-Sent Events (SSE) for agent status streaming
- Business logic (services/)
- Phase 5: CLI agent spawning, external notifications (currently delivered via Telegram)

---

## File Structure Rules

```
src/
├── server.ts           → Entry point. Register plugins + routes. No business logic.
├── db/
│   ├── client.ts       → Exports `db` singleton (Database instance). Only file that touches SQLite.
│   ├── migrations/     → Numbered SQL files (001_initial.sql, 002_fts.sql, ...). Append only.
│   └── seed.ts         → 10 agent seed rows. Run once if agents table is empty.
├── routes/             → One file per resource. Register as Fastify plugins. No DB calls here.
│   ├── agents.ts      → GET/POST /api/agents, GET/PATCH/DELETE /api/agents/:id
│   └── ...
└── services/           → Business logic. DB calls live here, not in routes.
    ├── agent-runner.ts       → Phase 5: CLI spawning
    ├── external-notifications.ts → Provider-agnostic dispatcher (gating + quiet hours)
    └── transports/*.ts       → Per-provider outbound senders (Telegram, Teams)
```

## Route File Pattern

```typescript
import type { FastifyInstance } from 'fastify';
import { CreateAgentSchema } from '@atlas/shared';
import { agentService } from '../services/agents.js';

export async function agentsRoutes(app: FastifyInstance) {
  app.get('/api/agents', async (_req, reply) => {
    return reply.send(agentService.getAll());
  });

  app.post('/api/agents', async (req, reply) => {
    const body = CreateAgentSchema.parse(req.body);  // Validate first
    return reply.status(201).send(agentService.create(body));
  });
}
```

## DB Rules

- `db` singleton is synchronous better-sqlite3 — never use async/await for DB operations
- All DB operations go through `services/` — never directly in route handlers
- Migrations are append-only numbered SQL files — never edit `001_initial.sql` (the consolidated pre-publish baseline). Future schema changes go in NEW numbered files (`002`, `003`, …).
- Use transactions (`db.transaction(fn)`) for multi-table writes
- Column names are snake_case matching `@atlas/shared` interface field names

## Validation Rules

- Always validate request bodies with Zod schemas from `@atlas/shared` BEFORE any DB operation
- Return HTTP 400 for validation errors, 404 for not-found, 409 for conflicts
- API responses match `@atlas/shared` interfaces exactly (snake_case, no extra fields)

## Status Transition Enforcement

```typescript
import { isValidTransition } from '@atlas/shared';

// In the status PATCH route:
if (!isValidTransition(issueType, current.status, newStatus)) {
  return reply.status(400).send({ error: 'Invalid status transition' });
}

// In the reassign PATCH route — enforce agent-to-owner-only escalation:
if (newAssigneeAgentId !== null && !isValidHandoff(agentId, issueType, current.status)) {
  return reply.status(400).send({ error: 'Agent cannot be assigned at this status' });
}
```

## SSE Rules

- SSE endpoint: `GET /api/events`
- Event format: `data: {"type":"agent_status","agentId":"...","runId":"...","status":"in_progress"}\n\n`
- Use Fastify's raw response to write SSE — no buffering
- Event types match `SSEEvent` interface in `@atlas/shared`

## Worktree Lifecycle (orchestrator-owned)

Worktrees are **ephemeral**. After every successful push (or `alreadyUpToDate`), the orchestrator runs `cleanupWorktreeAfterPush` to delete the local worktree folder, delete the local branch ref, and null out `items.worktree_path` / `items.worktree_branch`. The next run on the same item re-provisions from origin via `ensureWorktree` (Path 2: fetch + worktree add, or Path 3: net-new branch). Remote is the single source of truth; the local workspace is disposable. Same rule applies in the orphan reaper in `main.ts` after its rescue push.

If push *fails*, cleanup is skipped so manual recovery is possible. `ensureWorktree`'s Path 1 (reuse existing worktree → `pull --ff-only`) stays as a defensive fallback for the rare case where filesystem cleanup silently failed (Windows file locks, AV).

## What NOT to Do

- No business logic in route handlers (only: validate → call service → return)
- No CORS changes without checking `@fastify/cors` config in `server.ts`
- Never edit existing migration files — always add a new numbered one
- No `console.log` — use Fastify's logger: `app.log.info(...)`, `app.log.error(...)`
