import { describe, expect, it } from 'vitest';
import {
    diffWords,
    WORD_DIFF_CHAR_CAP,
    type WordSpan,
} from './wordDiff.js';

/** Render the highlighted substrings so assertions read as text, not offsets. */
const slice = (text: string, spans: WordSpan[]): string[] =>
    spans.map((s) => text.slice(s.start, s.end));

describe('diffWords', () => {
    it('returns no spans for identical strings', () => {
        expect(diffWords('const a = 1;', 'const a = 1;')).toEqual({ left: [], right: [] });
    });

    it('highlights only the changed identifier in the middle', () => {
        const a = 'const alpha = 1;';
        const b = 'const beta = 1;';
        const res = diffWords(a, b);
        expect(slice(a, res.left)).toEqual(['alpha']);
        expect(slice(b, res.right)).toEqual(['beta']);
    });

    it('handles a change at the start', () => {
        const a = 'alpha = 1;';
        const b = 'beta = 1;';
        const res = diffWords(a, b);
        expect(slice(a, res.left)).toEqual(['alpha']);
        expect(slice(b, res.right)).toEqual(['beta']);
    });

    it('handles a change at the end', () => {
        const a = 'const a = 1;';
        const b = 'const a = 2;';
        const res = diffWords(a, b);
        expect(slice(a, res.left)).toEqual(['1']);
        expect(slice(b, res.right)).toEqual(['2']);
    });

    it('marks a pure insertion on the right only', () => {
        const a = 'foo()';
        const b = 'foo(bar)';
        const res = diffWords(a, b);
        expect(res.left).toEqual([]);
        expect(slice(b, res.right)).toEqual(['bar']);
    });

    it('marks a pure deletion on the left only', () => {
        const a = 'foo(bar)';
        const b = 'foo()';
        const res = diffWords(a, b);
        expect(slice(a, res.left)).toEqual(['bar']);
        expect(res.right).toEqual([]);
    });

    it('treats an empty side as a whole-line change', () => {
        const b = 'added';
        const res = diffWords('', b);
        expect(res.left).toEqual([]);
        expect(slice(b, res.right)).toEqual(['added']);
    });

    // Semantic cleanup: two changed words separated only by a space read as
    // one edit, which is what VS Code shows.
    it('merges runs separated only by whitespace', () => {
        const a = 'call foo bar end';
        const b = 'call baz qux end';
        const res = diffWords(a, b);
        expect(slice(a, res.left)).toEqual(['foo bar']);
        expect(slice(b, res.right)).toEqual(['baz qux']);
    });

    it('reports offsets relative to the FULL line after affix trimming', () => {
        const a = '    const alpha = 1;';
        const b = '    const beta = 1;';
        const res = diffWords(a, b);
        expect(res.left[0]!.start).toBe(a.indexOf('alpha'));
        expect(res.left[0]!.end).toBe(a.indexOf('alpha') + 'alpha'.length);
        expect(res.right[0]!.start).toBe(b.indexOf('beta'));
    });

    it('falls back to whole-line spans above the char cap', () => {
        const a = 'a'.repeat(WORD_DIFF_CHAR_CAP + 1);
        const b = 'b'.repeat(WORD_DIFF_CHAR_CAP + 1);
        const res = diffWords(a, b);
        expect(res.left).toEqual([{ start: 0, end: a.length }]);
        expect(res.right).toEqual([{ start: 0, end: b.length }]);
    });

    // A large post-trim remainder means the line was rewritten; highlighting
    // it wholesale is the correct rendering, not a degradation.
    it('falls back to whole-remainder spans above the cell cap', () => {
        const a = Array.from({ length: 200 }, (_, i) => `a${i}`).join(' ');
        const b = Array.from({ length: 200 }, (_, i) => `b${i}`).join(' ');
        const res = diffWords(a, b);
        expect(res.left).toHaveLength(1);
        expect(res.right).toHaveLength(1);
        expect(res.left[0]).toEqual({ start: 0, end: a.length });
    });

    // The LCS scratch buffer is module-level and reused. If it were not
    // cleared correctly, results would drift after the first few calls.
    it('produces identical results across many sequential calls', () => {
        const first = diffWords('const alpha = 1;', 'const beta = 1;');
        for (let i = 0; i < 200; i++) {
            diffWords(`x${i} foo bar`, `y${i} baz qux`);
            diffWords('a'.repeat(i % 50), 'b'.repeat(i % 50));
        }
        expect(diffWords('const alpha = 1;', 'const beta = 1;')).toEqual(first);
    });

    it('never produces spans outside the line bounds', () => {
        const cases: Array<[string, string]> = [
            ['', ''],
            ['a', ''],
            ['', 'b'],
            ['🎉 alpha', '🎉 beta'],
            ['tab\there', 'tab\tthere'],
        ];
        for (const [a, b] of cases) {
            const res = diffWords(a, b);
            for (const s of res.left) {
                expect(s.start).toBeGreaterThanOrEqual(0);
                expect(s.end).toBeLessThanOrEqual(a.length);
            }
            for (const s of res.right) {
                expect(s.start).toBeGreaterThanOrEqual(0);
                expect(s.end).toBeLessThanOrEqual(b.length);
            }
        }
    });

    it('handles emoji without splitting a surrogate pair', () => {
        const a = 'label 🎉 done';
        const b = 'label 🚀 done';
        const res = diffWords(a, b);
        // Whatever the span boundaries, slicing must yield well-formed text.
        for (const s of res.left) expect(a.slice(s.start, s.end)).not.toContain('�');
        expect(slice(a, res.left).join('')).toContain('🎉');
        expect(slice(b, res.right).join('')).toContain('🚀');
    });

    it('completes quickly on a pathological pair', () => {
        const a = 'x'.repeat(1_500);
        const b = 'y'.repeat(1_500);
        const t0 = performance.now();
        diffWords(a, b);
        expect(performance.now() - t0).toBeLessThan(200);
    });
});
