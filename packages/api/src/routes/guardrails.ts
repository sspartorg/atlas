import type { FastifyInstance } from 'fastify';
import { CreateGuardrailRuleSchema, UpdateGuardrailRuleSchema } from '@atlas/shared';
import { guardrailsService } from '../services/guardrails.js';
import { settingsService } from '../services/settings.js';
import { requireMcpToken } from '../plugins/mcp-auth.js';

export async function guardrailsRoutes(app: FastifyInstance) {
    app.get('/api/guardrails', async (_req, reply) => {
        const [rules, settings] = await Promise.all([
            guardrailsService.list(),
            settingsService.get(),
        ]);
        return reply.send({ rules, published_at: settings.guardrails_published_at });
    });

    app.post('/api/guardrails', { preHandler: requireMcpToken }, async (req, reply) => {
        const body = CreateGuardrailRuleSchema.parse(req.body);
        const created = await guardrailsService.create(body);
        return reply.status(201).send(created);
    });

    app.patch('/api/guardrails/:id', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        const body = UpdateGuardrailRuleSchema.parse(req.body);
        const updated = await guardrailsService.update(id, body);
        if (!updated) return reply.status(404).send({ error: 'Rule not found' });
        return reply.send(updated);
    });

    app.delete('/api/guardrails/:id', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        await guardrailsService.remove(id);
        return reply.status(204).send();
    });

    app.post('/api/guardrails/save', { preHandler: requireMcpToken }, async (_req, reply) => {
        const publishedAt = await guardrailsService.markSaved();
        return reply.send({ ok: true, published_at: publishedAt });
    });
}
