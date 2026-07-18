import type { FastifyInstance } from 'fastify';
import { storiesService } from '../services/stories.js';
import { subTasksService, subBugsService } from '../services/issues.js';
import { issueFullService } from '../services/issue-full.js';
import { resetRoundsForIssue } from '../services/agent-rounds.js';
import {
    CreateStorySchema,
    CreateSubTaskSchema,
    CreateSubBugSchema,
    UpdateStorySchema,
    UpdateSubTaskSchema,
    UpdateSubBugSchema,
    TransitionStatusSchema,
    AssignSchema,
    assertChildrenDone,
    ChildrenNotDoneError,
} from '@atlas/shared';
import type { IssueStatus, SubTaskStatus } from '@atlas/shared';
import { db } from '../db/kysely-client.js';
import { requireMcpToken } from '../plugins/mcp-auth.js';

// P16 — Reusable closure-rule helper. Loads `items` rows whose `parent_id`
// matches and runs `assertChildrenDone()` from the shared status machine.
// Returns `null` on success or the fastify-reply payload on violation, so
// the route handler can return early. Mirrors the inline block in
// `epics.ts` but stays per-file so the import surface is small.
async function blockIfOpenChildren(
    parentId: string,
    targetStatus: IssueStatus | SubTaskStatus,
): Promise<{ status: number; body: unknown } | null> {
    if (targetStatus !== 'done') return null;
    const children = await db
        .selectFrom('items')
        .select(['id', 'status'])
        .where('parent_id', '=', parentId)
        .execute();
    try {
        assertChildrenDone(parentId, targetStatus as IssueStatus, children as never);
        return null;
    } catch (err) {
        if (err instanceof ChildrenNotDoneError) {
            return {
                status: 422,
                body: {
                    error: err.message,
                    kind: 'conflict',
                    details: {
                        parent_id: err.parentId,
                        open_children: err.openChildren,
                    },
                },
            };
        }
        /* v8 ignore next */
        throw err;
    }
}

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

export async function storiesRoutes(app: FastifyInstance) {
    app.get('/api/stories', async (req, reply) => {
        const { epic_id, project_id } = req.query as { epic_id?: string; project_id?: string };
        return reply.send(await storiesService.list({ epicId: epic_id, projectId: project_id }));
    });

    app.get('/api/stories/:id', async (req, reply) => {
        const { id } = req.params as { id: string };
        const story = await storiesService.get(id);
        if (!story) return reply.status(404).send({ error: 'Story not found' });
        return reply.send(story);
    });

    app.get('/api/stories/:id/full', async (req, reply) => {
        const { id } = req.params as { id: string };
        const full = await issueFullService.story(id);
        if (!full) return reply.status(404).send({ error: 'Story not found' });
        return reply.send(full);
    });

    app.post('/api/stories', { preHandler: requireMcpToken }, async (req, reply) => {
        const body = CreateStorySchema.parse(req.body);
        return reply.status(201).send(await storiesService.create(body));
    });

    app.patch('/api/stories/:id', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        if (!(await storiesService.get(id))) return reply.status(404).send({ error: 'Story not found' });
        const body = UpdateStorySchema.parse(req.body);
        return reply.send(await storiesService.update(id, body));
    });

    app.patch('/api/stories/:id/status', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        const { status, requested_by_agent_id } = TransitionStatusSchema.parse(req.body);
        const q = req.query as { override?: string };
        const override = q.override === '1' || q.override === 'true';
        // P16 — stories can have sub_task / sub_bug children. Block done when any are open.
        if (!override) {
            const blocked = await blockIfOpenChildren(id, status as IssueStatus);
            if (blocked) return reply.status(blocked.status).send(blocked.body);
        }
        try {
            return reply.send(
                await storiesService.transition(
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

    app.patch('/api/stories/:id/assign', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        const { assignee_agent_id, requested_by_agent_id } = AssignSchema.parse(req.body);
        if (!(await storiesService.get(id))) return reply.status(404).send({ error: 'Story not found' });
        if (assignee_agent_id) {
            const err = await assertActiveAgent(assignee_agent_id);
            if (err) return reply.status(400).send({ error: err });
        }
        return reply.send(
            await storiesService.assign(id, assignee_agent_id, requested_by_agent_id ?? null),
        );
    });

    app.post('/api/stories/:id/reset-rounds', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        if (!(await storiesService.get(id))) return reply.status(404).send({ error: 'Story not found' });
        await resetRoundsForIssue(id);
        return reply.status(204).send();
    });

    app.delete('/api/stories/:id', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        if (!(await storiesService.get(id))) return reply.status(404).send({ error: 'Story not found' });
        await storiesService.delete(id);
        return reply.status(204).send();
    });

    // Sub-tasks
    app.get('/api/sub-tasks', async (_req, reply) => reply.send(await subTasksService.listAll()));

    app.get('/api/stories/:id/sub-tasks', async (req, reply) => {
        const { id } = req.params as { id: string };
        return reply.send(await subTasksService.list(id));
    });

    app.get('/api/sub-tasks/:id/full', async (req, reply) => {
        const { id } = req.params as { id: string };
        const full = await issueFullService.subTask(id);
        if (!full) return reply.status(404).send({ error: 'Sub-task not found' });
        return reply.send(full);
    });

    app.post('/api/stories/:id/sub-tasks', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        const body = CreateSubTaskSchema.parse({ ...(req.body as object), story_id: id });
        return reply.status(201).send(await subTasksService.create(body));
    });

    app.patch('/api/sub-tasks/:id', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        if (!(await subTasksService.get(id)))
            return reply.status(404).send({ error: 'Sub-task not found' });
        const body = UpdateSubTaskSchema.parse(req.body);
        return reply.send(await subTasksService.update(id, body));
    });

    app.patch('/api/sub-tasks/:id/status', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        const { status, requested_by_agent_id } = TransitionStatusSchema.parse(req.body);
        const q = req.query as { override?: string };
        const override = q.override === '1' || q.override === 'true';
        // P16 — sub_tasks are leaves but the helper is a no-op when there
        // are no children, so we keep the call for symmetry. The check only
        // fires for `status === 'done'`.
        if (!override) {
            const blocked = await blockIfOpenChildren(id, status as IssueStatus);
            if (blocked) return reply.status(blocked.status).send(blocked.body);
        }
        try {
            return reply.send(
                await subTasksService.transition(
                    id,
                    status as SubTaskStatus,
                    override,
                    requested_by_agent_id ?? null,
                ),
            );
        } catch (err) {
            return reply.status(400).send({ error: (err as Error).message });
        }
    });

    app.patch('/api/sub-tasks/:id/assign', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        const { assignee_agent_id, requested_by_agent_id } = AssignSchema.parse(req.body);
        return reply.send(
            await subTasksService.assign(id, assignee_agent_id, requested_by_agent_id ?? null),
        );
    });

    app.post('/api/sub-tasks/:id/reset-rounds', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        if (!(await subTasksService.get(id)))
            return reply.status(404).send({ error: 'Sub-task not found' });
        await resetRoundsForIssue(id);
        return reply.status(204).send();
    });

    app.delete('/api/sub-tasks/:id', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        await subTasksService.delete(id);
        return reply.status(204).send();
    });

    // Sub-bugs
    app.get('/api/sub-bugs', async (_req, reply) => reply.send(await subBugsService.listAll()));

    app.get('/api/stories/:id/sub-bugs', async (req, reply) => {
        const { id } = req.params as { id: string };
        return reply.send(await subBugsService.list(id));
    });

    app.get('/api/sub-bugs/:id/full', async (req, reply) => {
        const { id } = req.params as { id: string };
        const full = await issueFullService.subBug(id);
        if (!full) return reply.status(404).send({ error: 'Sub-bug not found' });
        return reply.send(full);
    });

    app.post('/api/stories/:id/sub-bugs', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        const body = CreateSubBugSchema.parse({ ...(req.body as object), story_id: id });
        return reply.status(201).send(await subBugsService.create(body));
    });

    app.patch('/api/sub-bugs/:id', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        if (!(await subBugsService.get(id)))
            return reply.status(404).send({ error: 'Sub-bug not found' });
        const body = UpdateSubBugSchema.parse(req.body);
        return reply.send(await subBugsService.update(id, body));
    });

    app.patch('/api/sub-bugs/:id/status', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        const { status, requested_by_agent_id } = TransitionStatusSchema.parse(req.body);
        const q = req.query as { override?: string };
        const override = q.override === '1' || q.override === 'true';
        if (!override) {
            const blocked = await blockIfOpenChildren(id, status as IssueStatus);
            if (blocked) return reply.status(blocked.status).send(blocked.body);
        }
        try {
            return reply.send(
                await subBugsService.transition(
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

    app.patch('/api/sub-bugs/:id/assign', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        const { assignee_agent_id, requested_by_agent_id } = AssignSchema.parse(req.body);
        return reply.send(
            await subBugsService.assign(id, assignee_agent_id, requested_by_agent_id ?? null),
        );
    });

    app.post('/api/sub-bugs/:id/reset-rounds', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        if (!(await subBugsService.get(id)))
            return reply.status(404).send({ error: 'Sub-bug not found' });
        await resetRoundsForIssue(id);
        return reply.status(204).send();
    });

    app.delete('/api/sub-bugs/:id', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        await subBugsService.delete(id);
        return reply.status(204).send();
    });
}
