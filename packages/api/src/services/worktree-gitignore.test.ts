import { describe, expect, it, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureWorktreeGitignore } from './worktree-orchestrator.js';

// 2026-06-10 — `.gitignore` injection that gets COMMITTED.
//
// Previous implementation (`writeWorktreeExcludes`) wrote to
// `.git/info/exclude` — local-only, untracked. It didn't survive once an
// agent ran `git add -A` after atlas scratch had already been tracked
// in an earlier run, OR when an agent added a atlas path explicitly.
//
// New implementation appends three patterns to the worktree's tracked
// `.gitignore` AND stages the change so the agent's commit picks it up.
// Once pushed and merged the protection lives on `main` permanently.

const exec = promisify(execFile);

const cleanupDirs: string[] = [];

afterEach(() => {
    while (cleanupDirs.length > 0) {
        const p = cleanupDirs.pop()!;
        try {
            rmSync(p, { recursive: true, force: true });
        } catch {
            // best-effort
        }
    }
});

async function makeGitRepo(): Promise<string> {
    const p = mkdtempSync(join(tmpdir(), 'atlas-gitignore-test-'));
    cleanupDirs.push(p);
    // Init a real git repo so `git add` works against the test path. We
    // don't commit anything — staging is enough to verify the function
    // ran `git add .gitignore` successfully.
    await exec('git', ['init', '--initial-branch=main', p], { timeout: 10_000 });
    // `user.email` + `user.name` aren't strictly needed for `git add`,
    // but some CI environments fail without them on later git ops; set
    // for safety so the test is portable.
    await exec('git', ['-C', p, 'config', 'user.email', 'test@atlas.local'], { timeout: 5_000 });
    await exec('git', ['-C', p, 'config', 'user.name', 'Atlas Test'], { timeout: 5_000 });
    return p;
}

async function gitStatusPorcelain(worktreePath: string): Promise<string> {
    const { stdout } = await exec('git', ['-C', worktreePath, 'status', '--porcelain'], {
        timeout: 5_000,
    });
    return stdout.trim();
}

describe('ensureWorktreeGitignore', () => {
    it('creates .gitignore with all three patterns when none exists', async () => {
        const wt = await makeGitRepo();

        await ensureWorktreeGitignore(wt, null);

        const gitignore = readFileSync(join(wt, '.gitignore'), 'utf8');
        expect(gitignore).toContain('.claude/commands/atlas-*');
        expect(gitignore).toContain('.github/prompts/atlas-*');
        expect(gitignore).toContain('.atlas/');
        expect(gitignore).toContain('# Atlas scratch');

        // Staged for the next commit.
        const status = await gitStatusPorcelain(wt);
        expect(status).toMatch(/^A\s+\.gitignore$/m);
    });

    it('preserves the user\'s existing .gitignore entries verbatim', async () => {
        const wt = await makeGitRepo();
        const userContent = 'node_modules/\ndist/\n.env\n';
        writeFileSync(join(wt, '.gitignore'), userContent, 'utf8');

        await ensureWorktreeGitignore(wt, null);

        const gitignore = readFileSync(join(wt, '.gitignore'), 'utf8');
        // Owner's content is at the top, untouched.
        expect(gitignore.startsWith(userContent)).toBe(true);
        // Atlas block appended after.
        expect(gitignore).toContain('# Atlas scratch');
        expect(gitignore).toContain('.atlas/');
    });

    it('is idempotent — re-running does not append duplicates', async () => {
        const wt = await makeGitRepo();

        await ensureWorktreeGitignore(wt, null);
        const first = readFileSync(join(wt, '.gitignore'), 'utf8');

        await ensureWorktreeGitignore(wt, null);
        const second = readFileSync(join(wt, '.gitignore'), 'utf8');

        expect(second).toBe(first);
        // The Atlas header should appear exactly once.
        const headerOccurrences = (second.match(/# Atlas scratch/g) ?? []).length;
        expect(headerOccurrences).toBe(1);
    });

    it('appends only missing patterns when some are already present', async () => {
        const wt = await makeGitRepo();
        // Owner already had `.atlas/` — the orchestrator must still add
        // the other two without duplicating `.atlas/`.
        writeFileSync(join(wt, '.gitignore'), 'node_modules/\n.atlas/\n', 'utf8');

        await ensureWorktreeGitignore(wt, null);

        const gitignore = readFileSync(join(wt, '.gitignore'), 'utf8');
        expect(gitignore).toContain('.claude/commands/atlas-*');
        expect(gitignore).toContain('.github/prompts/atlas-*');
        // `.atlas/` appears exactly once.
        const atlasOccurrences = (gitignore.match(/^\.atlas\/$/gm) ?? []).length;
        expect(atlasOccurrences).toBe(1);
    });

    it('does not run `git add` when no patterns are missing (no work to do)', async () => {
        const wt = await makeGitRepo();
        // Pre-populate with all three patterns, so the function should
        // detect "nothing to do" and skip the git add entirely.
        const allThree =
            '# Atlas scratch — orchestrator-managed, do not edit by hand\n' +
            '.claude/commands/atlas-*\n' +
            '.github/prompts/atlas-*\n' +
            '.atlas/\n';
        writeFileSync(join(wt, '.gitignore'), allThree, 'utf8');

        await ensureWorktreeGitignore(wt, null);

        // `.gitignore` should not be in the staging area (we didn't stage
        // it and the function shouldn't either).
        const status = await gitStatusPorcelain(wt);
        // Unstaged untracked is `??`. Staged add is `A`.  Either way, the
        // function never ran `git add`, so we only see `??` (or possibly
        // nothing if .gitignore is somehow ignored).
        expect(status).not.toMatch(/^A\s+\.gitignore$/m);
    });
});

// Silence the unused-import sentinel when the test file shifts.
void existsSync;
