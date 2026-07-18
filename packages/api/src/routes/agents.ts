import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/kysely-client.js';
import {
    agentsService,
    ModelNotInRegistryError,
    CronExpressionInvalidError,
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
import {
    AgentChecklistsPutSchema,
    AgentHandoffRulesPutSchema,
    AgentMemoryUpdateSchema,
    CreateAgentSchema,
    RUNNABLE_ISSUE_TYPES,
    UpdateAgentSchema,
    type IssueType,
} from '@atlas/shared';

const AcceptUpgradeBodySchema = z.object({
    fields: z
        .array(
            z.enum([
                'prompt_md',
                'handoff_prompt_md',
                'settings_json',
                'handoff_rules',
                'checklists',
            ]),
        )
        .min(1),
});

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
            if (
                err instanceof ModelNotInRegistryError ||
                err instanceof CronExpressionInvalidError
            ) {
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
            if (
                err instanceof ModelNotInRegistryError ||
                err instanceof CronExpressionInvalidError
            ) {
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

    app.get('/api/agents/:id/handoff-rules', async (req, reply) => {
        const { id } = req.params as { id: string };
        return reply.send(await agentsService.getHandoffRules(id));
    });

    app.put(
        '/api/agents/:id/handoff-rules',
        { preHandler: requireMcpToken },
        async (req, reply) => {
            const { id } = req.params as { id: string };
            const body = AgentHandoffRulesPutSchema.parse(req.body);
            await agentsService.setHandoffRules(id, body.rules);
            return reply.send(await agentsService.getHandoffRules(id));
        }
    );

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

        // Freedom-mode agents (`requires_item = false`) can preview a prompt
        // with no item — the builder emits the freedom preamble. Item-driven
        // agents still require both fields.
        if (!hasItem && agent.requires_item) {
            return reply
                .status(400)
                .send({ error: 'issue_type and issue_id are required' });
        }
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
            /* v8 ignore next */
            throw err;
        }
    });
}
