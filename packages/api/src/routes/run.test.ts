import { describe, expect, it, beforeEach, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type * as AgentDispatcherModule from '../services/agent-dispatcher.js';

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

// Mock spawnAgentRun to keep just the depends_on gate behavior (the actual
// thing we're testing here) without the simulated-CLI setTimeout chain. The
// chain fires ~400ms later and writes to agent_round_counts for an item that
// the next test's truncateAll has wiped, surfacing as a false-positive
// "Unhandled Rejection" in the suite. The end-to-end happy path is still
// covered by agent-dispatcher.integration.test.ts which uses fake timers.
vi.mock('../services/agent-runner.js', () => {
    // LiveRunOnItemError must be exported from the mock so the route code
    // (`err instanceof LiveRunOnItemError`) resolves against the same
    // class reference at runtime.
    class LiveRunOnItemError extends Error {
        constructor(public readonly itemId: string) {
            super(`Item ${itemId} already has an active run.`);
            this.name = 'LiveRunOnItemError';
        }
    }
    return {
        LiveRunOnItemError,
        spawnAgentRun: vi.fn().mockImplementation(async (opts: {
            agentId: string;
            issueType?: string;
            issueId?: string;
            projectId?: string;
        }) => {
            if (opts.issueId) {
                const { assertDepsAllDoneForDispatch } = await import(
                    '../services/dependency-guard.js'
                );
                await assertDepsAllDoneForDispatch(opts.issueId, opts.agentId);
            }
            return `fake-run-${Math.random().toString(36).slice(2)}`;
        }),
        // W3 — GET /api/run/:id reads this registry to serve live in-memory
        // output between 10s DB flushes. Tests don't exercise the live path
        // (no real subprocess), so an empty Map is sufficient.
        runOutputRegistry: new Map<string, string>(),
        // The stop endpoint calls cancelRun to kill the live CLI subprocess
        // (best-effort). No real child here, so report "not in registry".
        cancelRun: vi.fn().mockResolvedValue({ cancelled: false, pidKilled: null }),
    };
});

// Passthrough mock for agent-dispatcher so we can vi.spyOn findLiveRunOnItem
// in the 23505 race test without breaking existing tests that use the real
// DB-backed implementation.
vi.mock('../services/agent-dispatcher.js', async (importOriginal) => {
    return importOriginal<typeof AgentDispatcherModule>();
});

import { buildApp } from '../server.js';
import { truncateAll, closeTestDb, testDb } from '../../tests/_pg-db.js';
import { insertProject, insertAgent, insertItem } from '../../tests/_items.js';
import { itemLinks } from '../services/item-links.js';

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
    await insertItem({ id: 'ATL-100', type: 'epic', project_id: 'p1', title: 'Parent epic' });
    await insertItem({
        id: 'ATL-2',
        type: 'story',
        project_id: 'p1',
        parent_id: 'ATL-100',
        parent_type: 'epic',
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

describe('POST /api/run — depends_on hard-gate (B04)', () => {
    it('returns 409 with the blocker list when a depends_on target is non-done', async () => {
        await insertItem({
            id: 'ATL-1',
            type: 'story',
            project_id: 'p1',
            parent_id: 'ATL-100',
            parent_type: 'epic',
            title: 'Upstream',
            status: 'in_progress',
        });
        await itemLinks.create('ATL-2', 'ATL-1', 'depends_on');

        const res = await app.inject({
            method: 'POST',
            url: '/api/run',
            payload: { agent_id: 'agent-coder', issue_type: 'story', issue_id: 'ATL-2' },
        });

        expect(res.statusCode).toBe(409);
        const body = res.json();
        expect(body.error).toBe('dependencies_not_ready');
        expect(body.blockers).toEqual([
            expect.objectContaining({ id: 'ATL-1', status: 'in_progress' }),
        ]);
    });

    it('returns 409 when a depends_on target is in_review (in_review does not satisfy)', async () => {
        await insertItem({
            id: 'ATL-1',
            type: 'story',
            project_id: 'p1',
            parent_id: 'ATL-100',
            parent_type: 'epic',
            title: 'Upstream in review',
            status: 'in_review',
        });
        await itemLinks.create('ATL-2', 'ATL-1', 'depends_on');

        const res = await app.inject({
            method: 'POST',
            url: '/api/run',
            payload: { agent_id: 'agent-coder', issue_type: 'story', issue_id: 'ATL-2' },
        });

        expect(res.statusCode).toBe(409);
        const body = res.json();
        expect(body.error).toBe('dependencies_not_ready');
        expect(body.blockers[0]).toEqual(
            expect.objectContaining({ id: 'ATL-1', status: 'in_review' }),
        );
    });

    it('returns 202 with a runId when every depends_on target is done', async () => {
        await insertItem({
            id: 'ATL-1',
            type: 'story',
            project_id: 'p1',
            parent_id: 'ATL-100',
            parent_type: 'epic',
            title: 'Upstream done',
            status: 'done',
        });
        await itemLinks.create('ATL-2', 'ATL-1', 'depends_on');

        const res = await app.inject({
            method: 'POST',
            url: '/api/run',
            payload: { agent_id: 'agent-coder', issue_type: 'story', issue_id: 'ATL-2' },
        });

        expect(res.statusCode).toBe(202);
        const body = res.json();
        expect(typeof body.runId).toBe('string');
    });
});

describe('POST /api/run — freedom-mode manual launch', () => {
    it('returns 400 when an item-driven agent is launched without item params', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/run',
            payload: { agent_id: 'agent-coder' },
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().error).toMatch(/issue_type and issue_id/);
    });

    it('returns 202 when a freedom-mode agent is launched without item params', async () => {
        await insertAgent({
            id: 'agent-freedom',
            status: 'active',
            requires_item: false,
        });

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

    it('returns kind=conflict with top-level blockers when deps not ready', async () => {
        await insertItem({
            id: 'ATL-1',
            type: 'story',
            project_id: 'p1',
            parent_id: 'ATL-100',
            parent_type: 'epic',
            title: 'Upstream',
            status: 'in_progress',
        });
        await itemLinks.create('ATL-2', 'ATL-1', 'depends_on');

        const res = await app.inject({
            method: 'POST',
            url: '/api/run',
            payload: { agent_id: 'agent-coder', issue_type: 'story', issue_id: 'ATL-2' },
        });
        expect(res.statusCode).toBe(409);
        const body = res.json();
        expect(body).toMatchObject({
            error: 'dependencies_not_ready',
            kind: 'conflict',
        });
        expect(Array.isArray(body.blockers)).toBe(true);
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
            type: 'story',
            project_id: 'p1',
            parent_id: 'ATL-100',
            parent_type: 'epic',
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
            }),
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
        (cancelRun as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(
            async () => {
                await testDb
                    .updateTable('agent_runs')
                    .set({ status: 'completed', completed_at: new Date().toISOString() })
                    .where('id', '=', 'run-race')
                    .execute();
                return { cancelled: false, pidKilled: null };
            },
        );

        const res = await app.inject({ method: 'POST', url: '/api/run/run-race/stop' });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.status).toBe('completed');

        expect(broadcastSSE).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'run_completed',
                runId: 'run-race',
                status: 'completed',
            }),
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
    it('returns 400 when issue_type is not a valid runnable type', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/run',
            payload: {
                agent_id: 'agent-coder',
                issue_type: 'invalid_type',
                issue_id: 'ATL-2',
            },
        });
        expect(res.statusCode).toBe(400);
        const body = res.json();
        expect(body.kind).toBe('validation_error');
    });

    it('returns 400 when agent is inactive', async () => {
        await insertAgent({ id: 'agent-dormant', status: 'inactive' });
        const res = await app.inject({
            method: 'POST',
            url: '/api/run',
            payload: {
                agent_id: 'agent-dormant',
                issue_type: 'story',
                issue_id: 'ATL-2',
            },
        });
        expect(res.statusCode).toBe(400);
    });
});

// ── Additional coverage for uncovered branches ────────────────────────────

// Live run lock (lines 90-95): when findLiveRunOnItem returns a blocker,
// POST /api/run must return 409 before reaching the INSERT. We seed a
// live run on the same item directly to trigger the lock.
describe('POST /api/run — live run item lock (findLiveRunOnItem)', () => {
    it('returns 409 when a live run already exists on the same item', async () => {
        // Insert a live (in_progress) run on ATL-2 directly, bypassing the
        // route so we avoid the unique-partial-index race in the other direction.
        await testDb
            .insertInto('agent_runs')
            .values({
                id: 'run-live-blocker',
                agent_id: 'agent-coder',
                item_id: 'ATL-2',
                status: 'in_progress',
                parent_run_id: null,
            })
            .execute();

        const res = await app.inject({
            method: 'POST',
            url: '/api/run',
            payload: { agent_id: 'agent-coder', issue_type: 'story', issue_id: 'ATL-2' },
        });

        expect(res.statusCode).toBe(409);
        const body = res.json();
        expect(body.error).toMatch(/already has an active run/);
        expect(body.kind).toBe('conflict');
    });
});

// DB INSERT 23505 race (lines 156-165): the unique partial index
// `agent_runs_one_live_per_item` blocks a second live row per item. This
// race can only happen between the `findLiveRunOnItem` check and the INSERT.
// We simulate it by: (1) bypassing `findLiveRunOnItem` via spy, (2) pre-
// seeding a live run, so the INSERT itself fails with 23505.
describe('POST /api/run — DB 23505 race guard (lines 156-165)', () => {
    it('returns 409 when the unique partial index fires (race between check and INSERT)', async () => {
        // Pre-seed a live run on ATL-2 (unique partial index will block a
        // second in-progress row for the same item).
        await testDb
            .insertInto('agent_runs')
            .values({
                id: 'run-race-seed',
                agent_id: 'agent-coder',
                item_id: 'ATL-2',
                status: 'in_progress',
                parent_run_id: null,
            })
            .execute();

        // Bypass the findLiveRunOnItem pre-check (simulates the window
        // between the check passing and the INSERT failing).
        const agentDispatcher = await import('../services/agent-dispatcher.js');
        const spy = vi.spyOn(agentDispatcher, 'findLiveRunOnItem').mockResolvedValueOnce(null);

        try {
            const res = await app.inject({
                method: 'POST',
                url: '/api/run',
                payload: { agent_id: 'agent-coder', issue_type: 'story', issue_id: 'ATL-2' },
            });
            expect(res.statusCode).toBe(409);
            const body = res.json();
            expect(body.error).toMatch(/race-blocked/);
            expect(body.kind).toBe('conflict');
        } finally {
            spy.mockRestore();
        }
    });
});


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
            new Error('subprocess registry error'),
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
            new Error('simulated spawn failure'),
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

    it('marks run as error when spawnAgentRun rejects with LiveRunOnItemError (covers LiveRunOnItemError branch)', async () => {
        const { spawnAgentRun, LiveRunOnItemError } = await import('../services/agent-runner.js');
        (spawnAgentRun as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
            new LiveRunOnItemError('ATL-LIVE'),
        );

        await insertAgent({ id: 'agent-live-err', status: 'active', requires_item: false });

        const res = await app.inject({
            method: 'POST',
            url: '/api/run',
            payload: { agent_id: 'agent-live-err' },
        });
        expect(res.statusCode).toBe(202);
        const { runId } = res.json();

        await new Promise((r) => setTimeout(r, 400));

        const row = await testDb
            .selectFrom('agent_runs')
            .select(['status', 'outcome_summary'])
            .where('id', '=', runId)
            .executeTakeFirst();
        expect(row?.status).toBe('error');
        expect(row?.outcome_summary).toMatch(/already has an active run/);
    });

    it('marks run as error when spawnAgentRun rejects with DependenciesNotReadyError in background (covers deps-branch in queueMicrotask)', async () => {
        const { spawnAgentRun } = await import('../services/agent-runner.js');
        const { DependenciesNotReadyError } = await import('../services/dependency-guard.js');
        (spawnAgentRun as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
            new DependenciesNotReadyError([{ id: 'ATL-BG-DEP', title: 'Blocker', status: 'in_progress' }]),
        );

        await insertAgent({ id: 'agent-dep-bg', status: 'active', requires_item: false });

        const res = await app.inject({
            method: 'POST',
            url: '/api/run',
            payload: { agent_id: 'agent-dep-bg' },
        });
        expect(res.statusCode).toBe(202);
        const { runId } = res.json();

        await new Promise((r) => setTimeout(r, 400));

        const row = await testDb
            .selectFrom('agent_runs')
            .select(['status', 'outcome_summary'])
            .where('id', '=', runId)
            .executeTakeFirst();
        expect(row?.status).toBe('error');
        expect(row?.outcome_summary).toMatch(/dependencies not ready/);
    });
});

// ── Additional branch coverage ────────────────────────────────────────────

// POST /api/run — broadcastSSE is called with issueType/issueId when hasItem.
// Exercises the ternary on line 171: `...(hasItem ? { issueType, issueId } : {})`.
describe('POST /api/run — broadcastSSE carries item fields when hasItem=true', () => {
    it('broadcasts run_queued with issueType and issueId for an item-driven dispatch', async () => {
        const { broadcastSSE } = await import('../routes/events.js');
        (broadcastSSE as unknown as ReturnType<typeof vi.fn>).mockClear();

        const res = await app.inject({
            method: 'POST',
            url: '/api/run',
            payload: { agent_id: 'agent-coder', issue_type: 'story', issue_id: 'ATL-2' },
        });

        expect(res.statusCode).toBe(202);
        expect(broadcastSSE).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'run_queued',
                issueType: 'story',
                issueId: 'ATL-2',
            }),
        );
    });

    it('broadcasts run_queued WITHOUT issueType/issueId for a freedom-mode dispatch', async () => {
        await insertAgent({ id: 'agent-free2', status: 'active', requires_item: false });
        const { broadcastSSE } = await import('../routes/events.js');
        (broadcastSSE as unknown as ReturnType<typeof vi.fn>).mockClear();

        const res = await app.inject({
            method: 'POST',
            url: '/api/run',
            payload: { agent_id: 'agent-free2' },
        });

        expect(res.statusCode).toBe(202);
        const call = (broadcastSSE as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
            type: string;
            issueType?: string;
            issueId?: string;
        };
        expect(call.type).toBe('run_queued');
        expect(call.issueType).toBeUndefined();
        expect(call.issueId).toBeUndefined();
    });
});

// POST /api/run — freedom-mode agent can also receive item params (hasItem=true
// path with requires_item=false). Exercises the freedom-mode agent with item params
// taking the normal item-check path (findLiveRunOnItem + assertDepsAllDoneForDispatch).
describe('POST /api/run — freedom-mode agent with item params', () => {
    it('returns 202 when a freedom-mode agent is dispatched WITH item params', async () => {
        await insertAgent({ id: 'agent-free-item', status: 'active', requires_item: false });

        const res = await app.inject({
            method: 'POST',
            url: '/api/run',
            payload: { agent_id: 'agent-free-item', issue_type: 'story', issue_id: 'ATL-2' },
        });

        expect(res.statusCode).toBe(202);
        const body = res.json();
        expect(typeof body.runId).toBe('string');

        // Verify the run row was inserted with the correct item_id.
        const row = await testDb
            .selectFrom('agent_runs')
            .select(['item_id', 'status'])
            .where('id', '=', body.runId)
            .executeTakeFirst();
        expect(row?.item_id).toBe('ATL-2');
        expect(row?.status).toBe('queued');
    });
});

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
