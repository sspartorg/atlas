import type { FastifyInstance } from 'fastify';
import { epicsService } from '../services/epics.js';
import { issueFullService } from '../services/issue-full.js';
import { resetRoundsForIssue } from '../services/agent-rounds.js';
import {
    CreateEpicSchema,
    UpdateEpicSchema,
    TransitionStatusSchema,
    AssignSchema,
    assertChildrenDone,
    ChildrenNotDoneError,
} from '@atlas/shared';
import type { IssueStatus } from '@atlas/shared';
import { db } from '../db/kysely-client.js';
import { requireMcpToken } from '../plugins/mcp-auth.js';

export async function epicsRoutes(app: FastifyInstance) {
    app.get('/api/epics', async (req, reply) => {
        const { project_id, include_archived } = req.query as {
            project_id?: string;
            include_archived?: string;
        };
        const includeArchived = include_archived === 'true' || include_archived === '1';
        return reply.send(await epicsService.list(project_id, includeArchived));
    });

    app.get('/api/epics/stats', async (_req, reply) => {
        return reply.send({
            total: await epicsService.count(),
            awaiting_pickup: await epicsService.awaitingPickupCount(),
        });
    });

    app.get('/api/epics/:id', async (req, reply) => {
        const { id } = req.params as { id: string };
        const epic = await epicsService.get(id);
        if (!epic) return reply.status(404).send({ error: 'Epic not found' });
        return reply.send(epic);
    });

    app.get('/api/epics/:id/full', async (req, reply) => {
        const { id } = req.params as { id: string };
        const full = await issueFullService.epic(id);
        if (!full) return reply.status(404).send({ error: 'Epic not found' });
        return reply.send(full);
    });

    app.post('/api/epics', { preHandler: requireMcpToken }, async (req, reply) => {
        const body = CreateEpicSchema.parse(req.body);
        return reply.status(201).send(await epicsService.create(body));
    });

    app.patch('/api/epics/:id', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        if (!(await epicsService.get(id))) return reply.status(404).send({ error: 'Epic not found' });
        const body = UpdateEpicSchema.parse(req.body);
        return reply.send(await epicsService.update(id, body));
    });

    app.patch('/api/epics/:id/status', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        const { status, requested_by_agent_id } = TransitionStatusSchema.parse(req.body);
        const q = req.query as { override?: string };
        // Accept both legacy `?override=1` (used by existing UI) and the
        // P16-spec `?override=true` so the MCP path can use either form.
        const override = q.override === '1' || q.override === 'true';
        // P16 — block parent → done when any child item isn't done.
        // Children are the rows whose `parent_id` is this epic's id
        // (stories and bugs both hang off the epic via `parent_id`).
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
                await epicsService.transition(
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

    app.patch('/api/epics/:id/assign', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        const { assignee_agent_id, requested_by_agent_id } = AssignSchema.parse(req.body);
        if (!(await epicsService.get(id))) return reply.status(404).send({ error: 'Epic not found' });
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
            await epicsService.assign(id, assignee_agent_id, requested_by_agent_id ?? null),
        );
    });

    app.post('/api/epics/:id/reset-rounds', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        if (!(await epicsService.get(id))) return reply.status(404).send({ error: 'Epic not found' });
        await resetRoundsForIssue(id);
        return reply.status(204).send();
    });

    app.delete('/api/epics/:id', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        if (!(await epicsService.get(id))) return reply.status(404).send({ error: 'Epic not found' });
        await epicsService.delete(id);
        return reply.status(204).send();
    });
}
