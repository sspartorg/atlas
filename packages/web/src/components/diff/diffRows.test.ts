import { describe, expect, it } from 'vitest';
import { parseUnifiedDiff, type ParsedFile } from './parseUnifiedDiff.js';
import {
    buildSplitRows,
    buildUnifiedRows,
    isHunkSeparator,
    rowKey,
    type SplitPairRow,
    type UnifiedRow,
} from './diffRows.js';

function fileFrom(hunkBody: string[], header = '@@ -1,10 +1,10 @@'): ParsedFile {
    const patch = ['diff --git a/x.ts b/x.ts', '--- a/x.ts', '+++ b/x.ts', header, ...hunkBody].join(
        '\n',
    );
    return parseUnifiedDiff(patch).files[0]!;
}

const pairs = (file: ParsedFile): SplitPairRow[] =>
    buildSplitRows(file).filter((r): r is SplitPairRow => r.kind === 'pair');

describe('buildSplitRows — change-block pairing', () => {
    it('pairs a balanced 2-del/2-add block', () => {
        const rows = pairs(fileFrom(['-a', '-b', '+A', '+B']));
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({
            left: { content: 'a', kind: 'del' },
            right: { content: 'A', kind: 'add' },
            paired: true,
        });
        expect(rows[1]!.paired).toBe(true);
    });

    // The unbalanced case is the one a naive zip gets wrong: it must emit
    // max(D, A) rows with filler on the short side, not min(D, A).
    it('emits 3 rows for a 3-del/1-add block with filler on the right', () => {
        const rows = pairs(fileFrom(['-a', '-b', '-c', '+A']));
        expect(rows).toHaveLength(3);
        expect(rows[0]).toMatchObject({ paired: true, right: { content: 'A' } });
        expect(rows[1]).toMatchObject({ paired: false, right: null, left: { content: 'b' } });
        expect(rows[2]).toMatchObject({ paired: false, right: null, left: { content: 'c' } });
    });

    it('emits 3 rows for a 1-del/3-add block with filler on the left', () => {
        const rows = pairs(fileFrom(['-a', '+A', '+B', '+C']));
        expect(rows).toHaveLength(3);
        expect(rows[0]!.paired).toBe(true);
        expect(rows[1]).toMatchObject({ left: null, right: { content: 'B' } });
        expect(rows[2]).toMatchObject({ left: null, right: { content: 'C' } });
    });

    it('renders a pure-add block with all-null left cells', () => {
        const rows = pairs(fileFrom(['+A', '+B']));
        expect(rows.every((r) => r.left === null)).toBe(true);
        expect(rows.every((r) => r.paired === false)).toBe(true);
    });

    it('renders a pure-del block with all-null right cells', () => {
        const rows = pairs(fileFrom(['-a', '-b']));
        expect(rows.every((r) => r.right === null)).toBe(true);
        expect(rows.every((r) => r.paired === false)).toBe(true);
    });

    it('shows context on both sides and never marks it paired', () => {
        const rows = pairs(fileFrom([' ctx']));
        expect(rows[0]).toMatchObject({
            left: { content: 'ctx', kind: 'context' },
            right: { content: 'ctx', kind: 'context' },
            paired: false,
        });
    });

    // A context line flushes the block, so nothing pairs across it.
    it('does not pair across an intervening context line', () => {
        const rows = pairs(fileFrom(['-a', ' ctx', '+A']));
        expect(rows).toHaveLength(3);
        expect(rows.every((r) => r.paired === false)).toBe(true);
        expect(rows[0]).toMatchObject({ left: { content: 'a' }, right: null });
        expect(rows[2]).toMatchObject({ left: null, right: { content: 'A' } });
    });

    // `+A -b +C` must not pair `-b` with `+A`: an addition followed by a
    // deletion closes the block, so `A` stands alone and `b`/`C` pair.
    it('starts a new block when a deletion follows an addition', () => {
        const rows = pairs(fileFrom(['+A', '-b', '+C']));
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({ left: null, right: { content: 'A' }, paired: false });
        expect(rows[1]).toMatchObject({
            left: { content: 'b' },
            right: { content: 'C' },
            paired: true,
        });
    });
});

describe('buildUnifiedRows', () => {
    it('emits deletions before additions with counterparts wired', () => {
        const rows = buildUnifiedRows(fileFrom(['-a', '-b', '+A'])).filter(
            (r): r is UnifiedRow => r.kind !== 'hunk',
        );
        expect(rows.map((r) => [r.kind, r.content, r.counterpart])).toEqual([
            ['del', 'a', 'A'],
            ['del', 'b', null],
            ['add', 'A', 'a'],
        ]);
    });

    it('leaves counterpart null for context rows', () => {
        const rows = buildUnifiedRows(fileFrom([' ctx'])).filter(
            (r): r is UnifiedRow => r.kind !== 'hunk',
        );
        expect(rows[0]!.counterpart).toBeNull();
    });
});

describe('hunk separators', () => {
    const twoHunks = (): ParsedFile => {
        const patch = [
            'diff --git a/x.ts b/x.ts',
            '--- a/x.ts',
            '+++ b/x.ts',
            '@@ -1,2 +1,2 @@',
            '-a',
            '+A',
            '@@ -20,2 +20,2 @@ function foo()',
            '-b',
            '+B',
        ].join('\n');
        return parseUnifiedDiff(patch).files[0]!;
    };

    it('inserts a separator between hunks but never before the first', () => {
        const rows = buildUnifiedRows(twoHunks());
        expect(isHunkSeparator(rows[0]!)).toBe(false);
        const seps = rows.filter(isHunkSeparator);
        expect(seps).toHaveLength(1);
        expect(seps[0]!.hunkIndex).toBe(1);
    });

    it('computes the skipped-line count between hunks', () => {
        const sep = buildUnifiedRows(twoHunks()).filter(isHunkSeparator)[0]!;
        // Hunk 1 covers old lines 1-2; hunk 2 starts at 20. Lines 3..19 are
        // skipped -> 20 - (1 + 2) = 17.
        expect(sep.skipped).toBe(17);
        expect(sep.label).toContain('@@ -20,2 +20,2 @@');
        expect(sep.label).toContain('function foo()');
    });

    it('produces the same separators in split mode', () => {
        expect(buildSplitRows(twoHunks()).filter(isHunkSeparator)).toHaveLength(1);
    });

    it('never reports a negative skipped count', () => {
        const patch = [
            'diff --git a/x.ts b/x.ts',
            '--- a/x.ts',
            '+++ b/x.ts',
            '@@ -10,5 +10,5 @@',
            '-a',
            '+A',
            '@@ -2,2 +2,2 @@',
            '-b',
            '+B',
        ].join('\n');
        const sep = buildUnifiedRows(parseUnifiedDiff(patch).files[0]!).filter(isHunkSeparator)[0]!;
        expect(sep.skipped).toBe(0);
    });
});

describe('rowKey', () => {
    it('is stable across two builds of the same file', () => {
        const file = fileFrom(['-a', '+A', ' ctx']);
        const a = buildUnifiedRows(file).map(rowKey);
        const b = buildUnifiedRows(file).map(rowKey);
        expect(a).toEqual(b);
    });

    it('is unique within a row set', () => {
        const rows = buildSplitRows(fileFrom(['-a', '-b', '+A', '+B', ' c']));
        const keys = rows.map(rowKey);
        expect(new Set(keys).size).toBe(keys.length);
    });
});

describe('empty input', () => {
    it('returns no rows for a file with no hunks', () => {
        const file = parseUnifiedDiff(
            ['diff --git a/o.ts b/n.ts', 'rename from o.ts', 'rename to n.ts'].join('\n'),
        ).files[0]!;
        expect(buildUnifiedRows(file)).toEqual([]);
        expect(buildSplitRows(file)).toEqual([]);
    });
});
