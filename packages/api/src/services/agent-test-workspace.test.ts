import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { collectTestWorkspace, openTestWorkspace } from './agent-test-workspace.js';

let repo: string;
const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' }).trim();

beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'atlas-ws-repo-'));
    git(repo, 'init', '-q', '-b', 'main');
    writeFileSync(join(repo, 'a.js'), 'export const a = 1;\n');
    writeFileSync(join(repo, 'b.js'), 'export const b = 2;\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'init');
});

afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
});

const aRepo = () => ({ id: `r-${Math.random()}`, git_path: repo, default_branch: 'main' });

describe('agent test workspace', () => {
    it('checks the repo out detached, then keeps only what the agent changed', async () => {
        const ws = await openTestWorkspace(aRepo(), `run-${Date.now()}`);
        expect(ws.base_sha).toBe(git(repo, 'rev-parse', 'main'));
        // Detached: no branch was created that could be pushed.
        expect(git(ws.path, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('HEAD');

        writeFileSync(join(ws.path, 'a.js'), 'export const a = 42;\n');
        rmSync(join(ws.path, 'b.js'));
        mkdirSync(join(ws.path, 'src'));
        writeFileSync(join(ws.path, 'src', 'new.js'), 'export {};\n');
        // Atlas's own staging is not the agent's change.
        mkdirSync(join(ws.path, '.atlas'));
        writeFileSync(join(ws.path, '.atlas', 'outcome.md'), 'x');
        mkdirSync(join(ws.path, '.claude', 'commands'), { recursive: true });
        writeFileSync(join(ws.path, '.claude', 'commands', 'atlas-coder.md'), 'x');

        const evidence = await collectTestWorkspace(ws.path, ws.base_sha);
        expect(evidence.files_changed?.sort()).toEqual(['a.js', 'b.js', 'src/new.js']);
        expect(evidence.diff).toContain('+export const a = 42;');
        expect(evidence.diff_truncated).toBeUndefined();
        // Gone from disk, and forgotten by the repo.
        expect(existsSync(ws.path)).toBe(false);
        expect(git(repo, 'worktree', 'list').split('\n')).toHaveLength(1);
    });

    it('counts a change the agent committed, not only uncommitted edits', async () => {
        const ws = await openTestWorkspace(aRepo(), `run-c-${Date.now()}`);
        writeFileSync(join(ws.path, 'c.js'), 'export const c = 3;\n');
        git(ws.path, 'add', '-A');
        git(ws.path, 'commit', '-q', '-m', 'agent commit');
        expect((await collectTestWorkspace(ws.path, ws.base_sha)).files_changed).toEqual(['c.js']);
    });

    it('cuts a huge diff and says so', async () => {
        const ws = await openTestWorkspace(aRepo(), `run-big-${Date.now()}`);
        writeFileSync(join(ws.path, 'big.txt'), 'x\n'.repeat(150_000));
        const evidence = await collectTestWorkspace(ws.path, ws.base_sha);
        expect(evidence.diff?.length).toBe(200_000);
        expect(evidence.diff_truncated).toBe(true);
    });

    it('returns just the base when the checkout is already gone', async () => {
        expect(await collectTestWorkspace(join(tmpdir(), 'atlas-test-gone'), 'abc')).toEqual({ base_sha: 'abc' });
    });

    it('prefers origin/<default> over the local branch', async () => {
        const clone = mkdtempSync(join(tmpdir(), 'atlas-ws-clone-'));
        try {
            git(clone, 'clone', '-q', repo, '.');
            // The local main moves on; origin/main does not.
            writeFileSync(join(clone, 'local.js'), '1');
            git(clone, 'add', '-A');
            git(clone, 'commit', '-q', '-m', 'local only');
            const ws = await openTestWorkspace({ id: 'clone', git_path: clone, default_branch: 'main' }, `run-o-${Date.now()}`);
            expect(ws.base_sha).toBe(git(clone, 'rev-parse', 'origin/main'));
            await collectTestWorkspace(ws.path, ws.base_sha);
        } finally {
            rmSync(clone, { recursive: true, force: true });
        }
    });

    it('refuses a repo with nothing to check out', async () => {
        const empty = mkdtempSync(join(tmpdir(), 'atlas-ws-empty-'));
        try {
            git(empty, 'init', '-q', '-b', 'main');
            await expect(openTestWorkspace({ id: 'e', git_path: empty, default_branch: null }, 'run-e')).rejects.toThrow(
                /no commit to check out/,
            );
        } finally {
            rmSync(empty, { recursive: true, force: true });
        }
    });
});
