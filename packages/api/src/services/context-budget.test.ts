import { describe, expect, it } from 'vitest';
import {
    DEFAULT_THREAD_HEAD_COMMENTS,
    DEFAULT_THREAD_TAIL_COMMENTS,
    estimateCommentsTokens,
    estimateTokens,
    headTailElideComments,
    takeRecentComments,
} from './context-budget.js';
import type { IComment } from '@atlas/shared';

function mkComment(id: number, body: string): IComment {
    return {
        id,
        author: 'owner',
        agent_id: null,
        issue_type: 'story',
        issue_id: 'ATL-1',
        body,
        edited_at: null,
        created_at: new Date(2026, 4, 27, 0, 0, id).toISOString(),
    };
}

describe('estimateTokens', () => {
    it('returns 0 for null / undefined / empty', () => {
        expect(estimateTokens(null)).toBe(0);
        expect(estimateTokens(undefined)).toBe(0);
        expect(estimateTokens('')).toBe(0);
    });

    it('uses ceil(chars / 4)', () => {
        expect(estimateTokens('a')).toBe(1);
        expect(estimateTokens('abcd')).toBe(1);
        expect(estimateTokens('abcde')).toBe(2);
        expect(estimateTokens('a'.repeat(400))).toBe(100);
    });
});

describe('estimateCommentsTokens', () => {
    it('sums per-body estimates', () => {
        const cs = [mkComment(1, 'hello'), mkComment(2, 'world!')];
        expect(estimateCommentsTokens(cs)).toBe(estimateTokens('hello') + estimateTokens('world!'));
    });

    it('returns 0 for empty', () => {
        expect(estimateCommentsTokens([])).toBe(0);
    });
});

describe('headTailElideComments', () => {
    const HEAD = DEFAULT_THREAD_HEAD_COMMENTS;
    const TAIL = DEFAULT_THREAD_TAIL_COMMENTS;

    it('keeps every comment when total <= head + tail', () => {
        const cs = Array.from({ length: HEAD + TAIL }, (_, i) => mkComment(i + 1, `c${i + 1}`));
        const { kept, elided_count } = headTailElideComments(cs);
        expect(kept).toEqual(cs);
        expect(elided_count).toBe(0);
    });

    it('elides the middle when total > head + tail', () => {
        const total = HEAD + TAIL + 5;
        const cs = Array.from({ length: total }, (_, i) => mkComment(i + 1, `c${i + 1}`));
        const { kept, elided_count } = headTailElideComments(cs);
        expect(kept).toHaveLength(HEAD + TAIL);
        expect(kept.slice(0, HEAD).map((c) => c.id)).toEqual(cs.slice(0, HEAD).map((c) => c.id));
        expect(kept.slice(HEAD).map((c) => c.id)).toEqual(cs.slice(total - TAIL).map((c) => c.id));
        expect(elided_count).toBe(5);
    });

    it('handles empty input', () => {
        const { kept, elided_count } = headTailElideComments([]);
        expect(kept).toEqual([]);
        expect(elided_count).toBe(0);
    });

    it('honours custom head + tail counts', () => {
        const cs = Array.from({ length: 10 }, (_, i) => mkComment(i + 1, `c${i + 1}`));
        const { kept, elided_count } = headTailElideComments(cs, 1, 2);
        expect(kept.map((c) => c.id)).toEqual([1, 9, 10]);
        expect(elided_count).toBe(7);
    });

    it('does not mutate the input array', () => {
        const cs = Array.from({ length: 20 }, (_, i) => mkComment(i + 1, `c${i + 1}`));
        const original = cs.slice();
        headTailElideComments(cs);
        expect(cs).toEqual(original);
    });

    it('rejects negative counts', () => {
        expect(() => headTailElideComments([], -1, 2)).toThrow();
        expect(() => headTailElideComments([], 2, -1)).toThrow();
    });
});

describe('takeRecentComments', () => {
    it('returns every comment when total <= recentN', () => {
        const cs = [mkComment(1, 'a'), mkComment(2, 'b')];
        expect(takeRecentComments(cs, 3).map((c) => c.id)).toEqual([1, 2]);
    });

    it('returns the last recentN comments otherwise', () => {
        const cs = Array.from({ length: 8 }, (_, i) => mkComment(i + 1, `c${i + 1}`));
        expect(takeRecentComments(cs, 3).map((c) => c.id)).toEqual([6, 7, 8]);
    });

    it('rejects negative recentN', () => {
        expect(() => takeRecentComments([], -1)).toThrow();
    });
});
