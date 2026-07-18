import type { FastifyInstance } from 'fastify';
import { Cron } from 'croner';
import { ProjectScheduleSchema } from '@atlas/shared';
import { projectsService } from '../services/projects.js';
import { schedulesService } from '../services/schedules.js';
import { materializeCron } from '../services/cron-materializer.js';
import { registerOne, unregisterOne, nextRun } from '../services/schedule-registry.js';
import { runAutoFetch } from '../services/auto-fetch-runner.js';
import { randomUUID } from 'node:crypto';
import { requireMcpToken } from '../plugins/mcp-auth.js';

export async function schedulesRoutes(app: FastifyInstance) {
    app.get('/api/schedules', async (_req, reply) => reply.send(await schedulesService.listEnabled()));

    app.get('/api/projects/:id/schedule', async (req, reply) => {
        const { id } = req.params as { id: string };
        if (!(await projectsService.get(id))) return reply.status(404).send({ error: 'Project not found' });
        return reply.send(await schedulesService.getOrDefault(id));
    });

    app.put('/api/projects/:id/schedule', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        if (!(await projectsService.get(id))) return reply.status(404).send({ error: 'Project not found' });
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
            const refreshed = nextRun(id);
            /* v8 ignore next */
            if (refreshed) {
                await schedulesService.recordRun(
                    id,
                    saved.last_run_status,
                    saved.last_run_detail,
                    refreshed.toISOString(),
                );
            }
        } else {
            unregisterOne(id);
        }
        return reply.send(await schedulesService.getOrDefault(id));
    });

    app.delete('/api/projects/:id/schedule', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        if (!(await projectsService.get(id))) return reply.status(404).send({ error: 'Project not found' });
        unregisterOne(id);
        await schedulesService.delete(id);
        return reply.send({ ok: true });
    });

    app.post('/api/projects/:id/schedule/fire', { preHandler: requireMcpToken }, async (req, reply) => {
        void req.body;
        const { id } = req.params as { id: string };
        if (!(await projectsService.get(id))) return reply.status(404).send({ error: 'Project not found' });
        const autofetchId = randomUUID();
        setImmediate(() => {
            void runAutoFetch(id);
        });
        return reply.status(202).send({ autofetch_id: autofetchId });
    });
}
