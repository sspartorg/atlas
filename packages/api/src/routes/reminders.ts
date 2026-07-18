import type { FastifyInstance } from 'fastify';
import { SetReminderSchema, CancelReminderSchema, UpdateReminderSchema } from '@atlas/shared';
import { remindersService } from '../services/reminders.js';
import { requireMcpToken } from '../plugins/mcp-auth.js';

// Theme 07 — REST surface for reminders. MCP tools call these endpoints
// through the api-client wrapper. The web UI doesn't render reminders
// yet (Theme 09's AI-news agent is the first user); a "Reminders" page
// can be layered later.

export async function remindersRoutes(app: FastifyInstance): Promise<void> {
    // search_reminder filter params (consolidation 2026-07). `status` /
    // `channel` / `since` are all optional; when omitted the list returns
    // every row sorted by next_fire_at (legacy listReminders shape).
    app.get('/api/reminders', async (req) => {
        const q = req.query as {
            status?: string;
            channel?: string;
            since?: string;
        };
        const filter: Parameters<typeof remindersService.list>[0] = {};
        if (q.status)
            filter.status = q.status as 'active' | 'paused' | 'cancelled' | 'completed';
        if (q.channel) filter.channel = q.channel as 'notification' | 'external' | 'both';
        if (q.since) filter.since = q.since;
        return remindersService.list(filter);
    });

    app.get('/api/reminders/:id', async (req, reply) => {
        const id = Number((req.params as { id: string }).id);
        if (!Number.isFinite(id)) return reply.status(400).send({ error: 'invalid id' });
        const row = await remindersService.get(id);
        if (!row) return reply.status(404).send({ error: 'reminder not found' });
        return row;
    });

    app.post('/api/reminders', { preHandler: requireMcpToken }, async (req, reply) => {
        const body = SetReminderSchema.parse(req.body);
        const created = await remindersService.create({
            label: body.label,
            body: body.body,
            schedule: body.schedule,
            channel: body.channel,
            created_by_agent_id: body.created_by_agent_id ?? null,
        });
        return reply.status(201).send(created);
    });

    app.patch('/api/reminders/:id', { preHandler: requireMcpToken }, async (req, reply) => {
        const id = Number((req.params as { id: string }).id);
        if (!Number.isFinite(id)) return reply.status(400).send({ error: 'invalid id' });
        const patch = UpdateReminderSchema.parse(req.body);
        try {
            const row = await remindersService.update(id, patch);
            if (!row) return reply.status(404).send({ error: 'reminder not found' });
            return row;
        } catch (e) {
            return reply.status(409).send({ error: (e as Error).message });
        }
    });

    app.delete('/api/reminders/:id', { preHandler: requireMcpToken }, async (req, reply) => {
        const parsed = CancelReminderSchema.parse({
            id: Number((req.params as { id: string }).id),
        });
        const row = await remindersService.cancel(parsed.id);
        if (!row) return reply.status(404).send({ error: 'reminder not found' });
        return row;
    });
}
