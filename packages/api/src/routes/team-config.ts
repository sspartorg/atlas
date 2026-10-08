import type { FastifyInstance } from 'fastify';
import { UpdateTeamConfigSchema } from '@atlas/shared';
import { requireMcpToken } from '../plugins/mcp-auth.js';
import { teamConfig } from '../services/team-config.js';

// Team config sync: the connection to the team's config repo and a manual
// sync. No route returns a secret.
export async function teamConfigRoutes(app: FastifyInstance) {
    app.get('/api/team-config', async (_req, reply) => reply.send(await teamConfig.getConfig()));

    app.put('/api/team-config', { preHandler: requireMcpToken }, async (req, reply) => {
        const body = UpdateTeamConfigSchema.parse(req.body);
        return reply.send(await teamConfig.saveConfig(body));
    });

    app.post('/api/team-config/sync', { preHandler: requireMcpToken }, async (_req, reply) => {
        const message = await teamConfig.syncNow();
        return reply.send({ message, config: await teamConfig.getConfig() });
    });
}
