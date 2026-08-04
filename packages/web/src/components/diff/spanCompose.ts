// 2026-08-04 — Terminal finalize diff.
//
// Two producers describe the same line with different span sets. The rule
// that keeps them from fighting:
//
//   SYNTAX owns `color`. WORD-DIFF owns `bgcolor`.
//
// They are orthogonal CSS properties, so there is nothing to arbitrate — a
// changed keyword is both purple AND highlighted. All this function does is
// cut the line at every boundary from either set so each output segment has
// exactly one token type and one changed/unchanged answer.

import type { SyntaxSpan, TokenType } from './syntaxHighlight.js';
import type { WordSpan } from './wordDiff.js';

export interface StyledSpan {
    text: string;
    token: TokenType;
    changed: boolean;
}

function tokenAt(syntax: SyntaxSpan[], offset: number): TokenType {
    // Linear scan is right here: `syntax` is capped at MAX_SPANS_PER_LINE and
    // is usually under 20 entries, where a binary search loses to cache
    // locality.
    for (const s of syntax) {
        if (offset >= s.start && offset < s.end) return s.token;
    }
    return 'plain';
}

function isChanged(changed: WordSpan[], offset: number): boolean {
    for (const c of changed) {
        if (offset >= c.start && offset < c.end) return true;
    }
    return false;
}

export function composeSpans(
    line: string,
    syntax: SyntaxSpan[],
    changed: WordSpan[],
): StyledSpan[] {
    if (line.length === 0) return [];

    const bounds = new Set<number>([0, line.length]);
    for (const s of syntax) {
        if (s.start > 0 && s.start < line.length) bounds.add(s.start);
        if (s.end > 0 && s.end < line.length) bounds.add(s.end);
    }
    for (const c of changed) {
        if (c.start > 0 && c.start < line.length) bounds.add(c.start);
        if (c.end > 0 && c.end < line.length) bounds.add(c.end);
    }

    const cuts = [...bounds].sort((a, b) => a - b);
    const out: StyledSpan[] = [];
    for (let i = 0; i < cuts.length - 1; i++) {
        const start = cuts[i]!;
        const end = cuts[i + 1]!;
        if (end <= start) continue;
        out.push({
            text: line.slice(start, end),
            token: tokenAt(syntax, start),
            changed: isChanged(changed, start),
        });
    }
    return out;
}
