import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { db } from '../db/kysely-client.js';

// Task 1 — per-project labels autocomplete. The Search page (Task 2)
// and the item-detail Labels editor both call this to surface known
// values without listing every item. Cheap query: a DISTINCT over
// `jsonb_array_elements_text(labels)` filtered by `project_id`. The
// GIN index from migration 083 lets PG pick the matching rows quickly.
//
// Read-only; no `requireMcpToken` — the web client calls this directly
// to populate autocompletes, matching how other read routes (epics,
// stories, search) are exposed.

export async function labelsRoutes(app: FastifyInstance): Promise<void> {
    app.get('/api/labels', async (req, reply) => {
        const q = req.query as { project_id?: string };
        let query = db
            .selectFrom('items')
            .select(sql<string>`DISTINCT jsonb_array_elements_text(labels)`.as('label'));
        if (q.project_id) {
            query = query.where('project_id', '=', q.project_id);
        }
        const rows = await query.execute();
        const labels = rows
            .map((r) => (r as unknown as { label: string }).label)
            .filter((l): l is string => typeof l === 'string' && l.length > 0)
            .sort((a, b) => a.localeCompare(b));
        return reply.send({ labels });
    });
}
