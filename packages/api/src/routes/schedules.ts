import type { FastifyInstance } from 'fastify';
import { Cron } from 'croner';
import { ProjectScheduleSchema } from '@atlas/shared';
import type { IProjectRepo } from '@atlas/shared';
import { projectReposService } from '../services/project-repos.js';
import { schedulesService } from '../services/schedules.js';
import { materializeCron } from '../services/cron-materializer.js';
import { registerOne, unregisterOne, nextRun } from '../services/schedule-registry.js';
import { runAutoFetch } from '../services/auto-fetch-runner.js';
import { randomUUID } from 'node:crypto';
import { requireMcpToken } from '../plugins/mcp-auth.js';

export async function schedulesRoutes(app: FastifyInstance) {
    // ADR 0018 — auto-fetch is per repo, so every route below names one.
    async function repoOr404(projectId: string, repoId: string): Promise<IProjectRepo | null> {
        const repos = await projectReposService.list(projectId).catch(() => null);
        return repos?.find((r) => r.id === repoId) ?? null;
    }

    app.get('/api/schedules', async (_req, reply) => reply.send(await schedulesService.listEnabled()));

    app.get('/api/projects/:id/repos/:repoId/schedule', async (req, reply) => {
        const { id, repoId } = req.params as { id: string; repoId: string };
        if (!(await repoOr404(id, repoId))) return reply.status(404).send({ error: 'Repo not found' });
        return reply.send(await schedulesService.getOrDefault(repoId, id));
    });

    app.put('/api/projects/:id/repos/:repoId/schedule', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id, repoId } = req.params as { id: string; repoId: string };
        if (!(await repoOr404(id, repoId))) return reply.status(404).send({ error: 'Repo not found' });
        const parsed = ProjectScheduleSchema.safeParse(req.body);
        if (!parsed.success) {
            return reply.status(400).send({ error: 'Invalid schedule', issues: parsed.error.issues });
        }
        const input = parsed.data;
        let cronExpr: string;
        try {
            cronExpr = materializeCron({
                preset: input.preset,
                time_of_day: input.time_of_day,
                weekday: input.weekday,
                cron_expression: input.cron_expression,
            }).cron_expression;
        } catch (e) {
            return reply
                .status(400)
                /* v8 ignore next */
                .send({ error: e instanceof Error ? e.message : 'Invalid schedule' });
        }
        let nextAt: string | null = null;
        if (input.enabled) {
            try {
                /* v8 ignore next */
                nextAt = new Cron(cronExpr, { paused: true }).nextRun()?.toISOString() ?? null;
            } catch (e) {
                /* v8 ignore next */
                return reply.status(400).send({ error: e instanceof Error ? e.message : 'Invalid cron' });
            }
        }
        const saved = await schedulesService.upsert({
            repo_id: repoId,
            project_id: id,
            enabled: input.enabled,
            preset: input.preset,
            cron_expression: cronExpr,
            time_of_day: input.time_of_day,
            weekday: input.weekday,
            skip_if_dirty: input.skip_if_dirty,
            pause_while_agents_active: input.pause_while_agents_active,
            conflict_policy: input.conflict_policy,
            next_run_at: nextAt,
        });
        if (saved.enabled) {
            registerOne(saved);
            const refreshed = nextRun(repoId);
            /* v8 ignore next */
            if (refreshed) {
                await schedulesService.recordRun(
                    repoId,
                    saved.last_run_status,
                    saved.last_run_detail,
                    refreshed.toISOString(),
                );
            }
        } else {
            unregisterOne(repoId);
        }
        return reply.send(await schedulesService.getOrDefault(repoId, id));
    });

    app.delete('/api/projects/:id/repos/:repoId/schedule', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id, repoId } = req.params as { id: string; repoId: string };
        if (!(await repoOr404(id, repoId))) return reply.status(404).send({ error: 'Repo not found' });
        unregisterOne(repoId);
        await schedulesService.delete(repoId);
        return reply.send({ ok: true });
    });

    app.post('/api/projects/:id/repos/:repoId/schedule/fire', { preHandler: requireMcpToken }, async (req, reply) => {
        void req.body;
        const { id, repoId } = req.params as { id: string; repoId: string };
        if (!(await repoOr404(id, repoId))) return reply.status(404).send({ error: 'Repo not found' });
        const autofetchId = randomUUID();
        setImmediate(() => {
            void runAutoFetch(repoId);
        });
        return reply.status(202).send({ autofetch_id: autofetchId });
    });
}
