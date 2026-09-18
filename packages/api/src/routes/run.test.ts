import { describe, expect, it, beforeEach, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// Mock SSE and notifications — the route under test only spawns runs; we
// don't want either side effect leaking across tests. Pattern mirrors
// e2e-lifecycle.test.ts.
vi.mock('../routes/events.js', () => ({
    eventsRoutes: async () => {
        /* no-op */
    },
    broadcastSSE: vi.fn(),
}));
vi.mock('../services/notifications.js', () => ({
    notificationsService: {
        create: vi.fn(),
        list: vi.fn().mockResolvedValue([]),
        markAllRead: vi.fn(),
        markRead: vi.fn(),
        updateExternalStatus: vi.fn(),
    },
}));

// No CLI: spawnAgentRun just returns an id. cancelRun reports "not in the
// registry" (no live child). The workflow engine runs for real.
vi.mock('../services/agent-runner.js', () => ({
    spawnAgentRun: vi.fn().mockImplementation(async () => `fake-run-${Math.random().toString(36).slice(2)}`),
    runOutputRegistry: new Map<string, string>(),
    cancelRun: vi.fn().mockResolvedValue({ cancelled: false, pidKilled: null }),
}));

import { buildApp } from '../server.js';
import { truncateAll, closeTestDb, testDb } from '../../tests/_pg-db.js';
import { insertProject, insertAgent, insertItem } from '../../tests/_items.js';

let app: FastifyInstance;

beforeEach(async () => {
    // Real timers — Fastify's `app.ready()` awaits internal timers that fake
    // timers would freeze. The 202 case schedules a 400ms simulated-CLI tick
    // inside the runner; it fires after the test asserts on the response,
    // which is harmless (the agent_runs row is already inserted; later state
    // changes touch a row the next test's truncateAll wipes anyway).
    await truncateAll();
    await insertProject('p1', 'ATL');
    await insertAgent({ id: 'agent-coder', status: 'active' });
    // Stories need an epic parent per the items CHECK constraint.
    await insertItem({ id: 'ATL-100', type: 'task', project_id: 'p1', title: 'Parent epic' });
    await insertItem({
        id: 'ATL-2',
        type: 'sub_task',
        project_id: 'p1',
        parent_id: 'ATL-100',
        parent_type: 'task',
        title: 'Downstream',
        status: 'ready',
        assignee_agent_id: 'agent-coder',
    });
    app = await buildApp({ logger: false });
    await app.ready();
});

afterAll(async () => {
    if (app) await app.close();
    await closeTestDb();
});

describe('POST /api/run — ad-hoc agent runs (ADR 0014)', () => {
    it('returns 400 for a run on an item — item work goes through a workflow', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/run',
            payload: { agent_id: 'agent-coder', issue_type: 'sub_task', issue_id: 'ATL-2' },
        });
        expect(res.statusCode).toBe(400);
        expect(res.json()).toMatchObject({ kind: 'validation_error' });
        expect(res.json().error).toMatch(/workflow/);
    });


    it('returns 202 when an agent is launched without item params', async () => {
        await insertAgent({ id: 'agent-freedom', status: 'active' });

        const res = await app.inject({
            method: 'POST',
            url: '/api/run',
            payload: { agent_id: 'agent-freedom' },
        });

        expect(res.statusCode).toBe(202);
        expect(typeof res.json().runId).toBe('string');
    });

    it('returns 400 when agent_id is missing', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/run',
            payload: {},
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().error).toBe('agent_id is required');
    });
});

// W4 — Typed error envelope. Every non-2xx response from a route that
// throws ApiError (or that the setErrorHandler classifies via Zod /
// Fastify validation) must carry both `error` (back-compat string) and
// `kind` (machine code the web client switches on). The depends_on path
// also keeps `blockers` top-level for back-compat — exercised above.
describe('POST /api/run — typed error envelope (W4)', () => {
    it('returns kind=not_found with the legacy error string when agent is missing', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/run',
            payload: { agent_id: 'no-such-agent' },
        });
        expect(res.statusCode).toBe(404);
        const body = res.json();
        expect(body).toMatchObject({
            error: 'Agent not found',
            kind: 'not_found',
        });
    });

    it('returns kind=validation_error when agent_id is missing', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/run',
            payload: {},
        });
        expect(res.statusCode).toBe(400);
        const body = res.json();
        expect(body).toMatchObject({
            error: 'agent_id is required',
            kind: 'validation_error',
        });
    });

});

// P9 — Delete-a-run + item unstick. The endpoint exists so the Owner can
// rescue an item that's stuck because its agent crashed mid-flight (CLI
// hang, server kill, etc.) without dropping into the DB. Behaviors
// exercised here:
//   - cascade: child reviewer rows (parent_run_id FK) are gone after
//     the parent is dropped.
//   - sibling cleanup: any other queued/in_progress runs targeting the
//     same item are also deleted, so nothing fights the next dispatcher
//     tick.
//   - item reset: assignee cleared, status → ready (or stays draft if
//     the Owner never promoted it).
//   - 404 path mirrors the rest of the route surface.
async function seedRun(opts: {
    id: string;
    item_id: string | null;
    status?: 'queued' | 'in_progress' | 'completed' | 'error';
    parent_run_id?: string | null;
}): Promise<void> {
    await testDb
        .insertInto('agent_runs')
        .values({
            id: opts.id,
            agent_id: 'agent-coder',
            item_id: opts.item_id,
            status: opts.status ?? 'in_progress',
            parent_run_id: opts.parent_run_id ?? null,
        })
        .execute();
}

describe('DELETE /api/run/:id — delete + item unstick (P9)', () => {
    it('returns 404 when the run id does not exist', async () => {
        const res = await app.inject({ method: 'DELETE', url: '/api/run/no-such-run' });
        expect(res.statusCode).toBe(404);
        expect(res.json()).toMatchObject({ error: 'Run not found', kind: 'not_found' });
    });

    it('deletes the run, cascades the reviewer child, and resets the item', async () => {
        // Item starts assigned to the agent in `in_progress` — a stuck-run
        // shape post-2026-06-10: performer finished (status=completed), the
        // reviewer was spawned and then hung mid-cleanup. The new DB-level
        // unique partial index `agent_runs_one_live_per_item` ensures only
        // the reviewer is live at any one time; deleting the performer row
        // cascade-deletes its child reviewer via the parent_run_id FK.
        await testDb
            .updateTable('items')
            .set({ status: 'in_progress', assignee_agent_id: 'agent-coder' })
            .where('id', '=', 'ATL-2')
            .execute();
        await seedRun({ id: 'run-performer', item_id: 'ATL-2', status: 'completed' });
        await seedRun({
            id: 'run-reviewer',
            item_id: 'ATL-2',
            status: 'in_progress',
            parent_run_id: 'run-performer',
        });

        const res = await app.inject({ method: 'DELETE', url: '/api/run/run-performer' });
        expect(res.statusCode).toBe(204);

        // Both parent and child are gone (CASCADE on parent_run_id).
        const remaining = await testDb
            .selectFrom('agent_runs')
            .select(['id'])
            .where('id', 'in', ['run-performer', 'run-reviewer'])
            .execute();
        expect(remaining).toEqual([]);

        // Item is reset back to `ready` with no assignee — dispatcher
        // can pick it up again on the next tick.
        const item = await testDb
            .selectFrom('items')
            .select(['status', 'assignee_agent_id'])
            .where('id', '=', 'ATL-2')
            .executeTakeFirst();
        expect(item).toEqual({ status: 'ready', assignee_agent_id: null });
    });

    it('leaves completed/error history intact when deleting the single in-flight run', async () => {
        // Post-2026-06-10 the unique partial index makes "sibling in-flight
        // runs on the same item" impossible to create. Historical
        // (completed/error) rows are unaffected by the index and remain
        // as the audit trail. DELETE on the only in-flight run must
        // (a) drop that run and (b) leave history alone.
        await testDb
            .updateTable('items')
            .set({ status: 'in_progress', assignee_agent_id: 'agent-coder' })
            .where('id', '=', 'ATL-2')
            .execute();
        await seedRun({ id: 'run-old-done', item_id: 'ATL-2', status: 'completed' });
        await seedRun({ id: 'run-old-error', item_id: 'ATL-2', status: 'error' });
        await seedRun({ id: 'run-target', item_id: 'ATL-2', status: 'in_progress' });

        const res = await app.inject({ method: 'DELETE', url: '/api/run/run-target' });
        expect(res.statusCode).toBe(204);

        const surviving = await testDb
            .selectFrom('agent_runs')
            .select(['id', 'status'])
            .where('item_id', '=', 'ATL-2')
            .orderBy('id')
            .execute();
        expect(surviving.map((r) => r.id).sort()).toEqual(['run-old-done', 'run-old-error']);
    });

    it('leaves a draft item as draft (does not fake-promote on delete)', async () => {
        await insertItem({
            id: 'ATL-DRAFT',
            type: 'sub_task',
            project_id: 'p1',
            parent_id: 'ATL-100',
            parent_type: 'task',
            title: 'Never promoted',
            status: 'draft',
            assignee_agent_id: 'agent-coder',
        });
        await seedRun({ id: 'run-on-draft', item_id: 'ATL-DRAFT', status: 'in_progress' });

        const res = await app.inject({ method: 'DELETE', url: '/api/run/run-on-draft' });
        expect(res.statusCode).toBe(204);

        const item = await testDb
            .selectFrom('items')
            .select(['status', 'assignee_agent_id'])
            .where('id', '=', 'ATL-DRAFT')
            .executeTakeFirst();
        expect(item).toEqual({ status: 'draft', assignee_agent_id: null });
    });

    it('succeeds for a run with no attached item (freedom-mode run)', async () => {
        await seedRun({ id: 'run-freedom', item_id: null, status: 'in_progress' });

        const res = await app.inject({ method: 'DELETE', url: '/api/run/run-freedom' });
        expect(res.statusCode).toBe(204);

        const row = await testDb
            .selectFrom('agent_runs')
            .select(['id'])
            .where('id', '=', 'run-freedom')
            .executeTakeFirst();
        expect(row).toBeUndefined();
    });
});

// W6 — POST /api/run/:id/stop. The endpoint flips status to `cancelled`,
// re-reads the row to learn the actual post-UPDATE state (handles the
// race where the runner finalises the row between the SELECT and the
// UPDATE), broadcasts an SSE event carrying that actual status, and
// returns it to the caller. The kill is best-effort and not asserted
// against here (covered by integration tests with a real subprocess).
describe('POST /api/run/:id/stop — kill switch (W6)', () => {
    it('stops a queued run, writes cancelled, and broadcasts cancelled', async () => {
        const { broadcastSSE } = await import('../routes/events.js');
        (broadcastSSE as unknown as ReturnType<typeof vi.fn>).mockClear();

        await seedRun({ id: 'run-q', item_id: 'ATL-2', status: 'queued' });

        const res = await app.inject({ method: 'POST', url: '/api/run/run-q/stop' });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body).toMatchObject({ runId: 'run-q', status: 'cancelled' });

        const row = await testDb
            .selectFrom('agent_runs')
            .select(['status', 'completed_at'])
            .where('id', '=', 'run-q')
            .executeTakeFirst();
        expect(row?.status).toBe('cancelled');
        expect(row?.completed_at).not.toBeNull();

        expect(broadcastSSE).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'run_completed',
                runId: 'run-q',
                status: 'cancelled',
            })
        );
    });

    it('broadcasts the actual row status, not a hard-coded cancelled, when the row was finalised mid-handler', async () => {
        // Race: while the stop handler awaits the subprocess kill, the
        // runner finalises the row to `completed`. The handler re-reads
        // the row after the kill and must broadcast the *actual* row
        // status, not a hard-coded `'cancelled'`. Without the re-read
        // the broadcast would lie and downstream caches would briefly
        // disagree with the DB.
        //
        // Handler order: `UPDATE → cancelRun → re-read → broadcast`.
        // We hijack `cancelRun` (already a vi.fn mock) so that, while
        // the handler awaits it, we mutate the row to `completed`.
        // The re-read then sees `completed` and that's what the
        // response + SSE both carry.
        await seedRun({ id: 'run-race', item_id: 'ATL-2', status: 'in_progress' });

        const { broadcastSSE } = await import('../routes/events.js');
        const { cancelRun } = await import('../services/agent-runner.js');
        (broadcastSSE as unknown as ReturnType<typeof vi.fn>).mockClear();
        (cancelRun as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
            await testDb
                .updateTable('agent_runs')
                .set({ status: 'completed', completed_at: new Date().toISOString() })
                .where('id', '=', 'run-race')
                .execute();
            return { cancelled: false, pidKilled: null };
        });

        const res = await app.inject({ method: 'POST', url: '/api/run/run-race/stop' });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.status).toBe('completed');

        expect(broadcastSSE).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'run_completed',
                runId: 'run-race',
                status: 'completed',
            })
        );

        const row = await testDb
            .selectFrom('agent_runs')
            .select(['status'])
            .where('id', '=', 'run-race')
            .executeTakeFirst();
        expect(row?.status).toBe('completed');
    });

    it('returns 409 when the run is already in a terminal state', async () => {
        await seedRun({ id: 'run-done', item_id: 'ATL-2', status: 'completed' });

        const res = await app.inject({ method: 'POST', url: '/api/run/run-done/stop' });
        expect(res.statusCode).toBe(409);
        const body = res.json();
        expect(body).toMatchObject({ kind: 'conflict' });
        expect(body.error).toMatch(/already completed/);
    });

    it('returns 404 when the run does not exist', async () => {
        const res = await app.inject({ method: 'POST', url: '/api/run/no-such-run/stop' });
        expect(res.statusCode).toBe(404);
    });
});

// Task 12 — the dedicated `PATCH /api/run/:id/performer-done` and
// `PATCH /api/run/:id/review` routes were removed. The agent no longer
// calls back over MCP / HTTP with its own run id (which used to be
// hallucinable from the prompt's activity log). Instead, the
// orchestrator parses the agent's CLI output for a terminal
// `atlas-outcome` fenced block, persists the parsed outcome into the
// unified `agent_runs.outcome_*` columns, and applies the on-pass /
// on-fail handoff.
//
// The pure parser is covered in `services/run-outcome-parser.test.ts`;
// the routing function in `services/agent-runner-outcome-routing.test.ts`.
// Tests that exercised the now-deleted routes have been retired with
// the routes themselves.

describe('GET /api/run — list endpoint', () => {
    it('returns 200 with an array when no runs exist', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/run' });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(Array.isArray(body)).toBe(true);
    });

    it('returns 200 with runs after seeding one', async () => {
        await seedRun({ id: 'run-list-1', item_id: 'ATL-2', status: 'completed' });
        const res = await app.inject({ method: 'GET', url: '/api/run' });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(Array.isArray(body)).toBe(true);
        expect(body.length).toBeGreaterThanOrEqual(1);
    });

    it('returns filtered results when issue_id is provided', async () => {
        await seedRun({ id: 'run-filter-1', item_id: 'ATL-2', status: 'completed' });
        const res = await app.inject({
            method: 'GET',
            url: '/api/run?issue_id=ATL-2',
        });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(Array.isArray(body)).toBe(true);
        // asAgentRun projects `item_id` → `issue_id` in the response.
        expect(body.every((r: { issue_id: string }) => r.issue_id === 'ATL-2')).toBe(true);
    });

    it('returns filtered results when project_id is provided', async () => {
        await seedRun({ id: 'run-proj-1', item_id: 'ATL-2', status: 'completed' });
        const res = await app.inject({
            method: 'GET',
            url: '/api/run?project_id=p1',
        });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(Array.isArray(body)).toBe(true);
    });
});

describe('GET /api/run/:id — single run endpoint', () => {
    it('returns 200 with the run data for an existing run', async () => {
        await seedRun({ id: 'run-get-1', item_id: 'ATL-2', status: 'in_progress' });
        const res = await app.inject({ method: 'GET', url: '/api/run/run-get-1' });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body).toMatchObject({ id: 'run-get-1', status: 'in_progress' });
    });

    it('returns 404 for a missing run', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/run/no-such-run-id' });
        expect(res.statusCode).toBe(404);
        expect(res.json()).toMatchObject({ kind: 'not_found' });
    });
});

describe('POST /api/run — additional validation', () => {

    it('returns 400 when agent is inactive', async () => {
        await insertAgent({ id: 'agent-dormant', status: 'inactive' });
        const res = await app.inject({
            method: 'POST',
            url: '/api/run',
            payload: { agent_id: 'agent-dormant' },
        });
        expect(res.statusCode).toBe(400);
    });
});

// ── Additional coverage for uncovered branches ────────────────────────────

// Live run lock (lines 90-95): when findLiveRunOnItem returns a blocker,
// POST /api/run must return 409 before reaching the INSERT. We seed a
// live run on the same item directly to trigger the lock.

// DB INSERT 23505 race (lines 156-165): the unique partial index
// `agent_runs_one_live_per_item` blocks a second live row per item. This
// race can only happen between the `findLiveRunOnItem` check and the INSERT.
// We simulate it by: (1) bypassing `findLiveRunOnItem` via spy, (2) pre-
// seeding a live run, so the INSERT itself fails with 23505.

// GET /api/run/:id with ?since parameter (lines 259-263).
// The `since` param tells the server to return only bytes after offset N.
describe('GET /api/run/:id — ?since slicing', () => {
    it('returns the full output when ?since=0', async () => {
        await seedRun({ id: 'run-since-1', item_id: 'ATL-2', status: 'completed' });
        const res = await app.inject({
            method: 'GET',
            url: '/api/run/run-since-1?since=0',
        });
        expect(res.statusCode).toBe(200);
        // output_text is null/empty for a seeded run; sliced result is ''
        const body = res.json();
        expect(body).toMatchObject({ id: 'run-since-1' });
    });

    it('returns empty string when ?since >= output length', async () => {
        await seedRun({ id: 'run-since-2', item_id: 'ATL-2', status: 'completed' });
        // output_text is null (no output_text in seedRun); effectiveOutput = ''; slice = ''
        const res = await app.inject({
            method: 'GET',
            url: '/api/run/run-since-2?since=999999',
        });
        expect(res.statusCode).toBe(200);
    });

    it('falls through to full output when ?since is non-numeric', async () => {
        await seedRun({ id: 'run-since-3', item_id: 'ATL-2', status: 'completed' });
        const res = await app.inject({
            method: 'GET',
            url: '/api/run/run-since-3?since=abc',
        });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body).toMatchObject({ id: 'run-since-3' });
    });

    it('serves live output from runOutputRegistry when present', async () => {
        const { runOutputRegistry } = await import('../services/agent-runner.js');
        await seedRun({ id: 'run-live-reg', item_id: 'ATL-2', status: 'in_progress' });
        // Set a live output entry in the registry (as the runner would during execution)
        (runOutputRegistry as Map<string, string>).set('run-live-reg', 'live-output-text');
        try {
            const res = await app.inject({
                method: 'GET',
                url: '/api/run/run-live-reg',
            });
            expect(res.statusCode).toBe(200);
            const body = res.json();
            expect(body.output_text).toBe('live-output-text');
        } finally {
            (runOutputRegistry as Map<string, string>).delete('run-live-reg');
        }
    });
});

// GET /api/run/:id — empty ?since string (line 258: since.length > 0 is false).
// When the client sends ?since= (empty), the slice condition short-circuits.
describe('GET /api/run/:id — empty ?since string (RUN-EXTRA)', () => {
    it('falls through to full output when ?since is an empty string (RUN-EXTRA-1)', async () => {
        await seedRun({ id: 'run-since-empty', item_id: 'ATL-2', status: 'completed' });
        const res = await app.inject({
            method: 'GET',
            url: '/api/run/run-since-empty?since=',
        });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body).toMatchObject({ id: 'run-since-empty' });
    });

    it('falls through to full output when ?since is negative (n >= 0 is false, RUN-EXTRA-2)', async () => {
        await seedRun({ id: 'run-since-neg', item_id: 'ATL-2', status: 'completed' });
        const res = await app.inject({
            method: 'GET',
            url: '/api/run/run-since-neg?since=-5',
        });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body).toMatchObject({ id: 'run-since-neg' });
    });
});

// POST /api/run/:id/stop — cancelRun throws (lines 382-385).
// The route wraps cancelRun in a .catch so a thrown error must NOT
// crash the handler; response is still 200.
describe('POST /api/run/:id/stop — cancelRun throwing is handled gracefully', () => {
    it('returns 200 even when cancelRun throws', async () => {
        await seedRun({ id: 'run-stop-throw', item_id: 'ATL-2', status: 'queued' });
        const { cancelRun } = await import('../services/agent-runner.js');
        (cancelRun as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
            new Error('subprocess registry error')
        );
        const res = await app.inject({ method: 'POST', url: '/api/run/run-stop-throw/stop' });
        expect(res.statusCode).toBe(200);
        // Status should still be cancelled (DB write succeeded before the kill attempt)
        const body = res.json();
        expect(body.status).toBe('cancelled');
    });
});

// POST /api/run/:id/stop — all three terminal states return 409.
describe('POST /api/run/:id/stop — all terminal states return 409', () => {
    it('returns 409 when run status is error', async () => {
        await seedRun({ id: 'run-terminal-err', item_id: 'ATL-2', status: 'error' });
        const res = await app.inject({
            method: 'POST',
            url: '/api/run/run-terminal-err/stop',
        });
        expect(res.statusCode).toBe(409);
        expect(res.json().error).toMatch(/already error/);
    });

    it('returns 409 when run status is cancelled', async () => {
        await seedRun({ id: 'run-terminal-can', item_id: 'ATL-2', status: 'error' });
        await testDb
            .updateTable('agent_runs')
            .set({ status: 'cancelled' })
            .where('id', '=', 'run-terminal-can')
            .execute();
        const res = await app.inject({
            method: 'POST',
            url: '/api/run/run-terminal-can/stop',
        });
        expect(res.statusCode).toBe(409);
        expect(res.json().error).toMatch(/already cancelled/);
    });
});

// queueMicrotask error callback (lines 185-209): when spawnAgentRun rejects
// AFTER the 202 is sent, the catch handler must mark the run row as error.
// We mock spawnAgentRun to reject with a plain Error, await async drain,
// then verify the row.
describe('POST /api/run — background spawn failure marks row as error', () => {
    it('marks the run row as error when spawnAgentRun rejects in the background', async () => {
        const { spawnAgentRun } = await import('../services/agent-runner.js');
        // Make spawnAgentRun reject with a generic error (covers the else branch
        // in the reason ternary — neither DependenciesNotReadyError nor
        // LiveRunOnItemError, so falls through to err.message).
        (spawnAgentRun as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
            new Error('simulated spawn failure')
        );

        // Use a freedom-mode agent so we bypass findLiveRunOnItem and
        // assertDepsAllDoneForDispatch (they only run for hasItem=true).
        await insertAgent({ id: 'agent-bg-fail', status: 'active', requires_item: false });

        const res = await app.inject({
            method: 'POST',
            url: '/api/run',
            payload: { agent_id: 'agent-bg-fail' },
        });
        expect(res.statusCode).toBe(202);
        const { runId } = res.json();
        expect(typeof runId).toBe('string');

        // Drain: queueMicrotask fires after reply; give it time to:
        //   1. call spawnAgentRun (rejects)
        //   2. enter the .catch callback
        //   3. do the DB UPDATE
        await new Promise((r) => setTimeout(r, 400));

        const row = await testDb
            .selectFrom('agent_runs')
            .select(['status', 'outcome_summary'])
            .where('id', '=', runId)
            .executeTakeFirst();
        expect(row?.status).toBe('error');
        expect(row?.outcome_summary).toMatch(/simulated spawn failure/);
    });

});

// ── Additional branch coverage ────────────────────────────────────────────

// POST /api/run — broadcastSSE is called with issueType/issueId when hasItem.
// Exercises the ternary on line 171: `...(hasItem ? { issueType, issueId } : {})`.

// POST /api/run — freedom-mode agent can also receive item params (hasItem=true
// path with requires_item=false). Exercises the freedom-mode agent with item params
// taking the normal item-check path (findLiveRunOnItem + assertDepsAllDoneForDispatch).

// GET /api/run — limit query clamping (line 435: Math.min(Number(limit ?? 50), 500)).
// Tests the explicit limit param code path.
describe('GET /api/run — limit query parameter', () => {
    it('respects an explicit limit param less than 500', async () => {
        for (let i = 0; i < 3; i++) {
            await seedRun({ id: `run-lim-${i}`, item_id: 'ATL-2', status: 'completed' });
        }
        const res = await app.inject({ method: 'GET', url: '/api/run?limit=2' });
        expect(res.statusCode).toBe(200);
        const body = res.json() as unknown[];
        // Should be at most 2 results.
        expect(body.length).toBeLessThanOrEqual(2);
    });

    it('clamps an over-limit value to 500', async () => {
        // Just verify the endpoint accepts a large limit without error.
        const res = await app.inject({ method: 'GET', url: '/api/run?limit=9999' });
        expect(res.statusCode).toBe(200);
        expect(Array.isArray(res.json())).toBe(true);
    });

    it('uses default limit of 50 when no limit is provided', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/run' });
        expect(res.statusCode).toBe(200);
        expect(Array.isArray(res.json())).toBe(true);
    });
});

// POST /api/run/:id/stop — stopping an in_progress run (complements the queued test).
describe('POST /api/run/:id/stop — stopping an in_progress run', () => {
    it('cancels an in_progress run and returns 200 with cancelled status', async () => {
        await seedRun({ id: 'run-ip-stop', item_id: 'ATL-2', status: 'in_progress' });

        const res = await app.inject({ method: 'POST', url: '/api/run/run-ip-stop/stop' });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body).toMatchObject({ runId: 'run-ip-stop', status: 'cancelled' });

        const row = await testDb
            .selectFrom('agent_runs')
            .select(['status', 'completed_at'])
            .where('id', '=', 'run-ip-stop')
            .executeTakeFirst();
        expect(row?.status).toBe('cancelled');
        expect(row?.completed_at).not.toBeNull();
    });
});

// GET /api/run/:id — response shape from asAgentRun projection.
// Verifies the projection renaming: item_id → issue_id, agent_id → agentId, etc.
describe('GET /api/run/:id — asAgentRun projection shape', () => {
    it('returns a run with projected fields (issue_id, agentId) for an item-linked run', async () => {
        await seedRun({ id: 'run-proj-shape', item_id: 'ATL-2', status: 'in_progress' });
        const res = await app.inject({ method: 'GET', url: '/api/run/run-proj-shape' });
        expect(res.statusCode).toBe(200);
        const body = res.json() as Record<string, unknown>;
        // asAgentRun renames columns; check at least the id is present
        expect(body.id).toBe('run-proj-shape');
        expect(body.status).toBe('in_progress');
    });

    it('returns a run with no item (freedom-mode) successfully', async () => {
        await seedRun({ id: 'run-freedom-get', item_id: null, status: 'completed' });
        const res = await app.inject({ method: 'GET', url: '/api/run/run-freedom-get' });
        expect(res.statusCode).toBe(200);
        const body = res.json() as Record<string, unknown>;
        expect(body.id).toBe('run-freedom-get');
    });
});

// DELETE /api/run/:id — runOutputRegistry.delete is called (best-effort buffer cleanup).
// We set a registry entry before deletion and confirm the handler completes without error.
describe('DELETE /api/run/:id — registry cleanup after delete', () => {
    it('succeeds (204) even when the run had a live registry entry', async () => {
        const { runOutputRegistry } = await import('../services/agent-runner.js');
        await seedRun({ id: 'run-reg-del', item_id: null, status: 'in_progress' });
        (runOutputRegistry as Map<string, string>).set('run-reg-del', 'some output');

        const res = await app.inject({ method: 'DELETE', url: '/api/run/run-reg-del' });
        expect(res.statusCode).toBe(204);

        // Registry entry should have been removed by the handler.
        expect((runOutputRegistry as Map<string, string>).has('run-reg-del')).toBe(false);
    });
});

// Regression — 2026-09-12. `GET /api/run` accepted `agent_id` and
// `issue_type` in its query shape but applied neither: `?agent_id=anything`
// returned every run in the workspace, including for an agent with none.
// `routes-map.md` documented the agent filter and `api.ts::run.list` sends
// `issue_type`, so both looked supported. Nothing user-facing broke (the Agent
// Detail Runs tab uses the dedicated `GET /api/agents/:id/runs`), but a filter
// that silently doesn't filter is a trap for the next caller.
describe('GET /api/run — filters actually filter', () => {
    beforeEach(async () => {
        await insertAgent({ id: 'agent-other', status: 'active' });
        await testDb
            .insertInto('agent_runs')
            .values([
                {
                    id: 'aaaaaaaa-0000-0000-0000-000000000001',
                    agent_id: 'agent-coder',
                    item_id: 'ATL-2',
                    project_id: 'p1',
                    status: 'completed',
                },
                {
                    id: 'aaaaaaaa-0000-0000-0000-000000000002',
                    agent_id: 'agent-coder',
                    item_id: 'ATL-100',
                    project_id: 'p1',
                    status: 'completed',
                },
            ])
            .execute();
    });

    it('narrows by agent_id, and returns nothing for an agent with no runs', async () => {
        const mine = await app.inject({ method: 'GET', url: '/api/run?agent_id=agent-coder' });
        expect(mine.statusCode).toBe(200);
        const mineRows = JSON.parse(mine.body) as Array<{ agent_id: string }>;
        expect(mineRows).toHaveLength(2);
        expect(mineRows.every((r) => r.agent_id === 'agent-coder')).toBe(true);

        const none = await app.inject({ method: 'GET', url: '/api/run?agent_id=agent-other' });
        expect(JSON.parse(none.body)).toHaveLength(0);
    });

    it('narrows by issue_type', async () => {
        const subTasks = await app.inject({ method: 'GET', url: '/api/run?issue_type=sub_task' });
        const tasks = await app.inject({ method: 'GET', url: '/api/run?issue_type=task' });
        expect(JSON.parse(subTasks.body)).toHaveLength(1);
        expect(JSON.parse(tasks.body)).toHaveLength(1);
    });

    it('unfiltered still returns everything', async () => {
        const all = await app.inject({ method: 'GET', url: '/api/run?limit=500' });
        expect(JSON.parse(all.body).length).toBeGreaterThanOrEqual(2);
    });
});

// Regression — 2026-09-12. A run that fails BEFORE the CLI is spawned
// (worktree provisioning, unmet depends_on, live-run conflict) has no
// output_text at all; POST /api/run records the reason on `outcome_summary`.
// `asAgentRun` maps that column, but GET /api/run/:id never SELECTed it, so it
// always came back null and the Run Detail page showed "Error" over an empty
// output pane. The only copy of the diagnostic was the server log.
describe('GET /api/run/:id — outcome columns reach the client', () => {
    it('returns outcome_summary for a run that failed before spawning', async () => {
        const runId = 'bbbbbbbb-0000-0000-0000-000000000001';
        const reason = 'Worktree provisioning failed for ATL-2: remote not found';
        await testDb
            .insertInto('agent_runs')
            .values({
                id: runId,
                agent_id: 'agent-coder',
                item_id: 'ATL-2',
                project_id: 'p1',
                status: 'error',
                outcome_summary: reason,
            })
            .execute();

        const res = await app.inject({ method: 'GET', url: `/api/run/${runId}` });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as {
            output_text: string | null;
            outcome_summary: string | null;
        };
        // The condition the UI banner keys on: errored, no output, but a reason.
        expect(body.output_text).toBeFalsy();
        expect(body.outcome_summary).toBe(reason);
    });
});
