import type { FastifyInstance } from 'fastify';
import {
    CreateJiraSourceSchema,
    TestJiraConnectionSchema,
    UpdateJiraConfigSchema,
    UpdateJiraSourceSchema,
} from '@atlas/shared';
import { requireMcpToken } from '../plugins/mcp-auth.js';
import { JiraSyncDisabledError, jiraSync } from '../services/jira-sync.js';
import { projectsService } from '../services/projects.js';

// Jira bridge config + manual controls (ADR 0016). The API token is write-only:
// no route returns it.
//
// The connection and the poller are a singleton — one self-hosted site, one
// token. The SOURCES (query + workflow + repos) belong to a project and live
// under /api/projects/:projectId/jira-sources (migration 010).
export async function jiraRoutes(app: FastifyInstance) {
    app.get('/api/integrations/jira', async (_req, reply) => {
        return reply.send(await jiraSync.getConfig());
    });

    app.put('/api/integrations/jira', { preHandler: requireMcpToken }, async (req, reply) => {
        const body = UpdateJiraConfigSchema.parse(req.body);
        return reply.send(await jiraSync.saveConfig(body));
    });

    // Reveal the stored token. `credsOf` inside the service throws 400
    // `credentials_missing` when none is set, which is the honest answer.
    app.post(
        '/api/integrations/jira/reveal-token',
        { preHandler: requireMcpToken },
        async (req, reply) => {
            const value = await jiraSync.revealToken();
            req.log.info({ tag: 'secret_reveal', scope: 'jira_api_token' }, 'secret revealed');
            return reply.send({ value });
        }
    );

    app.post('/api/integrations/jira/test', { preHandler: requireMcpToken }, async (req, reply) => {
        const body = TestJiraConnectionSchema.parse(req.body ?? {});
        return reply.send(await jiraSync.testConnection(body));
    });

    app.post(
        '/api/integrations/jira/sync',
        { preHandler: requireMcpToken },
        async (_req, reply) => {
            try {
                return reply.send(await jiraSync.syncNow());
            } catch (err) {
                if (err instanceof JiraSyncDisabledError) {
                    return reply.status(409).send({ error: err.message, kind: 'conflict' });
                }
                throw err;
            }
        }
    );

    // ── Per-project sources ──────────────────────────────────────────────
    async function projectOr404(projectId: string, reply: Parameters<typeof app.get>[1] extends never ? never : { status: (n: number) => { send: (b: unknown) => unknown } }) {
        const project = await projectsService.get(projectId);
        if (!project) {
            reply.status(404).send({ error: 'Project not found' });
            return null;
        }
        return project;
    }

    app.get('/api/projects/:projectId/jira-sources', async (req, reply) => {
        const { projectId } = req.params as { projectId: string };
        if (!(await projectOr404(projectId, reply))) return;
        return reply.send(await jiraSync.listSources(projectId));
    });

    app.post(
        '/api/projects/:projectId/jira-sources',
        { preHandler: requireMcpToken },
        async (req, reply) => {
            const { projectId } = req.params as { projectId: string };
            if (!(await projectOr404(projectId, reply))) return;
            const body = CreateJiraSourceSchema.parse(req.body);
            return reply.status(201).send(await jiraSync.createSource(projectId, body));
        }
    );

    app.patch(
        '/api/projects/:projectId/jira-sources/:id',
        { preHandler: requireMcpToken },
        async (req, reply) => {
            const { projectId, id } = req.params as { projectId: string; id: string };
            if (!(await projectOr404(projectId, reply))) return;
            const body = UpdateJiraSourceSchema.parse(req.body);
            const updated = await jiraSync.updateSource(projectId, Number(id), body);
            if (!updated) return reply.status(404).send({ error: 'Source not found' });
            return reply.send(updated);
        }
    );

    app.delete(
        '/api/projects/:projectId/jira-sources/:id',
        { preHandler: requireMcpToken },
        async (req, reply) => {
            const { projectId, id } = req.params as { projectId: string; id: string };
            if (!(await projectOr404(projectId, reply))) return;
            const ok = await jiraSync.deleteSource(projectId, Number(id));
            if (!ok) return reply.status(404).send({ error: 'Source not found' });
            return reply.status(204).send();
        }
    );
}
