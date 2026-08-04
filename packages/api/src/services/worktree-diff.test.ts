import { describe, expect, it, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    getWorktreeDiffSummary,
    getWorktreeFilePatch,
    normalizeRelPath,
    parseNumstatZ,
    parseNameStatusZ,
    parsePorcelainZ,
    WorktreeDiffError,
} from './worktree-diff.js';

// 2026-08-04 — Terminal finalize diff.
//
// These run against REAL git repos in tmpdir, not a mocked child_process.
// The whole point of this module is that it speaks git's `-z` wire formats
// correctly, and those formats (especially the rename layouts and the
// `--no-index` exit-1 convention) are exactly what a mock would paper over.
//
// `core.autocrlf false` is mandatory: without it Windows rewrites line
// endings on checkout and the exact-patch assertions drift.

const exec = promisify(execFile);
const cleanupDirs: string[] = [];

afterEach(() => {
    while (cleanupDirs.length > 0) {
        const p = cleanupDirs.pop()!;
        try {
            rmSync(p, { recursive: true, force: true });
        } catch {
            // Windows AV can hold a handle briefly; best-effort.
        }
    }
});

async function git(wt: string, args: string[]): Promise<string> {
    const { stdout } = await exec('git', ['-C', wt, ...args], { timeout: 20_000 });
    return stdout;
}

async function makeRepo(initialBranch = 'main'): Promise<string> {
    const p = mkdtempSync(join(tmpdir(), 'atlas-diff-test-'));
    cleanupDirs.push(p);
    await exec('git', ['init', `--initial-branch=${initialBranch}`, p], { timeout: 20_000 });
    await git(p, ['config', 'user.email', 'test@atlas.local']);
    await git(p, ['config', 'user.name', 'Atlas Test']);
    await git(p, ['config', 'commit.gpgsign', 'false']);
    await git(p, ['config', 'core.autocrlf', 'false']);
    await git(p, ['config', 'gc.auto', '0']);
    return p;
}

function write(wt: string, rel: string, content: string | Buffer): void {
    const full = join(wt, rel);
    const dir = full.slice(0, Math.max(full.lastIndexOf('/'), full.lastIndexOf('\\')));
    if (dir && dir !== wt) mkdirSync(dir, { recursive: true });
    writeFileSync(full, content);
}

async function commitAll(wt: string, message: string): Promise<void> {
    await git(wt, ['add', '-A']);
    await git(wt, ['commit', '-m', message]);
}

/** A repo with one commit on `main` containing `src/a.ts`. */
async function seededRepo(): Promise<string> {
    const wt = await makeRepo();
    write(wt, 'src/a.ts', 'line1\nline2\nline3\n');
    write(wt, '.env', 'SECRET=shhh\n');
    await commitAll(wt, 'init');
    return wt;
}

const summary = (wt: string, defaultBranch: string | null = 'main') =>
    getWorktreeDiffSummary({ worktreePath: wt, defaultBranch });

const patch = (
    wt: string,
    path: string,
    scope: 'uncommitted' | 'committed' = 'uncommitted',
    context = 3,
    defaultBranch: string | null = 'main',
) => getWorktreeFilePatch({ worktreePath: wt, defaultBranch, scope, path, context });

// ── Pure parsers ────────────────────────────────────────────────────────────
//
// Fixtures here are the exact byte layouts git emits, captured from real
// output. They're unit-tested separately from the git calls so a parser
// regression points at the parser rather than at a fixture repo.

describe('parseNumstatZ', () => {
    it('parses normal records', () => {
        const out = parseNumstatZ(Buffer.from('20\t3\tsrc/a.ts\u00007\t0\tsrc/b.ts\u0000', 'utf8'));
        expect(out).toEqual([
            { path: 'src/a.ts', oldPath: null, additions: 20, deletions: 3, binary: false },
            { path: 'src/b.ts', oldPath: null, additions: 7, deletions: 0, binary: false },
        ]);
    });

    it('parses the rename layout (empty third field + two extra fields)', () => {
        const out = parseNumstatZ(Buffer.from('1\t1\t\u0000old.ts\u0000new.ts\u0000', 'utf8'));
        expect(out).toEqual([
            { path: 'new.ts', oldPath: 'old.ts', additions: 1, deletions: 1, binary: false },
        ]);
    });

    it('keeps subsequent files aligned after a rename', () => {
        const out = parseNumstatZ(
            Buffer.from('1\t1\t\u0000old.ts\u0000new.ts\u00005\t2\tafter.ts\u0000', 'utf8'),
        );
        expect(out.map((e) => e.path)).toEqual(['new.ts', 'after.ts']);
        expect(out[1]).toMatchObject({ additions: 5, deletions: 2, oldPath: null });
    });

    it('flags binary records and zeroes their counts', () => {
        const out = parseNumstatZ(Buffer.from('-\t-\tlogo.png\u0000', 'utf8'));
        expect(out[0]).toMatchObject({ path: 'logo.png', binary: true, additions: 0, deletions: 0 });
    });

    it('returns [] for empty output', () => {
        expect(parseNumstatZ(Buffer.alloc(0))).toEqual([]);
    });

    it('skips malformed records without tabs', () => {
        expect(parseNumstatZ(Buffer.from('garbage\u0000', 'utf8'))).toEqual([]);
    });
});

describe('parseNameStatusZ', () => {
    it('parses single-path statuses', () => {
        const out = parseNameStatusZ(Buffer.from('M\u0000src/a.ts\u0000D\u0000src/b.ts\u0000A\u0000src/c.ts\u0000', 'utf8'));
        expect(out).toEqual([
            { path: 'src/a.ts', oldPath: null, status: 'modified' },
            { path: 'src/b.ts', oldPath: null, status: 'deleted' },
            { path: 'src/c.ts', oldPath: null, status: 'added' },
        ]);
    });

    it('parses rename and copy as two-path records', () => {
        const out = parseNameStatusZ(Buffer.from('R100\u0000old.ts\u0000new.ts\u0000C75\u0000s.ts\u0000d.ts\u0000', 'utf8'));
        expect(out).toEqual([
            { path: 'new.ts', oldPath: 'old.ts', status: 'renamed' },
            { path: 'd.ts', oldPath: 's.ts', status: 'copied' },
        ]);
    });

    it('maps T to type_changed and unknown letters to modified', () => {
        const out = parseNameStatusZ(Buffer.from('T\u0000link\u0000U\u0000conflict.ts\u0000', 'utf8'));
        expect(out.map((e) => e.status)).toEqual(['type_changed', 'modified']);
    });

    it('returns [] for empty output', () => {
        expect(parseNameStatusZ(Buffer.alloc(0))).toEqual([]);
    });
});

describe('parsePorcelainZ', () => {
    it('parses codes and marks untracked entries', () => {
        const out = parsePorcelainZ(Buffer.from(' M src/a.ts\u0000?? src/b.ts\u0000', 'utf8'));
        expect(out).toEqual([
            { code: ' M', path: 'src/a.ts', untracked: false },
            { code: '??', path: 'src/b.ts', untracked: true },
        ]);
    });

    it('consumes the extra origin-path field for renames and copies', () => {
        const out = parsePorcelainZ(
            Buffer.from('R  new.ts\u0000old.ts\u0000C  d.ts\u0000s.ts\u0000 M z.ts\u0000', 'utf8'),
        );
        expect(out).toEqual([
            { code: 'R ', path: 'new.ts', untracked: false },
            { code: 'C ', path: 'd.ts', untracked: false },
            { code: ' M', path: 'z.ts', untracked: false },
        ]);
    });

    it('handles a rename recorded in the worktree column', () => {
        const out = parsePorcelainZ(Buffer.from(' R moved.ts\u0000was.ts\u0000?? n.ts\u0000', 'utf8'));
        expect(out.map((e) => e.path)).toEqual(['moved.ts', 'n.ts']);
    });
});

describe('normalizeRelPath', () => {
    it('passes through a plain relative path', () => {
        expect(normalizeRelPath('src/a.ts')).toBe('src/a.ts');
    });

    it('normalizes backslashes and a leading ./', () => {
        expect(normalizeRelPath('src\\nested\\a.ts')).toBe('src/nested/a.ts');
        expect(normalizeRelPath('./src/a.ts')).toBe('src/a.ts');
    });

    it.each([
        ['', 'empty'],
        ['/etc/passwd', 'posix absolute'],
        ['\\\\server\\share\\x', 'UNC'],
        ['C:\\Windows\\win.ini', 'drive letter'],
        ['../../secret', 'upward traversal'],
        ['a/../../b', 'embedded traversal'],
        ['.git/config', 'git internals'],
        ['--output=pwned', 'flag-shaped'],
        ['a\u0000b', 'NUL byte'],
        ['a\nb', 'newline'],
    ])('rejects %s (%s)', (input) => {
        expect(() => normalizeRelPath(input)).toThrow(WorktreeDiffError);
        try {
            normalizeRelPath(input);
        } catch (err) {
            expect((err as WorktreeDiffError).code).toBe('invalid_path');
        }
    });
});

// ── Summary: uncommitted scope ──────────────────────────────────────────────

describe('getWorktreeDiffSummary — uncommitted scope', () => {
    it('reports both scopes empty for a clean worktree', async () => {
        const wt = await seededRepo();
        const res = await summary(wt);
        expect(res.uncommitted.files).toEqual([]);
        expect(res.uncommitted.total_files).toBe(0);
        expect(res.uncommitted.truncated).toBe(false);
        expect(res.committed.files).toEqual([]);
        expect(res.current_branch).toBe('main');
    });

    it('reports a modified tracked file with counts and porcelain code', async () => {
        const wt = await seededRepo();
        write(wt, 'src/a.ts', 'line1\nCHANGED\nline3\n');
        const res = await summary(wt);
        expect(res.uncommitted.files).toHaveLength(1);
        expect(res.uncommitted.files[0]).toMatchObject({
            path: 'src/a.ts',
            status: 'modified',
            code: ' M',
            additions: 1,
            deletions: 1,
            binary: false,
        });
        expect(res.uncommitted.additions).toBe(1);
        expect(res.uncommitted.deletions).toBe(1);
    });

    // The reason we use `git diff HEAD` rather than diff + diff --cached:
    // git merges the two views itself, so a file that is both staged AND
    // further modified is ONE record with counts measured against HEAD.
    it('merges staged and unstaged edits of one file into a single entry', async () => {
        const wt = await seededRepo();
        write(wt, 'src/a.ts', 'line1\nSTAGED\nline3\n');
        await git(wt, ['add', 'src/a.ts']);
        write(wt, 'src/a.ts', 'line1\nSTAGED\nline3\nWORKTREE\n');
        const res = await summary(wt);
        expect(res.uncommitted.files).toHaveLength(1);
        expect(res.uncommitted.files[0]).toMatchObject({ path: 'src/a.ts', code: 'MM' });
        expect(res.uncommitted.files[0]!.additions).toBe(2);
    });

    it('reports a staged new file once, not twice', async () => {
        const wt = await seededRepo();
        write(wt, 'src/new.ts', 'hello\n');
        await git(wt, ['add', 'src/new.ts']);
        const res = await summary(wt);
        const entries = res.uncommitted.files.filter((f) => f.path === 'src/new.ts');
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ status: 'added', code: 'A ', additions: 1 });
    });

    it('reports an untracked file with a line count', async () => {
        const wt = await seededRepo();
        write(wt, 'notes.md', 'one\ntwo\nthree\n');
        const res = await summary(wt);
        expect(res.uncommitted.files.find((f) => f.path === 'notes.md')).toMatchObject({
            status: 'untracked',
            code: '??',
            additions: 3,
            deletions: 0,
            binary: false,
        });
    });

    // `--untracked-files=all`: the git default collapses an untracked
    // directory to a single `dir/` entry, which is useless in a file-level
    // review and cannot be checkbox-staged per file.
    it('lists individual files inside an untracked directory', async () => {
        const wt = await seededRepo();
        write(wt, 'fresh/one.ts', 'a\n');
        write(wt, 'fresh/two.ts', 'b\n');
        const res = await summary(wt);
        const paths = res.uncommitted.files.map((f) => f.path);
        expect(paths).toContain('fresh/one.ts');
        expect(paths).toContain('fresh/two.ts');
        expect(paths).not.toContain('fresh/');
    });

    it('reports a deleted tracked file', async () => {
        const wt = await seededRepo();
        unlinkSync(join(wt, 'src/a.ts'));
        const res = await summary(wt);
        expect(res.uncommitted.files.find((f) => f.path === 'src/a.ts')).toMatchObject({
            status: 'deleted',
            additions: 0,
            deletions: 3,
        });
    });

    it('reports a staged rename as one entry carrying old_path', async () => {
        const wt = await seededRepo();
        await git(wt, ['mv', 'src/a.ts', 'src/renamed.ts']);
        const res = await summary(wt);
        const entries = res.uncommitted.files.filter((f) => f.path.startsWith('src/'));
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({
            path: 'src/renamed.ts',
            old_path: 'src/a.ts',
            status: 'renamed',
        });
    });

    it('flags a modified tracked binary file', async () => {
        const wt = await makeRepo();
        write(wt, 'logo.png', Buffer.from([0x89, 0x50, 0x00, 0x01, 0x02]));
        await commitAll(wt, 'init');
        write(wt, 'logo.png', Buffer.from([0x89, 0x50, 0x00, 0x09, 0x09, 0x09]));
        const res = await summary(wt);
        expect(res.uncommitted.files[0]).toMatchObject({
            path: 'logo.png',
            binary: true,
            additions: 0,
            deletions: 0,
        });
    });

    it('flags an untracked binary file via the NUL sniff', async () => {
        const wt = await seededRepo();
        write(wt, 'blob.bin', Buffer.from([0x01, 0x00, 0x02, 0x03]));
        const res = await summary(wt);
        expect(res.uncommitted.files.find((f) => f.path === 'blob.bin')).toMatchObject({
            binary: true,
            additions: 0,
        });
    });

    it('round-trips a non-ASCII path byte-exactly', async () => {
        const wt = await seededRepo();
        write(wt, 'café.ts', 'x\n');
        const res = await summary(wt);
        expect(res.uncommitted.files.map((f) => f.path)).toContain('café.ts');
    });

    it('handles an unborn HEAD without throwing', async () => {
        const wt = await makeRepo();
        write(wt, 'first.ts', 'a\nb\n');
        const res = await summary(wt, null);
        expect(res.uncommitted.files.find((f) => f.path === 'first.ts')).toMatchObject({
            status: 'untracked',
            additions: 2,
        });
        expect(res.base_ref).toBeNull();
        expect(res.committed.files).toEqual([]);
    });

    it('caps the file list but reports the true total', async () => {
        const wt = await seededRepo();
        for (let i = 0; i < 505; i++) write(wt, `gen/f${i}.txt`, 'x\n');
        const res = await summary(wt);
        expect(res.uncommitted.files).toHaveLength(500);
        expect(res.uncommitted.total_files).toBe(505);
        expect(res.uncommitted.truncated).toBe(true);
        // Totals span the UNCAPPED set so the header stat stays honest.
        expect(res.uncommitted.additions).toBe(505);
    });
});

// ── Summary: committed scope + base resolution ──────────────────────────────

describe('getWorktreeDiffSummary — committed scope', () => {
    it('diffs branch commits against the merge-base with the default branch', async () => {
        const wt = await seededRepo();
        await git(wt, ['checkout', '-b', 'atlas/terminal/x']);
        write(wt, 'src/a.ts', 'line1\nline2\nline3\nadded4\n');
        await commitAll(wt, 'c1');
        write(wt, 'src/b.ts', 'new\n');
        await commitAll(wt, 'c2');

        const res = await summary(wt);
        expect(res.base_ref).toBe('main');
        expect(res.base_sha).toMatch(/^[0-9a-f]{40}$/);
        expect(res.commits_ahead_of_base).toBe(2);
        expect(res.committed.files.map((f) => f.path).sort()).toEqual(['src/a.ts', 'src/b.ts']);
        expect(res.committed.files.every((f) => f.code === null)).toBe(true);
    });

    it('falls back to the local default branch when there is no remote', async () => {
        const wt = await seededRepo();
        await git(wt, ['checkout', '-b', 'feat']);
        write(wt, 'src/a.ts', 'changed\n');
        await commitAll(wt, 'c1');
        const res = await summary(wt, 'main');
        expect(res.base_ref).toBe('main');
    });

    it('falls back to `main` when default_branch is empty', async () => {
        const wt = await seededRepo();
        await git(wt, ['checkout', '-b', 'feat']);
        write(wt, 'src/a.ts', 'changed\n');
        await commitAll(wt, 'c1');
        const res = await summary(wt, '');
        expect(res.base_ref).toBe('main');
    });

    it('returns a null base and an empty scope when nothing resolves', async () => {
        const wt = await makeRepo('trunk');
        write(wt, 'a.ts', 'x\n');
        await commitAll(wt, 'init');
        const res = await summary(wt, null);
        expect(res.base_ref).toBeNull();
        expect(res.base_sha).toBeNull();
        expect(res.committed).toEqual({
            files: [],
            total_files: 0,
            truncated: false,
            additions: 0,
            deletions: 0,
        });
        expect(res.commits_ahead_of_base).toBe(0);
        expect(res.current_branch).toBe('trunk');
    });

    it('prefers origin/<default> over the local branch of the same name', async () => {
        const bare = mkdtempSync(join(tmpdir(), 'atlas-diff-remote-'));
        cleanupDirs.push(bare);
        await exec('git', ['init', '--bare', '--initial-branch=main', bare], { timeout: 20_000 });

        const wt = await seededRepo();
        await git(wt, ['remote', 'add', 'origin', bare]);
        await git(wt, ['push', '-u', 'origin', 'main']);
        await git(wt, ['checkout', '-b', 'feat']);
        write(wt, 'src/a.ts', 'changed\n');
        await commitAll(wt, 'c1');

        const res = await summary(wt, 'main');
        expect(res.base_ref).toBe('origin/main');
        expect(res.commits_ahead_of_base).toBe(1);
    });

    it('keeps the two scopes independent for the same file', async () => {
        const wt = await seededRepo();
        await git(wt, ['checkout', '-b', 'feat']);
        write(wt, 'src/a.ts', 'line1\nline2\nline3\ncommitted\n');
        await commitAll(wt, 'c1');
        write(wt, 'src/a.ts', 'line1\nline2\nline3\ncommitted\nworking\n');

        const res = await summary(wt);
        expect(res.committed.files.find((f) => f.path === 'src/a.ts')).toMatchObject({
            additions: 1,
            deletions: 0,
        });
        expect(res.uncommitted.files.find((f) => f.path === 'src/a.ts')).toMatchObject({
            additions: 1,
            deletions: 0,
        });
    });
});

// ── Per-file patch ──────────────────────────────────────────────────────────

describe('getWorktreeFilePatch', () => {
    it('returns a unified patch for a modified tracked file', async () => {
        const wt = await seededRepo();
        write(wt, 'src/a.ts', 'line1\nCHANGED\nline3\n');
        const res = await patch(wt, 'src/a.ts');
        expect(res).not.toBeNull();
        expect(res!.patch).toContain('diff --git');
        expect(res!.patch).toContain('@@');
        expect(res!.patch).toContain('+CHANGED');
        expect(res!.binary).toBe(false);
        expect(res!.truncated).toBe(false);
        expect(res!.byte_size).toBeGreaterThan(0);
    });

    // Pins the `--no-index /dev/null` behaviour, including its exit-1
    // convention. Runs on both the Owner's Windows box and Linux CI, which is
    // the point: git special-cases the literal "/dev/null" internally.
    it('returns a real add-patch for an untracked file', async () => {
        const wt = await seededRepo();
        write(wt, 'fresh.ts', 'alpha\nbeta\n');
        const res = await patch(wt, 'fresh.ts');
        expect(res).not.toBeNull();
        expect(res!.patch).toContain('new file mode');
        expect(res!.patch).toContain('--- /dev/null');
        expect(res!.patch).toContain('+alpha');
        expect(res!.patch).toContain('+beta');
    });

    it('preserves rename detection by passing both pathspec sides', async () => {
        const wt = await seededRepo();
        await git(wt, ['mv', 'src/a.ts', 'src/renamed.ts']);
        const res = await patch(wt, 'src/renamed.ts');
        expect(res!.patch).toContain('rename from src/a.ts');
        expect(res!.patch).toContain('rename to src/renamed.ts');
    });

    it('diffs the committed scope against the merge-base, not HEAD~1', async () => {
        const wt = await seededRepo();
        await git(wt, ['checkout', '-b', 'feat']);
        write(wt, 'src/a.ts', 'line1\nline2\nline3\nc1\n');
        await commitAll(wt, 'c1');
        write(wt, 'src/a.ts', 'line1\nline2\nline3\nc1\nc2\n');
        await commitAll(wt, 'c2');

        const res = await patch(wt, 'src/a.ts', 'committed');
        // Both commits' additions appear — a HEAD~1 diff would show only c2.
        expect(res!.patch).toContain('+c1');
        expect(res!.patch).toContain('+c2');
    });

    it('honours the context parameter', async () => {
        const wt = await makeRepo();
        write(wt, 'big.ts', Array.from({ length: 40 }, (_, i) => `l${i}`).join('\n') + '\n');
        await commitAll(wt, 'init');
        const lines = Array.from({ length: 40 }, (_, i) => (i === 20 ? 'CHANGED' : `l${i}`));
        write(wt, 'big.ts', lines.join('\n') + '\n');

        const tight = await patch(wt, 'big.ts', 'uncommitted', 0);
        const loose = await patch(wt, 'big.ts', 'uncommitted', 10);
        expect(loose!.patch!.length).toBeGreaterThan(tight!.patch!.length);
        expect(tight!.patch).not.toContain(' l10');
    });

    it('returns a binary marker instead of bytes', async () => {
        const wt = await makeRepo();
        write(wt, 'logo.png', Buffer.from([0x89, 0x50, 0x00, 0x01]));
        await commitAll(wt, 'init');
        write(wt, 'logo.png', Buffer.from([0x89, 0x50, 0x00, 0x07, 0x07]));
        const res = await patch(wt, 'logo.png');
        expect(res!.binary).toBe(true);
        expect(res!.patch).toBeNull();
    });

    // The membership check is the real access control: without it, `--no-index`
    // would happily dump any file in the worktree.
    it.each([
        ['.env', 'an unmodified tracked file that exists'],
        ['src/a.ts', 'an unmodified tracked file'],
        ['does/not/exist.ts', 'a path that is not there at all'],
    ])('returns null for %s (%s)', async (path) => {
        const wt = await seededRepo();
        expect(await patch(wt, path)).toBeNull();
    });

    it('returns null for a path changed in the other scope only', async () => {
        const wt = await seededRepo();
        await git(wt, ['checkout', '-b', 'feat']);
        write(wt, 'src/a.ts', 'committed change\n');
        await commitAll(wt, 'c1');
        // Changed in `committed`, clean in the worktree.
        expect(await patch(wt, 'src/a.ts', 'uncommitted')).toBeNull();
        expect(await patch(wt, 'src/a.ts', 'committed')).not.toBeNull();
    });

    it.each([
        '/etc/passwd',
        'C:\\Windows\\win.ini',
        '../../secret',
        '.git/config',
        '--output=pwned',
    ])('rejects the unsafe path %s', async (bad) => {
        const wt = await seededRepo();
        await expect(patch(wt, bad)).rejects.toThrow(WorktreeDiffError);
    });

    it('marks an oversized patch truncated instead of shipping it', async () => {
        const wt = await makeRepo();
        write(wt, 'huge.txt', '');
        await commitAll(wt, 'init');
        // > MAX_PATCH_LINES (20_000) added lines.
        write(wt, 'huge.txt', Array.from({ length: 25_000 }, (_, i) => `line ${i}`).join('\n'));
        const res = await patch(wt, 'huge.txt');
        expect(res!.truncated).toBe(true);
        expect(res!.patch).toBeNull();
        expect(res!.byte_size).toBeGreaterThan(0);
    });

    it('throws worktree_missing when the directory is gone', async () => {
        const wt = await seededRepo();
        rmSync(wt, { recursive: true, force: true });
        await expect(patch(wt, 'src/a.ts')).rejects.toMatchObject({ code: 'worktree_missing' });
        await expect(summary(wt)).rejects.toMatchObject({ code: 'worktree_missing' });
    });

    it('skips an untracked file deleted between the scan and the read', async () => {
        const wt = await seededRepo();
        write(wt, 'transient.ts', 'x\n');
        const res = await summary(wt);
        expect(res.uncommitted.files.map((f) => f.path)).toContain('transient.ts');
        unlinkSync(join(wt, 'transient.ts'));
        // Second pass must not throw now that the file is gone.
        const after = await summary(wt);
        expect(after.uncommitted.files.map((f) => f.path)).not.toContain('transient.ts');
    });
});

// ── Hardening ───────────────────────────────────────────────────────────────
//
// The worktree is agent-controlled and the agent has a live shell in it, so
// these are security controls: `diff.external` / textconv would otherwise get
// executed by this process on every diff.

describe('git config cannot subvert the diff', () => {
    it('ignores a configured external diff driver', async () => {
        const wt = await seededRepo();
        await git(wt, ['config', 'diff.external', 'exit 1']);
        write(wt, 'src/a.ts', 'line1\nCHANGED\nline3\n');
        const res = await patch(wt, 'src/a.ts');
        expect(res!.patch).toContain('diff --git');
        expect(res!.patch).toContain('+CHANGED');
    });

    it('emits no ANSI escapes even with color.diff=always', async () => {
        const wt = await seededRepo();
        await git(wt, ['config', 'color.diff', 'always']);
        await git(wt, ['config', 'color.ui', 'always']);
        write(wt, 'src/a.ts', 'line1\nCHANGED\nline3\n');
        const res = await patch(wt, 'src/a.ts');
        expect(res!.patch).not.toContain('\u001b[');
    });

    it('reports numstat counts unaffected by a textconv driver', async () => {
        const wt = await seededRepo();
        write(wt, '.gitattributes', '*.ts diff=fake\n');
        await git(wt, ['config', 'diff.fake.textconv', 'exit 1']);
        await commitAll(wt, 'attrs');
        write(wt, 'src/a.ts', 'line1\nCHANGED\nline3\n');
        const res = await summary(wt);
        expect(res.uncommitted.files.find((f) => f.path === 'src/a.ts')).toMatchObject({
            additions: 1,
            deletions: 1,
        });
    });
});
