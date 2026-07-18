import type { FastifyInstance } from 'fastify';
import { environmentSecretsService } from '../services/environment-secrets.js';
import { requireMcpToken } from '../plugins/mcp-auth.js';

// 2026-06-10 — Global tier of the two-scope secrets model. Replace-all
// PUT semantics mirror `PUT /api/projects/:id/env` (see projects.ts:406);
// the same UPPER_SNAKE_CASE key regex keeps both tiers compatible with
// the substitution engine's identifier rule.
const KEY_RE = /^[A-Z][A-Z0-9_]*$/;

export async function environmentSecretsRoutes(app: FastifyInstance) {
    // Batch-9 enterprise-secrets read model: metadata-only listing. The
    // plaintext value never crosses the wire on this route; the Owner
    // clicks per-row Reveal in the UI which hits GET
    // /api/environment-secrets/:key/value for a single decrypt.
    app.get('/api/environment-secrets', async (_req, reply) => {
        const vars = await environmentSecretsService.listMetadata();
        return reply.send({ vars });
    });

    // On-demand reveal for a single stored secret. Requires the same
    // MCP-token gate as writes — matches enterprise secret-store
    // behaviour where reveal is an authenticated + auditable action,
    // not a batch broadcast on every settings-tab render.
    app.get(
        '/api/environment-secrets/:key/value',
        { preHandler: requireMcpToken },
        async (req, reply) => {
            const { key } = req.params as { key: string };
            if (!KEY_RE.test(key)) {
                return reply.status(400).send({
                    error: `Invalid key "${key}" — must be UPPER_SNAKE_CASE`,
                    kind: 'validation_error',
                });
            }
            const value = await environmentSecretsService.revealOne(key);
            if (value === null) {
                return reply.status(404).send({ error: 'Secret not found' });
            }
            req.log.info({ tag: 'secret_reveal', scope: 'environment', key }, 'secret revealed');
            return reply.send({ key, value });
        },
    );

    app.put(
        '/api/environment-secrets',
        { preHandler: requireMcpToken },
        async (req, reply) => {
            const raw = req.body as { vars?: unknown };
            if (!raw || !Array.isArray(raw.vars)) {
                return reply
                    .status(400)
                    .send({ error: 'Expected { vars: Array<{key,value}> }' });
            }
            const seen = new Set<string>();
            const next: Array<{ key: string; value: string }> = [];
            for (const item of raw.vars) {
                const v = item as { key?: unknown; value?: unknown };
                if (typeof v.key !== 'string' || typeof v.value !== 'string') {
                    return reply
                        .status(400)
                        .send({ error: 'Each row must have string key and value' });
                }
                if (!KEY_RE.test(v.key)) {
                    return reply
                        .status(400)
                        .send({ error: `Invalid key "${v.key}" — must be UPPER_SNAKE_CASE` });
                }
                if (seen.has(v.key)) {
                    return reply.status(400).send({ error: `Duplicate key "${v.key}"` });
                }
                seen.add(v.key);
                next.push({ key: v.key, value: v.value });
            }
            await environmentSecretsService.replaceAll(next);
            // Post-write response is also metadata-only — the caller
            // already knows what they just sent; the UI just needs the
            // new updated_at timestamps.
            return reply.send({ vars: await environmentSecretsService.listMetadata() });
        },
    );
}
