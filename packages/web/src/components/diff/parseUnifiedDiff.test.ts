import { describe, expect, it } from 'vitest';
import { parseUnifiedDiff } from './parseUnifiedDiff.js';

// Fixtures are real git output shapes. The high-value cases here are the ones
// a hand-rolled parser classically gets wrong: zero-length context lines,
// `\ No newline`, omitted hunk counts, renames, and paths with spaces.

const simple = [
    'diff --git a/src/a.ts b/src/a.ts',
    'index 1111111..2222222 100644',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1,3 +1,3 @@',
    ' line1',
    '-line2',
    '+LINE2',
    ' line3',
    '',
].join('\n');

describe('parseUnifiedDiff', () => {
    it('returns an empty patch for empty and whitespace-only input', () => {
        expect(parseUnifiedDiff('')).toEqual({ files: [], truncated: false });
        expect(parseUnifiedDiff('   \n  \n')).toEqual({ files: [], truncated: false });
    });

    it('parses a single-hunk modification with correct line numbers', () => {
        const { files } = parseUnifiedDiff(simple);
        expect(files).toHaveLength(1);
        const f = files[0]!;
        expect(f.path).toBe('src/a.ts');
        expect(f.oldPath).toBe('src/a.ts');
        expect(f.newPath).toBe('src/a.ts');
        expect(f.status).toBe('modified');
        expect(f.additions).toBe(1);
        expect(f.deletions).toBe(1);
        expect(f.hunks).toHaveLength(1);
        expect(f.hunks[0]!.lines.map((l) => [l.kind, l.oldLine, l.newLine, l.content])).toEqual([
            ['context', 1, 1, 'line1'],
            ['del', 2, null, 'line2'],
            ['add', null, 2, 'LINE2'],
            ['context', 3, 3, 'line3'],
        ]);
    });

    it('keeps line numbers continuous across multiple hunks', () => {
        const patch = [
            'diff --git a/x.ts b/x.ts',
            '--- a/x.ts',
            '+++ b/x.ts',
            '@@ -1,2 +1,2 @@',
            ' a',
            '-b',
            '+B',
            '@@ -20,2 +20,3 @@',
            ' t',
            '+NEW',
            ' u',
        ].join('\n');
        const f = parseUnifiedDiff(patch).files[0]!;
        expect(f.hunks).toHaveLength(2);
        const second = f.hunks[1]!;
        expect(second.oldStart).toBe(20);
        expect(second.lines.map((l) => [l.oldLine, l.newLine])).toEqual([
            [20, 20],
            [null, 21],
            [21, 22],
        ]);
    });

    it('defaults an omitted hunk count to 1', () => {
        const patch = [
            'diff --git a/x.ts b/x.ts',
            '--- a/x.ts',
            '+++ b/x.ts',
            '@@ -1 +1 @@',
            '-a',
            '+b',
        ].join('\n');
        const h = parseUnifiedDiff(patch).files[0]!.hunks[0]!;
        expect(h.oldCount).toBe(1);
        expect(h.newCount).toBe(1);
    });

    // git emits an empty context line as a ZERO-LENGTH line, not as " ".
    // Getting this wrong desyncs every line number after the first blank line.
    it('treats a zero-length line inside a hunk as empty context', () => {
        const patch = [
            'diff --git a/x.ts b/x.ts',
            '--- a/x.ts',
            '+++ b/x.ts',
            '@@ -1,4 +1,4 @@',
            ' a',
            '',
            '-b',
            '+B',
            ' c',
        ].join('\n');
        const lines = parseUnifiedDiff(patch).files[0]!.hunks[0]!.lines;
        expect(lines[1]).toMatchObject({ kind: 'context', content: '', oldLine: 2, newLine: 2 });
        expect(lines[2]).toMatchObject({ kind: 'del', oldLine: 3 });
        expect(lines[4]).toMatchObject({ kind: 'context', oldLine: 4, newLine: 4 });
    });

    // The patch's own trailing newline leaves an empty element after split,
    // which is byte-identical to an empty context line. Exactly one gets
    // dropped, so a REAL trailing empty context line still survives.
    it('preserves a genuine empty context line at the end of a hunk', () => {
        const patch =
            ['diff --git a/x.ts b/x.ts', '--- a/x.ts', '+++ b/x.ts', '@@ -1,3 +1,3 @@', '-a', '+A', ''].join(
                '\n',
            ) + '\n';
        const lines = parseUnifiedDiff(patch).files[0]!.hunks[0]!.lines;
        expect(lines.map((l) => [l.kind, l.content])).toEqual([
            ['del', 'a'],
            ['add', 'A'],
            ['context', ''],
        ]);
    });

    it('does not append a phantom context row for the trailing newline', () => {
        const lines = parseUnifiedDiff(simple).files[0]!.hunks[0]!.lines;
        expect(lines).toHaveLength(4);
        expect(lines[lines.length - 1]!.content).toBe('line3');
    });

    it('attaches "\\ No newline at end of file" to the preceding line', () => {
        const patch = [
            'diff --git a/x.ts b/x.ts',
            '--- a/x.ts',
            '+++ b/x.ts',
            '@@ -1 +1 @@',
            '-a',
            '\\ No newline at end of file',
            '+b',
            '\\ No newline at end of file',
        ].join('\n');
        const lines = parseUnifiedDiff(patch).files[0]!.hunks[0]!.lines;
        expect(lines[0]!.noNewline).toBe(true);
        expect(lines[1]!.noNewline).toBe(true);
    });

    it('parses an added file (new file mode + /dev/null)', () => {
        const patch = [
            'diff --git a/new.ts b/new.ts',
            'new file mode 100644',
            'index 0000000..abc1234',
            '--- /dev/null',
            '+++ b/new.ts',
            '@@ -0,0 +1,2 @@',
            '+alpha',
            '+beta',
        ].join('\n');
        const f = parseUnifiedDiff(patch).files[0]!;
        expect(f.status).toBe('added');
        expect(f.oldPath).toBeNull();
        expect(f.newPath).toBe('new.ts');
        expect(f.path).toBe('new.ts');
        expect(f.additions).toBe(2);
    });

    it('parses a deleted file', () => {
        const patch = [
            'diff --git a/gone.ts b/gone.ts',
            'deleted file mode 100644',
            '--- a/gone.ts',
            '+++ /dev/null',
            '@@ -1,2 +0,0 @@',
            '-alpha',
            '-beta',
        ].join('\n');
        const f = parseUnifiedDiff(patch).files[0]!;
        expect(f.status).toBe('deleted');
        expect(f.newPath).toBeNull();
        expect(f.path).toBe('gone.ts');
        expect(f.deletions).toBe(2);
    });

    it('parses a pure rename with similarity', () => {
        const patch = [
            'diff --git a/old.ts b/new.ts',
            'similarity index 95%',
            'rename from old.ts',
            'rename to new.ts',
        ].join('\n');
        const f = parseUnifiedDiff(patch).files[0]!;
        expect(f.status).toBe('renamed');
        expect(f.oldPath).toBe('old.ts');
        expect(f.newPath).toBe('new.ts');
        expect(f.similarity).toBe(95);
        expect(f.hunks).toEqual([]);
    });

    it('parses a rename that also has content changes', () => {
        const patch = [
            'diff --git a/old.ts b/new.ts',
            'similarity index 80%',
            'rename from old.ts',
            'rename to new.ts',
            '--- a/old.ts',
            '+++ b/new.ts',
            '@@ -1 +1 @@',
            '-a',
            '+b',
        ].join('\n');
        const f = parseUnifiedDiff(patch).files[0]!;
        expect(f.status).toBe('renamed');
        expect(f.hunks).toHaveLength(1);
        expect(f.additions).toBe(1);
    });

    it('parses a copy', () => {
        const patch = [
            'diff --git a/src.ts b/dst.ts',
            'similarity index 100%',
            'copy from src.ts',
            'copy to dst.ts',
        ].join('\n');
        const f = parseUnifiedDiff(patch).files[0]!;
        expect(f.status).toBe('copied');
        expect(f.oldPath).toBe('src.ts');
        expect(f.newPath).toBe('dst.ts');
    });

    it('flags a binary file and parses no hunks', () => {
        const patch = [
            'diff --git a/logo.png b/logo.png',
            'index 111..222 100644',
            'Binary files a/logo.png and b/logo.png differ',
        ].join('\n');
        const f = parseUnifiedDiff(patch).files[0]!;
        expect(f.binary).toBe(true);
        expect(f.hunks).toEqual([]);
    });

    it('flags a GIT binary patch without parsing its payload', () => {
        const patch = [
            'diff --git a/b.bin b/b.bin',
            'GIT binary patch',
            'literal 12',
            'zcmZQzU|<4="lots of base85"',
        ].join('\n');
        expect(parseUnifiedDiff(patch).files[0]!.binary).toBe(true);
    });

    it('parses a multi-file patch with independent numbering', () => {
        const patch = [simple, simple.replace(/src\/a\.ts/g, 'src/b.ts')].join('');
        const { files } = parseUnifiedDiff(patch);
        expect(files.map((f) => f.path)).toEqual(['src/a.ts', 'src/b.ts']);
        expect(files[1]!.hunks[0]!.lines[0]).toMatchObject({ oldLine: 1, newLine: 1 });
    });

    // Paths can contain spaces, so `diff --git a/x b/y` is ambiguous and must
    // never be split on whitespace. `--- a/…` is authoritative.
    it('parses a path containing spaces', () => {
        const patch = [
            'diff --git a/my dir/my file.ts b/my dir/my file.ts',
            '--- a/my dir/my file.ts',
            '+++ b/my dir/my file.ts',
            '@@ -1 +1 @@',
            '-a',
            '+b',
        ].join('\n');
        expect(parseUnifiedDiff(patch).files[0]!.path).toBe('my dir/my file.ts');
    });

    it('decodes a C-quoted non-ASCII path', () => {
        const patch = [
            'diff --git "a/caf\\303\\251.ts" "b/caf\\303\\251.ts"',
            '--- "a/caf\\303\\251.ts"',
            '+++ "b/caf\\303\\251.ts"',
            '@@ -1 +1 @@',
            '-a',
            '+b',
        ].join('\n');
        expect(parseUnifiedDiff(patch).files[0]!.path).toBe('café.ts');
    });

    // For a CRLF file the trailing \r IS file content and must survive; only
    // header candidates get it stripped.
    it('keeps \\r on content lines but still matches headers', () => {
        const patch = [
            'diff --git a/x.ts b/x.ts\r',
            '--- a/x.ts\r',
            '+++ b/x.ts\r',
            '@@ -1 +1 @@\r',
            '-a\r',
            '+b\r',
        ].join('\n');
        const f = parseUnifiedDiff(patch).files[0]!;
        expect(f.path).toBe('x.ts');
        expect(f.hunks[0]!.lines[0]!.content).toBe('a\r');
        expect(f.hunks[0]!.lines[1]!.content).toBe('b\r');
    });

    it('captures the enclosing-function heading from the @@ line', () => {
        const patch = [
            'diff --git a/x.ts b/x.ts',
            '--- a/x.ts',
            '+++ b/x.ts',
            '@@ -10,3 +10,3 @@ export function foo() {',
            ' a',
            '-b',
            '+B',
        ].join('\n');
        expect(parseUnifiedDiff(patch).files[0]!.hunks[0]!.heading).toBe(
            'export function foo() {',
        );
    });

    it('marks type_changed for a mode-only diff', () => {
        const patch = [
            'diff --git a/run.sh b/run.sh',
            'old mode 100644',
            'new mode 100755',
        ].join('\n');
        expect(parseUnifiedDiff(patch).files[0]!.status).toBe('type_changed');
    });

    it('truncates past maxLines and flags it', () => {
        const body = Array.from({ length: 200 }, (_, i) => `+line ${i}`).join('\n');
        const patch = ['diff --git a/x.ts b/x.ts', '--- a/x.ts', '+++ b/x.ts', '@@ -0,0 +1,200 @@', body].join('\n');
        const res = parseUnifiedDiff(patch, { maxLines: 20 });
        expect(res.truncated).toBe(true);
        expect(res.files[0]!.truncated).toBe(true);
    });

    it('skips a combined (merge) hunk without throwing', () => {
        const patch = [
            'diff --cc x.ts',
            '@@@ -1,2 -1,2 +1,2 @@@',
            '- a',
            '+ b',
            ' c',
        ].join('\n');
        const res = parseUnifiedDiff(patch);
        expect(res.truncated).toBe(true);
        expect(res.files[0]!.hunks).toEqual([]);
    });

    it('ignores a malformed @@ header instead of throwing', () => {
        const patch = [
            'diff --git a/x.ts b/x.ts',
            '--- a/x.ts',
            '+++ b/x.ts',
            '@@ nonsense @@',
            'garbage',
        ].join('\n');
        expect(() => parseUnifiedDiff(patch)).not.toThrow();
        expect(parseUnifiedDiff(patch).files[0]!.hunks).toEqual([]);
    });

    // `git diff --no-index` output and third-party patches sometimes omit the
    // `diff --git` line entirely.
    it('opens an implicit file on a bare --- header', () => {
        const patch = ['--- a/x.ts', '+++ b/x.ts', '@@ -1 +1 @@', '-a', '+b'].join('\n');
        const f = parseUnifiedDiff(patch).files[0]!;
        expect(f.path).toBe('x.ts');
        expect(f.hunks).toHaveLength(1);
    });

    it('counts additions and deletions to match the emitted lines', () => {
        const { files } = parseUnifiedDiff(simple);
        const f = files[0]!;
        const adds = f.hunks.flatMap((h) => h.lines).filter((l) => l.kind === 'add');
        const dels = f.hunks.flatMap((h) => h.lines).filter((l) => l.kind === 'del');
        expect(f.additions).toBe(adds.length);
        expect(f.deletions).toBe(dels.length);
    });
});
