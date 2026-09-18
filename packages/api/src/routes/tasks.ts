import type { FastifyInstance } from 'fastify';
import { tasksService } from '../services/tasks.js';
import { issueFullService } from '../services/issue-full.js';
import {
    CreateTaskSchema,
    UpdateTaskSchema,
    TransitionStatusSchema,
    ReorderSubTasksSchema,
    AssignSchema,
    assertChildrenDone,
    ChildrenNotDoneError,
} from '@atlas/shared';
import type { IssueStatus } from '@atlas/shared';
import { db } from '../db/kysely-client.js';
import { requireMcpToken } from '../plugins/mcp-auth.js';
import { headerAgentId } from '../services/request-actor.js';

export async function tasksRoutes(app: FastifyInstance) {
    app.get('/api/tasks', async (req, reply) => {
        const { project_id, include_archived } = req.query as {
            project_id?: string;
            include_archived?: string;
        };
        const includeArchived = include_archived === 'true' || include_archived === '1';
        return reply.send(await tasksService.list(project_id, includeArchived));
    });

    app.get('/api/tasks/stats', async (_req, reply) => {
        return reply.send({
            total: await tasksService.count(),
            awaiting_pickup: await tasksService.awaitingPickupCount(),
        });
    });

    app.get('/api/tasks/:id', async (req, reply) => {
        const { id } = req.params as { id: string };
        const task = await tasksService.get(id);
        if (!task) return reply.status(404).send({ error: 'Task not found' });
        return reply.send(task);
    });

    app.get('/api/tasks/:id/full', async (req, reply) => {
        const { id } = req.params as { id: string };
        const full = await issueFullService.task(id);
        if (!full) return reply.status(404).send({ error: 'Task not found' });
        return reply.send(full);
    });

    app.post('/api/tasks', { preHandler: requireMcpToken }, async (req, reply) => {
        const actor = await headerAgentId(req.headers);
        // The header agent is the default reporter; an explicit body value wins.
        const body = CreateTaskSchema.parse({ reporter_agent_id: actor, ...(req.body as object) });
        return reply.status(201).send(await tasksService.create(body, actor));
    });

    app.patch('/api/tasks/:id', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        if (!(await tasksService.get(id))) return reply.status(404).send({ error: 'Task not found' });
        const body = UpdateTaskSchema.parse(req.body);
        return reply.send(await tasksService.update(id, body, await headerAgentId(req.headers)));
    });

    app.patch('/api/tasks/:id/status', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        const { status, requested_by_agent_id, close_sub_tasks } = TransitionStatusSchema.parse(req.body);
        const q = req.query as { override?: string };
        // Accept both legacy `?override=1` (used by existing UI) and the
        // P16-spec `?override=true` so the MCP path can use either form.
        const override = q.override === '1' || q.override === 'true';
        if (!(await tasksService.get(id))) return reply.status(404).send({ error: 'Task not found' });
        // Closing a verified Task closes the sub-tasks it was reviewed with.
        if (status === 'done' && close_sub_tasks) {
            await tasksService.closeReviewedSubtasks(id, 'closed_with_task', requested_by_agent_id ?? null);
        }
        // P16 — block parent → done when any child item isn't done.
        // Children are the task's sub-tasks (their `parent_id`).
        if (status === 'done' && !override) {
            const children = await db
                .selectFrom('items')
                .select(['id', 'status'])
                .where('parent_id', '=', id)
                .execute();
            try {
                assertChildrenDone(id, status as IssueStatus, children as never);
            } catch (err) {
                if (err instanceof ChildrenNotDoneError) {
                    return reply.status(422).send({
                        error: err.message,
                        kind: 'conflict',
                        details: {
                            parent_id: err.parentId,
                            open_children: err.openChildren,
                        },
                    });
                }
                /* v8 ignore next 2 */
                // Only ChildrenNotDoneError is thrown by assertChildrenDone — this arm is defensive
                throw err;
            }
        }
        try {
            return reply.send(
                await tasksService.transition(
                    id,
                    status as IssueStatus,
                    override,
                    requested_by_agent_id ?? null,
                ),
            );
        } catch (err) {
            return reply.status(400).send({ error: (err as Error).message });
        }
    });

    app.put('/api/tasks/:id/sub-tasks/order', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        if (!(await tasksService.get(id))) return reply.status(404).send({ error: 'Task not found' });
        const { ids } = ReorderSubTasksSchema.parse(req.body);
        try {
            await tasksService.reorderSubtasks(id, ids);
        } catch (err) {
            return reply.status(400).send({ error: (err as Error).message });
        }
        return reply.status(204).send();
    });

    app.patch('/api/tasks/:id/assign', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        const { assignee_agent_id, requested_by_agent_id } = AssignSchema.parse(req.body);
        if (!(await tasksService.get(id))) return reply.status(404).send({ error: 'Task not found' });
        if (assignee_agent_id) {
            const w = await db
                .selectFrom('agents')
                .select('status')
                .where('id', '=', assignee_agent_id)
                .executeTakeFirst();
            if (!w) return reply.status(400).send({ error: 'Agent not found' });
            if (w.status !== 'active')
                return reply.status(400).send({ error: 'Agent is not active' });
        }
        return reply.send(
            await tasksService.assign(id, assignee_agent_id, requested_by_agent_id ?? null),
        );
    });

    app.delete('/api/tasks/:id', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        if (!(await tasksService.get(id))) return reply.status(404).send({ error: 'Task not found' });
        await tasksService.delete(id);
        return reply.status(204).send();
    });
}
