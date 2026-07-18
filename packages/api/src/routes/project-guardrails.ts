import type { FastifyInstance } from 'fastify';
import { projectGuardrailsService } from '../services/projectGuardrails.js';
import {
    CreateProjectGuardrailSchema,
    UpdateProjectGuardrailSchema,
    ToggleProjectGuardrailSchema,
} from '@atlas/shared';
import { db } from '../db/kysely-client.js';
import { requireMcpToken } from '../plugins/mcp-auth.js';

async function projectExists(projectId: string): Promise<boolean> {
    const row = await db
        .selectFrom('projects')
        .select('id')
        .where('id', '=', projectId)
        .executeTakeFirst();
    return Boolean(row);
}

export async function projectGuardrailsRoutes(app: FastifyInstance) {
    app.get('/api/projects/:projectId/guardrails', async (req, reply) => {
        const { projectId } = req.params as { projectId: string };
        if (!(await projectExists(projectId)))
            return reply.status(404).send({ error: 'Project not found' });
        return reply.send(await projectGuardrailsService.list(projectId));
    });

    app.post('/api/projects/:projectId/guardrails', { preHandler: requireMcpToken }, async (req, reply) => {
        const { projectId } = req.params as { projectId: string };
        if (!(await projectExists(projectId)))
            return reply.status(404).send({ error: 'Project not found' });
        const body = CreateProjectGuardrailSchema.parse(req.body);
        return reply.status(201).send(await projectGuardrailsService.create(projectId, body));
    });

    app.patch('/api/projects/:projectId/guardrails/:id', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { projectId: string; id: string };
        if (!(await projectGuardrailsService.get(id)))
            return reply.status(404).send({ error: 'Rule not found' });
        const body = UpdateProjectGuardrailSchema.parse(req.body);
        return reply.send(await projectGuardrailsService.update(id, body));
    });

    app.patch('/api/projects/:projectId/guardrails/:id/toggle', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { projectId: string; id: string };
        if (!(await projectGuardrailsService.get(id)))
            return reply.status(404).send({ error: 'Rule not found' });
        const { enabled } = ToggleProjectGuardrailSchema.parse(req.body);
        return reply.send(await projectGuardrailsService.toggle(id, enabled));
    });

    app.delete('/api/projects/:projectId/guardrails/:id', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { projectId: string; id: string };
        if (!(await projectGuardrailsService.get(id)))
            return reply.status(404).send({ error: 'Rule not found' });
        await projectGuardrailsService.delete(id);
        return reply.status(204).send();
    });
}
