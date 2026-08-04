// 2026-08-04 — Terminal finalize diff. Turns parsed hunks into flat row
// arrays, one array element per rendered row, so a single virtualizer can
// drive either view mode.
//
// Split view deliberately produces ONE row object holding BOTH sides rather
// than two parallel arrays: the two columns then render as sibling cells
// inside one DOM row, inside one scroll container. There is nothing to
// scroll-sync and nothing to drift.

import type { DiffHunk, DiffLine, ParsedFile } from './parseUnifiedDiff.js';

/**
 * A change block larger than this gets NO intra-line highlighting. Past a few
 * hundred paired lines the file was rewritten wholesale, the row-level red and
 * green already tell that story, and running an LCS per pair stops being free.
 */
const WORD_DIFF_BLOCK_CAP = 400;

export interface HunkSeparatorRow {
    kind: 'hunk';
    hunkIndex: number;
    label: string;
    /** Unchanged lines skipped between the previous hunk and this one. */
    skipped: number;
}

export interface UnifiedRow {
    kind: 'add' | 'del' | 'context';
    oldLine: number | null;
    newLine: number | null;
    content: string;
    hunkIndex: number;
    /** The paired line on the other side, for word-level diffing. */
    counterpart: string | null;
}

export type UnifiedViewRow = HunkSeparatorRow | UnifiedRow;

interface SplitSide {
    line: number | null;
    content: string;
    kind: 'add' | 'del' | 'context';
}

export interface SplitPairRow {
    kind: 'pair';
    /** null renders a filler cell — no line number, no text. */
    left: SplitSide | null;
    right: SplitSide | null;
    hunkIndex: number;
    /** Both sides present AND both are changes — eligible for word diff. */
    paired: boolean;
}

export type SplitViewRow = HunkSeparatorRow | SplitPairRow;

/**
 * A maximal run of deletions immediately followed by a run of additions.
 * Context lines flush the block. This is the unit that gets index-paired.
 */
interface ChangeBlock {
    dels: DiffLine[];
    adds: DiffLine[];
}

function blocksOf(hunk: DiffHunk): Array<ChangeBlock | DiffLine> {
    const out: Array<ChangeBlock | DiffLine> = [];
    let block: ChangeBlock | null = null;
    for (const line of hunk.lines) {
        if (line.kind === 'context') {
            if (block) {
                out.push(block);
                block = null;
            }
            out.push(line);
            continue;
        }
        if (!block) block = { dels: [], adds: [] };
        // An addition followed by a deletion starts a NEW block — otherwise
        // `+a -b +c` would pair across an intervening deletion run.
        if (line.kind === 'del' && block.adds.length > 0) {
            out.push(block);
            block = { dels: [], adds: [] };
        }
        if (line.kind === 'del') block.dels.push(line);
        else block.adds.push(line);
    }
    if (block) out.push(block);
    return out;
}

function isBlock(x: ChangeBlock | DiffLine): x is ChangeBlock {
    return (x as ChangeBlock).dels !== undefined;
}

function separator(file: ParsedFile, index: number): HunkSeparatorRow {
    const hunk = file.hunks[index]!;
    const prev = index > 0 ? file.hunks[index - 1] : null;
    const skipped = prev ? hunk.oldStart - (prev.oldStart + prev.oldCount) : 0;
    return {
        kind: 'hunk',
        hunkIndex: index,
        label: `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@${
            hunk.heading ? ` ${hunk.heading}` : ''
        }`,
        skipped: Math.max(0, skipped),
    };
}

export function buildUnifiedRows(file: ParsedFile): UnifiedViewRow[] {
    const rows: UnifiedViewRow[] = [];
    file.hunks.forEach((hunk, hunkIndex) => {
        // No separator before the first hunk — the file header already says
        // where we are, and a leading "⋯ 0 unchanged lines" reads as a bug.
        if (hunkIndex > 0) rows.push(separator(file, hunkIndex));
        for (const item of blocksOf(hunk)) {
            if (!isBlock(item)) {
                rows.push({
                    kind: 'context',
                    oldLine: item.oldLine,
                    newLine: item.newLine,
                    content: item.content,
                    hunkIndex,
                    counterpart: null,
                });
                continue;
            }
            const wordDiffable = item.dels.length + item.adds.length <= WORD_DIFF_BLOCK_CAP;
            item.dels.forEach((d, i) => {
                rows.push({
                    kind: 'del',
                    oldLine: d.oldLine,
                    newLine: null,
                    content: d.content,
                    hunkIndex,
                    counterpart: wordDiffable ? (item.adds[i]?.content ?? null) : null,
                });
            });
            item.adds.forEach((a, i) => {
                rows.push({
                    kind: 'add',
                    oldLine: null,
                    newLine: a.newLine,
                    content: a.content,
                    hunkIndex,
                    counterpart: wordDiffable ? (item.dels[i]?.content ?? null) : null,
                });
            });
        }
    });
    return rows;
}

export function buildSplitRows(file: ParsedFile): SplitViewRow[] {
    const rows: SplitViewRow[] = [];
    file.hunks.forEach((hunk, hunkIndex) => {
        if (hunkIndex > 0) rows.push(separator(file, hunkIndex));
        for (const item of blocksOf(hunk)) {
            if (!isBlock(item)) {
                rows.push({
                    kind: 'pair',
                    left: { line: item.oldLine, content: item.content, kind: 'context' },
                    right: { line: item.newLine, content: item.content, kind: 'context' },
                    hunkIndex,
                    paired: false,
                });
                continue;
            }
            // Index pairing, `max(D, A)` rows, short side gets filler cells.
            // This is what GitHub does and it is O(n). Similarity-based
            // pairing costs O(D*A) comparisons and produces surprising
            // cross-line matches when two similar lines are far apart.
            const height = Math.max(item.dels.length, item.adds.length);
            const wordDiffable = item.dels.length + item.adds.length <= WORD_DIFF_BLOCK_CAP;
            for (let i = 0; i < height; i++) {
                const d = item.dels[i];
                const a = item.adds[i];
                rows.push({
                    kind: 'pair',
                    left: d ? { line: d.oldLine, content: d.content, kind: 'del' } : null,
                    right: a ? { line: a.newLine, content: a.content, kind: 'add' } : null,
                    hunkIndex,
                    paired: Boolean(d && a) && wordDiffable,
                });
            }
        }
    });
    return rows;
}

/**
 * Stable across rebuilds of the same file so react-virtual's measurement
 * cache survives re-renders. Index is included because a pure-context file
 * can legitimately repeat a (hunk, old, new) triple after a truncation.
 */
export function rowKey(row: UnifiedViewRow | SplitViewRow, index: number): string {
    if (row.kind === 'hunk') return `h${row.hunkIndex}:${index}`;
    if (row.kind === 'pair') {
        return `p${row.hunkIndex}:${row.left?.line ?? 'x'}:${row.right?.line ?? 'x'}:${index}`;
    }
    return `u${row.hunkIndex}:${row.oldLine ?? 'x'}:${row.newLine ?? 'x'}:${index}`;
}

export function isHunkSeparator(
    row: UnifiedViewRow | SplitViewRow,
): row is HunkSeparatorRow {
    return row.kind === 'hunk';
}
