import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import JSZip from 'jszip';
import type { IPublishedWorkflow, IPublishedWorkflowDetail, IWorkflow, IWorkflowGraph, IWorkflowImportResult } from '@atlas/shared';

vi.mock('../routes/events.js', () => ({ eventsRoutes: async () => undefined, broadcastSSE: vi.fn() }));

import { buildApp } from '../server.js';
import { unpackWorkflowBundle } from '../services/workflow-bundle.js';
import { closeTestDb, testDb, truncateAll } from '../../tests/_pg-db.js';
import { insertAgent, insertProject } from '../../tests/_items.js';

let app: FastifyInstance;

const pos = { x: 0, y: 0 };
const buildGraph = {
    nodes: [
        { id: 'start', type: 'start', position: pos },
        { id: 'coder', type: 'agent', agent_id: 'agent-coder', position: pos },
        { id: 'review', type: 'agent', agent_id: 'agent-code-reviewer', position: pos },
        { id: 'end', type: 'end', position: pos },
    ],
    edges: [
        { id: 'e1', source: 'start', target: 'coder', kind: 'pass' },
        { id: 'e2', source: 'coder', target: 'review', kind: 'pass' },
        { id: 'e3', source: 'review', target: 'end', kind: 'pass' },
        { id: 'e4', source: 'review', target: 'coder', kind: 'fail' },
    ],
};
const taskGraph = (subId: string) => ({
    nodes: [
        { id: 'start', type: 'start', position: pos },
        { id: 'coder', type: 'agent', agent_id: 'agent-coder', position: pos },
        { id: 'build', type: 'subtasks', sub_workflow_id: subId, label: 'dev', position: pos },
        { id: 'end', type: 'end', position: pos },
    ],
    edges: [
        { id: 'e1', source: 'start', target: 'coder', kind: 'pass' },
        { id: 'e2', source: 'coder', target: 'build', kind: 'pass' },
        { id: 'e3', source: 'build', target: 'end', kind: 'pass' },
    ],
});

async function post(payload: Record<string, unknown>): Promise<IWorkflow> {
    const res = await app.inject({ method: 'POST', url: '/api/workflows', payload });
    expect(res.statusCode).toBe(201);
    return res.json();
}

/** Project p1 with a Task workflow "Delivery" whose Sub-tasks step runs "Build". */
async function seedDelivery(): Promise<{ main: IWorkflow; sub: IWorkflow }> {
    const sub = await post({ name: 'Build', project_id: 'p1', input_kind: 'sub_task', graph: buildGraph });
    const main = await post({
        name: 'Delivery',
        project_id: 'p1',
        trigger: 'schedule',
        schedule_preset: 'daily',
        schedule_time_of_day: '07:15',
        max_loops: 5,
        graph: taskGraph(sub.id),
    });
    return { main, sub };
}

async function exportZip(url: string): Promise<Buffer> {
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    return res.rawPayload;
}

function importZip(zip: Buffer, projectId = 'p2') {
    return app.inject({
        method: 'POST',
        url: `/api/workflows/import?project_id=${projectId}`,
        headers: { 'content-type': 'application/zip' },
        payload: zip,
    });
}

async function editZip(zip: Buffer, edit: (z: JSZip) => void | Promise<void>): Promise<Buffer> {
    const z = await JSZip.loadAsync(zip);
    await edit(z);
    return z.generateAsync({ type: 'nodebuffer' });
}

/** Fresh DB with two projects and the model registry row, but no agents. */
async function resetToEmptyInstall(): Promise<void> {
    await truncateAll();
    await insertProject('p1', 'ATL');
    await insertProject('p2', 'TWO');
    await testDb
        .insertInto('cli_models')
        .values({ id: 'test-cli-claude-claude-opus-4-7', cli: 'claude', model_name: 'claude-opus-4-7', note: null, sort_order: 0 })
        .onConflict((oc) => oc.columns(['cli', 'model_name']).doNothing())
        .execute();
}

beforeEach(async () => {
    await truncateAll();
    await insertProject('p1', 'ATL');
    await insertProject('p2', 'TWO');
    await insertAgent({ id: 'agent-coder', name: 'Coder', prompt_md: 'You write code.' });
    await insertAgent({ id: 'agent-code-reviewer', name: 'Code Reviewer', status: 'inactive' });
    await testDb.insertInto('agent_checklists').values({ agent_id: 'agent-coder', label: 'Tests pass', sort_order: 0, required: true }).execute();
    if (!app) {
        app = await buildApp({ logger: false });
        await app.ready();
    }
});

afterAll(async () => {
    if (app) await app.close();
    await closeTestDb();
});

describe('GET /api/workflows/:id/export', () => {
    it('packs the workflow, its sub-workflow and every agent, with no local ids', async () => {
        const { main } = await seedDelivery();
        const zipBuf = await exportZip(`/api/workflows/${main.id}/export`);
        const zip = await JSZip.loadAsync(zipBuf);
        const files = Object.keys(zip.files).filter((f) => !zip.files[f]?.dir).sort();
        expect(files).toEqual([
            'agents/agent-code-reviewer/checklists.json',
            'agents/agent-code-reviewer/manifest.json',
            'agents/agent-code-reviewer/memory.md',
            'agents/agent-code-reviewer/prompt.md',
            'agents/agent-coder/checklists.json',
            'agents/agent-coder/manifest.json',
            'agents/agent-coder/memory.md',
            'agents/agent-coder/prompt.md',
            'workflow.json',
            'workflows/build.json',
        ]);
        const wf = JSON.parse(await zip.file('workflow.json')!.async('string'));
        expect(wf).not.toHaveProperty('id');
        expect(wf).not.toHaveProperty('project_id');
        expect(wf).toMatchObject({
            format_version: 1,
            name: 'Delivery',
            trigger: 'schedule',
            schedule_preset: 'daily',
            schedule_time_of_day: '07:15',
            max_loops: 5,
        });
        expect(wf.graph.nodes.find((n: { id: string }) => n.id === 'build').sub_workflow_id).toBe('build');

        const bundle = await unpackWorkflowBundle(zipBuf);
        expect(bundle.workflow.name).toBe('Delivery');
        expect([...bundle.sub_workflows.keys()]).toEqual(['build']);
        expect(bundle.sub_workflows.get('build')).toMatchObject({ name: 'Build', input_kind: 'sub_task', graph: buildGraph });
        expect(bundle.agents.get('agent-coder')).toMatchObject({
            prompt_md: 'You write code.',
            checklists: [{ label: 'Tests pass', sort_order: 0, required: true }],
        });
    });

    it('404s for an unknown workflow', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/workflows/nope/export' });
        expect(res.statusCode).toBe(404);
    });
});

describe('POST /api/workflows/import', () => {
    it('imports into another project, reusing installed agents and remapping the sub-workflow', async () => {
        const { main } = await seedDelivery();
        const res = await importZip(await exportZip(`/api/workflows/${main.id}/export`));
        expect(res.statusCode).toBe(201);
        const result = res.json() as IWorkflowImportResult;
        expect(result.installed_agents).toEqual([]);
        expect(result.reused_agents.sort()).toEqual(['agent-code-reviewer', 'agent-coder']);
        expect(result.sub_workflows).toHaveLength(1);
        const sub = result.sub_workflows[0]!;
        expect(sub).toMatchObject({ name: 'Build', project_id: 'p2', input_kind: 'sub_task' });
        expect(result.workflow).toMatchObject({ name: 'Delivery', project_id: 'p2', trigger: 'schedule', cron_expr: '15 7 * * *', max_loops: 5 });
        expect(result.workflow.graph.nodes.find((n) => n.id === 'build')).toMatchObject({ sub_workflow_id: sub.id, label: 'dev' });
        // Reused agents stay as they were — even an inactive one.
        const reviewer = await testDb.selectFrom('agents').select('status').where('id', '=', 'agent-code-reviewer').executeTakeFirstOrThrow();
        expect(reviewer.status).toBe('inactive');
    });

    it('reads a bundle without format_version as format 1', async () => {
        const { main } = await seedDelivery();
        const zip = await editZip(await exportZip(`/api/workflows/${main.id}/export`), async (z) => {
            const { format_version: _dropped, ...wf } = JSON.parse(await z.file('workflow.json')!.async('string'));
            z.file('workflow.json', JSON.stringify(wf));
        });
        const res = await importZip(zip);
        expect(res.statusCode).toBe(201);
        expect((res.json() as IWorkflowImportResult).workflow.name).toBe('Delivery');
    });

    it('suffixes names already used in the project', async () => {
        const { main } = await seedDelivery();
        const zip = await exportZip(`/api/workflows/${main.id}/export`);
        const first = (await importZip(zip, 'p1')).json() as IWorkflowImportResult;
        expect(first.workflow.name).toBe('Delivery (imported)');
        expect(first.sub_workflows[0]?.name).toBe('Build (imported)');
        const second = (await importZip(zip, 'p1')).json() as IWorkflowImportResult;
        expect(second.workflow.name).toBe('Delivery (imported 2)');
        expect(second.sub_workflows[0]?.name).toBe('Build (imported 2)');
    });

    it('a scheduled workflow arrives paused so it does not start firing on its own', async () => {
        const { main } = await seedDelivery(); // trigger: schedule
        const zip = await exportZip(`/api/workflows/${main.id}/export`);
        const result = (await importZip(zip)).json() as IWorkflowImportResult;
        expect(result.workflow).toMatchObject({ trigger: 'schedule', status: 'inactive' });
        expect(result.sub_workflows[0]).toMatchObject({ status: 'active' });
    });

    it('installs missing agents from the bundle and activates them', async () => {
        const { main } = await seedDelivery();
        const zip = await exportZip(`/api/workflows/${main.id}/export`);
        await resetToEmptyInstall();

        const res = await importZip(zip);
        expect(res.statusCode).toBe(201);
        const result = res.json() as IWorkflowImportResult;
        expect(result.installed_agents.sort()).toEqual(['agent-code-reviewer', 'agent-coder']);
        expect(result.reused_agents).toEqual([]);
        const agents = await testDb.selectFrom('agents').select(['id', 'status', 'prompt_md']).orderBy('id').execute();
        expect(agents).toEqual([
            { id: 'agent-code-reviewer', status: 'active', prompt_md: '' },
            { id: 'agent-coder', status: 'active', prompt_md: 'You write code.' },
        ]);
        const checklists = await testDb.selectFrom('agent_checklists').select('label').where('agent_id', '=', 'agent-coder').execute();
        expect(checklists).toEqual([{ label: 'Tests pass' }]);
    });

    it('rolls back everything it created when a workflow fails validation', async () => {
        const { main } = await seedDelivery();
        // The sub-workflow now takes Tasks, so the main graph's Sub-tasks step rejects it.
        const zip = await editZip(await exportZip(`/api/workflows/${main.id}/export`), async (z) => {
            const sub = JSON.parse(await z.file('workflows/build.json')!.async('string'));
            z.file('workflows/build.json', JSON.stringify({ ...sub, input_kind: 'item' }));
        });
        await resetToEmptyInstall();

        const res = await importZip(zip);
        expect(res.statusCode).toBe(400);
        expect(res.json().error).toBe('Pick a sub-task workflow for this step');
        expect(await testDb.selectFrom('workflows').select('id').execute()).toEqual([]);
        expect(await testDb.selectFrom('agents').select('id').execute()).toEqual([]);
    });

    it('accepts multipart with a project_id field', async () => {
        const { main } = await seedDelivery();
        const zip = await exportZip(`/api/workflows/${main.id}/export`);
        const boundary = '----WorkflowBundle';
        const body = Buffer.concat([
            Buffer.from(
                `--${boundary}\r\nContent-Disposition: form-data; name="project_id"\r\n\r\np2\r\n` +
                    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="delivery.zip"\r\nContent-Type: application/zip\r\n\r\n`,
            ),
            zip,
            Buffer.from(`\r\n--${boundary}--`),
        ]);
        const res = await app.inject({
            method: 'POST',
            url: '/api/workflows/import',
            headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
            payload: body,
        });
        expect(res.statusCode).toBe(201);
        expect((res.json() as IWorkflowImportResult).workflow.project_id).toBe('p2');
    });

    describe('rejects bad input', () => {
        it('a body that is not a zip', async () => {
            const res = await importZip(Buffer.from('not a zip'));
            expect(res.statusCode).toBe(400);
            expect(res.json().error).toMatch(/^Workflow bundle: not a valid zip archive/);
        });

        it('a zip without workflow.json (e.g. an agent bundle)', async () => {
            const zip = await exportZip('/api/agents/agent-coder/export');
            const res = await importZip(zip);
            expect(res.statusCode).toBe(400);
            expect(res.json().error).toBe('Workflow bundle: missing workflow.json');
        });

        it('a workflow.json that fails the schema', async () => {
            const { main } = await seedDelivery();
            const zip = await editZip(await exportZip(`/api/workflows/${main.id}/export`), (z) => {
                z.file('workflow.json', JSON.stringify({ name: 'X', input_kind: 'weekly', graph: { nodes: [], edges: [] } }));
            });
            const res = await importZip(zip);
            expect(res.statusCode).toBe(400);
            expect(res.json().error).toMatch(/^Workflow bundle: workflow.json failed validation: input_kind/);
        });

        it('a missing sub-workflow or agent', async () => {
            const { main } = await seedDelivery();
            const zip = await exportZip(`/api/workflows/${main.id}/export`);
            const noSub = await editZip(zip, (z) => void z.remove('workflows/build.json'));
            expect((await importZip(noSub)).json().error).toBe('Workflow bundle: missing workflows/build.json');
            const noAgent = await editZip(zip, (z) => void z.remove('agents/agent-coder'));
            expect((await importZip(noAgent)).json().error).toBe('Workflow bundle: missing agents/agent-coder/manifest.json');
        });

        it('a malformed agent manifest', async () => {
            const { main } = await seedDelivery();
            const zip = await editZip(await exportZip(`/api/workflows/${main.id}/export`), (z) => {
                z.file('agents/agent-coder/manifest.json', '{"id":');
            });
            const res = await importZip(zip);
            expect(res.statusCode).toBe(400);
            expect(res.json().error).toMatch(/^Workflow bundle: agents\/agent-coder\/manifest.json is not valid JSON/);
        });

        it('a bundle from a newer Atlas, or a nonsense format_version', async () => {
            const { main } = await seedDelivery();
            const zip = await exportZip(`/api/workflows/${main.id}/export`);
            const setFormat = (format: unknown) =>
                editZip(zip, async (z) => {
                    const wf = JSON.parse(await z.file('workflow.json')!.async('string'));
                    z.file('workflow.json', JSON.stringify({ ...wf, format_version: format }));
                });
            const newer = await importZip(await setFormat(2));
            expect(newer.statusCode).toBe(400);
            expect(newer.json().error).toBe('Workflow bundle: made by a newer Atlas (format 2); update Atlas to import it');
            expect((await importZip(await setFormat('two'))).json().error).toBe('Workflow bundle: workflow.json has an invalid format_version');
        });

        it('no project, or an unknown one', async () => {
            const { main } = await seedDelivery();
            const zip = await exportZip(`/api/workflows/${main.id}/export`);
            const none = await app.inject({ method: 'POST', url: '/api/workflows/import', headers: { 'content-type': 'application/zip' }, payload: zip });
            expect(none.statusCode).toBe(400);
            expect((await importZip(zip, 'ghost')).statusCode).toBe(404);
        });
    });
});

describe('GET /api/workflows/templates/:id/export', () => {
    const DELIVERY_AGENTS = [
        'agent-po-writer',
        'agent-po-reviewer',
        'agent-architect',
        'agent-architect-reviewer',
        'agent-coder',
        'agent-code-reviewer',
        'agent-qa-writer',
        'agent-qa-reviewer',
        'agent-automation',
        'agent-automation-reviewer',
    ];

    async function seedCatalog(ids: string[]): Promise<void> {
        for (const [i, id] of ids.entries()) {
            await testDb
                .insertInto('marketplace_agents')
                .values({
                    id,
                    name: id,
                    category: 'software-dev',
                    cli: 'claude',
                    model: 'claude-opus-4-7',
                    framework: '',
                    prompt_md: `catalog ${id}`,
                    description: '',
                    designation: '',
                    accent_color: '#007AC9',
                    sort_order: i,
                    glyph: 'code',
                    role_id: null,
                    status: 'inactive',
                    kind_slug: 'custom',
                    settings_json: {},
                    version: 1,
                })
                .execute();
        }
    }

    it('bundles Delivery with its template sub-workflows and catalog agents, and imports it', async () => {
        await resetToEmptyInstall();
        await seedCatalog(DELIVERY_AGENTS);
        const zipBuf = await exportZip('/api/workflows/templates/delivery/export');
        const bundle = await unpackWorkflowBundle(zipBuf);
        expect([...bundle.sub_workflows.keys()].sort()).toEqual(['build-sub-task', 'test-sub-task']);
        expect([...bundle.agents.keys()].sort()).toEqual([...DELIVERY_AGENTS].sort());
        expect(bundle.agents.get('agent-coder')?.prompt_md).toBe('catalog agent-coder');

        const res = await importZip(zipBuf, 'p1');
        expect(res.statusCode).toBe(201);
        const result = res.json() as IWorkflowImportResult;
        expect(result.installed_agents.sort()).toEqual([...DELIVERY_AGENTS].sort());
        expect(result.sub_workflows.map((w) => w.name).sort()).toEqual(['Build sub-task', 'Test sub-task']);
        const subIds = new Set(result.sub_workflows.map((w) => w.id));
        const steps = result.workflow.graph.nodes.filter((n) => n.type === 'subtasks');
        expect(steps).toHaveLength(2);
        for (const s of steps) expect(subIds.has(s.sub_workflow_id ?? '')).toBe(true);
    });

    // The guarantee behind "imports never leave you with something missing":
    // after an import, nothing in any stored graph may still point at a
    // bundle-local ref, and every agent a graph names must exist.
    it('leaves no unresolved reference behind after importing Delivery', async () => {
        await resetToEmptyInstall();
        await seedCatalog(DELIVERY_AGENTS);
        const res = await importZip(await exportZip('/api/workflows/templates/delivery/export'), 'p1');
        expect(res.statusCode).toBe(201);

        const stored = await testDb.selectFrom('workflows').select(['id', 'graph']).execute();
        const agentIds = new Set((await testDb.selectFrom('agents').select('id').execute()).map((a) => a.id));
        const workflowIds = new Set(stored.map((w) => w.id));
        for (const wf of stored) {
            const graph = wf.graph as unknown as IWorkflowGraph;
            for (const node of graph.nodes) {
                if (node.agent_id) expect(agentIds.has(node.agent_id)).toBe(true);
                if (node.sub_workflow_id) {
                    // No `template:` or bundle-local ref may survive the import.
                    expect(node.sub_workflow_id.includes(':')).toBe(false);
                    expect(workflowIds.has(node.sub_workflow_id)).toBe(true);
                }
            }
        }
    });

    // Import used to say nothing about what it did to existing agents.
    it('reports what it installed, upgraded and left alone', async () => {
        await resetToEmptyInstall();
        await seedCatalog(DELIVERY_AGENTS);
        const zipBuf = await exportZip('/api/workflows/templates/delivery/export');
        const result = (await importZip(zipBuf, 'p1')).json() as IWorkflowImportResult;
        expect(result.agents.installed.sort()).toEqual([...DELIVERY_AGENTS].sort());
        expect(result.agents.upgraded).toEqual([]);
        expect(result.agents.skipped_edited).toEqual([]);
    });

    it('404s for an unknown template or a catalog agent that is missing', async () => {
        expect((await app.inject({ method: 'GET', url: '/api/workflows/templates/nope/export' })).statusCode).toBe(404);
        const res = await app.inject({ method: 'GET', url: '/api/workflows/templates/ai-readiness/export' });
        expect(res.statusCode).toBe(404);
        expect(res.json().error).toBe('Agent agent-ai-readiness does not exist');
    });
});

describe('published workflows (Marketplace)', () => {
    async function publish(workflowId: string) {
        return app.inject({ method: 'POST', url: `/api/workflows/${workflowId}/publish` });
    }

    // A published entry is overwritten in place on republish, so the version
    // counter is the only way a consumer can tell the entry moved. And what
    // gets imported must stay linked to it, or it can never be upgraded.
    // Using the same entry twice used to fork the whole tree — "Delivery
    // (imported)", "Test sub-task (imported 2)" — and every copy landed with a
    // NULL source id, so the duplicates were unupgradable as well as unwanted.
    it('reuses the same entry on a second use instead of forking duplicates', async () => {
        const { main } = await seedDelivery();
        const entry = (await publish(main.id)).json() as IPublishedWorkflow;
        const use = async () =>
            app.inject({ method: 'POST', url: `/api/marketplace/workflows/${entry.id}/use`, payload: { project_id: 'p2' } });

        const first = (await use()).json() as IWorkflowImportResult;
        const second = (await use()).json() as IWorkflowImportResult;

        // Same rows both times, not a second tree.
        expect(second.workflow.id).toBe(first.workflow.id);
        expect(second.workflows.created).toEqual([]);
        expect(second.sub_workflows.map((w) => w.id).sort()).toEqual(first.sub_workflows.map((w) => w.id).sort());

        const inProject = await testDb.selectFrom('workflows').select(['id', 'name', 'marketplace_source_id']).where('project_id', '=', 'p2').execute();
        expect(inProject).toHaveLength(first.sub_workflows.length + 1);
        // And every one of them is linked, so every one can be upgraded.
        expect(inProject.filter((w) => w.marketplace_source_id == null)).toEqual([]);
        expect(inProject.filter((w) => w.name.includes('(imported'))).toEqual([]);
    });

    // The explicit upgrade is the Owner's call and applies over local edits;
    // the automatic one (import) must not.
    it('flags an upgrade when the entry moves, and applies it on request', async () => {
        const { main } = await seedDelivery();
        const entry = (await publish(main.id)).json() as IPublishedWorkflow;
        const used = (await app.inject({ method: 'POST', url: `/api/marketplace/workflows/${entry.id}/use`, payload: { project_id: 'p2' } })).json() as IWorkflowImportResult;
        expect(used.workflow.upgrade_available).toBe(false);

        // Republish bumps the entry to v2.
        await publish(main.id);
        const before = (await app.inject({ method: 'GET', url: `/api/workflows/${used.workflow.id}` })).json() as IWorkflow;
        expect(before.upgrade_available).toBe(true);
        expect(before.marketplace_pulled_version).toBe(1);

        const upgraded = (await app.inject({ method: 'POST', url: `/api/workflows/${used.workflow.id}/upgrade` })).json() as IWorkflow;
        expect(upgraded.marketplace_pulled_version).toBe(2);
        expect(upgraded.upgrade_available).toBe(false);
    });

    // Regression: `marketplace_pulled_at` must come from the DB clock, the same
    // one the `workflows_set_updated_at` trigger writes `updated_at` with. A
    // JS-generated timestamp a few ms behind makes `updated_at > pulled_at` on a
    // row nobody has touched — it reads as "Owner edited" forever and silently
    // stops taking upgrades. Caught live: a re-import reported all three
    // workflows as skipped_edited when only one had been edited.
    it('treats an untouched workflow as untouched, so it still upgrades', async () => {
        const { main } = await seedDelivery();
        const entry = (await publish(main.id)).json() as IPublishedWorkflow;
        const use = async () =>
            (await app.inject({ method: 'POST', url: `/api/marketplace/workflows/${entry.id}/use`, payload: { project_id: 'p2' } })).json() as IWorkflowImportResult;

        const first = await use();
        await publish(main.id); // entry -> v2

        const second = await use();
        // Nothing was edited, so nothing may be skipped.
        expect(second.workflows.skipped_edited).toEqual([]);
        expect(second.workflows.upgraded).toContain(first.workflow.id);
        for (const sub of first.sub_workflows) expect(second.workflows.upgraded).toContain(sub.id);
    });

    // A workflow the Owner has edited is left exactly as they left it.
    it('leaves a locally edited workflow alone when the entry moves', async () => {
        const { main } = await seedDelivery();
        const entry = (await publish(main.id)).json() as IPublishedWorkflow;
        const used = (await app.inject({ method: 'POST', url: `/api/marketplace/workflows/${entry.id}/use`, payload: { project_id: 'p2' } })).json() as IWorkflowImportResult;

        await app.inject({ method: 'PATCH', url: `/api/workflows/${used.workflow.id}`, payload: { description: 'my own notes' } });
        await publish(main.id);

        const again = (await app.inject({ method: 'POST', url: `/api/marketplace/workflows/${entry.id}/use`, payload: { project_id: 'p2' } })).json() as IWorkflowImportResult;
        expect(again.workflows.skipped_edited).toContain(used.workflow.id);
        expect(again.workflows.upgraded).not.toContain(used.workflow.id);
        const after = (await app.inject({ method: 'GET', url: `/api/workflows/${used.workflow.id}` })).json() as IWorkflow;
        expect(after.description).toBe('my own notes');
        // Still offered, so nothing is lost.
        expect(after.upgrade_available).toBe(true);
    });

    it('bumps the version on republish, and links what it imports back to the entry', async () => {
        const { main } = await seedDelivery();
        const first = (await publish(main.id)).json() as IPublishedWorkflow;
        expect(first.version).toBe(1);
        const again = (await publish(main.id)).json() as IPublishedWorkflow;
        expect(again.version).toBe(2);
        expect(again.id).toBe(first.id);

        const used = await app.inject({ method: 'POST', url: `/api/marketplace/workflows/${first.id}/use`, payload: { project_id: 'p1' } });
        expect(used.statusCode).toBe(201);
        const imported = (used.json() as IWorkflowImportResult).workflow;
        expect(imported.marketplace_source_id).toBe(first.id);
        expect(imported.marketplace_pulled_version).toBe(2);
    });

    it('publishes the export bundle and reads the entry back from it', async () => {
        const { main } = await seedDelivery();
        const res = await publish(main.id);
        expect(res.statusCode).toBe(201);
        const entry = res.json() as IPublishedWorkflow;
        expect(entry).toMatchObject({
            name: 'Delivery',
            description: null,
            source_workflow_id: main.id,
            input_kind: 'item',
            trigger: 'schedule',
            push_code: true,
            raises_pr: true,
            push_to_default: false,
        });
        // Coder runs in Delivery, Code Reviewer only in its Build sub-workflow.
        expect(entry.agent_ids.sort()).toEqual(['agent-code-reviewer', 'agent-coder']);
        expect(entry.updated_at).toBe(entry.published_at);

        const row = await testDb.selectFrom('published_workflows').select('bundle').executeTakeFirstOrThrow();
        const stored = await JSZip.loadAsync(row.bundle);
        const exported = await JSZip.loadAsync(await exportZip(`/api/workflows/${main.id}/export`));
        expect(Object.keys(stored.files).sort()).toEqual(Object.keys(exported.files).sort());
        expect(await stored.file('workflow.json')!.async('string')).toBe(await exported.file('workflow.json')!.async('string'));
    });

    it('publishing again replaces the entry', async () => {
        const { main } = await seedDelivery();
        const first = (await publish(main.id)).json() as IPublishedWorkflow;
        await app.inject({ method: 'PATCH', url: `/api/workflows/${main.id}`, payload: { name: 'Delivery v2', description: 'Now better' } });
        const res = await publish(main.id);
        expect(res.statusCode).toBe(200);
        const second = res.json() as IPublishedWorkflow;
        expect(second).toMatchObject({ id: first.id, name: 'Delivery v2', description: 'Now better', published_at: first.published_at });
        expect(second.updated_at > first.updated_at).toBe(true);
        expect(await testDb.selectFrom('published_workflows').select('id').execute()).toHaveLength(1);
    });

    it('lists entries newest first and shows one with its graph and sub-workflows', async () => {
        const { main, sub } = await seedDelivery();
        const delivery = (await publish(main.id)).json() as IPublishedWorkflow;
        const build = (await publish(sub.id)).json() as IPublishedWorkflow;

        const list = await app.inject({ method: 'GET', url: '/api/marketplace/workflows' });
        expect(list.statusCode).toBe(200);
        expect((list.json() as IPublishedWorkflow[]).map((e) => e.name)).toEqual(['Build', 'Delivery']);
        expect((list.json() as IPublishedWorkflow[])[0]).toEqual(build);

        const res = await app.inject({ method: 'GET', url: `/api/marketplace/workflows/${delivery.id}` });
        expect(res.statusCode).toBe(200);
        const detail = res.json() as IPublishedWorkflowDetail;
        expect(detail).toMatchObject({ ...delivery, sub_workflows: [{ ref: 'build', name: 'Build' }] });
        expect(detail.graph.nodes.find((n) => n.id === 'build')).toMatchObject({ type: 'subtasks', sub_workflow_id: 'build' });
    });

    it('exports the stored zip', async () => {
        const { main } = await seedDelivery();
        const entry = (await publish(main.id)).json() as IPublishedWorkflow;
        const res = await app.inject({ method: 'GET', url: `/api/marketplace/workflows/${entry.id}/export` });
        expect(res.statusCode).toBe(200);
        expect(res.headers['content-disposition']).toBe('attachment; filename="delivery.zip"');
        const row = await testDb.selectFrom('published_workflows').select('bundle').executeTakeFirstOrThrow();
        expect(res.rawPayload.equals(row.bundle)).toBe(true);
    });

    it('uses an entry in a project through the bundle import', async () => {
        const { main } = await seedDelivery();
        const entry = (await publish(main.id)).json() as IPublishedWorkflow;
        const res = await app.inject({ method: 'POST', url: `/api/marketplace/workflows/${entry.id}/use`, payload: { project_id: 'p2' } });
        expect(res.statusCode).toBe(201);
        const result = res.json() as IWorkflowImportResult;
        expect(result.workflow).toMatchObject({ name: 'Delivery', project_id: 'p2' });
        expect(result.sub_workflows.map((w) => w.name)).toEqual(['Build']);
        expect(result.reused_agents.sort()).toEqual(['agent-code-reviewer', 'agent-coder']);

        const noProject = await app.inject({ method: 'POST', url: `/api/marketplace/workflows/${entry.id}/use`, payload: {} });
        expect(noProject.statusCode).toBe(400);
        const ghost = await app.inject({ method: 'POST', url: `/api/marketplace/workflows/${entry.id}/use`, payload: { project_id: 'ghost' } });
        expect(ghost.statusCode).toBe(404);
    });

    it('keeps an entry when its source workflow is deleted', async () => {
        const { main } = await seedDelivery();
        const entry = (await publish(main.id)).json() as IPublishedWorkflow;
        expect((await app.inject({ method: 'DELETE', url: `/api/workflows/${main.id}` })).statusCode).toBe(204);
        const res = await app.inject({ method: 'GET', url: `/api/marketplace/workflows/${entry.id}` });
        expect(res.json()).toMatchObject({ name: 'Delivery', source_workflow_id: null });
    });

    it('unpublishes', async () => {
        const { main } = await seedDelivery();
        const entry = (await publish(main.id)).json() as IPublishedWorkflow;
        expect((await app.inject({ method: 'DELETE', url: `/api/marketplace/workflows/${entry.id}` })).statusCode).toBe(204);
        expect((await app.inject({ method: 'GET', url: '/api/marketplace/workflows' })).json()).toEqual([]);
        expect((await app.inject({ method: 'DELETE', url: `/api/marketplace/workflows/${entry.id}` })).statusCode).toBe(404);
    });

    it('404s for an unknown workflow or entry', async () => {
        expect((await publish('nope')).statusCode).toBe(404);
        for (const url of ['/api/marketplace/workflows/nope', '/api/marketplace/workflows/nope/export']) {
            const res = await app.inject({ method: 'GET', url });
            expect(res.statusCode).toBe(404);
            expect(res.json().error).toBe('Published workflow not found');
        }
        const use = await app.inject({ method: 'POST', url: '/api/marketplace/workflows/nope/use', payload: { project_id: 'p1' } });
        expect(use.statusCode).toBe(404);
    });
});
