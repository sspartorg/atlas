import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';

vi.mock('../routes/events.js', () => ({ eventsRoutes: async () => undefined, broadcastSSE: vi.fn() }));

// A step spawn only records a live agent_runs row; no CLI, no git.
vi.mock('../services/agent-runner.js', () => ({
    spawnAgentRun: vi.fn(async (opts: { agentId: string; issueId?: string | null; workflowRun?: { id: string; nodeId: string } | null }) => {
        const { testDb } = await import('../../tests/_pg-db.js');
        const id = randomUUID();
        await testDb
            .insertInto('agent_runs')
            .values({
                id,
                agent_id: opts.agentId,
                item_id: opts.issueId ?? null,
                status: 'in_progress',
                workflow_run_id: opts.workflowRun?.id ?? null,
                node_id: opts.workflowRun?.nodeId ?? null,
            })
            .execute();
        return id;
    }),
    runOutputRegistry: new Map<string, string>(),
    cancelRun: vi.fn(async () => ({ cancelled: false, pidKilled: null })),
}));
vi.mock('../services/worktree-orchestrator.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../services/worktree-orchestrator.js')>()),
    ensureWorktree: vi.fn(async () => ({ path: '/tmp/wf', branch: 'atlas/wf/x', freshlyCreated: true })),
    pushWorktree: vi.fn(async () => ({ pushed: true, alreadyUpToDate: false })),
    openPullRequest: vi.fn(async () => ({ opened: false, url: null, alreadyExists: false })),
    cleanupWorktreeAfterPush: vi.fn(async () => ({ worktreeRemoved: true, branchDeleted: true, dbCleared: false, warnings: [] })),
}));

import { buildApp } from '../server.js';
import { closeTestDb, testDb, truncateAll } from '../../tests/_pg-db.js';
import { insertAgent, insertItem, insertProject } from '../../tests/_items.js';

let app: FastifyInstance;

const graph = {
    nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 } },
        { id: 'coder', type: 'agent', agent_id: 'agent-coder', position: { x: 200, y: 0 } },
        { id: 'end', type: 'end', position: { x: 400, y: 0 } },
    ],
    edges: [
        { id: 'e1', source: 'start', target: 'coder', kind: 'pass' },
        { id: 'e2', source: 'coder', target: 'end', kind: 'pass' },
    ],
};

async function createWorkflow(overrides: Record<string, unknown> = {}) {
    const res = await app.inject({
        method: 'POST',
        url: '/api/workflows',
        payload: { name: 'Dev', project_id: 'p1', graph, ...overrides },
    });
    return res;
}

beforeEach(async () => {
    await truncateAll();
    await insertProject('p1', 'ATL', { git_path: '/tmp/repo' });
    await insertAgent({ id: 'agent-coder', status: 'active' });
    await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'Epic', status: 'ready' });
    app = await buildApp({ logger: false });
    await app.ready();
});

afterAll(async () => {
    if (app) await app.close();
    await closeTestDb();
});

describe('workflow CRUD', () => {
    it('creates, lists, updates and deletes a workflow', async () => {
        const created = await createWorkflow();
        expect(created.statusCode).toBe(201);
        const wf = created.json();
        expect(wf).toMatchObject({ name: 'Dev', trigger: 'manual', input_kind: 'item', graph });

        const list = await app.inject({ method: 'GET', url: '/api/workflows?project_id=p1' });
        expect(list.json()).toHaveLength(1);

        const patched = await app.inject({
            method: 'PATCH',
            url: `/api/workflows/${wf.id}`,
            payload: { name: 'Dev v2', trigger: 'schedule', schedule_preset: 'daily', schedule_time_of_day: '09:30' },
        });
        expect(patched.statusCode).toBe(200);
        expect(patched.json()).toMatchObject({ name: 'Dev v2', cron_expr: '30 9 * * *' });
        expect(patched.json().next_run_at).not.toBeNull();

        const del = await app.inject({ method: 'DELETE', url: `/api/workflows/${wf.id}` });
        expect(del.statusCode).toBe(204);
        expect((await app.inject({ method: 'GET', url: `/api/workflows/${wf.id}` })).statusCode).toBe(404);
    });

    it('rejects an invalid graph with per-node errors', async () => {
        const res = await createWorkflow({
            graph: { nodes: [graph.nodes[0], graph.nodes[1]], edges: [graph.edges[0]] },
        });
        expect(res.statusCode).toBe(400);
        const errors = res.json().details.graph_errors as Array<{ node_id: string | null; message: string }>;
        expect(errors).toContainEqual({ node_id: null, message: 'A workflow needs at least one End node' });
        expect(errors).toContainEqual({ node_id: 'coder', message: 'Needs exactly one pass connection' });
    });

    it('rejects a graph that references an unknown agent', async () => {
        const res = await createWorkflow({
            graph: { ...graph, nodes: graph.nodes.map((n) => (n.id === 'coder' ? { ...n, agent_id: 'agent-ghost' } : n)) },
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().details.graph_errors).toContainEqual({ node_id: 'coder', message: 'Agent agent-ghost does not exist' });
    });

    it('requires a project for item workflows', async () => {
        const res = await createWorkflow({ project_id: null });
        expect(res.statusCode).toBe(400);
    });

    it('lists the shipped templates with valid graphs', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/workflows/templates' });
        const ids = (res.json() as Array<{ id: string }>).map((t) => t.id).sort();
        expect(ids).toEqual(['ai-readiness', 'dev', 'planning', 'qa']);
    });
});

describe('workflow runs over HTTP', () => {
    it('starts a run on an item, shows its steps, and stops it', async () => {
        const wf = (await createWorkflow()).json();
        const start = await app.inject({ method: 'POST', url: `/api/workflows/${wf.id}/runs`, payload: { item_id: 'ATL-1' } });
        expect(start.statusCode).toBe(202);
        const runId = start.json().run_id as string;

        const detail = await app.inject({ method: 'GET', url: `/api/workflow-runs/${runId}` });
        expect(detail.json()).toMatchObject({ status: 'running', workflow_name: 'Dev', item_title: 'Epic', current_node_id: 'coder' });
        expect(detail.json().steps).toHaveLength(1);

        const itemRuns = await app.inject({ method: 'GET', url: '/api/items/ATL-1/workflow-runs' });
        expect(itemRuns.json()).toHaveLength(1);

        const again = await app.inject({ method: 'POST', url: `/api/workflows/${wf.id}/runs`, payload: { item_id: 'ATL-1' } });
        expect(again.statusCode).toBe(409);

        const stopped = await app.inject({ method: 'POST', url: `/api/workflow-runs/${runId}/stop` });
        expect(stopped.json()).toMatchObject({ status: 'cancelled' });

        const resume = await app.inject({ method: 'POST', url: `/api/workflow-runs/${runId}/resume` });
        expect(resume.statusCode).toBe(409);
    });

    it('returns 400 when an item workflow is started without an item', async () => {
        const wf = (await createWorkflow()).json();
        const res = await app.inject({ method: 'POST', url: `/api/workflows/${wf.id}/runs`, payload: {} });
        expect(res.statusCode).toBe(400);
    });

    it('locks item status and assignee while a run is working it', async () => {
        const wf = (await createWorkflow()).json();
        await app.inject({ method: 'POST', url: `/api/workflows/${wf.id}/runs`, payload: { item_id: 'ATL-1' } });

        const status = await app.inject({ method: 'PATCH', url: '/api/epics/ATL-1/status', payload: { status: 'done' } });
        expect(status.statusCode).toBe(409);
        const assign = await app.inject({ method: 'PATCH', url: '/api/epics/ATL-1/assign', payload: { assignee_agent_id: null } });
        expect(assign.statusCode).toBe(409);
        // Field edits (e.g. an agent writing spec_md) stay allowed.
        const fields = await app.inject({ method: 'PATCH', url: '/api/epics/ATL-1', payload: { title: 'Epic renamed' } });
        expect(fields.statusCode).toBe(200);
    });

    it('deleting a workflow step run cancels its workflow run', async () => {
        const wf = (await createWorkflow()).json();
        const runId = (await app.inject({ method: 'POST', url: `/api/workflows/${wf.id}/runs`, payload: { item_id: 'ATL-1' } })).json().run_id;
        const step = await testDb.selectFrom('agent_runs').select('id').where('workflow_run_id', '=', runId).executeTakeFirstOrThrow();

        const del = await app.inject({ method: 'DELETE', url: `/api/run/${step.id}` });
        expect(del.statusCode).toBe(204);
        const run = await testDb.selectFrom('workflow_runs').select('status').where('id', '=', runId).executeTakeFirstOrThrow();
        expect(run.status).toBe('cancelled');
        const item = await testDb.selectFrom('items').select('status').where('id', '=', 'ATL-1').executeTakeFirstOrThrow();
        expect(item.status).toBe('waiting_for_info');
    });

    it('stopping a workflow step through /api/run stops its workflow run', async () => {
        const wf = (await createWorkflow()).json();
        const runId = (await app.inject({ method: 'POST', url: `/api/workflows/${wf.id}/runs`, payload: { item_id: 'ATL-1' } })).json().run_id;
        const step = await testDb.selectFrom('agent_runs').select('id').where('workflow_run_id', '=', runId).executeTakeFirstOrThrow();

        await app.inject({ method: 'POST', url: `/api/run/${step.id}/stop` });
        const run = await testDb.selectFrom('workflow_runs').select('status').where('id', '=', runId).executeTakeFirstOrThrow();
        expect(run.status).toBe('cancelled');
    });

    it('queues an item for a workflow and refuses a workflow from another project', async () => {
        const wf = (await createWorkflow()).json();
        const set = await app.inject({ method: 'PUT', url: '/api/items/ATL-1/workflow', payload: { workflow_id: wf.id } });
        expect(set.statusCode).toBe(204);
        const epic = await app.inject({ method: 'GET', url: '/api/epics/ATL-1' });
        expect(epic.json().workflow_id).toBe(wf.id);

        await insertProject('p2', 'OTH', { git_path: '/tmp/repo2' });
        const other = (await createWorkflow({ project_id: 'p2', name: 'Other' })).json();
        const refused = await app.inject({ method: 'PUT', url: '/api/items/ATL-1/workflow', payload: { workflow_id: other.id } });
        expect(refused.statusCode).toBe(400);
    });
});
