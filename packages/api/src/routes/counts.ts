import type { FastifyInstance } from 'fastify';
import { countsService } from '../services/counts.js';
import { workflowQueueService } from '../services/workflow-queue.js';
import { normalizeTz } from '../services/analytics-window.js';

export async function countsRoutes(app: FastifyInstance) {
    app.get('/api/counts', async (_req, reply) => {
        return reply.send(await countsService.getSidenavCounts());
    });

    app.get('/api/counts/queue-by-agent', async (_req, reply) => {
        return reply.send(await countsService.getQueueDepthByAgent());
    });

    app.get('/api/counts/project/:id', async (req, reply) => {
        const { id } = req.params as { id: string };
        return reply.send(await countsService.getProjectCounts(id));
    });

    app.get('/api/dashboard', async (req, reply) => {
        const raw = (req.query as { tz?: string } | undefined)?.tz;
        const [kpis, awaiting, queue, pipelines] = await Promise.all([
            countsService.getDashboardKpis(raw === undefined ? undefined : normalizeTz(raw)),
            countsService.getAwaitingItems(),
            countsService.getQueueItems(),
            workflowQueueService.dashboardSummary(),
        ]);
        return reply.send({ kpis, awaiting, queue, pipelines });
    });
}
