import type { FastifyInstance } from 'fastify';
import { UpdateTeamConfigSchema } from '@atlas/shared';
import { requireMcpToken } from '../plugins/mcp-auth.js';
import { teamConfig } from '../services/team-config.js';

// Team config sync: the connection to the team's config repo and a manual
// sync. No route returns a secret.
export async function teamConfigRoutes(app: FastifyInstance) {
    app.get('/api/team-config', async (_req, reply) => reply.send(await teamConfig.getConfig()));

    app.put('/api/team-config', { preHandler: requireMcpToken }, async (req, reply) => {
        // Test hook: the e2e suite publishes to a local bare repo over file://,
        // which the https-only schema refuses. Off unless the env var is set.
        const raw = (req.body ?? {}) as { repo_url?: unknown };
        const fileUrl =
            process.env['ATLAS_TEAM_CONFIG_ALLOW_FILE_URLS'] === '1' &&
            typeof raw.repo_url === 'string' &&
            raw.repo_url.startsWith('file://')
                ? raw.repo_url
                : undefined;
        const body = UpdateTeamConfigSchema.parse(fileUrl ? { ...raw, repo_url: undefined } : raw);
        return reply.send(await teamConfig.saveConfig(fileUrl ? { ...body, repo_url: fileUrl } : body));
    });

    app.post('/api/team-config/sync', { preHandler: requireMcpToken }, async (_req, reply) => {
        const message = await teamConfig.syncNow();
        return reply.send({ message, config: await teamConfig.getConfig() });
    });
}
