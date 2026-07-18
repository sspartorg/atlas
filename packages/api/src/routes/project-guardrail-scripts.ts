import type { FastifyInstance } from 'fastify';
import {
    CreateProjectGuardrailScriptSchema,
    UpdateProjectGuardrailScriptSchema,
} from '@atlas/shared';
import {
    projectGuardrailScriptsService,
    ProjectGuardrailScriptIdConflictError,
} from '../services/projectGuardrailScripts.js';
import { db } from '../db/kysely-client.js';
import { requireMcpToken } from '../plugins/mcp-auth.js';

// Phase 1.5b — Per-project guardrail SCRIPTS routes.

async function projectExists(projectId: string): Promise<boolean> {
    const row = await db
        .selectFrom('projects')
        .select('id')
        .where('id', '=', projectId)
        .executeTakeFirst();
    return Boolean(row);
}

export async function projectGuardrailScriptsRoutes(app: FastifyInstance) {
    app.get('/api/projects/:projectId/guardrail-scripts', async (req, reply) => {
        const { projectId } = req.params as { projectId: string };
        if (!(await projectExists(projectId)))
            return reply.status(404).send({ error: 'Project not found' });
        return reply.send(await projectGuardrailScriptsService.list(projectId));
    });

    app.post(
        '/api/projects/:projectId/guardrail-scripts',
        { preHandler: requireMcpToken },
        async (req, reply) => {
            const { projectId } = req.params as { projectId: string };
            if (!(await projectExists(projectId)))
                return reply.status(404).send({ error: 'Project not found' });
            const body = CreateProjectGuardrailScriptSchema.parse(req.body);
            try {
                return reply
                    .status(201)
                    .send(await projectGuardrailScriptsService.create(projectId, body));
            } catch (err) {
                if (err instanceof ProjectGuardrailScriptIdConflictError) {
                    return reply.status(409).send({ error: err.message });
                }
                /* v8 ignore next */
                throw err;
            }
        },
    );

    app.patch(
        '/api/projects/:projectId/guardrail-scripts/:id',
        { preHandler: requireMcpToken },
        async (req, reply) => {
            const { id } = req.params as { projectId: string; id: string };
            if (!(await projectGuardrailScriptsService.get(id)))
                return reply.status(404).send({ error: 'Script not found' });
            const body = UpdateProjectGuardrailScriptSchema.parse(req.body);
            return reply.send(await projectGuardrailScriptsService.update(id, body));
        },
    );

    app.delete(
        '/api/projects/:projectId/guardrail-scripts/:id',
        { preHandler: requireMcpToken },
        async (req, reply) => {
            const { id } = req.params as { projectId: string; id: string };
            if (!(await projectGuardrailScriptsService.get(id)))
                return reply.status(404).send({ error: 'Script not found' });
            await projectGuardrailScriptsService.remove(id);
            return reply.status(204).send();
        },
    );
}
