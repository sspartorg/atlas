import type { FastifyInstance } from 'fastify';
import { NotificationFilterSchema } from '@atlas/shared';
import { z } from 'zod';
import { notificationsService } from '../services/notifications.js';
import { channelConfigured, deliverExternalNow, sendOwnerExternalMessage } from '../services/external-notifications.js';

// A09 — body shape for the MCP-callable external-notification passthrough.
// Manual validation here avoids adding a zod dep to @atlas/api just for one
// route; the same shape's type-safety is re-asserted by the MCP-side zod
// schema in `packages/mcp/src/tools/notifications.ts`.
function parseSendExternalBody(body: unknown): { message: string; event_key?: string } {
    if (typeof body !== 'object' || body === null) {
        throw new Error('body must be an object');
    }
    const b = body as Record<string, unknown>;
    if (typeof b['message'] !== 'string' || b['message'].length === 0 || b['message'].length > 4000) {
        throw new Error('message must be a non-empty string ≤ 4000 chars');
    }
    if (b['event_key'] !== undefined) {
        if (typeof b['event_key'] !== 'string' || b['event_key'].length > 64) {
            throw new Error('event_key must be a string ≤ 64 chars');
        }
    }
    const out: { message: string; event_key?: string } = { message: b['message'] };
    if (typeof b['event_key'] === 'string') out.event_key = b['event_key'];
    return out;
}

// `before` is the "Load more" cursor (a notification id); `in_app=true` is the
// In-App Feed's rows only. API-only, so they extend the shared filter here
// rather than in @atlas/shared.
const ListQuerySchema = NotificationFilterSchema.extend({
    before: z.coerce.number().int().min(1).optional(),
    log: z
        .enum(['true', 'false'])
        .transform((v) => v === 'true')
        .optional(),
    in_app: z
        .enum(['true', 'false'])
        .transform((v) => v === 'true')
        .optional(),
});

export async function notificationsRoutes(app: FastifyInstance) {
    app.get('/api/notifications', async (req, reply) => {
        /* v8 ignore next */
        const filter = ListQuerySchema.parse(req.query ?? {});
        return reply.send(await notificationsService.list(filter));
    });

    // Guard against `?id=abc`: Number('abc') is NaN, Kysely's
    // `.where('id','=',NaN)` produces `id = NaN` which PG rejects at parse
    // — every route below would return 500 on non-numeric ids without this.
    // Same shape as the reminders route's parseIntParam pattern.
    function parseId(raw: string): number | null {
        const n = Number(raw);
        return Number.isFinite(n) && Number.isInteger(n) && n >= 1 ? n : null;
    }

    app.patch('/api/notifications/:id/sent', async (req, reply) => {
        const { id } = req.params as { id: string };
        const n = parseId(id);
        if (n === null) return reply.status(400).send({ error: 'invalid id', kind: 'validation_error' });
        await notificationsService.markSent(n);
        return reply.status(204).send();
    });

    app.post('/api/notifications/:id/resend', async (req, reply) => {
        const { id } = req.params as { id: string };
        const n = parseId(id);
        if (n === null) return reply.status(400).send({ error: 'invalid id', kind: 'validation_error' });
        const row = await notificationsService.get(n);
        if (!row) return reply.status(404).send({ error: 'Notification not found' });
        // Without a channel the send can only end at `none`: the toast would
        // say "Resent" and the row would drop out of the log.
        if (!(await channelConfigured())) {
            return reply.status(409).send({
                error: 'No external channel is connected. Set one up in Settings → Notifications.',
                kind: 'credentials_missing',
            });
        }
        try {
            // The Owner pressed Resend/Retry: send now, quiet hours or not.
            await deliverExternalNow(row.id, row.message);
            return reply.send(await notificationsService.get(row.id));
        } catch (err) {
            return reply.status(502).send({
                error: 'External notification delivery failed',
                detail: err instanceof Error ? err.message : String(err),
            });
        }
    });

    app.post('/api/notifications/:id/cancel', async (req, reply) => {
        const { id } = req.params as { id: string };
        const n = parseId(id);
        if (n === null) return reply.status(400).send({ error: 'invalid id', kind: 'validation_error' });
        const ok = await notificationsService.cancel(n);
        if (!ok)
            return reply.status(409).send({ error: 'Only pending deliveries can be cancelled' });
        return reply.send(await notificationsService.get(n));
    });

    app.post('/api/notifications/mark-all-read', async (_req, reply) => {
        const changed = await notificationsService.markAllRead();
        return reply.send({ ok: true, changed });
    });

    app.post('/api/notifications/:id/read', async (req, reply) => {
        const { id } = req.params as { id: string };
        const n = parseId(id);
        if (n === null) return reply.status(400).send({ error: 'invalid id', kind: 'validation_error' });
        const changed = await notificationsService.markRead(n);
        return reply.send({ ok: true, changed });
    });

    // A09 — MCP-callable external-notification send. Lets autonomous agents
    // (the daily AI-news scout is the first user) deliver a one-shot message.
    // It gets a log-only row (`in_app=false`, event_type `mcp_external`) so
    // quiet hours HOLD it rather than drop it, the event toggle applies when
    // event_key is set, and the Notification Log tracks it.
    app.post('/api/notifications/send-external', async (req, reply) => {
        let body: { message: string; event_key?: string };
        try {
            body = parseSendExternalBody(req.body);
        } catch (err) {
            return reply.status(400).send({ error: (err as Error).message });
        }
        // `sent: false` + `held: true` = quiet hours, it goes out when the
        // window ends. `sent: false` + `held: false` = toggle off, no channel,
        // or the transport failed (`external_status` says which).
        const r = await sendOwnerExternalMessage(body.message, body.event_key);
        return reply.status(202).send({ ok: true, sent: r.external_status === 'sent', ...r });
    });
}
