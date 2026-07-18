// A12 — Reply-context envelope assembler.
//
// `replyToItem` (MCP) and `GET /api/issues/:type/:id/reply-context` (REST)
// both flow through `assembleReplyContext`. The output is a token-budgeted
// envelope the calling LLM reads before composing a reply: item core, project,
// the full comment thread (head + tail elided when over budget), every linked
// item (depends_on entries get description + acceptance_criteria + last N
// comments inlined; relates_to stays shallow), and recent activity events.
//
// Reuses:
//   • `issueFullService.<kind>` — item + project + activity + agents + links
//   • `commentsService.list`     — full thread for the target + for depends_on
//                                  neighbors
//   • `getItem`                  — description + acceptance_criteria of linked
//                                  depends_on items (cheap, single-row lookup)
//   • `headTailElideComments`,
//     `takeRecentComments`,
//     `estimateTokens`           — deterministic budgeter from context-budget.ts

import type {
    IComment,
    IReplyContext,
    IReplyContextLinkedItem,
    IReplyContextThread,
    IssueType,
} from '@atlas/shared';
import { commentsService } from './comments.js';
import { issueFullService } from './issue-full.js';
import { getItem } from './items.js';
import { itemLinks } from './item-links.js';
import {
    DEFAULT_ACTIVITY_HIGHLIGHTS,
    DEFAULT_LINKED_ITEM_RECENT_COMMENTS,
    DEFAULT_REPLY_CONTEXT_BUDGET_TOKENS,
    DEFAULT_THREAD_HEAD_COMMENTS,
    DEFAULT_THREAD_TAIL_COMMENTS,
    estimateCommentsTokens,
    estimateTokens,
    headTailElideComments,
    takeRecentComments,
} from './context-budget.js';

interface IItemCore {
    kind: IssueType;
    id: string;
    title: string;
    status: IReplyContext['item']['status'];
    summary: string | null;
}

interface IFullResolved {
    item: IItemCore;
    project: { id: string; name: string } | null;
    activity: IReplyContext['activity_highlights'];
}

async function resolveFull(issueType: IssueType, id: string): Promise<IFullResolved | null> {
    switch (issueType) {
        case 'story': {
            const r = await issueFullService.story(id);
            if (!r) return null;
            return {
                item: {
                    kind: 'story',
                    id: r.story.id,
                    title: r.story.title,
                    status: r.story.status,
                    summary: r.story.description || null,
                },
                project: r.project ? { id: r.project.id, name: r.project.name } : null,
                activity: r.activity,
            };
        }
        case 'epic': {
            const r = await issueFullService.epic(id);
            if (!r) return null;
            return {
                item: {
                    kind: 'epic',
                    id: r.epic.id,
                    title: r.epic.title,
                    status: r.epic.status,
                    summary: r.epic.description || null,
                },
                project: r.project ? { id: r.project.id, name: r.project.name } : null,
                activity: r.activity,
            };
        }
        case 'bug': {
            const r = await issueFullService.bug(id);
            if (!r) return null;
            return {
                item: {
                    kind: 'bug',
                    id: r.bug.id,
                    title: r.bug.title,
                    status: r.bug.status,
                    summary: r.bug.description || null,
                },
                project: r.project ? { id: r.project.id, name: r.project.name } : null,
                activity: r.activity,
            };
        }
        case 'sub_task': {
            const r = await issueFullService.subTask(id);
            if (!r) return null;
            return {
                item: {
                    kind: 'sub_task',
                    id: r.sub_task.id,
                    title: r.sub_task.title,
                    status: r.sub_task.status,
                    summary: r.sub_task.description || null,
                },
                project: r.project ? { id: r.project.id, name: r.project.name } : null,
                activity: r.activity,
            };
        }
        case 'sub_bug': {
            const r = await issueFullService.subBug(id);
            if (!r) return null;
            return {
                item: {
                    kind: 'sub_bug',
                    id: r.sub_bug.id,
                    title: r.sub_bug.title,
                    status: r.sub_bug.status,
                    summary: r.sub_bug.description || null,
                },
                project: r.project ? { id: r.project.id, name: r.project.name } : null,
                activity: r.activity,
            };
        }
    }
}

interface IAssembleOptions {
    budget_cap?: number;
    head_comments?: number;
    tail_comments?: number;
    recent_per_linked_item?: number;
    activity_highlights?: number;
}

export async function assembleReplyContext(
    issueType: IssueType,
    issueId: string,
    options: IAssembleOptions = {},
): Promise<IReplyContext | null> {
    const full = await resolveFull(issueType, issueId);
    if (!full) return null;

    const head_comments = options.head_comments ?? DEFAULT_THREAD_HEAD_COMMENTS;
    const tail_comments = options.tail_comments ?? DEFAULT_THREAD_TAIL_COMMENTS;
    const recent_per_linked_item =
        options.recent_per_linked_item ?? DEFAULT_LINKED_ITEM_RECENT_COMMENTS;
    const activity_highlights_n = options.activity_highlights ?? DEFAULT_ACTIVITY_HIGHLIGHTS;
    const budget_cap = options.budget_cap ?? DEFAULT_REPLY_CONTEXT_BUDGET_TOKENS;

    // Pull the full comment thread separately so we can elide deterministically.
    // `issueFullService.activity` already merges events + comments, but for the
    // budgeter we need the raw comments array; we slice activity for highlights.
    const rawComments = await commentsService.list(issueType, issueId);
    const elided = headTailElideComments(rawComments, head_comments, tail_comments);
    const thread: IReplyContextThread = {
        comments: elided.kept,
        elided_count: elided.elided_count,
        total_count: rawComments.length,
    };

    // Activity highlights — take the most recent N events (drop comments here
    // because the thread carries them).
    const activity_highlights = full.activity
        .filter((a) => a.kind === 'event')
        .slice(-activity_highlights_n);

    // Linked items: pull straight from itemLinks so we carry direction
    // (outgoing vs incoming — distinguishes "I depend on X" from "X depends
    // on me", which matters for an informed reply). For each depends_on
    // edge, inline the linked item's description + acceptance_criteria +
    // last N comments. For relates_to, leave description/AC null and
    // recent_comments empty. Matches the depth conventions in
    // `buildLinkedItemsSection` (prompt-builder.ts) so the LLM sees a
    // familiar shape.
    const rawLinks = await itemLinks.list(issueId);
    const linked_items: IReplyContextLinkedItem[] = await Promise.all(
        rawLinks.map(async (link): Promise<IReplyContextLinkedItem> => {
            const base: IReplyContextLinkedItem = {
                id: link.id,
                relation_type: link.relation_type,
                direction: link.direction,
                type: link.type,
                item_id: link.item_id,
                short_id: link.short_id,
                title: link.title,
                status: link.status,
                description: null,
                acceptance_criteria: null,
                recent_comments: [],
            };
            if (link.relation_type !== 'depends_on') return base;
            const [row, neighborComments] = await Promise.all([
                getItem(link.item_id),
                commentsService.list(link.type, link.item_id),
            ]);
            return {
                ...base,
                description: row?.description || null,
                acceptance_criteria: row?.acceptance_criteria || null,
                recent_comments: takeRecentComments(neighborComments, recent_per_linked_item),
            };
        }),
    );

    const token_estimate = estimateEnvelopeTokens({
        item: full.item,
        thread_comments: thread.comments,
        linked_items,
        activity_highlights,
    });

    return {
        item: full.item,
        project: full.project,
        thread,
        linked_items,
        activity_highlights,
        token_estimate,
        budget_cap,
    };
}

function estimateEnvelopeTokens(env: {
    item: IItemCore;
    thread_comments: ReadonlyArray<IComment>;
    linked_items: ReadonlyArray<IReplyContextLinkedItem>;
    activity_highlights: IReplyContext['activity_highlights'];
}): number {
    let n = 0;
    n += estimateTokens(env.item.title);
    n += estimateTokens(env.item.summary);
    n += estimateCommentsTokens(env.thread_comments);
    for (const li of env.linked_items) {
        n += estimateTokens(li.title);
        n += estimateTokens(li.description);
        n += estimateTokens(li.acceptance_criteria);
        n += estimateCommentsTokens(li.recent_comments);
    }
    for (const a of env.activity_highlights) {
        if (a.kind === 'event') {
            n += estimateTokens(a.data.detail);
            n += estimateTokens(a.data.to_value);
        }
    }
    return n;
}
