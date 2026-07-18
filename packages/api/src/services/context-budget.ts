// A12 — token-budget helper for the reply-context envelope.
//
// Deterministic, dependency-free. No `tiktoken` import: the envelope is
// rendered as plain text and the LLM has plenty of slack; a 4-chars-per-token
// heuristic is close enough to keep us under any real budget and avoids
// shipping a multi-MB BPE table for one route.
//
// The constants below tune the elision shape. They are exported so tests
// (and a future Owner setting, if one ever appears) can override them.

import type { IComment } from '@atlas/shared';

export const DEFAULT_REPLY_CONTEXT_BUDGET_TOKENS = 16_000;
export const DEFAULT_THREAD_HEAD_COMMENTS = 3;
export const DEFAULT_THREAD_TAIL_COMMENTS = 12;
export const DEFAULT_LINKED_ITEM_RECENT_COMMENTS = 3;
export const DEFAULT_ACTIVITY_HIGHLIGHTS = 20;

/** Rough char-based token estimate. `Math.ceil(chars / 4)` — close enough
 *  to the real cl100k_base tokenizer that we stay safely under any budget
 *  without pulling in a tokenizer dependency. */
export function estimateTokens(text: string | null | undefined): number {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
}

export function estimateCommentsTokens(comments: ReadonlyArray<IComment>): number {
    let n = 0;
    for (const c of comments) n += estimateTokens(c.body);
    return n;
}

/**
 * Head + tail elision. If the thread fits within `headN + tailN`, returns
 * every comment as-is and `elided_count: 0`. Otherwise returns the first
 * `headN` + the last `tailN` comments, dropping everything in between, and
 * reports how many comments were elided so the caller can render a single
 * "{N earlier comments elided" marker between the two halves.
 *
 * Pure — does NOT mutate the input array.
 */
export function headTailElideComments(
    comments: ReadonlyArray<IComment>,
    headN: number = DEFAULT_THREAD_HEAD_COMMENTS,
    tailN: number = DEFAULT_THREAD_TAIL_COMMENTS,
): { kept: IComment[]; elided_count: number } {
    if (headN < 0 || tailN < 0) {
        throw new Error(`headTailElideComments: head/tail must be non-negative (got ${headN}, ${tailN})`);
    }
    if (comments.length <= headN + tailN) {
        return { kept: comments.slice(), elided_count: 0 };
    }
    const head = comments.slice(0, headN);
    const tail = comments.slice(comments.length - tailN);
    const elided_count = comments.length - headN - tailN;
    return { kept: [...head, ...tail], elided_count };
}

/**
 * Truncate the last `recentN` comments off the end of a linked item's
 * thread. Used for the `depends_on` linked-item bundle so the envelope
 * surfaces the latest activity on each dependency without dumping its
 * full thread. Returns a plain `IComment[]`; the consumer decides whether
 * to surface a "{N earlier on this dep elided}" hint separately.
 */
export function takeRecentComments(
    comments: ReadonlyArray<IComment>,
    recentN: number = DEFAULT_LINKED_ITEM_RECENT_COMMENTS,
): IComment[] {
    if (recentN < 0) {
        throw new Error(`takeRecentComments: recentN must be non-negative (got ${recentN})`);
    }
    if (comments.length <= recentN) return comments.slice();
    return comments.slice(comments.length - recentN);
}
