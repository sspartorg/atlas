import type { FastifyInstance } from 'fastify';
import {
    CreateWorkflowFromTemplateSchema,
    CreateWorkflowSchema,
    SetItemWorkflowSchema,
    StartWorkflowRunSchema,
    UpdateWorkflowSchema,
} from '@atlas/shared';
import { requireMcpToken } from '../plugins/mcp-auth.js';
import { ApiError } from '../utils/errors.js';
import { workflowsService } from '../services/workflows.js';
import {
    WorkflowStartError,
    cancelWorkflowRun,
    resumeWorkflowRun,
    startWorkflowRun,
} from '../services/workflow-engine.js';
import { DependenciesNotReadyError } from '../services/dependency-guard.js';

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

export async function workflowsRoutes(app: FastifyInstance) {
    app.get('/api/workflows', async (req, reply) => {
        const { project_id } = req.query as { project_id?: string };
        return reply.send(await workflowsService.list(project_id));
    });

    app.get('/api/workflows/templates', async (_req, reply) => reply.send(workflowsService.listTemplates()));

    app.post('/api/workflows', { preHandler: requireMcpToken }, async (req, reply) => {
        const input = parseBody(CreateWorkflowSchema, req.body);
        return reply.status(201).send(await workflowsService.create(input));
    });

    app.post('/api/workflows/from-template', { preHandler: requireMcpToken }, async (req, reply) => {
        const { template_id, project_id } = parseBody(CreateWorkflowFromTemplateSchema, req.body);
        return reply.status(201).send(await workflowsService.createFromTemplate(template_id, project_id));
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
        const { item_id } = parseBody(StartWorkflowRunSchema, req.body);
        try {
            const runId = await startWorkflowRun(id, item_id ?? null);
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

    app.post('/api/workflow-runs/:id/stop', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        if (!(await workflowsService.getRun(id))) throw new ApiError('not_found', 'Workflow run not found', 404);
        await cancelWorkflowRun(id);
        return reply.send(await workflowsService.getRun(id));
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
