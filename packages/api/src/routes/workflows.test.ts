import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as WorktreeOrchestratorModule from '../services/worktree-orchestrator.js';
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
    ...(await importOriginal<typeof WorktreeOrchestratorModule>()),
    ensureWorktree: vi.fn(async () => ({ path: '/tmp/wf', branch: 'atlas/wf/x', freshlyCreated: true })),
    pushWorktree: vi.fn(async () => ({ pushed: true, alreadyUpToDate: false })),
    openPullRequest: vi.fn(async () => ({ opened: false, url: null, alreadyExists: false })),
    cleanupWorktreeAfterPush: vi.fn(async () => ({ worktreeRemoved: true, branchDeleted: true, dbCleared: false, warnings: [] })),
}));

import { buildApp } from '../server.js';
import { closeTestDb, testDb, truncateAll } from '../../tests/_pg-db.js';
import { insertAgent, insertItem, insertProject } from '../../tests/_items.js';
import { workflowsService } from '../services/workflows.js';
import type { IWorkflow } from '@atlas/shared';

/** Delivery's full agent closure: its own graph's four plus Build's and Test's. */
// Derived, not restated: every agent the Delivery template needs, its
// sub-templates' included. The hardcoded list this replaces went stale the
// moment the graph grew a docs sub-workflow, four gate fixers and a release
// reviewer, and the symptom was an opaque 500 from create-from-template.
const DELIVERY_AGENT_IDS = workflowsService.templateAgentIds('delivery');
const templateVersion = (id: string): number =>
    workflowsService.listTemplates().find((t) => t.id === id)?.version ?? 0;

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
    await insertItem({ id: 'ATL-1', type: 'task', project_id: 'p1', title: 'Task', status: 'ready' });
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

    // An empty graph on a self-starting trigger would be picked up by the very
    // next dispatch tick and run every ready Task through nothing.
    it('creates a self-triggering workflow inactive until its graph has an agent', async () => {
        const emptyGraph = {
            nodes: [
                { id: 'start', type: 'start', position: { x: 0, y: 0 } },
                { id: 'end', type: 'end', position: { x: 200, y: 0 } },
            ],
            edges: [{ id: 'e1', source: 'start', target: 'end', kind: 'pass' }],
        };

        const blank = await createWorkflow({ graph: emptyGraph, trigger: 'item_ready' });
        expect(blank.statusCode).toBe(201);
        expect((blank.json() as IWorkflow).status).toBe('inactive');

        // A real graph self-starts as before…
        const withAgent = await createWorkflow({ trigger: 'item_ready' });
        expect((withAgent.json() as IWorkflow).status).toBe('active');

        // …as does an empty one that can only be started by hand.
        const manual = await createWorkflow({ graph: emptyGraph, trigger: 'manual' });
        expect((manual.json() as IWorkflow).status).toBe('active');

        // An explicit status still wins.
        const forced = await createWorkflow({
            graph: emptyGraph,
            trigger: 'item_ready',
            status: 'active',
        });
        expect((forced.json() as IWorkflow).status).toBe('active');
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
        expect(ids).toEqual(['ai-readiness', 'build', 'delivery', 'docs', 'test']);
    });

    it('creates Delivery with its Sub-tasks steps pointing at this project’s Build and Test sub-workflows', async () => {
        for (const a of DELIVERY_AGENT_IDS.filter((x) => x !== 'agent-coder')) await insertAgent({ id: a, status: 'active' });

        const res = await app.inject({ method: 'POST', url: '/api/workflows/from-template', payload: { template_id: 'delivery', project_id: 'p1' } });
        expect(res.statusCode).toBe(201);
        const all = (await app.inject({ method: 'GET', url: '/api/workflows' })).json() as Array<{ id: string; name: string; input_kind: string }>;
        const byName = (name: string) => all.find((w) => w.name === name);
        expect(byName('Build sub-task')).toMatchObject({ input_kind: 'sub_task' });
        expect(byName('Test sub-task')).toMatchObject({ input_kind: 'sub_task' });
        expect(byName('Docs sub-task')).toMatchObject({ input_kind: 'sub_task' });
        const steps = (res.json().graph.nodes as Array<{ id: string; type: string }>).filter((n) => n.type === 'subtasks');
        expect(steps).toEqual([
            // Unlabelled on purpose: it is the catch-all, so a sub-task that
            // arrives with no label is still built rather than stranding the run.
            expect.objectContaining({ id: 'build', sub_workflow_id: byName('Build sub-task')?.id }),
            expect.objectContaining({ id: 'test', sub_workflow_id: byName('Test sub-task')?.id, label: 'qa' }),
            expect.objectContaining({ id: 'docs', sub_workflow_id: byName('Docs sub-task')?.id, label: 'doc' }),
        ]);

        // Four gate steps, each naming a seeded guardrail script and each with
        // a fixer on its fail edge. They spawn no agent when green.
        const gates = (res.json().graph.nodes as Array<{ type: string; script_id?: string }>)
            .filter((n) => n.type === 'gate')
            .map((n) => n.script_id);
        expect(gates).toEqual(['gate-hygiene', 'gate-coverage', 'gate-perf', 'gate-visual']);
        expect(res.json().max_loops).toBe(templateVersion('delivery') > 1 ? 12 : 3);

        // A sub-workflow a Sub-tasks step uses can't be deleted from under it.
        const del = await app.inject({ method: 'DELETE', url: `/api/workflows/${byName('Build sub-task')?.id ?? ''}` });
        expect(del.statusCode).toBe(409);
    });

    // Every agent Delivery needs to RUN, not just the four its own graph
    // names — the other six live in the Build and Test sub-templates. Scanning
    // only the parent graph left them uninstalled whenever the sub-workflow
    // already existed, and the run then parked on a missing agent. Asserted
    // against the template files directly: this is a pure rollup, no DB.
    it('rolls up the sub-templates’ agents for a template', () => {
        const ids = workflowsService.templateAgentIds('delivery').sort();
        expect(ids).toEqual([
            'agent-architect',
            'agent-architect-reviewer',
            'agent-automation',
            'agent-automation-reviewer',
            'agent-code-reviewer',
            'agent-coder',
            'agent-coverage-fixer',
            'agent-doc-reviewer',
            'agent-doc-writer',
            'agent-hygiene-fixer',
            'agent-perf-fixer',
            'agent-po-reviewer',
            'agent-po-writer',
            'agent-qa-reviewer',
            'agent-qa-writer',
            'agent-release-reviewer',
            'agent-visual-reviewer',
        ]);
        // The parent graph alone names nine of those seventeen; the other eight
        // belong to the Build, Test and Docs sub-templates. Rolling them up is
        // what stops a stale sub-workflow leaving its agents uninstalled.
        expect(workflowsService.templateAgentIds('build').sort()).toEqual(['agent-code-reviewer', 'agent-coder']);
        // An id that names no template resolves to no agents rather than
        // throwing: callers feed this straight into dependency resolution, and
        // a throw there would fail an import over a stale reference.
        expect(workflowsService.templateAgentIds('no-such-template')).toEqual([]);
    });

    // Provenance is what makes a template-created workflow upgradable. Without
    // it the workflow was a detached copy the moment it was written, and an
    // improved upstream template could never reach it.
    it('records the template it came from, on the workflow and its sub-workflows', async () => {
        // `agent-coder` is already created by beforeEach.
        for (const a of DELIVERY_AGENT_IDS.filter((x) => x !== 'agent-coder')) await insertAgent({ id: a, status: 'active' });
        const res = await app.inject({ method: 'POST', url: '/api/workflows/from-template', payload: { template_id: 'delivery', project_id: 'p1' } });
        expect(res.statusCode).toBe(201);
        expect(res.json()).toMatchObject({ marketplace_source_id: 'delivery', marketplace_pulled_version: templateVersion('delivery') });

        const rows = await testDb.selectFrom('workflows').select(['name', 'marketplace_source_id', 'marketplace_pulled_version']).execute();
        const byName = (n: string) => rows.find((r) => r.name === n);
        expect(byName('Build sub-task')).toMatchObject({ marketplace_source_id: 'build', marketplace_pulled_version: templateVersion('build') });
        expect(byName('Test sub-task')).toMatchObject({ marketplace_source_id: 'test', marketplace_pulled_version: templateVersion('test') });
    });

    // A workflow that never came from the marketplace has no pull to compare
    // against, so it is never "edited since" — the import path must treat it as
    // a plain local workflow, not as one it may overwrite.
    it('treats a workflow with no pull as not edited since one', () => {
        const hand = { updated_at: '2026-09-22T10:00:00.000Z', marketplace_pulled_at: null } as unknown as IWorkflow;
        expect(workflowsService.isEditedSincePull(hand)).toBe(false);
    });

    // The other half of the upgrade route. `upgradeFromPublished` is covered in
    // workflow-bundle.test.ts; this is the template path, where the source is
    // a file on disk rather than a stored bundle.
    //
    // The explicit upgrade applies OVER local edits on purpose — asking for it
    // IS the decision, the same contract as accepting an agent upgrade. The
    // automatic path (import) is the one that checks for edits first, because
    // there nobody asked.
    it('re-applies the template over local edits and clears the upgrade flag', async () => {
        for (const a of DELIVERY_AGENT_IDS.filter((x) => x !== 'agent-coder')) await insertAgent({ id: a, status: 'active' });
        const made = (await app.inject({ method: 'POST', url: '/api/workflows/from-template', payload: { template_id: 'delivery', project_id: 'p1' } })).json() as IWorkflow;

        // Drift the pointer behind the shipped template and edit the copy, the
        // way a real workflow behind an improved upstream looks.
        await testDb.updateTable('workflows').set({ marketplace_pulled_version: 0, description: 'my own notes' }).where('id', '=', made.id).execute();
        const before = (await app.inject({ method: 'GET', url: `/api/workflows/${made.id}` })).json() as IWorkflow;
        expect(before.upgrade_available).toBe(true);
        expect(before.description).toBe('my own notes');

        const res = await app.inject({ method: 'POST', url: `/api/workflows/${made.id}/upgrade` });

        expect(res.statusCode).toBe(200);
        const after = res.json() as IWorkflow;
        expect(after.marketplace_pulled_version).toBe(templateVersion('delivery'));
        // The upgrade is the path that needs the loop budget — it is where an
        // existing workflow's graph grows failable steps while the row still
        // carries the old `max_loops`. Wiring it into create alone left every
        // install parking on a limit the new graph was never meant to hit.
        expect(after.max_loops).toBe(12);
        expect(after.upgrade_available).toBe(false);
        // The Owner asked, so the template's description won.
        expect(after.description).not.toBe('my own notes');
        // The name is the Owner's and is never overwritten by an upgrade.
        expect(after.name).toBe(made.name);
    });

    // Every early exit of the upgrade route, so a bad id fails loudly instead
    // of writing a graph from the wrong source onto a workflow.
    it('refuses to upgrade a workflow with no marketplace source, and 404s an unknown one', async () => {
        const hand = (await createWorkflow({ name: 'Hand-built' })).json() as IWorkflow;
        const noSource = await app.inject({ method: 'POST', url: `/api/workflows/${hand.id}/upgrade` });
        expect(noSource.statusCode).toBe(400);
        expect(noSource.json().error).toMatch(/did not come from the marketplace/);

        const missing = await app.inject({ method: 'POST', url: `/api/workflows/${randomUUID()}/upgrade` });
        expect(missing.statusCode).toBe(404);
    });

    // Sub-workflows used to be matched by NAME, so renaming one made the next
    // Delivery fork a second copy instead of reusing it — and any workflow that
    // happened to carry the template's name got adopted as a build step
    // whatever its graph contained.
    it('reuses a renamed sub-workflow through its provenance instead of forking', async () => {
        // `agent-coder` is already created by beforeEach.
        for (const a of DELIVERY_AGENT_IDS.filter((x) => x !== 'agent-coder')) await insertAgent({ id: a, status: 'active' });
        const first = await app.inject({ method: 'POST', url: '/api/workflows/from-template', payload: { template_id: 'delivery', project_id: 'p1' } });
        expect(first.statusCode).toBe(201);
        const build = await testDb.selectFrom('workflows').select('id').where('marketplace_source_id', '=', 'build').executeTakeFirstOrThrow();
        await testDb.updateTable('workflows').set({ name: 'Renamed by the Owner' }).where('id', '=', build.id).execute();

        const second = await app.inject({ method: 'POST', url: '/api/workflows/from-template', payload: { template_id: 'delivery', project_id: 'p1' } });
        expect(second.statusCode).toBe(201);
        const builds = await testDb.selectFrom('workflows').select('id').where('marketplace_source_id', '=', 'build').execute();
        expect(builds).toHaveLength(1);
        const step = (second.json().graph.nodes as Array<{ id: string; sub_workflow_id?: string }>).find((n) => n.id === 'build');
        expect(step?.sub_workflow_id).toBe(build.id);
    });

    it('rejects a Sub-tasks step that points at a Task workflow, and a scheduled sub-workflow', async () => {
        const task = (await createWorkflow()).json();
        const withStep = {
            nodes: [
                { id: 'start', type: 'start', position: { x: 0, y: 0 } },
                { id: 'subs', type: 'subtasks', sub_workflow_id: task.id, position: { x: 200, y: 0 } },
                { id: 'end', type: 'end', position: { x: 400, y: 0 } },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'subs', kind: 'pass' },
                { id: 'e2', source: 'subs', target: 'end', kind: 'pass' },
            ],
        };
        const res = await createWorkflow({ name: 'Delivery', graph: withStep });
        expect(res.statusCode).toBe(400);
        expect(res.json().details.graph_errors).toContainEqual({ node_id: 'subs', message: 'Pick a sub-task workflow for this step' });

        const scheduled = await createWorkflow({ input_kind: 'sub_task', trigger: 'schedule', schedule_preset: 'daily' });
        expect(scheduled.statusCode).toBe(400);
    });

    it('rejects push to the default branch together with a pull request', async () => {
        const res = await createWorkflow({ push_to_default: true, raises_pr: true });
        expect(res.statusCode).toBe(400);
        expect((await createWorkflow({ push_to_default: true })).json()).toMatchObject({ push_to_default: true, raises_pr: false });
    });

    // This used to assert the opposite: creating from a template flipped EVERY
    // agent its graph named to `active`, on the reasoning that an inactive
    // agent parks the run. But an agent that is already here and paused was
    // paused BY the Owner, and silently undoing that is worse than a workflow
    // that waits — they get no say and no notice. The run-parks problem is
    // handled where it belongs: the builder warns on the step, the import
    // reports `agents.paused`, and an agent the resolution INSTALLS is
    // activated on the way in (nobody paused that one — see
    // `services/marketplace.test.ts`, which has a catalog to install from).
    it('does not re-activate an agent the Owner paused', async () => {
        await insertAgent({ id: 'agent-ai-readiness', status: 'inactive' });
        const res = await app.inject({ method: 'POST', url: '/api/workflows/from-template', payload: { template_id: 'ai-readiness', project_id: 'p1' } });
        expect(res.statusCode).toBe(201);
        const agent = await testDb.selectFrom('agents').select('status').where('id', '=', 'agent-ai-readiness').executeTakeFirstOrThrow();
        expect(agent.status).toBe('inactive');
    });
});

describe('workflow runs over HTTP', () => {
    it('starts a run on an item, shows its steps, and stops it', async () => {
        const wf = (await createWorkflow()).json();
        const start = await app.inject({ method: 'POST', url: `/api/workflows/${wf.id}/runs`, payload: { item_id: 'ATL-1' } });
        expect(start.statusCode).toBe(202);
        const runId = start.json().run_id as string;

        const detail = await app.inject({ method: 'GET', url: `/api/workflow-runs/${runId}` });
        expect(detail.json()).toMatchObject({ status: 'running', workflow_name: 'Dev', item_title: 'Task', current_node_id: 'coder' });
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

        const status = await app.inject({ method: 'PATCH', url: '/api/tasks/ATL-1/status', payload: { status: 'done' } });
        expect(status.statusCode).toBe(409);
        const assign = await app.inject({ method: 'PATCH', url: '/api/tasks/ATL-1/assign', payload: { assignee_agent_id: null } });
        expect(assign.statusCode).toBe(409);
        // Field edits (e.g. an agent writing spec_md) stay allowed.
        const fields = await app.inject({ method: 'PATCH', url: '/api/tasks/ATL-1', payload: { title: 'Task renamed' } });
        expect(fields.statusCode).toBe(200);
    });

    it('locks a sub-task the same way while a run holds it', async () => {
        const wf = (await createWorkflow()).json();
        await insertItem({ id: 'ATL-2', type: 'sub_task', project_id: 'p1', parent_id: 'ATL-1', title: 'Sub' });
        await testDb
            .insertInto('workflow_runs')
            .values({ id: 'wr-sub', workflow_id: wf.id, item_id: 'ATL-2', project_id: 'p1', graph_snapshot: JSON.stringify(graph) })
            .execute();

        const status = await app.inject({ method: 'PATCH', url: '/api/sub-tasks/ATL-2/status', payload: { status: 'ready' } });
        expect(status.statusCode).toBe(409);
        const assign = await app.inject({ method: 'PATCH', url: '/api/sub-tasks/ATL-2/assign', payload: { assignee_agent_id: null } });
        expect(assign.statusCode).toBe(409);
        // The parent task is not held by that run.
        const parent = await app.inject({ method: 'PATCH', url: '/api/tasks/ATL-1/assign', payload: { assignee_agent_id: null } });
        expect(parent.statusCode).toBe(200);
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
        const task = await app.inject({ method: 'GET', url: '/api/tasks/ATL-1' });
        expect(task.json().workflow_id).toBe(wf.id);

        await insertProject('p2', 'OTH', { git_path: '/tmp/repo2' });
        const other = (await createWorkflow({ project_id: 'p2', name: 'Other' })).json();
        const refused = await app.inject({ method: 'PUT', url: '/api/items/ATL-1/workflow', payload: { workflow_id: other.id } });
        expect(refused.statusCode).toBe(400);
    });
});

describe('queueing and run cost', () => {
    it('assigning a workflow to a draft Task queues it as Ready; other statuses stay', async () => {
        const wf = (await createWorkflow()).json();
        await insertItem({ id: 'ATL-5', type: 'task', project_id: 'p1', title: 'Draft task', status: 'draft' });
        await insertItem({ id: 'ATL-6', type: 'task', project_id: 'p1', title: 'Waiting task', status: 'waiting_for_info' });
        for (const id of ['ATL-5', 'ATL-6']) {
            const res = await app.inject({ method: 'PUT', url: `/api/items/${id}/workflow`, payload: { workflow_id: wf.id } });
            expect(res.statusCode).toBe(204);
        }
        const status = async (id: string) =>
            (await testDb.selectFrom('items').select('status').where('id', '=', id).executeTakeFirstOrThrow()).status;
        expect(await status('ATL-5')).toBe('ready');
        expect(await status('ATL-6')).toBe('waiting_for_info');
    });

    it('a run’s cost includes its sub-task runs', async () => {
        const wf = (await createWorkflow()).json();
        const runId = (await app.inject({ method: 'POST', url: `/api/workflows/${wf.id}/runs`, payload: { item_id: 'ATL-1' } })).json().run_id as string;
        await insertItem({ id: 'ATL-9', type: 'sub_task', project_id: 'p1', parent_id: 'ATL-1', parent_type: 'task', title: 'Sub' });
        await testDb
            .insertInto('workflow_runs')
            .values({ id: 'child-1', workflow_id: wf.id, item_id: 'ATL-9', project_id: 'p1', graph_snapshot: JSON.stringify(graph), parent_workflow_run_id: runId, parent_node_id: 'coder', status: 'completed' })
            .execute();
        await testDb.updateTable('agent_runs').set({ total_cost_usd: 0.25 }).where('workflow_run_id', '=', runId).execute();
        await testDb
            .insertInto('agent_runs')
            .values({ id: randomUUID(), agent_id: 'agent-coder', item_id: 'ATL-9', status: 'completed', workflow_run_id: 'child-1', node_id: 'coder', total_cost_usd: 1.5 })
            .execute();

        const detail = (await app.inject({ method: 'GET', url: `/api/workflow-runs/${runId}` })).json();
        expect(detail.total_cost_usd).toBeCloseTo(1.75);
    });
});

