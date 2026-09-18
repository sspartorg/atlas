import type { FastifyInstance } from 'fastify';
import { subTasksService } from '../services/sub-tasks.js';
import { tasksService } from '../services/tasks.js';
import { issueFullService } from '../services/issue-full.js';
import {
    CreateSubTaskSchema,
    UpdateSubTaskSchema,
    TransitionStatusSchema,
    AssignSchema,
} from '@atlas/shared';
import { db } from '../db/kysely-client.js';
import { requireMcpToken } from '../plugins/mcp-auth.js';
import { headerAgentId } from '../services/request-actor.js';

async function assertActiveAgent(agentId: string): Promise<string | null> {
    const w = await db
        .selectFrom('agents')
        .select('status')
        .where('id', '=', agentId)
        .executeTakeFirst();
    if (!w) return 'Agent not found';
    if (w.status !== 'active') return 'Agent is not active';
    return null;
}

export async function subTasksRoutes(app: FastifyInstance) {
    app.get('/api/sub-tasks', async (_req, reply) => reply.send(await subTasksService.listAll()));

    app.get('/api/tasks/:id/sub-tasks', async (req, reply) => {
        const { id } = req.params as { id: string };
        return reply.send(await subTasksService.list(id));
    });

    app.post('/api/tasks/:id/sub-tasks', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        if (!(await tasksService.get(id))) return reply.status(404).send({ error: 'Task not found' });
        const actor = await headerAgentId(req.headers);
        // The path wins over any body `task_id`; the header agent is the
        // default reporter, an explicit body value wins.
        const body = CreateSubTaskSchema.parse({
            reporter_agent_id: actor,
            ...(req.body as object),
            task_id: id,
        });
        return reply.status(201).send(await subTasksService.create(body, actor));
    });

    app.get('/api/sub-tasks/:id', async (req, reply) => {
        const { id } = req.params as { id: string };
        const subTask = await subTasksService.get(id);
        if (!subTask) return reply.status(404).send({ error: 'Sub-task not found' });
        return reply.send(subTask);
    });

    app.get('/api/sub-tasks/:id/full', async (req, reply) => {
        const { id } = req.params as { id: string };
        const full = await issueFullService.subTask(id);
        if (!full) return reply.status(404).send({ error: 'Sub-task not found' });
        return reply.send(full);
    });

    app.patch('/api/sub-tasks/:id', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        if (!(await subTasksService.get(id)))
            return reply.status(404).send({ error: 'Sub-task not found' });
        const body = UpdateSubTaskSchema.parse(req.body);
        return reply.send(await subTasksService.update(id, body, await headerAgentId(req.headers)));
    });

    app.patch('/api/sub-tasks/:id/status', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        const { status, requested_by_agent_id } = TransitionStatusSchema.parse(req.body);
        const q = req.query as { override?: string };
        const override = q.override === '1' || q.override === 'true';
        try {
            return reply.send(
                await subTasksService.transition(id, status, override, requested_by_agent_id ?? null),
            );
        } catch (err) {
            return reply.status(400).send({ error: (err as Error).message });
        }
    });

    app.patch('/api/sub-tasks/:id/assign', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        const { assignee_agent_id, requested_by_agent_id } = AssignSchema.parse(req.body);
        if (!(await subTasksService.get(id)))
            return reply.status(404).send({ error: 'Sub-task not found' });
        if (assignee_agent_id) {
            const err = await assertActiveAgent(assignee_agent_id);
            if (err) return reply.status(400).send({ error: err });
        }
        return reply.send(
            await subTasksService.assign(id, assignee_agent_id, requested_by_agent_id ?? null),
        );
    });

    app.delete('/api/sub-tasks/:id', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        if (!(await subTasksService.get(id)))
            return reply.status(404).send({ error: 'Sub-task not found' });
        await subTasksService.delete(id);
        return reply.status(204).send();
    });
}
