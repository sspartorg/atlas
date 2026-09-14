import type { FastifyInstance } from 'fastify';
import { getCliAvailability } from '../services/cli-availability.js';

export async function cliAvailabilityRoutes(app: FastifyInstance) {
    app.get('/api/cli/availability', async (_req, reply) => {
        return reply.send(await getCliAvailability());
    });
}
