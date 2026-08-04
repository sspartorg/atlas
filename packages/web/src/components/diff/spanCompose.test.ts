import { describe, expect, it } from 'vitest';
import { composeSpans } from './spanCompose.js';
import { tokenizeLine } from './syntaxHighlight.js';
import type { SyntaxSpan } from './syntaxHighlight.js';
import type { WordSpan } from './wordDiff.js';

const plainTiling = (line: string): SyntaxSpan[] => [
    { start: 0, end: line.length, token: 'plain' },
];

describe('composeSpans', () => {
    it('returns [] for an empty line', () => {
        expect(composeSpans('', [], [])).toEqual([]);
    });

    it('mirrors the syntax spans when nothing changed', () => {
        const line = 'const x = 1;';
        const syntax = tokenizeLine(line, 'ts');
        const out = composeSpans(line, syntax, []);
        expect(out.map((s) => s.text).join('')).toBe(line);
        expect(out.every((s) => s.changed === false)).toBe(true);
        expect(out).toHaveLength(syntax.length);
    });

    it('marks a changed span that lines up with a syntax boundary', () => {
        const line = 'const x = 1;';
        const syntax = tokenizeLine(line, 'ts');
        const changed: WordSpan[] = [{ start: 0, end: 5 }]; // exactly `const`
        const out = composeSpans(line, syntax, changed);
        expect(out[0]).toMatchObject({ text: 'const', token: 'keyword', changed: true });
        expect(out[1]!.changed).toBe(false);
    });

    // The interesting case: a changed span that STRADDLES two syntax spans has
    // to split into segments carrying different token types.
    it('splits a changed span that straddles two syntax spans', () => {
        const line = 'ab.cd';
        const syntax: SyntaxSpan[] = [
            { start: 0, end: 2, token: 'plain' },
            { start: 2, end: 3, token: 'punct' },
            { start: 3, end: 5, token: 'plain' },
        ];
        const out = composeSpans(line, syntax, [{ start: 1, end: 4 }]);
        expect(out.map((s) => [s.text, s.token, s.changed])).toEqual([
            ['a', 'plain', false],
            ['b', 'plain', true],
            ['.', 'punct', true],
            ['c', 'plain', true],
            ['d', 'plain', false],
        ]);
    });

    it('splits a changed span sitting inside one syntax span into three', () => {
        const line = 'abcde';
        const out = composeSpans(line, plainTiling(line), [{ start: 1, end: 3 }]);
        expect(out.map((s) => [s.text, s.changed])).toEqual([
            ['a', false],
            ['bc', true],
            ['de', false],
        ]);
    });

    it('handles multiple disjoint changed spans', () => {
        const line = 'abcdefgh';
        const out = composeSpans(line, plainTiling(line), [
            { start: 1, end: 3 },
            { start: 5, end: 7 },
        ]);
        expect(out.filter((s) => s.changed).map((s) => s.text)).toEqual(['bc', 'fg']);
    });

    it('reconstructs the original line exactly', () => {
        const cases: Array<[string, WordSpan[]]> = [
            ['const alpha = "x"; // hi', [{ start: 6, end: 11 }]],
            ['  indented();', [{ start: 2, end: 10 }]],
            ['a', [{ start: 0, end: 1 }]],
            ['tab\there', [{ start: 3, end: 4 }]],
        ];
        for (const [line, changed] of cases) {
            const out = composeSpans(line, tokenizeLine(line, 'ts'), changed);
            expect(out.map((s) => s.text).join('')).toBe(line);
        }
    });

    it('produces sorted, non-overlapping segments', () => {
        const line = 'const alpha = beta;';
        const out = composeSpans(line, tokenizeLine(line, 'ts'), [
            { start: 6, end: 11 },
            { start: 14, end: 18 },
        ]);
        let cursor = 0;
        for (const s of out) {
            expect(s.text.length).toBeGreaterThan(0);
            cursor += s.text.length;
        }
        expect(cursor).toBe(line.length);
    });

    it('tolerates changed spans that run to the end of the line', () => {
        const line = 'abc';
        const out = composeSpans(line, plainTiling(line), [{ start: 0, end: 3 }]);
        expect(out).toEqual([{ text: 'abc', token: 'plain', changed: true }]);
    });

    it('tolerates empty syntax input by falling back to plain', () => {
        const out = composeSpans('abc', [], [{ start: 1, end: 2 }]);
        expect(out.map((s) => [s.text, s.token, s.changed])).toEqual([
            ['a', 'plain', false],
            ['b', 'plain', true],
            ['c', 'plain', false],
        ]);
    });
});
