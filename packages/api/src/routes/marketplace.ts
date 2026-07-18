import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
    marketplaceService,
    MarketplaceSlugTakenError,
    MarketplaceNotFoundError,
} from '../services/marketplace.js';
import { requireMcpToken } from '../plugins/mcp-auth.js';
import { broadcastSSE } from './events.js';
import type { AgentCategory, AgentKindSlug } from '@atlas/shared';

const CATEGORY_VALUES = ['software-dev', 'marketing', 'content', 'design'] as const;
const KIND_SLUG_VALUES = [
    'ai-news',
    'market-research',
    'regulations',
    'jira-to-epic',
    'ai-readiness',
    'knowledge-base',
    'custom',
] as const;

const SearchQuerySchema = z.object({
    q: z.string().optional(),
    category: z.enum(CATEGORY_VALUES).optional(),
    kind: z.enum(KIND_SLUG_VALUES).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
});

const InstallBodySchema = z.object({
    /** Optional override slug for the new local agent. When the default
     *  (= catalog id) is already taken locally, the modal sends a fresh
     *  slug here on retry. */
    agent_id: z.string().min(1).max(120).optional(),
});

export async function marketplaceRoutes(app: FastifyInstance) {
    app.get('/api/marketplace/agents', async (req, reply) => {
        /* v8 ignore next */
        const query = SearchQuerySchema.parse(req.query ?? {});
        const result = await marketplaceService.search({
            query: query.q,
            category: query.category as AgentCategory | undefined,
            kind_slug: query.kind as AgentKindSlug | undefined,
            limit: query.limit,
        });
        return reply.send(result);
    });

    app.get('/api/marketplace/agents/:id', async (req, reply) => {
        const { id } = req.params as { id: string };
        const full = await marketplaceService.getFull(id);
        if (!full) return reply.status(404).send({ error: 'Marketplace agent not found' });
        return reply.send(full);
    });

    app.post(
        '/api/marketplace/agents/:id/install',
        { preHandler: requireMcpToken },
        async (req, reply) => {
            const { id } = req.params as { id: string };
            /* v8 ignore next */
            const body = InstallBodySchema.parse(req.body ?? {});
            try {
                const installed = await marketplaceService.install(id, {
                    agent_id: body.agent_id,
                });
                // Notify all connected clients that the installed-agent set
                // changed. The web's useSSE handler invalidates
                // ['sidenav-counts'] (which feeds the sidenav "Agents" badge)
                // on this event — without it the badge sits at the stale
                // count until a hard refresh.
                broadcastSSE({ type: 'counts_changed' });
                return reply.status(201).send(installed);
            } catch (err) {
                if (err instanceof MarketplaceSlugTakenError) {
                    // details carries the structured retry hints — the web
                    // client reads them off the thrown AtlasApiError.
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
                if (err instanceof MarketplaceNotFoundError) {
                    return reply.status(404).send({ error: err.message });
                }
                throw err;
            }
        },
    );

    app.get('/api/marketplace/agents/:catalog_id/diff/:agent_id', async (req, reply) => {
        const { catalog_id, agent_id } = req.params as { catalog_id: string; agent_id: string };
        try {
            return reply.send(await marketplaceService.diff(catalog_id, agent_id));
        } catch (err) {
            if (err instanceof MarketplaceNotFoundError) {
                return reply.status(404).send({ error: err.message });
            }
            throw err;
        }
    });

    app.get('/api/marketplace/agents/:id/export', async (req, reply) => {
        const { id } = req.params as { id: string };
        try {
            const buf = await marketplaceService.exportCatalogBundle(id);
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
}
