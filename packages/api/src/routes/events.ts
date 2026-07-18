import type { FastifyInstance } from 'fastify';
import type { SSEEvent } from '@atlas/shared';
import { getTrustedBrowserOrigins } from '../utils/lan-origins.js';

// SSE client registry — in Phase 5, real agent runs will push events here
const clients = new Set<(event: SSEEvent) => void>();

export function broadcastSSE(event: Omit<SSEEvent, 'timestamp'>): void {
    const stamped: SSEEvent = { ...event, timestamp: new Date().toISOString() };
    for (const send of clients) {
        send(stamped);
    }
}

export async function eventsRoutes(app: FastifyInstance) {
    app.get('/api/events', async (req, reply) => {
        // Hijack the reply so Fastify 5 stops managing this response — without
        // this the handler's pending Promise keeps the framework waiting for a
        // serializable payload, headers never flush, and EventSource never
        // fires `onopen`. With hijack(), we own `reply.raw` end-to-end.
        reply.hijack();

        // Only reflect the Origin header when it matches the trusted browser
        // allowlist (static localhost + optional LAN origins). Previously
        // this reflected any origin verbatim, letting a cross-origin
        // attacker page open an EventSource and read live agent activity,
        // clone status, and notifications for the local Owner.
        const origin = (req.headers['origin'] as string | undefined) ?? '';
        const trusted = origin && getTrustedBrowserOrigins().has(origin) ? origin : '';

        reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
            ...(trusted ? { 'Access-Control-Allow-Origin': trusted, Vary: 'Origin' } : {}),
        });

        // Push an SSE comment immediately so EventSource.onopen fires across
        // browsers + dev proxies. Without an early flush some clients buffer
        // until the first real message (or the 30-s heartbeat below) and the
        // UI sits in "connecting" forever.
        reply.raw.write(': connected\n\n');

        const send = (event: SSEEvent) => {
            reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
        };

        clients.add(send);

        // Heartbeat every 30s to keep connection alive
        const heartbeat = setInterval(() => {
            reply.raw.write(': heartbeat\n\n');
        }, 30_000);

        req.raw.on('close', () => {
            clearInterval(heartbeat);
            clients.delete(send);
        });
    });
}
