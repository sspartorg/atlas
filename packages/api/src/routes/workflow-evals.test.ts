import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

vi.mock('../routes/events.js', () => ({
    eventsRoutes: async () => {
        /* no-op */
    },
    broadcastSSE: vi.fn(),
}));
vi.mock('../services/workflow-engine.js', () => ({
    startWorkflowRun: vi.fn(async () => 'wr-1'),
    onStepFinished: vi.fn(),
    cancelWorkflowRun: vi.fn(),
    resumeWorkflowRun: vi.fn(),
    reconcileWorkflowRuns: vi.fn(),
    tickWorkflowDispatch: vi.fn(),
    continueResumedRun: vi.fn(),
}));

import { buildApp } from '../server.js';
import { closeTestDb, testDb, truncateAll } from '../../tests/_pg-db.js';
import { insertProject } from '../../tests/_items.js';

// ADR 0023 phase 3 / ATL-173 over HTTP.

let app: FastifyInstance;
// The POST routes carry `requireMcpToken`. `vitest.config.ts` sets
// `ATLAS_MCP_TOKEN_OPEN: '1'`, so the gate is open here by design and no route
// test can assert a 401 — the header is sent to document the real requirement.
const token = { 'x-atlas-token': process.env['ATLAS_MCP_TOKEN'] ?? '' };

const body = {
    project_id: 'p1',
    name: 'ambiguous must escalate',
    suite: 'golden',
    item_template: { issue_type: 'task', title: 'Make the thing better' },
    expectations: { requires_pr: false },
};

async function makeWorkflow(id: string, inputKind: 'item' | 'sub_task' = 'item'): Promise<void> {
    await testDb
        .insertInto('workflows')
        .values({
            id,
            project_id: 'p1',
            name: id,
            graph: JSON.stringify({ nodes: [], edges: [] }),
            input_kind: inputKind,
            trigger: 'manual',
        } as never)
        .execute();
}

beforeEach(async () => {
    await truncateAll();
    await insertProject('p1', 'ATL');
    await makeWorkflow('wf-1');
    if (!app) {
        app = await buildApp({ logger: false });
        await app.ready();
    }
});

afterAll(async () => {
    if (app) await app.close();
    await closeTestDb();
});

describe('workflow evals over HTTP', () => {
    it('creates a fixture against a workflow and lists it', async () => {
        const created = await app.inject({
            method: 'POST',
            url: '/api/workflows/wf-1/tests',
            headers: token,
            payload: body,
        });
        expect(created.statusCode).toBe(201);
        expect(created.json()).toMatchObject({ workflow_id: 'wf-1', agent_id: null, suite: 'golden' });

        const listed = await app.inject({ method: 'GET', url: '/api/workflows/wf-1/tests' });
        expect(listed.json()).toHaveLength(1);
    });

    it('404s for a workflow that does not exist', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/workflows/nope/tests',
            headers: token,
            payload: body,
        });
        expect(res.statusCode).toBe(404);
    });

    // A sub-task workflow runs only from a Task workflow's Sub-tasks step, so
    // a fixture pointed at one could never start. Refusing at CREATE rather
    // than at run time saves discovering it an hour and several dollars in.
    it('refuses a fixture pointed at a sub-task workflow', async () => {
        await makeWorkflow('wf-sub', 'sub_task');
        const res = await app.inject({
            method: 'POST',
            url: '/api/workflows/wf-sub/tests',
            headers: token,
            payload: body,
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().error).toContain("Sub-tasks step");
    });

    it('rejects a body that is not a fixture', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/workflows/wf-1/tests',
            headers: token,
            payload: { name: 'no project or item' },
        });
        expect(res.statusCode).toBe(400);
    });

    // ATL-173's make-or-break: the parks have to be answerable from the UI.
    it('reports the fixtures waiting on an answer, with their reasons', async () => {
        const created = await app.inject({
            method: 'POST',
            url: '/api/workflows/wf-1/tests',
            headers: token,
            payload: body,
        });
        const testId = created.json().id as string;

        await testDb
            .insertInto('workflow_runs')
            .values({
                id: 'wr-parked',
                workflow_id: 'wf-1',
                project_id: 'p1',
                status: 'waiting_for_owner',
                graph_snapshot: JSON.stringify({ nodes: [], edges: [] }),
                parked_node_id: 'po-writer',
                park_reason: 'Which repo owns this?',
                started_at: new Date().toISOString(),
            } as never)
            .execute();
        await testDb
            .insertInto('agent_test_runs')
            .values({ id: 'atr-1', agent_test_id: testId, batch_id: 'b1', workflow_run_id: 'wr-parked' } as never)
            .execute();

        const parked = await app.inject({ method: 'GET', url: '/api/workflows/wf-1/evals/parked' });
        expect(parked.json()).toHaveLength(1);
        expect(parked.json()[0]).toMatchObject({
            test_name: 'ambiguous must escalate',
            parked_node_id: 'po-writer',
            park_reason: 'Which repo owns this?',
        });
    });

    it('reports nothing parked when nothing is', async () => {
        await app.inject({ method: 'POST', url: '/api/workflows/wf-1/tests', headers: token, payload: body });
        const parked = await app.inject({ method: 'GET', url: '/api/workflows/wf-1/evals/parked' });
        expect(parked.json()).toEqual([]);
    });
});
