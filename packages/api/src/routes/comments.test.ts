import { describe, expect, it, beforeEach, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

vi.mock('../routes/events.js', () => ({
    eventsRoutes: async () => {
        /* no-op */
    },
    broadcastSSE: vi.fn(),
}));

import { buildApp } from '../server.js';
import { truncateAll, closeTestDb, testDb } from '../../tests/_pg-db.js';
import { insertProject, insertAgent, insertItem } from '../../tests/_items.js';
import { commentsService } from '../services/comments.js';
import type { IComment, IActivityItem } from '@atlas/shared';

let app: FastifyInstance;

// Build the Fastify app once for the whole file — every test only needs
// a fresh DB state, not a fresh server. This shaves ~2-3s/case under
// load (sibling worktrees pressuring the same PG) and matches the
// pattern in `settings.test.ts`.
beforeEach(async () => {
    await truncateAll();
    await insertProject('p1', 'ATL');
    await insertAgent({ id: 'agent-coder' });
    await insertAgent({ id: 'agent-reviewer' });
    await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'E' });
    if (!app) {
        app = await buildApp({ logger: false });
        await app.ready();
    }
});

afterAll(async () => {
    if (app) await app.close();
    await closeTestDb();
});

describe('DELETE /api/comments/:id', () => {
    it('returns 400 for a non-numeric id', async () => {
        const res = await app.inject({
            method: 'DELETE',
            url: '/api/comments/not-a-number',
        });
        expect(res.statusCode).toBe(400);
    });

    it('returns 404 when the comment does not exist', async () => {
        const res = await app.inject({
            method: 'DELETE',
            url: '/api/comments/99999',
        });
        expect(res.statusCode).toBe(404);
    });

    it('owner (no actor_agent_id) can soft-delete an owner comment', async () => {
        const created = await commentsService.create({
            author: 'owner',
            issue_type: 'epic',
            issue_id: 'ATL-1',
            body: 'first thought',
        });

        const res = await app.inject({
            method: 'DELETE',
            url: `/api/comments/${created.id}`,
        });
        expect(res.statusCode).toBe(204);

        // The row stays on disk with deleted_at populated.
        const row = await testDb
            .selectFrom('comments')
            .selectAll()
            .where('id', '=', created.id)
            .executeTakeFirst();
        expect(row).toBeDefined();
        expect(row!.deleted_at).not.toBeNull();

        // listComments hides it.
        const list = await commentsService.list('epic', 'ATL-1');
        expect(list.find((c: IComment) => c.id === created.id)).toBeUndefined();
    });

    it('owner can soft-delete an agent comment', async () => {
        const created = await commentsService.create({
            author: 'agent',
            agent_id: 'agent-coder',
            issue_type: 'epic',
            issue_id: 'ATL-1',
            body: 'starting work',
        });

        const res = await app.inject({
            method: 'DELETE',
            url: `/api/comments/${created.id}`,
        });
        expect(res.statusCode).toBe(204);

        const list = await commentsService.list('epic', 'ATL-1');
        expect(list).toHaveLength(0);
    });

    it('agent can soft-delete its own comment via actor_agent_id', async () => {
        const created = await commentsService.create({
            author: 'agent',
            agent_id: 'agent-coder',
            issue_type: 'epic',
            issue_id: 'ATL-1',
            body: 'mine',
        });

        const res = await app.inject({
            method: 'DELETE',
            url: `/api/comments/${created.id}?actor_agent_id=agent-coder`,
        });
        expect(res.statusCode).toBe(204);
    });

    it('agent cannot delete another agent’s comment', async () => {
        const created = await commentsService.create({
            author: 'agent',
            agent_id: 'agent-coder',
            issue_type: 'epic',
            issue_id: 'ATL-1',
            body: 'mine',
        });

        const res = await app.inject({
            method: 'DELETE',
            url: `/api/comments/${created.id}?actor_agent_id=agent-reviewer`,
        });
        expect(res.statusCode).toBe(403);

        // Still visible — not soft-deleted on the failed call.
        const list = await commentsService.list('epic', 'ATL-1');
        expect(list).toHaveLength(1);
    });

    it('agent cannot delete an owner comment', async () => {
        const created = await commentsService.create({
            author: 'owner',
            issue_type: 'epic',
            issue_id: 'ATL-1',
            body: 'owner says',
        });

        const res = await app.inject({
            method: 'DELETE',
            url: `/api/comments/${created.id}?actor_agent_id=agent-coder`,
        });
        expect(res.statusCode).toBe(403);
    });

    it('a second DELETE on the same comment returns 404', async () => {
        const created = await commentsService.create({
            author: 'owner',
            issue_type: 'epic',
            issue_id: 'ATL-1',
            body: 'once',
        });

        const first = await app.inject({
            method: 'DELETE',
            url: `/api/comments/${created.id}`,
        });
        expect(first.statusCode).toBe(204);

        const second = await app.inject({
            method: 'DELETE',
            url: `/api/comments/${created.id}`,
        });
        expect(second.statusCode).toBe(404);
    });

    it('soft-deleted comments disappear from the activity feed', async () => {
        const a = await commentsService.create({
            author: 'owner',
            issue_type: 'epic',
            issue_id: 'ATL-1',
            body: 'keep me',
        });
        const b = await commentsService.create({
            author: 'owner',
            issue_type: 'epic',
            issue_id: 'ATL-1',
            body: 'delete me',
        });

        const del = await app.inject({
            method: 'DELETE',
            url: `/api/comments/${b.id}`,
        });
        expect(del.statusCode).toBe(204);

        const res = await app.inject({
            method: 'GET',
            url: '/api/issues/epic/ATL-1/activity',
        });
        expect(res.statusCode).toBe(200);
        const items = JSON.parse(res.body) as IActivityItem[];
        const commentItems = items.filter(
            (it): it is Extract<IActivityItem, { kind: 'comment' }> => it.kind === 'comment',
        );
        const ids = commentItems.map((it) => it.data.id);
        expect(ids).toContain(a.id);
        expect(ids).not.toContain(b.id);
    });
});

// ── Additional coverage for comments routes ────────────────────────────────

describe('GET /api/comments', () => {
    it('returns 200 with an empty array when no comments exist', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/comments?issue_type=epic&issue_id=ATL-1',
        });
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual([]);
    });

    it('returns 200 with comments for a given issue', async () => {
        await commentsService.create({
            author: 'owner',
            issue_type: 'epic',
            issue_id: 'ATL-1',
            body: 'hello',
        });
        const res = await app.inject({
            method: 'GET',
            url: '/api/comments?issue_type=epic&issue_id=ATL-1',
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as IComment[];
        expect(body).toHaveLength(1);
        expect(body[0].body).toBe('hello');
    });
});

describe('POST /api/comments', () => {
    it('returns 201 on valid payload', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/comments',
            payload: {
                author: 'owner',
                issue_type: 'epic',
                issue_id: 'ATL-1',
                body: 'new comment',
            },
        });
        expect(res.statusCode).toBe(201);
        const body = JSON.parse(res.body) as IComment;
        expect(body.body).toBe('new comment');
        expect(body.author).toBe('owner');
    });

    it('returns 400 when Zod validation fails (missing required fields)', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/comments',
            payload: { body: 'no issue_type or issue_id' },
        });
        expect(res.statusCode).toBe(400);
    });
});

describe('PATCH /api/comments/:id', () => {
    it('returns 200 on successful update', async () => {
        const created = await commentsService.create({
            author: 'owner',
            issue_type: 'epic',
            issue_id: 'ATL-1',
            body: 'original text',
        });
        const res = await app.inject({
            method: 'PATCH',
            url: `/api/comments/${created.id}`,
            payload: { body: 'updated text' },
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as IComment;
        expect(body.body).toBe('updated text');
    });

    it('returns 404 when comment does not exist', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/comments/99999',
            payload: { body: 'whatever' },
        });
        expect(res.statusCode).toBe(404);
    });

    it('returns 400 for a non-numeric id', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/comments/not-a-number',
            payload: { body: 'whatever' },
        });
        expect(res.statusCode).toBe(400);
    });
});

describe('GET /api/issues/:type/:id/activity', () => {
    it('returns 200 for a valid issue type', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/issues/epic/ATL-1/activity',
        });
        expect(res.statusCode).toBe(200);
        expect(Array.isArray(JSON.parse(res.body))).toBe(true);
    });

    it('returns 400 for an invalid issue type', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/issues/invalid-type/ATL-1/activity',
        });
        expect(res.statusCode).toBe(400);
    });
});

describe('GET /api/issues/:type/:id/links', () => {
    it('returns 200 with an empty array when no links exist', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/issues/epic/ATL-1/links',
        });
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual([]);
    });

    it('returns 400 for an invalid issue type', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/issues/bogus-type/ATL-1/links',
        });
        expect(res.statusCode).toBe(400);
    });
});

describe('POST /api/issues/:type/:id/links', () => {
    it('returns 201 when creating a valid link between two items', async () => {
        await insertItem({
            id: 'ATL-2',
            type: 'story',
            project_id: 'p1',
            parent_id: 'ATL-1',
            parent_type: 'epic',
            title: 'Story',
        });
        const res = await app.inject({
            method: 'POST',
            url: '/api/issues/epic/ATL-1/links',
            payload: { to_type: 'story', to_id: 'ATL-2' },
        });
        expect(res.statusCode).toBe(201);
    });

    it('returns 400 for a self-link', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/issues/epic/ATL-1/links',
            payload: { to_type: 'epic', to_id: 'ATL-1' },
        });
        expect(res.statusCode).toBe(400);
    });

    it('returns 400 for an invalid issue type', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/issues/not-a-type/ATL-1/links',
            payload: { to_type: 'story', to_id: 'ATL-2' },
        });
        expect(res.statusCode).toBe(400);
    });
});

describe('DELETE /api/issues/links/:linkId', () => {
    it('returns 204 on successful delete of a link', async () => {
        await insertItem({
            id: 'ATL-2',
            type: 'story',
            project_id: 'p1',
            parent_id: 'ATL-1',
            parent_type: 'epic',
            title: 'Story',
        });
        const createRes = await app.inject({
            method: 'POST',
            url: '/api/issues/epic/ATL-1/links',
            payload: { to_type: 'story', to_id: 'ATL-2' },
        });
        expect(createRes.statusCode).toBe(201);
        const created = JSON.parse(createRes.body) as { id: number };

        const res = await app.inject({
            method: 'DELETE',
            url: `/api/issues/links/${created.id}`,
        });
        expect(res.statusCode).toBe(204);
    });

    it('returns 400 for a non-numeric link id', async () => {
        const res = await app.inject({
            method: 'DELETE',
            url: '/api/issues/links/not-a-number',
        });
        expect(res.statusCode).toBe(400);
    });
});

describe('GET /api/issues/:type/:id/reply-context', () => {
    it('returns 200 with context for an existing epic', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/issues/epic/ATL-1/reply-context',
        });
        expect(res.statusCode).toBe(200);
    });

    it('returns 404 when the item does not exist', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/issues/epic/ATL-9999/reply-context',
        });
        expect(res.statusCode).toBe(404);
    });

    it('returns 400 for an invalid issue type', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/issues/not-valid/ATL-1/reply-context',
        });
        expect(res.statusCode).toBe(400);
    });
});

describe('POST /api/issues/:type/:id/reply', () => {
    it('returns 201 with comment and context for an existing epic', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/issues/epic/ATL-1/reply',
            payload: { author: 'owner', body: 'a reply' },
        });
        expect(res.statusCode).toBe(201);
        const body = JSON.parse(res.body) as { comment: IComment; context: unknown };
        expect(body.comment.body).toBe('a reply');
        expect(body.context).toBeDefined();
    });

    it('returns 404 when the item does not exist', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/issues/epic/ATL-9999/reply',
            payload: { author: 'owner', body: 'ghost reply' },
        });
        expect(res.statusCode).toBe(404);
    });

    it('returns 400 for an invalid issue type', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/issues/bad-type/ATL-1/reply',
            payload: { author: 'owner', body: 'typed wrong' },
        });
        expect(res.statusCode).toBe(400);
    });
});

// ---------------------------------------------------------------------------
// POST /api/issues/:type/:id/links — uncovered link error reasons (CMNT-LINK)
// ---------------------------------------------------------------------------
describe('POST /api/issues/:type/:id/links — all error reason branches (CMNT-LINK)', () => {
    it('returns 400 with "Source ... not found" when from-item does not exist (CMNT-LINK-1)', async () => {
        // ATL-9999 doesn't exist → reason='missing_from'
        const res = await app.inject({
            method: 'POST',
            url: '/api/issues/epic/ATL-9999/links',
            payload: { to_type: 'story', to_id: 'ATL-1' },
        });
        expect(res.statusCode).toBe(400);
        expect(JSON.parse(res.body).error).toMatch(/Source epic not found/);
        expect(JSON.parse(res.body).reason).toBe('missing_from');
    });

    it('returns 400 with "Target ... not found" when to-item does not exist (CMNT-LINK-2)', async () => {
        // ATL-1 exists (epic), ATL-8888 does not → reason='missing_to'
        const res = await app.inject({
            method: 'POST',
            url: '/api/issues/epic/ATL-1/links',
            payload: { to_type: 'story', to_id: 'ATL-8888' },
        });
        expect(res.statusCode).toBe(400);
        expect(JSON.parse(res.body).error).toMatch(/Target story not found/);
        expect(JSON.parse(res.body).reason).toBe('not_found');
    });

    it('returns 400 with "Would create a dependency cycle" for a cycle (CMNT-LINK-3)', async () => {
        // Create a second item and a depends_on link from ATL-1 → ATL-2,
        // then attempt ATL-2 → ATL-1 with depends_on to create a cycle.
        await insertItem({
            id: 'ATL-2',
            type: 'story',
            project_id: 'p1',
            parent_id: 'ATL-1',
            parent_type: 'epic',
            title: 'Story',
        });
        // First link: ATL-1 → ATL-2 (depends_on)
        const first = await app.inject({
            method: 'POST',
            url: '/api/issues/epic/ATL-1/links',
            payload: { to_type: 'story', to_id: 'ATL-2', relation_type: 'depends_on' },
        });
        expect(first.statusCode).toBe(201);
        // Cyclic link: ATL-2 → ATL-1 with depends_on → cycle detected
        const res = await app.inject({
            method: 'POST',
            url: '/api/issues/story/ATL-2/links',
            payload: { to_type: 'epic', to_id: 'ATL-1', relation_type: 'depends_on' },
        });
        expect(res.statusCode).toBe(400);
        expect(JSON.parse(res.body).error).toMatch(/cycle/i);
        expect(JSON.parse(res.body).reason).toBe('cycle');
    });
});

describe('GET /api/issues/:type/:id/external-links', () => {
    it('returns 200 with an empty array when no links exist', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/issues/epic/ATL-1/external-links',
        });
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual([]);
    });

    it('returns 400 for an invalid issue type', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/issues/banana/ATL-1/external-links',
        });
        expect(res.statusCode).toBe(400);
    });

    it('returns links newest-first', async () => {
        const a = await app.inject({
            method: 'POST',
            url: '/api/issues/epic/ATL-1/external-links',
            payload: { link_kind: 'pull_request', url: 'https://github.com/o/r/pull/1' },
        });
        expect(a.statusCode).toBe(201);
        const b = await app.inject({
            method: 'POST',
            url: '/api/issues/epic/ATL-1/external-links',
            payload: { link_kind: 'pull_request', url: 'https://github.com/o/r/pull/2' },
        });
        expect(b.statusCode).toBe(201);
        const res = await app.inject({
            method: 'GET',
            url: '/api/issues/epic/ATL-1/external-links',
        });
        expect(res.statusCode).toBe(200);
        const rows = JSON.parse(res.body) as Array<{ url: string }>;
        expect(rows.map((r) => r.url)).toEqual([
            'https://github.com/o/r/pull/2',
            'https://github.com/o/r/pull/1',
        ]);
    });
});

describe('POST /api/issues/:type/:id/external-links', () => {
    it('returns 201 with the new link for a valid GitHub PR URL', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/issues/epic/ATL-1/external-links',
            payload: {
                link_kind: 'pull_request',
                url: 'https://github.com/foo/bar/pull/42',
            },
        });
        expect(res.statusCode).toBe(201);
        const body = JSON.parse(res.body);
        expect(body.item_id).toBe('ATL-1');
        expect(body.link_kind).toBe('pull_request');
        expect(body.url).toBe('https://github.com/foo/bar/pull/42');
        expect(body.external_ref).toBe('42');
    });

    it('returns 201 idempotently — same URL twice returns the same id', async () => {
        const first = await app.inject({
            method: 'POST',
            url: '/api/issues/epic/ATL-1/external-links',
            payload: {
                link_kind: 'pull_request',
                url: 'https://github.com/foo/bar/pull/9',
            },
        });
        const second = await app.inject({
            method: 'POST',
            url: '/api/issues/epic/ATL-1/external-links',
            payload: {
                link_kind: 'pull_request',
                url: 'https://github.com/foo/bar/pull/9',
            },
        });
        expect(first.statusCode).toBe(201);
        expect(second.statusCode).toBe(201);
        expect(JSON.parse(second.body).id).toBe(JSON.parse(first.body).id);
    });

    it('returns 400 when pull_request URL is not a GitHub PR', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/issues/epic/ATL-1/external-links',
            payload: {
                link_kind: 'pull_request',
                url: 'https://github.com/foo/bar/issues/123',
            },
        });
        expect(res.statusCode).toBe(400);
        expect(JSON.parse(res.body).error).toMatch(/pull_request URL/i);
    });

    it('returns 400 when body fails Zod (no url)', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/issues/epic/ATL-1/external-links',
            payload: { link_kind: 'pull_request' },
        });
        expect(res.statusCode).toBe(400);
    });

    it('returns 404 when the item does not exist', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/issues/epic/NOPE-999/external-links',
            payload: {
                link_kind: 'pull_request',
                url: 'https://github.com/foo/bar/pull/1',
            },
        });
        expect(res.statusCode).toBe(404);
    });

    it('returns 400 for an invalid issue type', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/issues/banana/ATL-1/external-links',
            payload: {
                link_kind: 'pull_request',
                url: 'https://github.com/foo/bar/pull/1',
            },
        });
        expect(res.statusCode).toBe(400);
    });

    it('honors a client-supplied title (skips gh fetch)', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/issues/epic/ATL-1/external-links',
            payload: {
                link_kind: 'pull_request',
                url: 'https://github.com/foo/bar/pull/7',
                title: 'feat: brought my own title',
            },
        });
        expect(res.statusCode).toBe(201);
        expect(JSON.parse(res.body).title).toBe('feat: brought my own title');
    });
});

describe('DELETE /api/issues/external-links/:linkId', () => {
    it('returns 204 on successful delete', async () => {
        const created = await app.inject({
            method: 'POST',
            url: '/api/issues/epic/ATL-1/external-links',
            payload: {
                link_kind: 'pull_request',
                url: 'https://github.com/foo/bar/pull/5',
            },
        });
        const id = JSON.parse(created.body).id as number;
        const del = await app.inject({
            method: 'DELETE',
            url: `/api/issues/external-links/${id}`,
        });
        expect(del.statusCode).toBe(204);
        const after = await app.inject({
            method: 'GET',
            url: '/api/issues/epic/ATL-1/external-links',
        });
        expect(JSON.parse(after.body)).toEqual([]);
    });

    it('returns 400 for a non-numeric id', async () => {
        const res = await app.inject({
            method: 'DELETE',
            url: '/api/issues/external-links/not-a-number',
        });
        expect(res.statusCode).toBe(400);
    });

    it('returns 204 even for an unknown id (delete is idempotent)', async () => {
        const res = await app.inject({
            method: 'DELETE',
            url: '/api/issues/external-links/999999',
        });
        expect(res.statusCode).toBe(204);
    });
});

// ---------------------------------------------------------------------------
// Extra branch coverage — gaps identified from ~88% baseline (CMNT-EXTRA)
// ---------------------------------------------------------------------------

describe('PATCH /api/comments/:id — Zod rejection (CMNT-EXTRA)', () => {
    it('returns 400 when body field is missing from payload (CMNT-EXTRA-1)', async () => {
        const created = await commentsService.create({
            author: 'owner',
            issue_type: 'epic',
            issue_id: 'ATL-1',
            body: 'to be patched',
        });
        const res = await app.inject({
            method: 'PATCH',
            url: `/api/comments/${created.id}`,
            payload: {},
        });
        expect(res.statusCode).toBe(400);
    });

    it('returns 400 when body is an empty string (CMNT-EXTRA-2)', async () => {
        const created = await commentsService.create({
            author: 'owner',
            issue_type: 'epic',
            issue_id: 'ATL-1',
            body: 'to be patched',
        });
        const res = await app.inject({
            method: 'PATCH',
            url: `/api/comments/${created.id}`,
            payload: { body: '' },
        });
        expect(res.statusCode).toBe(400);
    });
});

describe('POST /api/issues/:type/:id/reply — Zod rejection (CMNT-EXTRA)', () => {
    it('returns 400 when body field is missing (CMNT-EXTRA-3)', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/issues/epic/ATL-1/reply',
            payload: { author: 'owner' },
        });
        expect(res.statusCode).toBe(400);
    });

    it('returns 400 when body is an empty string (CMNT-EXTRA-4)', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/issues/epic/ATL-1/reply',
            payload: { author: 'owner', body: '' },
        });
        expect(res.statusCode).toBe(400);
    });
});

describe('GET /api/issues/:type/:id/links — non-empty result (CMNT-EXTRA)', () => {
    it('returns 200 with projected link fields when a link exists (CMNT-EXTRA-5)', async () => {
        await insertItem({
            id: 'ATL-2',
            type: 'story',
            project_id: 'p1',
            parent_id: 'ATL-1',
            parent_type: 'epic',
            title: 'Linked Story',
        });
        // Create a link so the projection path runs.
        await app.inject({
            method: 'POST',
            url: '/api/issues/epic/ATL-1/links',
            payload: { to_type: 'story', to_id: 'ATL-2' },
        });
        const res = await app.inject({
            method: 'GET',
            url: '/api/issues/epic/ATL-1/links',
        });
        expect(res.statusCode).toBe(200);
        const links = JSON.parse(res.body) as Array<{ id: number; relation_type: string; direction: string; type: string; item_id: string }>;
        expect(links.length).toBeGreaterThanOrEqual(1);
        // Verify the projection shape includes required fields.
        expect(links[0]).toHaveProperty('id');
        expect(links[0]).toHaveProperty('relation_type');
        expect(links[0]).toHaveProperty('direction');
        expect(links[0]).toHaveProperty('item_id');
    });
});

describe('POST /api/issues/:type/:id/links — explicit relation_type (CMNT-EXTRA)', () => {
    it('returns 201 with relation_type=relates_to when explicitly provided (CMNT-EXTRA-6)', async () => {
        await insertItem({
            id: 'ATL-2',
            type: 'story',
            project_id: 'p1',
            parent_id: 'ATL-1',
            parent_type: 'epic',
            title: 'Story Two',
        });
        const res = await app.inject({
            method: 'POST',
            url: '/api/issues/epic/ATL-1/links',
            payload: { to_type: 'story', to_id: 'ATL-2', relation_type: 'relates_to' },
        });
        expect(res.statusCode).toBe(201);
        const body = JSON.parse(res.body) as { relation_type: string };
        expect(body.relation_type).toBe('relates_to');
    });
});

describe('GET /api/issues/:type/:id/activity — non-empty feed (CMNT-EXTRA)', () => {
    it('returns activity items including a comment after one is posted (CMNT-EXTRA-7)', async () => {
        await commentsService.create({
            author: 'owner',
            issue_type: 'epic',
            issue_id: 'ATL-1',
            body: 'activity comment',
        });
        const res = await app.inject({
            method: 'GET',
            url: '/api/issues/epic/ATL-1/activity',
        });
        expect(res.statusCode).toBe(200);
        const items = JSON.parse(res.body) as Array<{ kind: string }>;
        expect(items.some((it) => it.kind === 'comment')).toBe(true);
    });
});

describe('POST /api/issues/:type/:id/reply — agent author (CMNT-EXTRA)', () => {
    it('returns 201 with agent author comment and context (CMNT-EXTRA-8)', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/issues/epic/ATL-1/reply',
            payload: { author: 'agent', agent_id: 'agent-coder', body: 'agent reply' },
        });
        expect(res.statusCode).toBe(201);
        const body = JSON.parse(res.body) as { comment: IComment; context: unknown };
        expect(body.comment.author).toBe('agent');
        expect(body.comment.body).toBe('agent reply');
        expect(body.context).toBeDefined();
    });
});

describe('POST /api/comments — agent author (CMNT-EXTRA)', () => {
    it('returns 201 with agent comment (CMNT-EXTRA-9)', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/comments',
            payload: {
                author: 'agent',
                agent_id: 'agent-coder',
                issue_type: 'epic',
                issue_id: 'ATL-1',
                body: 'agent comment via POST',
            },
        });
        expect(res.statusCode).toBe(201);
        const body = JSON.parse(res.body) as IComment;
        expect(body.author).toBe('agent');
        expect(body.agent_id).toBe('agent-coder');
    });
});

describe('GET /api/comments — multiple comments listing (CMNT-EXTRA)', () => {
    it('returns all non-deleted comments for the issue (CMNT-EXTRA-10)', async () => {
        await commentsService.create({ author: 'owner', issue_type: 'epic', issue_id: 'ATL-1', body: 'first' });
        await commentsService.create({ author: 'owner', issue_type: 'epic', issue_id: 'ATL-1', body: 'second' });
        const res = await app.inject({
            method: 'GET',
            url: '/api/comments?issue_type=epic&issue_id=ATL-1',
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as IComment[];
        expect(body).toHaveLength(2);
    });
});
