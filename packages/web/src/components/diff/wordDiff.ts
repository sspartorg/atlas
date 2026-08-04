// 2026-08-04 — Terminal finalize diff. Intra-line highlighting for a paired
// -/+ line. This is the thing that makes a diff read like an IDE rather than
// like a wall of red and green.
//
// Deliberately NOT reusing `DiffViewer.tsx`'s `lcsTable`: it allocates a
// fresh `number[][]` per call, which is fine for its two whole-document
// consumers but would allocate ~80 KB per line pair here. This module keeps
// one module-level Int32Array and reuses it.

export interface WordSpan {
    /** Char offset, inclusive. */
    start: number;
    /** Char offset, exclusive. */
    end: number;
}

export interface WordDiffResult {
    left: WordSpan[];
    right: WordSpan[];
}

/** Skip entirely above this — a line this long is minified or a blob. */
export const WORD_DIFF_CHAR_CAP = 2_000;
/** Post-trim token-grid cap (100x100). Above it, highlight the whole remainder. */
const WORD_DIFF_CELL_CAP = 10_000;

const EMPTY: WordDiffResult = { left: [], right: [] };

// Identifier runs | whitespace runs | one other character. Flat alternation,
// no nesting, so it is linear and cannot backtrack catastrophically.
const TOKEN_RE = /[A-Za-z0-9_$]+|\s+|[^A-Za-z0-9_$\s]/g;

interface Token {
    text: string;
    start: number;
}

function tokenize(text: string, offset: number): Token[] {
    const out: Token[] = [];
    TOKEN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TOKEN_RE.exec(text)) !== null) {
        out.push({ text: m[0], start: offset + m.index });
    }
    return out;
}

// Reused across calls. Grown on demand, never shrunk — the cap bounds it.
let scratch = new Int32Array(0);
function scratchFor(rows: number, cols: number): Int32Array {
    const needed = (rows + 1) * (cols + 1);
    if (scratch.length < needed) scratch = new Int32Array(needed);
    else scratch.fill(0, 0, needed);
    return scratch;
}

/** Merge runs separated only by whitespace, so `foo bar` -> `baz qux` reads as one span. */
function coalesce(spans: WordSpan[], text: string): WordSpan[] {
    if (spans.length < 2) return spans;
    const out: WordSpan[] = [spans[0]!];
    for (let i = 1; i < spans.length; i++) {
        const prev = out[out.length - 1]!;
        const cur = spans[i]!;
        const between = text.slice(prev.end, cur.start);
        if (between.length === 0 || between.trim().length === 0) prev.end = cur.end;
        else out.push({ ...cur });
    }
    return out;
}

function wholeSpan(text: string, from: number, to: number): WordSpan[] {
    return to > from ? [{ start: from, end: to }] : [];
}

const tokenEnd = (t: Token): number => t.start + t.text.length;

export function diffWords(oldText: string, newText: string): WordDiffResult {
    if (oldText === newText) return EMPTY;
    if (oldText.length > WORD_DIFF_CHAR_CAP || newText.length > WORD_DIFF_CHAR_CAP) {
        return {
            left: wholeSpan(oldText, 0, oldText.length),
            right: wholeSpan(newText, 0, newText.length),
        };
    }

    // 1. Trim shared leading/trailing TOKENS — not characters.
    //
    //    Character trimming looks cheaper but produces mid-token highlights:
    //    `alpha` -> `beta` shares a trailing "a", so it would highlight
    //    `alph` -> `bet` and leave a stray unhighlighted "a" hanging off the
    //    end. Every IDE highlights the whole token, and so do we. Token
    //    trimming is still O(n) and still resolves the common case (one
    //    identifier changed) without touching the LCS.
    const allLeft = tokenize(oldText, 0);
    const allRight = tokenize(newText, 0);

    let lo = 0;
    const maxLo = Math.min(allLeft.length, allRight.length);
    while (lo < maxLo && allLeft[lo]!.text === allRight[lo]!.text) lo++;

    let hi = 0;
    const maxHi = Math.min(allLeft.length, allRight.length) - lo;
    while (
        hi < maxHi &&
        allLeft[allLeft.length - 1 - hi]!.text === allRight[allRight.length - 1 - hi]!.text
    ) {
        hi++;
    }

    const lt = allLeft.slice(lo, allLeft.length - hi);
    const rt = allRight.slice(lo, allRight.length - hi);

    if (lt.length === 0 && rt.length === 0) return EMPTY;
    if (lt.length === 0) {
        return { left: [], right: wholeSpan(newText, rt[0]!.start, tokenEnd(rt[rt.length - 1]!)) };
    }
    if (rt.length === 0) {
        return { left: wholeSpan(oldText, lt[0]!.start, tokenEnd(lt[lt.length - 1]!)), right: [] };
    }

    // A remainder of 100+ tokens after affix trimming means the line was
    // rewritten. Highlighting the whole remainder is not a degradation there —
    // it is the correct rendering.
    if (lt.length * rt.length > WORD_DIFF_CELL_CAP) {
        return {
            left: wholeSpan(oldText, lt[0]!.start, tokenEnd(lt[lt.length - 1]!)),
            right: wholeSpan(newText, rt[0]!.start, tokenEnd(rt[rt.length - 1]!)),
        };
    }

    // 2. LCS over tokens, backwards DP so the traceback runs forwards.
    const n = lt.length;
    const m = rt.length;
    const stride = m + 1;
    const dp = scratchFor(n, m);
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            dp[i * stride + j] =
                lt[i]!.text === rt[j]!.text
                    ? dp[(i + 1) * stride + (j + 1)]! + 1
                    : Math.max(dp[(i + 1) * stride + j]!, dp[i * stride + (j + 1)]!);
        }
    }

    const left: WordSpan[] = [];
    const right: WordSpan[] = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
        if (lt[i]!.text === rt[j]!.text) {
            i++;
            j++;
        } else if (dp[(i + 1) * stride + j]! >= dp[i * stride + (j + 1)]!) {
            left.push({ start: lt[i]!.start, end: lt[i]!.start + lt[i]!.text.length });
            i++;
        } else {
            right.push({ start: rt[j]!.start, end: rt[j]!.start + rt[j]!.text.length });
            j++;
        }
    }
    while (i < n) {
        left.push({ start: lt[i]!.start, end: lt[i]!.start + lt[i]!.text.length });
        i++;
    }
    while (j < m) {
        right.push({ start: rt[j]!.start, end: rt[j]!.start + rt[j]!.text.length });
        j++;
    }

    return { left: coalesce(left, oldText), right: coalesce(right, newText) };
}
