import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
    CreateWorkflowFromTemplateSchema,
    CreateWorkflowSchema,
    SetItemWorkflowSchema,
    StartWorkflowRunSchema,
    UpdateWorkflowSchema,
    UsePublishedWorkflowSchema,
} from '@atlas/shared';
import { requireMcpToken } from '../plugins/mcp-auth.js';
import { ApiError } from '../utils/errors.js';
import { workflowsService } from '../services/workflows.js';
import { agentTestsService } from '../services/agent-tests.js';
import {
    WorkflowStartError,
    cancelWorkflowRun,
    resumeWorkflowRun,
    startWorkflowRun,
} from '../services/workflow-engine.js';
import { DependenciesNotReadyError } from '../services/dependency-guard.js';
import { listGateResultsForRun } from '../services/run-gate-results.js';
import {
    exportTemplateBundle,
    exportWorkflowBundle,
    getPublishedWorkflow,
    importPublishedWorkflow,
    importWorkflowBundle,
    upgradeFromPublished,
    listPublishedWorkflows,
    publishWorkflow,
    publishedWorkflowZip,
    unpackWorkflowBundle,
    unpublishWorkflow,
} from '../services/workflow-bundle.js';

function parseBody<T>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: unknown } } }, body: unknown): T {
    const parsed = schema.safeParse(body ?? {});
    if (!parsed.success) throw new ApiError('validation_error', 'Invalid request body', 400, { issues: parsed.error.issues });
    return parsed.data;
}

function mapStartError(err: unknown): never {
    if (err instanceof WorkflowStartError) {
        const status = err.code === 'not_found' ? 404 : err.code === 'conflict' ? 409 : 400;
        throw new ApiError(err.code === 'invalid' ? 'validation_error' : err.code, err.message, status);
    }
    if (err instanceof DependenciesNotReadyError) {
        throw new ApiError('conflict', 'This item depends on items that are not done yet', 409, { blockers: err.blockers });
    }
    throw err;
}

function sendZip(reply: FastifyReply, zip: { filename: string; data: Buffer }) {
    return reply
        .header('Content-Type', 'application/zip')
        .header('Content-Disposition', `attachment; filename="${zip.filename}"`)
        .send(zip.data);
}

/** A fixture pointed at a workflow. Same shape as an agent test's, plus a suite tag. */
const WorkflowTestBodySchema = z
    .object({
        project_id: z.string().min(1),
        repo_id: z.string().min(1).nullable().optional(),
        suite: z.string().trim().min(1).max(120).nullable().optional(),
        name: z.string().trim().min(1).max(200),
        item_template: z.object({
            issue_type: z.enum(['task', 'sub_task']),
            title: z.string().trim().min(1).max(500),
            description: z.string().max(20_000).optional(),
            acceptance_criteria: z.string().max(20_000).optional(),
            labels: z.array(z.string().min(1).max(40)).max(20).optional(),
        }),
        expectations: z.record(z.string(), z.unknown()).optional(),
    })
    .strict();

export async function workflowsRoutes(app: FastifyInstance) {
    app.get('/api/workflows', async (req, reply) => {
        const { project_id } = req.query as { project_id?: string };
        return reply.send(await workflowsService.list(project_id));
    });

    app.get('/api/workflows/templates', async (_req, reply) => reply.send(workflowsService.listTemplates()));

    app.get('/api/workflows/templates/:id/export', async (req, reply) => {
        const { id } = req.params as { id: string };
        return sendZip(reply, await exportTemplateBundle(id));
    });

    app.get('/api/workflows/:id/export', async (req, reply) => {
        const { id } = req.params as { id: string };
        return sendZip(reply, await exportWorkflowBundle(id));
    });

    // Multipart (file + `project_id` field) from the browser, or a raw
    // application/zip body with `?project_id=` for curl / MCP — same as
    // POST /api/agents/import.
    app.post('/api/workflows/import', { preHandler: requireMcpToken }, async (req, reply) => {
        const query = req.query as { project_id?: string };
        let data: Buffer;
        let projectId = query.project_id;
        if ((req.headers['content-type'] ?? '').includes('multipart/form-data')) {
            const part = await (req as unknown as {
                file: () => Promise<{ toBuffer: () => Promise<Buffer>; fields?: Record<string, unknown> } | null>;
            }).file();
            if (!part) throw new ApiError('validation_error', 'No file uploaded', 400);
            data = await part.toBuffer();
            // Only fields sent before the file part are visible here.
            projectId = (part.fields?.['project_id'] as { value?: string } | undefined)?.value || projectId;
        } else if (req.body instanceof Buffer) {
            data = req.body;
        } else {
            throw new ApiError('validation_error', 'Expected an application/zip body or multipart/form-data with a file part', 400);
        }
        if (!projectId) throw new ApiError('validation_error', 'Pick the project to import into (project_id)', 400);
        const bundle = await unpackWorkflowBundle(data);
        return reply.status(201).send(await importWorkflowBundle(bundle, projectId));
    });

    app.post('/api/workflows/:id/publish', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        const entry = await publishWorkflow(id);
        return reply.status(entry.published_at === entry.updated_at ? 201 : 200).send(entry);
    });

    app.get('/api/marketplace/workflows', async (_req, reply) => reply.send(await listPublishedWorkflows()));

    app.get('/api/marketplace/workflows/:id', async (req, reply) => {
        const { id } = req.params as { id: string };
        return reply.send(await getPublishedWorkflow(id));
    });

    app.get('/api/marketplace/workflows/:id/export', async (req, reply) => {
        const { id } = req.params as { id: string };
        return sendZip(reply, await publishedWorkflowZip(id));
    });

    app.post('/api/marketplace/workflows/:id/use', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        const { project_id } = parseBody(UsePublishedWorkflowSchema, req.body);
        return reply.status(201).send(await importPublishedWorkflow(id, project_id));
    });

    app.delete('/api/marketplace/workflows/:id', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        await unpublishWorkflow(id);
        return reply.status(204).send();
    });

    app.post('/api/workflows', { preHandler: requireMcpToken }, async (req, reply) => {
        const input = parseBody(CreateWorkflowSchema, req.body);
        return reply.status(201).send(await workflowsService.create(input));
    });

    app.post('/api/workflows/from-template', { preHandler: requireMcpToken }, async (req, reply) => {
        const { template_id, project_id } = parseBody(CreateWorkflowFromTemplateSchema, req.body);
        return reply.status(201).send(await workflowsService.createFromTemplate(template_id, project_id));
    });

    // Pull the workflow's upstream again. Explicit on purpose — this replaces
    // the graph, so it is the Owner's call, exactly as accepting an agent
    // upgrade is. The automatic path (import) checks for local edits first.
    app.post('/api/workflows/:id/upgrade', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        const wf = await workflowsService.get(id);
        if (!wf) return reply.status(404).send({ error: 'Workflow not found' });
        if (!wf.marketplace_source_id) {
            return reply.status(400).send({ error: 'This workflow did not come from the marketplace' });
        }
        // A template id names a shipped template; anything else is a published
        // entry, whose graph lives in the stored bundle rather than on disk.
        const isTemplate = workflowsService.listTemplates().some((t) => t.id === wf.marketplace_source_id);
        return reply.send(
            isTemplate
                ? await workflowsService.upgradeFromTemplate(id)
                : await upgradeFromPublished(id)
        );
    });

    app.get('/api/workflows/:id', async (req, reply) => {
        const { id } = req.params as { id: string };
        const wf = await workflowsService.get(id);
        if (!wf) throw new ApiError('not_found', 'Workflow not found', 404);
        return reply.send(wf);
    });

    app.patch('/api/workflows/:id', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        const patch = parseBody(UpdateWorkflowSchema, req.body);
        return reply.send(await workflowsService.update(id, patch));
    });

    app.delete('/api/workflows/:id', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        await workflowsService.remove(id);
        return reply.status(204).send();
    });

    app.get('/api/workflows/:id/runs', async (req, reply) => {
        const { id } = req.params as { id: string };
        return reply.send(await workflowsService.listRuns(id));
    });

    app.post('/api/workflows/:id/runs', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        const { item_id, from_subtasks } = parseBody(StartWorkflowRunSchema, req.body);
        try {
            const runId = await startWorkflowRun(id, item_id ?? null, undefined, { fromSubtasks: from_subtasks ?? false });
            return reply.status(202).send({ run_id: runId });
        } catch (err) {
            mapStartError(err);
        }
    });

    app.get('/api/workflow-runs/:id', async (req, reply) => {
        const { id } = req.params as { id: string };
        const run = await workflowsService.getRun(id);
        if (!run) throw new ApiError('not_found', 'Workflow run not found', 404);
        return reply.send(run);
    });

    // The gate verdicts for a run. Gate nodes spawn no agent, so they have no
    // `agent_runs` row and were invisible everywhere except the eval scorer —
    // which is how a `skipped` gate passed for a verified one on the golden set.
    app.get('/api/workflow-runs/:id/gate-results', async (req, reply) => {
        const { id } = req.params as { id: string };
        if (!(await workflowsService.getRun(id))) throw new ApiError('not_found', 'Workflow run not found', 404);
        return reply.send(await listGateResultsForRun(id));
    });

    app.post('/api/workflow-runs/:id/stop', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        if (!(await workflowsService.getRun(id))) throw new ApiError('not_found', 'Workflow run not found', 404);
        await cancelWorkflowRun(id);
        return reply.send(await workflowsService.getRun(id));
    });

    // ── Workflow evals (ADR 0023 phase 3, ATL-173) ────────────────────────
    //
    // The same fixture primitive as an agent test, run through the whole chain
    // instead of one agent. `evals/` does this from a terminal today: 12
    // fixtures, 257 dispatches, $129.30 and 327 minutes on the v4 set, with the
    // scorecard in a gitignored markdown file.

    app.get('/api/workflows/:id/tests', async (req, reply) => {
        const { id } = req.params as { id: string };
        return reply.send(await agentTestsService.listForWorkflow(id));
    });

    app.post('/api/workflows/:id/tests', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        const workflow = await workflowsService.get(id);
        if (!workflow) return reply.status(404).send({ error: 'Workflow not found' });
        // A sub-task workflow runs only from a Task workflow's Sub-tasks step,
        // so a fixture pointed at one could never start. Refused at CREATE
        // rather than discovered at run time, an hour and several dollars in.
        if (workflow.input_kind === 'sub_task') {
            throw new ApiError(
                'validation_error',
                "A sub-task workflow runs only from a Task workflow's Sub-tasks step, so it cannot be evaluated on its own",
                400,
            );
        }
        const body = WorkflowTestBodySchema.parse(req.body ?? {});
        return reply.status(201).send(
            await agentTestsService.create({
                workflow_id: id,
                project_id: body.project_id,
                repo_id: body.repo_id ?? null,
                suite: body.suite ?? null,
                name: body.name,
                item_template: body.item_template,
                ...(body.expectations ? { expectations: body.expectations } : {}),
            }),
        );
    });

    /**
     * Fixtures of one workflow that are parked, waiting on an answer.
     *
     * ATL-173 names this as the thing that decides whether running a set from
     * the UI beats the CLI: every fixture parks once at PO Writer's brainstorm
     * by design, that is ~12 substantive answers across a set, and it is the
     * slowest part of the whole exercise. It also carries every park reason
     * together, because two fixtures once escalated on the same defect and the
     * two rulings would have contradicted each other — each run only ever sees
     * its own branch.
     */
    app.get('/api/workflows/:id/evals/parked', async (req, reply) => {
        const { id } = req.params as { id: string };
        const tests = await agentTestsService.listForWorkflow(id);
        return reply.send(await agentTestsService.parked(tests.map((t) => t.id)));
    });

    app.post('/api/workflow-runs/:id/resume', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        if (!(await workflowsService.getRun(id))) throw new ApiError('not_found', 'Workflow run not found', 404);
        try {
            await resumeWorkflowRun(id);
        } catch (err) {
            mapStartError(err);
        }
        return reply.send(await workflowsService.getRun(id));
    });

    app.get('/api/items/:id/workflow-runs', async (req, reply) => {
        const { id } = req.params as { id: string };
        return reply.send(await workflowsService.listRunsForItem(id));
    });

    app.put('/api/items/:id/workflow', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        const { workflow_id } = parseBody(SetItemWorkflowSchema, req.body);
        await workflowsService.setItemWorkflow(id, workflow_id);
        return reply.status(204).send();
    });
}
