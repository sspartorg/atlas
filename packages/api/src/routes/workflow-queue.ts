import type { FastifyInstance } from 'fastify';
import { workflowQueueService } from '../services/workflow-queue.js';

export async function workflowQueueRoutes(app: FastifyInstance) {
    app.get('/api/workflow-queue', async (req, reply) => {
        const { project_id } = req.query as { project_id?: string };
        return reply.send(await workflowQueueService.get(project_id));
    });
}
