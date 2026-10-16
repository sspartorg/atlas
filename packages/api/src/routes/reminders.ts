import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
    SetReminderSchema,
    CancelReminderSchema,
    UpdateReminderSchema,
    SnoozeReminderSchema,
    ReminderChannelSchema,
} from '@atlas/shared';
import { remindersService } from '../services/reminders.js';
import { requireMcpToken } from '../plugins/mcp-auth.js';

// Theme 07 — REST surface for reminders. The Reminders page and the MCP
// tools (through the api-client wrapper) call these endpoints.

const IdSchema = z.coerce.number().int().positive();
const StatusSchema = z.enum(['active', 'paused', 'cancelled', 'completed']);
const ListQuerySchema = z.object({
    status: z
        .string()
        .transform((v) => v.split(',').filter(Boolean))
        .pipe(z.array(StatusSchema))
        .optional(),
    channel: ReminderChannelSchema.optional(),
    since: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
    offset: z.coerce.number().int().min(0).optional(),
});

export async function remindersRoutes(app: FastifyInstance): Promise<void> {
    // `status` takes a comma list (`active,paused`); `limit` / `offset` page it.
    // With no filter the list returns every row sorted by next_fire_at.
    app.get('/api/reminders', async (req) => {
        const q = ListQuerySchema.parse(req.query);
        return remindersService.list({
            status: q.status,
            channel: q.channel,
            since: q.since,
            limit: q.limit,
            offset: q.offset,
        });
    });

    app.get('/api/reminders/:id/fires', async (req) => {
        const id = IdSchema.parse((req.params as { id: string }).id);
        const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }).parse(req.query);
        return remindersService.fires(id, limit);
    });

    app.post('/api/reminders/:id/snooze', { preHandler: requireMcpToken }, async (req) => {
        const id = IdSchema.parse((req.params as { id: string }).id);
        const { minutes } = SnoozeReminderSchema.parse(req.body);
        return remindersService.snooze(id, minutes);
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
        const row = await remindersService.update(id, patch);
        if (!row) return reply.status(404).send({ error: 'reminder not found' });
        return row;
    });

    app.delete('/api/reminders/:id', { preHandler: requireMcpToken }, async (req, reply) => {
        const parsed = CancelReminderSchema.parse({
            id: Number((req.params as { id: string }).id),
        });
        // `?hard=1` deletes a finished reminder (409 while it can still fire);
        // the default stays a soft cancel that keeps the row as history.
        if ((req.query as { hard?: string }).hard === '1') {
            await remindersService.hardDelete(parsed.id);
            return reply.status(204).send();
        }
        const row = await remindersService.cancel(parsed.id);
        if (!row) return reply.status(404).send({ error: 'reminder not found' });
        return row;
    });
}
