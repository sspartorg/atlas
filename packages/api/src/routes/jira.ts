import type { FastifyInstance } from 'fastify';
import { TestJiraConnectionSchema, UpdateJiraConfigSchema } from '@atlas/shared';
import { requireMcpToken } from '../plugins/mcp-auth.js';
import { jiraSync } from '../services/jira-sync.js';

// Jira bridge config + manual controls (ADR 0016). The API token is write-only:
// no route returns it.
export async function jiraRoutes(app: FastifyInstance) {
    app.get('/api/integrations/jira', async (_req, reply) => {
        return reply.send(await jiraSync.getConfig());
    });

    app.put('/api/integrations/jira', { preHandler: requireMcpToken }, async (req, reply) => {
        const body = UpdateJiraConfigSchema.parse(req.body);
        return reply.send(await jiraSync.saveConfig(body));
    });

    app.post('/api/integrations/jira/test', { preHandler: requireMcpToken }, async (req, reply) => {
        const body = TestJiraConnectionSchema.parse(req.body ?? {});
        return reply.send(await jiraSync.testConnection(body));
    });

    app.post(
        '/api/integrations/jira/sync',
        { preHandler: requireMcpToken },
        async (_req, reply) => {
            return reply.send(await jiraSync.syncNow());
        }
    );
}
