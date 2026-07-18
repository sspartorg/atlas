import type { FastifyInstance } from 'fastify';
import { countsService } from '../services/counts.js';

export async function countsRoutes(app: FastifyInstance) {
    app.get('/api/counts', async (_req, reply) => {
        return reply.send(await countsService.getSidenavCounts());
    });

    app.get('/api/counts/project/:id', async (req, reply) => {
        const { id } = req.params as { id: string };
        return reply.send(await countsService.getProjectCounts(id));
    });

    app.get('/api/dashboard', async (_req, reply) => {
        const [kpis, awaiting, queue] = await Promise.all([
            countsService.getDashboardKpis(),
            countsService.getAwaitingItems(),
            countsService.getQueueItems(),
        ]);
        return reply.send({ kpis, awaiting, queue });
    });
}
