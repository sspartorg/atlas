import type { FastifyInstance } from 'fastify';

export async function serverRoutes(app: FastifyInstance) {
    app.post('/api/server/restart', async (_req, reply) => {
        // Respond first, then exit on the next tick so the client gets a real
        // response (not a connection reset). The host (pnpm dev / PM2 /
        // launcher) is responsible for restarting the process — if nothing is
        // supervising, the server stays down until the user starts it again.
        const supervised = process.env['ATLAS_SUPERVISED'] !== '0';
        reply.send({ ok: true, supervised });
        setTimeout(() => {
            app.log.info('exiting for restart');
            process.exit(0);
        }, 200);
    });
}
