import { describe, it, expect } from 'vitest';
import {
    getStatusLabel,
    getValidNextStatuses,
    isTerminalStatus,
    isValidTransition,
    normalizeStatusInput,
} from './index.js';

// All issue types share the same 6-status machine. Tests below cover the
// allowed forward path, the two reverse paths (in_review→in_progress,
// waiting_for_info→ready), and the escape hatch to waiting_for_info from any
// non-terminal status. Per-issue-type pruning no longer exists, so a single
// suite suffices.

describe('status-machine — forward path', () => {
    it('draft → ready', () => {
        expect(isValidTransition('story', 'draft', 'ready')).toBe(true);
    });

    it('ready → in_progress', () => {
        expect(isValidTransition('story', 'ready', 'in_progress')).toBe(true);
    });

    it('in_progress → in_review', () => {
        expect(isValidTransition('story', 'in_progress', 'in_review')).toBe(true);
    });

    // Performer → reviewer agent handoff: the performer finishes (item is
    // in_progress, assigned to the performer) and re-queues the item for
    // the reviewer at `ready`. Seeded in `agent_handoff_rules` for every
    // performer/reviewer pair (po-writer → po-reviewer, architect →
    // architect-reviewer, coder → code-reviewer). Without this transition,
    // any agent using `mcp__atlas__transitionItemStatus` to act on its own
    // handoff rule gets a 400 from the route; the parser-path runner has
    // been bypassing this check via a direct Kysely UPDATE.
    it('in_progress → ready (agent-to-agent handoff)', () => {
        expect(isValidTransition('epic', 'in_progress', 'ready')).toBe(true);
        expect(isValidTransition('story', 'in_progress', 'ready')).toBe(true);
    });

    it('in_review → done', () => {
        expect(isValidTransition('story', 'in_review', 'done')).toBe(true);
    });
});

describe('status-machine — reverse paths', () => {
    it('in_review → in_progress (owner rejects)', () => {
        expect(isValidTransition('story', 'in_review', 'in_progress')).toBe(true);
    });

    it('waiting_for_info → ready (re-queue)', () => {
        expect(isValidTransition('story', 'waiting_for_info', 'ready')).toBe(true);
    });

    it('waiting_for_info → in_progress (resume after info)', () => {
        expect(isValidTransition('story', 'waiting_for_info', 'in_progress')).toBe(true);
    });
});

describe('status-machine — escape hatch', () => {
    it.each(['draft', 'ready', 'in_progress', 'in_review'] as const)(
        '%s → waiting_for_info is valid',
        (from) => {
            expect(isValidTransition('story', from, 'waiting_for_info')).toBe(true);
        }
    );

    it('done → waiting_for_info is invalid (terminal)', () => {
        expect(isValidTransition('story', 'done', 'waiting_for_info')).toBe(false);
    });

    it('waiting_for_info → waiting_for_info is invalid (no-op)', () => {
        expect(isValidTransition('story', 'waiting_for_info', 'waiting_for_info')).toBe(false);
    });
});

describe('status-machine — invalid transitions', () => {
    it('draft → done is invalid (must traverse the chain)', () => {
        expect(isValidTransition('story', 'draft', 'done')).toBe(false);
    });

    it('ready → done is invalid', () => {
        expect(isValidTransition('story', 'ready', 'done')).toBe(false);
    });

    it('done has no valid next statuses', () => {
        expect(getValidNextStatuses('story', 'done')).toHaveLength(0);
    });
});

describe('status-machine — all issue types share the same machine', () => {
    it.each(['epic', 'story', 'bug', 'sub_bug'] as const)('%s: draft → ready is valid', (type) => {
        expect(isValidTransition(type, 'draft', 'ready')).toBe(true);
    });

    it('sub_task: ready → in_progress is valid (same unified machine)', () => {
        expect(isValidTransition('sub_task', 'ready', 'in_progress')).toBe(true);
    });

    it('sub_task: in_progress → in_review is valid (replaces old "done" direct path)', () => {
        expect(isValidTransition('sub_task', 'in_progress', 'in_review')).toBe(true);
    });
});

describe('isTerminalStatus', () => {
    it('done is terminal for story', () => {
        expect(isTerminalStatus('story', 'done')).toBe(true);
    });

    it('in_progress is not terminal', () => {
        expect(isTerminalStatus('story', 'in_progress')).toBe(false);
    });

    it('done is terminal for sub_task', () => {
        expect(isTerminalStatus('sub_task', 'done')).toBe(true);
    });
});

describe('getStatusLabel', () => {
    it('returns the display label for each canonical status', () => {
        expect(getStatusLabel('draft')).toBe('Draft');
        expect(getStatusLabel('ready')).toBe('Ready');
        expect(getStatusLabel('in_progress')).toBe('In Progress');
        expect(getStatusLabel('waiting_for_info')).toBe('Waiting for Info');
        expect(getStatusLabel('in_review')).toBe('In Review');
        expect(getStatusLabel('done')).toBe('Done');
    });
});

describe('normalizeStatusInput', () => {
    it.each([
        // Canonical enum form (already lowercase)
        ['draft', 'draft'],
        ['ready', 'ready'],
        ['in_progress', 'in_progress'],
        ['waiting_for_info', 'waiting_for_info'],
        ['in_review', 'in_review'],
        ['done', 'done'],
        // Human label form (the path Copilot tends to pick)
        ['Ready', 'ready'],
        ['Draft', 'draft'],
        ['In Progress', 'in_progress'],
        ['Waiting for Info', 'waiting_for_info'],
        ['In Review', 'in_review'],
        ['Done', 'done'],
        // Various case mixings — accept all
        ['READY', 'ready'],
        ['in review', 'in_review'],
        ['IN_REVIEW', 'in_review'],
        // Leading / trailing whitespace tolerated
        ['  ready  ', 'ready'],
        [' In Review ', 'in_review'],
    ])('normalizes %p to %p', (input, expected) => {
        expect(normalizeStatusInput(input)).toBe(expected);
    });

    it.each([
        '',
        '   ',
        'bogus',
        'in-review',
        'inreview',
        'not_a_status',
    ])('returns null for unknown input %p', (input) => {
        expect(normalizeStatusInput(input)).toBeNull();
    });

    // Called via MCP / API boundary where the value is `unknown` at runtime.
    // Defensive `typeof input !== 'string'` guard must reject non-strings
    // before .trim() / .toLowerCase() are called.
    it.each([
        null,
        undefined,
        42,
        { status: 'ready' },
        ['ready'],
        true,
    ])('returns null for non-string input %p', (input) => {
        expect(normalizeStatusInput(input as unknown as string)).toBeNull();
    });
});
