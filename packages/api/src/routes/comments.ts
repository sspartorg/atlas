import type { FastifyInstance } from 'fastify';
import { commentsService } from '../services/comments.js';
import { eventsLog } from '../services/events-log.js';
import { itemLinks } from '../services/item-links.js';
import {
    externalLinks,
    parseGithubPrUrl,
    fetchGithubPrTitle,
} from '../services/external-links.js';
import { getItem } from '../services/items.js';
import { assembleReplyContext } from '../services/reply-context.js';
import {
    CreateCommentSchema,
    UpdateCommentSchema,
    CreateIssueLinkSchema,
    CreateItemExternalLinkSchema,
    ReplyToItemSchema,
    PruneItemHistorySchema,
} from '@atlas/shared';
import { historyPruneService } from '../services/history-prune.js';
import type { IssueType, IssueStatus, IItemLinkRow, IReplyResponse } from '@atlas/shared';

const VALID_TYPES = new Set<IssueType>(['epic', 'story', 'sub_task', 'sub_bug', 'bug']);

export async function commentsRoutes(app: FastifyInstance) {
    app.get('/api/comments', async (req, reply) => {
        const { issue_type, issue_id } = req.query as { issue_type: IssueType; issue_id: string };
        return reply.send(await commentsService.list(issue_type, issue_id));
    });

    app.post('/api/comments', async (req, reply) => {
        const body = CreateCommentSchema.parse(req.body);
        return reply.status(201).send(await commentsService.create(body));
    });

    app.patch('/api/comments/:id', async (req, reply) => {
        const { id } = req.params as { id: string };
        const num = Number(id);
        if (!Number.isFinite(num)) {
            return reply.status(400).send({ error: 'Invalid comment id' });
        }
        const { body } = UpdateCommentSchema.parse(req.body);
        const updated = await commentsService.update(num, body);
        if (!updated) {
            return reply.status(404).send({ error: 'Comment not found' });
        }
        return reply.send(updated);
    });

    // P11 — DELETE /api/comments/:id. Soft-deletes the row so listComments
    // and the activity feed hide it while the underlying audit trail
    // survives (the `comment_added` issue_events row is left untouched
    // intentionally — that row records that a comment existed, the body is
    // what we hide).
    //
    // Authorize:
    //   • Owner (no `actor_agent_id` query param) can delete any comment.
    //   • An agent can delete only its own comments — pass
    //     `?actor_agent_id=<id>` and we check `row.agent_id === actor`.
    //
    // Atlas runs single-user locally so there is no session middleware to
    // lean on — this contract matches the rest of the routes that surface
    // an explicit `actor_agent_id` when an agent is the caller (notably
    // the MCP layer when it eventually wires through).
    app.delete('/api/comments/:id', async (req, reply) => {
        const { id } = req.params as { id: string };
        const { actor_agent_id } = req.query as { actor_agent_id?: string };
        const num = Number(id);
        if (!Number.isFinite(num)) {
            return reply.status(400).send({ error: 'Invalid comment id' });
        }
        const row = await commentsService.getRaw(num);
        if (!row || row.deleted_at !== null) {
            return reply.status(404).send({ error: 'Comment not found' });
        }
        // Authorize: when the caller declares itself an agent (actor_agent_id
        // present), only the comment's own author agent can delete it.
        // Absent that flag, treat the caller as Owner — Owner is allowed
        // to delete any comment.
        if (actor_agent_id) {
            if (row.author !== 'agent' || row.agent_id !== actor_agent_id) {
                return reply.status(403).send({ error: 'Not allowed to delete this comment' });
            }
        }
        const deleted = await commentsService.softDelete(num);
        if (!deleted) {
            // Race: someone else soft-deleted between getRaw and softDelete.
            return reply.status(404).send({ error: 'Comment not found' });
        }
        return reply.status(204).send();
    });

    // Unified activity feed (comments + status / assignment / field events).
    app.get('/api/issues/:type/:id/activity', async (req, reply) => {
        const { type, id } = req.params as { type: string; id: string };
        if (!VALID_TYPES.has(type as IssueType)) {
            return reply.status(400).send({ error: `Unknown issue type: ${type}` });
        }
        return reply.send(await eventsLog.activity(id, type as IssueType));
    });

    // Bulk history prune. Hard-deletes every AGENT-authored comment and
    // every issue_event on the target item with `created_at < before_time`,
    // in one transaction. Owner-authored comments are PRESERVED. Writes a
    // `history_pruned` audit event inside the same transaction so the
    // destructive operation is always traceable.
    //
    // Used by long-running agents (e.g. `cer-weekly-automation`) to trim
    // their own noise off a permanent tracking epic. Called from the MCP
    // `update_item` tool with `action: 'remove_history'`.
    //
    // Safety rails (all added 2026-07-03 audit round 2):
    //   * before_time must be at least MIN_PRUNE_AGE_MS in the past — a
    //     future or too-recent cutoff would wipe rows the agent hasn't
    //     had a chance to observe yet.
    //   * The item must exist AND its type must match the URL segment
    //     — a typo returns 404, not a silent {0,0}.
    //   * The MCP write-token gate is enforced upstream by the global
    //     mcp-auth plugin; this route also captures the caller's agent
    //     id from `x-atlas-agent-id` (set by the MCP tool) for the
    //     audit row.
    const MIN_PRUNE_AGE_MS = 60 * 60 * 1000; // 1 hour
    app.post('/api/issues/:type/:id/history/prune', async (req, reply) => {
        const { type, id } = req.params as { type: string; id: string };
        if (!VALID_TYPES.has(type as IssueType)) {
            return reply.status(400).send({ error: `Unknown issue type: ${type}` });
        }
        const { before_time } = PruneItemHistorySchema.parse(req.body);

        const beforeMs = Date.parse(before_time);
        if (!Number.isFinite(beforeMs)) {
            return reply
                .status(400)
                .send({ error: 'before_time is not a valid ISO datetime' });
        }
        if (beforeMs > Date.now() - MIN_PRUNE_AGE_MS) {
            return reply.status(400).send({
                error: `before_time must be at least 1 hour in the past to prevent accidental full-history wipe (got ${before_time}); typical use is a date 30-90 days back`,
            });
        }

        const item = await getItem(id);
        if (!item) {
            return reply.status(404).send({ error: `Item not found: ${id}` });
        }
        if (item.type !== type) {
            return reply.status(400).send({
                error: `Item ${id} is a ${item.type}, not ${type}`,
            });
        }

        const actorAgentId =
            (req.headers['x-atlas-agent-id'] as string | undefined) ?? null;
        const result = await historyPruneService.pruneBefore(
            id,
            type as IssueType,
            before_time,
            actorAgentId,
        );
        return reply.send(result);
    });

    app.get('/api/issues/:type/:id/links', async (req, reply) => {
        const { type, id } = req.params as { type: string; id: string };
        if (!VALID_TYPES.has(type as IssueType)) {
            return reply.status(400).send({ error: `Unknown issue type: ${type}` });
        }
        const rows = await itemLinks.list(id);
        const projected: IItemLinkRow[] = rows.map((r) => ({
            id: r.id,
            relation_type: r.relation_type,
            direction: r.direction,
            type: r.type,
            item_id: r.item_id,
            short_id: r.short_id,
            title: r.title,
            status: r.status as IssueStatus,
            created_at: r.created_at,
        }));
        return reply.send(projected);
    });

    // Create a link. Body is { to_type, to_id, relation_type? }; relation_type
    // defaults to 'relates_to' when omitted. Other valid values: 'depends_on',
    // 'tested_by' (QA → dev story, agent-only).
    app.post('/api/issues/:type/:id/links', async (req, reply) => {
        const { type, id } = req.params as { type: string; id: string };
        if (!VALID_TYPES.has(type as IssueType)) {
            return reply.status(400).send({ error: `Unknown issue type: ${type}` });
        }
        const parsed = CreateIssueLinkSchema.parse(req.body);
        const rel = parsed.relation_type ?? 'relates_to';
        const result = await itemLinks.create(id, parsed.to_id, rel);
        if (!result.ok) {
            const message =
                result.reason === 'self'
                    ? 'Cannot link an item to itself'
                    : result.reason === 'missing_from'
                      ? `Source ${type} not found`
                      : result.reason === 'cycle'
                        ? 'Would create a dependency cycle'
                        : `Target ${parsed.to_type} not found`;
            return reply.status(400).send({ error: message, reason: result.reason });
        }
        return reply.status(201).send(result.link);
    });

    app.delete('/api/issues/links/:linkId', async (req, reply) => {
        const { linkId } = req.params as { linkId: string };
        const id = Number(linkId);
        if (!Number.isFinite(id)) {
            return reply.status(400).send({ error: 'Invalid link id' });
        }
        await itemLinks.delete(id);
        return reply.status(204).send();
    });

    // External links — off-platform URL attachments (currently PR URLs).
    // GET /api/issues/:type/:id/external-links → list newest-first.
    app.get('/api/issues/:type/:id/external-links', async (req, reply) => {
        const { type, id } = req.params as { type: string; id: string };
        if (!VALID_TYPES.has(type as IssueType)) {
            return reply.status(400).send({ error: `Unknown issue type: ${type}` });
        }
        return reply.send(await externalLinks.list(id));
    });

    // POST /api/issues/:type/:id/external-links — create. Idempotent on
    // (item_id, url). Server-side validates GitHub PR URL shape when
    // link_kind=pull_request and best-effort fetches the title via gh
    // when the client didn't pass one.
    app.post('/api/issues/:type/:id/external-links', async (req, reply) => {
        const { type, id } = req.params as { type: string; id: string };
        if (!VALID_TYPES.has(type as IssueType)) {
            return reply.status(400).send({ error: `Unknown issue type: ${type}` });
        }
        const item = await getItem(id);
        if (!item) {
            return reply.status(404).send({ error: `${type} not found: ${id}` });
        }
        const parsed = CreateItemExternalLinkSchema.parse(req.body);
        let externalRef: string | null = null;
        /* v8 ignore next */
        if (parsed.link_kind === 'pull_request') {
            const pr = parseGithubPrUrl(parsed.url);
            if (!pr) {
                return reply.status(400).send({
                    error: 'pull_request URL must be a GitHub PR (https://github.com/<owner>/<repo>/pull/<number>)',
                });
            }
            externalRef = pr.number;
        }
        const title = parsed.title ?? (await fetchGithubPrTitle(parsed.url));
        const link = await externalLinks.create({
            itemId: id,
            url: parsed.url,
            linkKind: parsed.link_kind,
            title,
            externalRef,
        });
        return reply.status(201).send(link);
    });

    app.delete('/api/issues/external-links/:linkId', async (req, reply) => {
        const { linkId } = req.params as { linkId: string };
        const id = Number(linkId);
        if (!Number.isFinite(id)) {
            return reply.status(400).send({ error: 'Invalid external link id' });
        }
        await externalLinks.delete(id);
        return reply.status(204).send();
    });

    // A12 — Reply-to-item with linked context.
    //
    // GET returns the IReplyContext envelope: item core + project + token-
    // budgeted comment thread + linked items (depends_on entries get
    // description + acceptance_criteria + last N comments inlined) + recent
    // activity events. The MCP tool `replyToItem` calls this when no body
    // was provided so the calling LLM can read context first.
    app.get('/api/issues/:type/:id/reply-context', async (req, reply) => {
        const { type, id } = req.params as { type: string; id: string };
        if (!VALID_TYPES.has(type as IssueType)) {
            return reply.status(400).send({ error: `Unknown issue type: ${type}` });
        }
        const ctx = await assembleReplyContext(type as IssueType, id);
        if (!ctx) {
            return reply.status(404).send({ error: `${type} not found: ${id}` });
        }
        return reply.send(ctx);
    });

    // POST loads the same envelope, posts the comment via commentsService
    // (so the existing comment_added activity event + comment-created SSE
    // fire unchanged), and returns { comment, context }. The context is
    // the snapshot visible at post time, useful for audit / inspection.
    app.post('/api/issues/:type/:id/reply', async (req, reply) => {
        const { type, id } = req.params as { type: string; id: string };
        if (!VALID_TYPES.has(type as IssueType)) {
            return reply.status(400).send({ error: `Unknown issue type: ${type}` });
        }
        const parsed = ReplyToItemSchema.parse(req.body);
        const ctx = await assembleReplyContext(type as IssueType, id);
        if (!ctx) {
            return reply.status(404).send({ error: `${type} not found: ${id}` });
        }
        const comment = await commentsService.create({
            author: parsed.author,
            agent_id: parsed.agent_id,
            issue_type: type as IssueType,
            issue_id: id,
            body: parsed.body,
        });
        const response: IReplyResponse = { comment, context: ctx };
        return reply.status(201).send(response);
    });
}
