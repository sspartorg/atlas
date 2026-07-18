import type { FastifyInstance } from 'fastify';
import { searchItems } from '../services/items.js';
import type { IssueStatus } from '@atlas/shared';
import type { ItemType } from '../db/types.js';

const VALID_TYPES = new Set<ItemType>(['epic', 'story', 'sub_task', 'sub_bug', 'bug']);
const VALID_STATUSES = new Set<IssueStatus>([
    'draft',
    'ready',
    'in_progress',
    'waiting_for_info',
    'in_review',
    'done',
]);

const VALID_UPDATED = new Set(['today', 'last_7_days', 'last_30_days', 'older']);

interface SearchQuery {
    q?: string;
    /** Comma-separated list of item types. Unknown values are ignored. */
    type?: string;
    /** Comma-separated list of project ids. */
    project_id?: string;
    /** Comma-separated list of agent ids (assignee). */
    agent_id?: string;
    status?: string;
    /** One of: today, last_7_days, last_30_days, older. */
    updated?: string;
    /**
     * Task 2 — comma-separated label values; the search returns items
     * carrying ALL of the supplied labels (jsonb `@>` containment).
     */
    labels?: string;
    limit?: string;
}

interface SearchResult {
    issue_type: string;
    issue_id: string;
    title: string;
    description: string;
    status: string;
    project_id: string;
    assignee_agent_id: string | null;
    updated_at: string;
    rank: number;
}

function splitCsv(s: string | undefined): string[] {
    if (!s) return [];
    return s
        .split(',')
        .map((x) => x.trim())
        .filter((x) => x.length > 0);
}

function updatedRangeBounds(range: string | undefined): {
    updated_after?: string;
    updated_before?: string;
} {
    if (!range || !VALID_UPDATED.has(range)) return {};
    const now = Date.now();
    const day = 86_400_000;
    if (range === 'today') return { updated_after: new Date(now - day).toISOString() };
    if (range === 'last_7_days') return { updated_after: new Date(now - 7 * day).toISOString() };
    if (range === 'last_30_days') return { updated_after: new Date(now - 30 * day).toISOString() };
    if (range === 'older') return { updated_before: new Date(now - 30 * day).toISOString() };
    /* v8 ignore next */
    return {};
}

// P14 — server-side full-text + filter search backing the Search page.
// Returns the same per-row shape the page needs to render (status,
// assignee, project, updated_at, plus the rank for sort ordering) so
// the client no longer has to fetch every entity kind separately and
// filter in memory.
export async function searchRoutes(app: FastifyInstance) {
    app.get('/api/search', async (req, reply) => {
        const params = req.query as SearchQuery;
        const q = params.q?.trim() ?? '';

        // A filter-only request (no q) is valid; only block totally-empty
        // queries with no filters so we don't return the full table.
        const hasAnyFilter = Boolean(
            params.type ||
                params.project_id ||
                params.agent_id ||
                params.status ||
                params.updated ||
                params.labels,
        );
        if (q.length < 2 && !hasAnyFilter) return reply.send([]);

        const types = splitCsv(params.type).filter((t): t is ItemType =>
            VALID_TYPES.has(t as ItemType),
        );
        const projectIds = splitCsv(params.project_id);
        const agentIds = splitCsv(params.agent_id);
        const labels = splitCsv(params.labels);
        const statusRaw = params.status?.trim();
        const status =
            statusRaw && VALID_STATUSES.has(statusRaw as IssueStatus)
                ? (statusRaw as IssueStatus)
                : undefined;
        const { updated_after, updated_before } = updatedRangeBounds(params.updated);
        const limitRaw = Number.parseInt(params.limit ?? '', 10);
        const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50;

        const hits = await searchItems(
            {
                ...(q.length >= 2 ? { q } : {}),
                ...(types.length > 0 ? { types } : {}),
                ...(projectIds.length > 0 ? { project_ids: projectIds } : {}),
                ...(agentIds.length > 0 ? { agent_ids: agentIds } : {}),
                ...(status ? { status } : {}),
                ...(updated_after ? { updated_after } : {}),
                ...(updated_before ? { updated_before } : {}),
                ...(labels.length > 0 ? { labels } : {}),
            },
            limit,
        );
        const out: SearchResult[] = hits.map((h) => ({
            issue_type: h.type,
            issue_id: h.id,
            title: h.title,
            /* v8 ignore next */
            description: h.description ?? '',
            status: h.status,
            project_id: h.project_id,
            assignee_agent_id: h.assignee_agent_id,
            updated_at: h.updated_at,
            rank: h.rank,
        }));
        return reply.send(out);
    });
}
