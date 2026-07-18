import type { FastifyInstance } from 'fastify';
import { db } from '../db/kysely-client.js';
import type { IToolCatalogEntry, IToolCatalogGroup } from '@atlas/shared';

// Read-only directory of every Atlas MCP tool the server exposes. Owner-
// facing for discoverability; no enforcement attached (per-agent allowlists
// were dropped 2026-05-27 along with the spawned-CLI --tools flag).

export async function toolCatalogRoutes(app: FastifyInstance) {
    app.get('/api/tool-catalog', async (_req, reply) => {
        const rows = (await db
            .selectFrom('tool_catalog')
            .selectAll()
            .orderBy('sort_order', 'asc')
            .orderBy('tool_name', 'asc')
            .execute()) as unknown as IToolCatalogEntry[];

        const grouped = new Map<string, IToolCatalogGroup>();
        for (const r of rows) {
            let g = grouped.get(r.group_name);
            if (!g) {
                g = { group_name: r.group_name, tools: [] };
                grouped.set(r.group_name, g);
            }
            g.tools.push({ tool_name: r.tool_name, description: r.description });
        }
        return reply.send({ groups: Array.from(grouped.values()) });
    });
}
