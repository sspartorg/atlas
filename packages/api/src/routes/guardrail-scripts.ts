import type { FastifyInstance } from 'fastify';
import { CreateGuardrailScriptSchema, UpdateGuardrailScriptSchema } from '@atlas/shared';
import {
    guardrailScriptsService,
    GuardrailScriptIdConflictError,
} from '../services/guardrailScripts.js';
import { requireMcpToken } from '../plugins/mcp-auth.js';

// Phase 1.5b — Org-wide guardrail SCRIPTS routes. Mirrors the shape
// of guardrails-routes.ts but for the independent scripts table.

export async function guardrailScriptsRoutes(app: FastifyInstance) {
    app.get('/api/guardrail-scripts', async (_req, reply) => {
        return reply.send(await guardrailScriptsService.list());
    });

    app.post('/api/guardrail-scripts', { preHandler: requireMcpToken }, async (req, reply) => {
        const body = CreateGuardrailScriptSchema.parse(req.body);
        try {
            return reply.status(201).send(await guardrailScriptsService.create(body));
        } catch (err) {
            if (err instanceof GuardrailScriptIdConflictError) {
                return reply.status(409).send({ error: err.message });
            }
            /* v8 ignore next */
            throw err;
        }
    });

    app.patch(
        '/api/guardrail-scripts/:id',
        { preHandler: requireMcpToken },
        async (req, reply) => {
            const { id } = req.params as { id: string };
            const body = UpdateGuardrailScriptSchema.parse(req.body);
            const updated = await guardrailScriptsService.update(id, body);
            if (!updated) return reply.status(404).send({ error: 'Script not found' });
            return reply.send(updated);
        },
    );

    app.delete(
        '/api/guardrail-scripts/:id',
        { preHandler: requireMcpToken },
        async (req, reply) => {
            const { id } = req.params as { id: string };
            await guardrailScriptsService.remove(id);
            return reply.status(204).send();
        },
    );
}
