import type { FastifyInstance } from 'fastify';
import { bugsService } from '../services/issues.js';
import { issueFullService } from '../services/issue-full.js';
import { resetRoundsForIssue } from '../services/agent-rounds.js';
import {
    CreateBugSchema,
    UpdateBugSchema,
    TransitionStatusSchema,
    AssignSchema,
} from '@atlas/shared';
import type { IssueStatus } from '@atlas/shared';
import { requireMcpToken } from '../plugins/mcp-auth.js';

export async function bugsRoutes(app: FastifyInstance) {
    app.get('/api/bugs', async (req, reply) => {
        const { epic_id, project_id } = req.query as { epic_id?: string; project_id?: string };
        return reply.send(await bugsService.list({ epicId: epic_id, projectId: project_id }));
    });

    app.get('/api/bugs/:id', async (req, reply) => {
        const { id } = req.params as { id: string };
        const bug = await bugsService.get(id);
        if (!bug) return reply.status(404).send({ error: 'Bug not found' });
        return reply.send(bug);
    });

    app.get('/api/bugs/:id/full', async (req, reply) => {
        const { id } = req.params as { id: string };
        const full = await issueFullService.bug(id);
        if (!full) return reply.status(404).send({ error: 'Bug not found' });
        return reply.send(full);
    });

    app.post('/api/bugs', { preHandler: requireMcpToken }, async (req, reply) => {
        const body = CreateBugSchema.parse(req.body);
        return reply.status(201).send(await bugsService.create(body));
    });

    app.patch('/api/bugs/:id', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        if (!(await bugsService.get(id))) return reply.status(404).send({ error: 'Bug not found' });
        const body = UpdateBugSchema.parse(req.body);
        return reply.send(await bugsService.update(id, body));
    });

    app.patch('/api/bugs/:id/status', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        const { status, requested_by_agent_id } = TransitionStatusSchema.parse(req.body);
        const q = req.query as { override?: string };
        // P16 — bugs are leaves (no children) so the closure rule doesn't
        // trip here, but accept both override forms for consistency with
        // epics/stories so the MCP path is uniform.
        const override = q.override === '1' || q.override === 'true';
        try {
            return reply.send(
                await bugsService.transition(
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

    app.patch('/api/bugs/:id/assign', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        const { assignee_agent_id, requested_by_agent_id } = AssignSchema.parse(req.body);
        if (!(await bugsService.get(id))) return reply.status(404).send({ error: 'Bug not found' });
        return reply.send(
            await bugsService.assign(id, assignee_agent_id, requested_by_agent_id ?? null),
        );
    });

    app.post('/api/bugs/:id/reset-rounds', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        if (!(await bugsService.get(id))) return reply.status(404).send({ error: 'Bug not found' });
        await resetRoundsForIssue(id);
        return reply.status(204).send();
    });

    app.delete('/api/bugs/:id', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        if (!(await bugsService.get(id))) return reply.status(404).send({ error: 'Bug not found' });
        await bugsService.delete(id);
        return reply.status(204).send();
    });
}
