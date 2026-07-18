import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/kysely-client.js';
import { getVapidPublicKey, sendTestPush } from '../services/web-push.js';
import { sql } from 'kysely';

const SubscribeSchema = z.object({
    endpoint: z.string().url(),
    p256dh: z.string().min(1),
    auth: z.string().min(1),
    userAgent: z.string().max(512).optional(),
});

const UnsubscribeSchema = z.object({
    endpoint: z.string().url(),
});

export async function pushSubscriptionsRoutes(app: FastifyInstance) {
    // Public — the browser fetches this BEFORE it can call subscribe(), so
    // gating it behind the MCP token gate would create a chicken/egg loop.
    // The VAPID public key is public by design (that's the V — "Voluntary").
    app.get('/api/push-subscriptions/vapid-public-key', async (_req, reply) => {
        return reply.send({ publicKey: await getVapidPublicKey() });
    });

    app.post('/api/push-subscriptions/subscribe', async (req, reply) => {
        const body = SubscribeSchema.parse(req.body);
        // Upsert on endpoint — re-subscribing the same browser shouldn't
        // create a duplicate row. Refresh last_seen_at so a future "purge
        // stale subs" job can spot abandoned browsers.
        await db
            .insertInto('push_subscriptions')
            .values({
                endpoint: body.endpoint,
                p256dh: body.p256dh,
                auth: body.auth,
                user_agent: body.userAgent ?? null,
            })
            .onConflict((oc) =>
                oc.column('endpoint').doUpdateSet({
                    p256dh: body.p256dh,
                    auth: body.auth,
                    user_agent: body.userAgent ?? null,
                    last_seen_at: sql`now()`,
                }),
            )
            .execute();
        return reply.status(201).send({ ok: true });
    });

    app.post('/api/push-subscriptions/unsubscribe', async (req, reply) => {
        const body = UnsubscribeSchema.parse(req.body);
        await db
            .deleteFrom('push_subscriptions')
            .where('endpoint', '=', body.endpoint)
            .execute();
        return reply.status(204).send();
    });

    app.post('/api/push-subscriptions/test', async (_req, reply) => {
        const result = await sendTestPush();
        return reply.send(result);
    });
}
