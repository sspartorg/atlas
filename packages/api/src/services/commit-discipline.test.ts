import { describe, it, expect } from 'vitest';
import {
    parseCommitMessage,
    COMMIT_DISCIPLINE_PROMPT_SECTION,
} from './commit-discipline.js';

describe('COMMIT_DISCIPLINE_PROMPT_SECTION', () => {
    it('contains the canonical type list', () => {
        for (const t of ['feat', 'fix', 'refactor', 'test', 'docs', 'chore', 'perf']) {
            expect(COMMIT_DISCIPLINE_PROMPT_SECTION).toContain(t);
        }
    });
    it('forbids --no-verify and amend', () => {
        expect(COMMIT_DISCIPLINE_PROMPT_SECTION).toMatch(/--no-verify/);
        expect(COMMIT_DISCIPLINE_PROMPT_SECTION).toMatch(/amend/i);
    });
    it('mentions the Refs: line + per-chore rule', () => {
        expect(COMMIT_DISCIPLINE_PROMPT_SECTION).toMatch(/Refs:/);
        expect(COMMIT_DISCIPLINE_PROMPT_SECTION).toMatch(/per ?chore|per discrete chore|every discrete chore/i);
    });
});

describe('parseCommitMessage', () => {
    it('parses a clean Conventional subject + Refs body', () => {
        const out = parseCommitMessage(
            'feat(api): add memory cadence trigger\n\nRefs: ATL-12\n\nDouble-counts errors per spec.',
        );
        expect(out.type).toBe('feat');
        expect(out.scope).toBe('api');
        expect(out.summary).toBe('add memory cadence trigger');
        expect(out.refs).toEqual(['ATL-12']);
        expect(out.problems).toEqual([]);
    });

    it('parses a scope-less subject', () => {
        const out = parseCommitMessage('docs: refresh the readme\n\nRefs: ATL-1');
        expect(out.type).toBe('docs');
        expect(out.scope).toBeUndefined();
        expect(out.summary).toBe('refresh the readme');
        expect(out.refs).toEqual(['ATL-1']);
    });

    it('flags subject-not-conventional', () => {
        const out = parseCommitMessage('quick fix without colon\n\nRefs: ATL-1');
        expect(out.problems.some((p) => p.reason === 'subject-not-conventional')).toBe(true);
    });

    it('flags unknown-type', () => {
        const out = parseCommitMessage('wibble(api): something\n\nRefs: ATL-1');
        expect(out.problems.some((p) => p.reason === 'unknown-type:wibble')).toBe(true);
    });

    it('flags summary-too-long (>60 chars)', () => {
        const longSummary = 'a'.repeat(80);
        const out = parseCommitMessage(`feat: ${longSummary}\n\nRefs: ATL-1`);
        expect(out.problems.some((p) => p.reason === 'summary-too-long')).toBe(true);
    });

    it('accepts UUID refs', () => {
        const uuid = '0123abcd-4567-89ef-0123-456789abcdef';
        const out = parseCommitMessage(`feat: thing\n\nRefs: ${uuid}`);
        expect(out.refs).toEqual([uuid]);
    });

    it('handles multiple refs on one line', () => {
        const out = parseCommitMessage('feat: cross-cutting\n\nRefs: ATL-1, ATL-2 ATL-3');
        expect(out.refs).toEqual(['ATL-1', 'ATL-2', 'ATL-3']);
    });

    it('returns empty refs when no Refs: line', () => {
        const out = parseCommitMessage('feat(api): no ref\n\nJust a body.');
        expect(out.refs).toEqual([]);
    });

    // CD-EXTRA — a Refs: token that matches neither the short-id nor the
    // UUID shape must be silently dropped (not pushed to out.refs), rather
    // than throwing or being included verbatim.
    it('drops Refs: tokens that match neither the short-id nor UUID shape', () => {
        const out = parseCommitMessage('feat: cross-cutting\n\nRefs: notaref');
        expect(out.refs).toEqual([]);
    });

    it('keeps only the valid tokens when mixed with invalid ones', () => {
        const out = parseCommitMessage('feat: cross-cutting\n\nRefs: ATL-1 notaref ATL-2');
        expect(out.refs).toEqual(['ATL-1', 'ATL-2']);
    });
});
