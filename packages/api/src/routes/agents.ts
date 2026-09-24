import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/kysely-client.js';
import {
    agentsService,
    ModelNotInRegistryError,
    RoleNotInCatalogError,
} from '../services/agents.js';
import { agentMemoryService } from '../services/agent-memory.js';
import { startDryRun } from '../services/dry-run.js';
import { compilePromptFor } from '../services/compile-prompt.js';
import {
    marketplaceService,
    MarketplaceSlugTakenError,
    MarketplaceNotFoundError,
} from '../services/marketplace.js';
import { unpackAgentBundle, AgentBundleParseError } from '../services/agent-bundle.js';
import { requireMcpToken } from '../plugins/mcp-auth.js';
import { agentTestsService } from '../services/agent-tests.js';
import { agentPerformance } from '../services/agent-scorecard.js';
import {
    AgentChecklistsPutSchema,
    AgentMemoryUpdateSchema,
    CreateAgentSchema,
    RUNNABLE_ISSUE_TYPES,
    UpdateAgentSchema,
    type IssueType,
} from '@atlas/shared';

const AcceptUpgradeBodySchema = z.object({
    fields: z
        .array(
            z.enum(['prompt_md', 'settings_json', 'checklists']),
        )
        .min(1),
});


const AgentTestItemTemplateSchema = z.object({
    issue_type: z.enum(['task', 'sub_task']),
    title: z.string().trim().min(1).max(500),
    description: z.string().max(20000).optional(),
    acceptance_criteria: z.string().max(20000).optional(),
    labels: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});

const AgentTestExpectationsSchema = z.object({
    outcome_kind: z.enum(['done', 'rejected', 'asked_question']).optional(),
    required_checklist_all_passed: z.boolean().optional(),
    summary_contains: z.array(z.string().min(1).max(200)).max(20).optional(),
    summary_omits: z.array(z.string().min(1).max(200)).max(20).optional(),
    max_cost_usd: z.number().positive().optional(),
    max_duration_s: z.number().int().positive().optional(),
    // Migration 017 — assertions about what the run DID, not what it said.
    // A test that asks one of these and cannot be answered comes back
    // `errored`, never a silent pass.
    tools_required: z.array(z.string().min(1).max(120)).max(20).optional(),
    tools_forbidden: z.array(z.string().min(1).max(120)).max(20).optional(),
    max_turns: z.number().int().positive().optional(),
    max_tool_calls: z.number().int().positive().optional(),
    files_touched: z.array(z.string().min(1).max(300)).max(20).optional(),
    files_untouched: z.array(z.string().min(1).max(300)).max(20).optional(),
});

const AgentTestBodySchema = z.object({
    project_id: z.string().min(1),
    repo_id: z.string().min(1).nullable().optional(),
    name: z.string().trim().min(1).max(200),
    item_template: AgentTestItemTemplateSchema,
    expectations: AgentTestExpectationsSchema.optional(),
});

/**
 * `n_runs` is capped at 10 in the schema as well as the service: a bad number
 * should be a 400 at the boundary, not a silently clamped spend.
 */
const AgentTestRunBodySchema = z
    .object({
        n_runs: z.number().int().min(1).max(10).optional(),
        label: z.string().trim().max(120).optional(),
    })
    .strict();

const AgentTestPatchSchema = z.object({
    repo_id: z.string().min(1).nullable().optional(),
    name: z.string().trim().min(1).max(200).optional(),
    item_template: AgentTestItemTemplateSchema.optional(),
    expectations: AgentTestExpectationsSchema.optional(),
});

/** 90 days. Long enough to show a prompt change landing, short enough to stay cheap. */
const PERFORMANCE_WINDOW_DAYS = 90;

function defaultSince(): string {
    return new Date(Date.now() - PERFORMANCE_WINDOW_DAYS * 86_400_000).toISOString();
}

export async function agentsRoutes(app: FastifyInstance) {
    app.get('/api/agents', async (_req, reply) => reply.send(await agentsService.list()));

    app.get('/api/agents/:id', async (req, reply) => {
        const { id } = req.params as { id: string };
        const agent = await agentsService.get(id);
        if (!agent) return reply.status(404).send({ error: 'Agent not found' });
        return reply.send(agent);
    });

    app.post('/api/agents', { preHandler: requireMcpToken }, async (req, reply) => {
        const body = CreateAgentSchema.parse(req.body);
        try {
            return reply.status(201).send(await agentsService.create(body));
        } catch (err) {
            if (err instanceof ModelNotInRegistryError || err instanceof RoleNotInCatalogError) {
                return reply.status(400).send({ error: err.message, code: err.code });
            }
            /* v8 ignore next */
            throw err;
        }
    });

    app.patch('/api/agents/:id', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        if (!(await agentsService.get(id))) return reply.status(404).send({ error: 'Agent not found' });
        const body = UpdateAgentSchema.parse(req.body);
        try {
            return reply.send(await agentsService.update(id, body));
        } catch (err) {
            if (err instanceof ModelNotInRegistryError || err instanceof RoleNotInCatalogError) {
                return reply.status(400).send({ error: err.message, code: err.code });
            }
            /* v8 ignore next */
            throw err;
        }
    });

    app.delete('/api/agents/:id', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        if (!(await agentsService.get(id))) return reply.status(404).send({ error: 'Agent not found' });
        await agentsService.delete(id);
        return reply.status(204).send();
    });

    app.get('/api/agents/:id/runs', async (req, reply) => {
        const { id } = req.params as { id: string };
        return reply.send(await agentsService.getRuns(id));
    });

    app.get('/api/agents/:id/checklists', async (req, reply) => {
        const { id } = req.params as { id: string };
        return reply.send(await agentsService.getChecklists(id));
    });

    app.put(
        '/api/agents/:id/checklists',
        { preHandler: requireMcpToken },
        async (req, reply) => {
            const { id } = req.params as { id: string };
            const body = AgentChecklistsPutSchema.parse(req.body);
            await agentsService.setChecklists(id, body.items);
            return reply.send(await agentsService.getChecklists(id));
        }
    );

    app.get('/api/agents/:id/memory', async (req, reply) => {
        const { id } = req.params as { id: string };
        if (!(await agentsService.get(id))) return reply.status(404).send({ error: 'Agent not found' });
        return reply.send(await agentMemoryService.get(id));
    });

    app.put('/api/agents/:id/memory', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        if (!(await agentsService.get(id))) return reply.status(404).send({ error: 'Agent not found' });
        const body = AgentMemoryUpdateSchema.parse(req.body);
        // `mode='append'` routes to surgical lesson append (audit row
        // trigger='mcp_update', cadence counter untouched); `mode='replace'`
        // overwrites the full body.
        if (body.mode === 'append') {
            return reply.send(await agentMemoryService.appendLesson(id, body.body_md));
        }
        return reply.send(await agentMemoryService.put(id, body.body_md));
    });

    app.post(
        '/api/agents/:id/memory/regenerate',
        { preHandler: requireMcpToken },
        async (req, reply) => {
            const { id } = req.params as { id: string };
            if (!(await agentsService.get(id))) return reply.status(404).send({ error: 'Agent not found' });
            const next = await agentMemoryService.regenerate(id, { trigger: 'manual' });
            return reply.status(202).send(next);
        }
    );

    // Theme 08 — memory regeneration audit history for the
    // Agent Detail Memory tab. Newest first; clamped to 1..50.
    app.get('/api/agents/:id/memory/history', async (req, reply) => {
        const { id } = req.params as { id: string };
        if (!(await agentsService.get(id))) return reply.status(404).send({ error: 'Agent not found' });
        const { limit } = req.query as { limit?: string };
        // Guard against ?limit=<non-numeric>: Number('abc') = NaN, and NaN
        // propagates through Math.min/max as NaN → `LIMIT NaN` which PG
        // rejects at parse (a garbled `limit` param becomes a 500). Coerce
        // non-finite to the default 10 and clamp to [1, 50].
        const rawN = limit ? Number(limit) : 10;
        const n = Math.min(Math.max(Number.isFinite(rawN) ? rawN : 10, 1), 50);
        return reply.send(await agentMemoryService.history(id, n));
    });

    // Theme 11 — commit-discipline verifications for the Agent Detail
    // Overview tile. Newest first; clamped to 1..50, default 10.
    app.get('/api/agents/:id/commit-verifications', async (req, reply) => {
        const { id } = req.params as { id: string };
        if (!(await agentsService.get(id))) return reply.status(404).send({ error: 'Agent not found' });
        const { limit } = req.query as { limit?: string };
        // Guard against ?limit=<non-numeric>: Number('abc') = NaN, and NaN
        // propagates through Math.min/max as NaN → `LIMIT NaN` which PG
        // rejects at parse (a garbled `limit` param becomes a 500). Coerce
        // non-finite to the default 10 and clamp to [1, 50].
        const rawN = limit ? Number(limit) : 10;
        const n = Math.min(Math.max(Number.isFinite(rawN) ? rawN : 10, 1), 50);
        const rows = await db
            .selectFrom('commit_verifications')
            .selectAll()
            .where('agent_id', '=', id)
            .orderBy('checked_at', 'desc')
            .limit(n)
            .execute();
        return reply.send(rows);
    });

    app.get('/api/agents/:id/prompt-versions', async (req, reply) => {
        const { id } = req.params as { id: string };
        if (!(await agentsService.get(id))) return reply.status(404).send({ error: 'Agent not found' });
        return reply.send(await agentsService.listPromptVersions(id));
    });

    app.post('/api/agents/:id/compile-prompt', async (req, reply) => {
        const { id } = req.params as { id: string };
        const agent = await agentsService.get(id);
        if (!agent) return reply.status(404).send({ error: 'Agent not found' });

        /* v8 ignore next */
        const body = (req.body ?? {}) as { issue_type?: string; issue_id?: string };
        const hasItem = Boolean(body.issue_type && body.issue_id);

        if (hasItem && !RUNNABLE_ISSUE_TYPES.includes(body.issue_type as IssueType)) {
            return reply.status(400).send({
                error: `issue_type must be one of: ${RUNNABLE_ISSUE_TYPES.join(', ')}`,
            });
        }

        try {
            const result = await compilePromptFor(
                agent,
                hasItem ? (body.issue_type as IssueType) : null,
                hasItem ? body.issue_id! : null
            );
            return reply.send(result);
        } catch (err) {
            return reply.status(404).send({ error: (err as Error).message });
        }
    });

    app.post('/api/agents/:id/dry-run', async (req, reply) => {
        const { id } = req.params as { id: string };
        const agent = await agentsService.get(id);
        if (!agent) return reply.status(404).send({ error: 'Agent not found' });

        /* v8 ignore next */
        const body = (req.body ?? {}) as { extra_prompt?: string | null };
        const extra = typeof body.extra_prompt === 'string' ? body.extra_prompt : null;

        const result = await startDryRun(agent, extra);
        return reply.status(202).send(result);
    });

    // ── Agent tests (ADR 0023) ─────────────────────────────────────────────
    //
    // A customer installing an agent from the marketplace does it on trust, and
    // one they wrote themselves cannot be qualified at all. These are what make
    // "does this agent work?" a question the product can answer.

    app.get('/api/agents/:id/tests', async (req, reply) => {
        const { id } = req.params as { id: string };
        if (!(await agentsService.get(id))) return reply.status(404).send({ error: 'Agent not found' });
        return reply.send(await agentTestsService.list(id));
    });

    /**
     * What one run of this agent is likely to cost, from its own history.
     *
     * Shown before the button is pressed. Spend that surprises you afterwards
     * is the thing that stops people running tests at all.
     */
    app.get('/api/agents/:id/cost-estimate', async (req, reply) => {
        const { id } = req.params as { id: string };
        if (!(await agentsService.get(id))) return reply.status(404).send({ error: 'Agent not found' });
        const { n } = req.query as { n?: string };
        const samples = Math.min(10, Math.max(1, Number.parseInt(n ?? '1', 10) || 1));
        const rows = await db
            .selectFrom('agent_runs')
            .select(['total_cost_usd'])
            .where('agent_id', '=', id)
            .where('status', '=', 'completed')
            .where('total_cost_usd', 'is not', null)
            .orderBy('created_at', 'desc')
            .limit(20)
            .execute();
        const costs = rows.map((r) => Number(r.total_cost_usd)).filter((n2) => Number.isFinite(n2));
        const mean = costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null;
        // The spread was always in the same 20 rows and always thrown away. A
        // mean alone reads as a promise; a range reads as what it is.
        const sorted = [...costs].sort((a, b) => a - b);
        const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
        const round = (v: number) => Number(v.toFixed(4));
        return reply.send({
            // Null rather than 0: "we do not know yet" and "it is free" are
            // different answers, and only one of them is honest here.
            estimated_cost_usd: mean === null ? null : round(mean),
            sample_size: costs.length,
            n_runs: samples,
            // What the Owner is actually about to spend. ADR 0023's "spend is
            // shown before it happens" is why this tab exists at all, and `n`
            // silently costing n-times would undo it.
            estimated_total_usd: mean === null ? null : round(mean * samples),
            estimated_range_usd:
                sorted.length === 0 ? null : [round((at(0.25) ?? 0) * samples), round((at(0.75) ?? 0) * samples)],
        });
    });

    /**
     * What this agent's own runs already prove (ADR 0023 phase 2, ATL-140).
     *
     * 515 `agent_runs` rows carrying cli, model, effort, token counts, cost and
     * outcome have sat unread since ADR 0014, snapshotted explicitly so agent
     * configurations could be compared. This is the route over them.
     *
     * **There is no `pass@1` in the response.** It returns `first_pass` split
     * three ways — applied / rejected / parked — because on the v4 golden set
     * `agent-release-reviewer` scored 64% for rejecting four times, and those
     * rejections were the most valuable thing in the run. A page that ranked
     * agents on the summed number would recommend culling the best reviewer in
     * the fleet, so the number is not offered.
     */
    app.get('/api/agents/:id/performance', async (req, reply) => {
        const { id } = req.params as { id: string };
        if (!(await agentsService.get(id))) return reply.status(404).send({ error: 'Agent not found' });
        const { since, until } = req.query as { since?: string; until?: string };
        return reply.send(
            await agentPerformance(id, {
                since: since ?? defaultSince(),
                ...(until ? { until } : {}),
            }),
        );
    });

    app.post('/api/agents/:id/tests', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        if (!(await agentsService.get(id))) return reply.status(404).send({ error: 'Agent not found' });
        const body = AgentTestBodySchema.parse(req.body ?? {});
        return reply.status(201).send(
            await agentTestsService.create({
                agent_id: id,
                project_id: body.project_id,
                repo_id: body.repo_id ?? null,
                name: body.name,
                item_template: body.item_template,
                ...(body.expectations ? { expectations: body.expectations } : {}),
            }),
        );
    });

    app.patch('/api/agent-tests/:testId', { preHandler: requireMcpToken }, async (req, reply) => {
        const { testId } = req.params as { testId: string };
        if (!(await agentTestsService.get(testId))) return reply.status(404).send({ error: 'Agent test not found' });
        const body = AgentTestPatchSchema.parse(req.body ?? {});
        return reply.send(await agentTestsService.update(testId, body));
    });

    app.delete('/api/agent-tests/:testId', { preHandler: requireMcpToken }, async (req, reply) => {
        const { testId } = req.params as { testId: string };
        await agentTestsService.remove(testId);
        return reply.status(204).send();
    });

    /** Flat runs. Kept so a client from before sampling keeps working. */
    app.get('/api/agent-tests/:testId/runs', async (req, reply) => {
        const { testId } = req.params as { testId: string };
        if (!(await agentTestsService.get(testId))) return reply.status(404).send({ error: 'Agent test not found' });
        return reply.send(await agentTestsService.listRuns(testId));
    });

    /** The same runs folded into the batches the Owner actually pressed. */
    app.get('/api/agent-tests/:testId/batches', async (req, reply) => {
        const { testId } = req.params as { testId: string };
        if (!(await agentTestsService.get(testId))) return reply.status(404).send({ error: 'Agent test not found' });
        return reply.send(await agentTestsService.listBatches(testId));
    });

    app.post('/api/agent-tests/:testId/run', { preHandler: requireMcpToken }, async (req, reply) => {
        const { testId } = req.params as { testId: string };
        if (!(await agentTestsService.get(testId))) return reply.status(404).send({ error: 'Agent test not found' });
        const body = AgentTestRunBodySchema.parse(req.body ?? {});
        // 202: the dispatches are asynchronous. Verdicts land when each run
        // finishes (`evaluateAgentTestRun`), so the batch comes back with
        // every sample still `running`.
        return reply.status(202).send(
            await agentTestsService.run(testId, {
                ...(body.n_runs !== undefined ? { n_runs: body.n_runs } : {}),
                ...(body.label !== undefined ? { label: body.label } : {}),
            }),
        );
    });

    app.post(
        '/api/agents/:id/prompt-versions/:version/revert',
        { preHandler: requireMcpToken },
        async (req, reply) => {
            const { id, version } = req.params as { id: string; version: string };
            if (!(await agentsService.get(id))) return reply.status(404).send({ error: 'Agent not found' });
            const v = Number(version);
            if (!Number.isInteger(v) || v < 1) {
                return reply.status(400).send({ error: 'Invalid version' });
            }
            try {
                const next = await agentsService.revertPrompt(id, v);
                return reply.send(next);
            } catch (e) {
                return reply.status(404).send({ error: (e as Error).message });
            }
        }
    );

    // ── Marketplace integration ─────────────────────────────────────────
    // Catalog-side endpoints (search, get, install, diff, export) live in
    // routes/marketplace.ts. The endpoints below are the LOCAL-agent side
    // of the same flow: accept a pending upgrade, dismiss it, detach the
    // back-link, or export the local agent as a zip.

    app.post(
        '/api/agents/:id/accept-upgrade',
        { preHandler: requireMcpToken },
        async (req, reply) => {
            const { id } = req.params as { id: string };
            /* v8 ignore next */
            const body = AcceptUpgradeBodySchema.parse(req.body ?? {});
            try {
                return reply.send(await marketplaceService.acceptUpgrade(id, body.fields));
            } catch (err) {
                if (err instanceof MarketplaceNotFoundError) {
                    return reply.status(404).send({ error: err.message });
                }
                throw err;
            }
        },
    );

    app.post(
        '/api/agents/:id/dismiss-upgrade',
        { preHandler: requireMcpToken },
        async (req, reply) => {
            const { id } = req.params as { id: string };
            try {
                return reply.send(await marketplaceService.dismissUpgrade(id));
            } catch (err) {
                if (err instanceof MarketplaceNotFoundError) {
                    return reply.status(404).send({ error: err.message });
                }
                throw err;
            }
        },
    );

    app.post('/api/agents/:id/detach', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        try {
            return reply.send(await marketplaceService.detach(id));
        } catch (err) {
            if (err instanceof MarketplaceNotFoundError) {
                return reply.status(404).send({ error: err.message });
            }
            throw err;
        }
    });

    app.get('/api/agents/:id/export', async (req, reply) => {
        const { id } = req.params as { id: string };
        try {
            const buf = await marketplaceService.exportLocalBundle(id);
            reply.header('Content-Type', 'application/zip');
            reply.header('Content-Disposition', `attachment; filename="${id}.zip"`);
            return reply.send(buf);
        } catch (err) {
            if (err instanceof MarketplaceNotFoundError) {
                return reply.status(404).send({ error: err.message });
            }
            throw err;
        }
    });

    app.post('/api/agents/import', { preHandler: requireMcpToken }, async (req, reply) => {
        // Two upload modes: multipart for browser uploads (file picker) and
        // raw application/zip for curl / MCP. We accept either to keep the
        // ergonomics open.
        let data: Buffer;
        let agentId: string | undefined;
        /* v8 ignore next */
        const ct = req.headers['content-type'] ?? '';
        if (ct.includes('multipart/form-data')) {
            const part = await (req as unknown as { file: () => Promise<{
                toBuffer: () => Promise<Buffer>;
                fields?: Record<string, unknown>;
            } | null> }).file();
            if (!part) return reply.status(400).send({ error: 'no file uploaded' });
            data = await part.toBuffer();
            const fields = part.fields as Record<string, unknown> | undefined;
            const idField = fields?.['agent_id'] as { value?: string } | undefined;
            agentId = idField?.value && idField.value.length > 0 ? idField.value : undefined;
        } else {
            const raw = req.body;
            if (!raw || !(raw instanceof Buffer)) {
                return reply.status(400).send({
                    error: 'expected application/zip body or multipart/form-data with a file part',
                });
            }
            data = raw;
            const query = req.query as { agent_id?: string };
            agentId = query.agent_id;
        }

        let bundle;
        try {
            bundle = await unpackAgentBundle(data);
        } catch (err) {
            if (err instanceof AgentBundleParseError) {
                return reply.status(400).send({ error: err.message });
            }
            /* v8 ignore next */
            throw err;
        }
        try {
            const installed = await marketplaceService.importBundle(bundle, {
                agent_id: agentId,
            });
            return reply.status(201).send(installed);
        } catch (err) {
            if (err instanceof MarketplaceSlugTakenError) {
                return reply.status(409).send({
                    error: err.message,
                    kind: 'conflict',
                    details: {
                        code: 'SLUG_TAKEN',
                        conflicting_id: err.conflictingId,
                        suggested_id: err.suggestedId,
                    },
                });
            }
            // The bundle names a model absent from cli_models. Without this
            // the composite FK on agents(cli, model) surfaces as a raw 500.
            if (err instanceof ModelNotInRegistryError) {
                return reply.status(400).send({ error: err.message, code: err.code });
            }
            /* v8 ignore next */
            throw err;
        }
    });
}
