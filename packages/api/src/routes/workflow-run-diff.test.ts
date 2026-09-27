import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../routes/events.js', () => ({ eventsRoutes: async () => undefined, broadcastSSE: vi.fn() }));

import type { FastifyInstance } from 'fastify';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { WorkflowRunDiffResponse } from '@atlas/shared';
import { buildApp } from '../server.js';
import { closeTestDb, testDb, truncateAll } from '../../tests/_pg-db.js';
import { insertItem, insertProject, insertProjectRepo } from '../../tests/_items.js';

// Real git repos in tmpdir, like worktree-diff.test.ts: which ref survives a
// delivered run's cleanup is exactly what a mock would get wrong.

const exec = promisify(execFile);
const BRANCH = 'atlas/wf/ATL-1';
const SLUG = 'atlas__wf__ATL-1';
let app: FastifyInstance;
let root: string;

async function git(cwd: string, args: string[]): Promise<string> {
    const { stdout } = await exec('git', ['-C', cwd, ...args], { timeout: 20_000 });
    return stdout;
}

function write(dir: string, rel: string, content: string): void {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
}

/**
 * A bare "remote" plus its clone at `<root>/clones/<name>` — the shape of a
 * project repo's `git_path` — with one commit on main.
 */
async function makeClone(name: string): Promise<{ clone: string; remote: string }> {
    const remote = join(root, 'remotes', `${name}.git`);
    mkdirSync(remote, { recursive: true });
    await exec('git', ['init', '--bare', '--initial-branch=main', remote]);
    const clone = join(root, 'clones', name);
    await exec('git', ['clone', remote, clone]);
    for (const [k, v] of [
        ['user.email', 'test@atlas.local'],
        ['user.name', 'Atlas Test'],
        ['commit.gpgsign', 'false'],
        ['core.autocrlf', 'false'],
    ]) {
        await git(clone, ['config', k as string, v as string]);
    }
    write(clone, 'src/a.ts', 'one\n');
    await git(clone, ['add', '-A']);
    await git(clone, ['commit', '-m', 'init']);
    await git(clone, ['push', 'origin', 'main']);
    return { clone, remote };
}

/** The run's checkout on BRANCH with one committed and one uncommitted change. */
async function makeWorktree(clone: string, path: string): Promise<void> {
    await git(clone, ['worktree', 'add', '-b', BRANCH, path, 'main']);
    write(path, 'src/a.ts', 'one\ntwo\n');
    await git(path, ['commit', '-am', 'work']);
    write(path, 'src/new.ts', 'fresh\n');
}

/** What delivery does: push, remove the checkout, delete the local branch. */
async function deliver(clone: string, path: string): Promise<void> {
    await git(path, ['push', 'origin', BRANCH]);
    await git(clone, ['worktree', 'remove', '--force', path]);
    await git(clone, ['branch', '-D', BRANCH]);
}

async function insertRun(worktreePath: string | null, overrides: Record<string, unknown> = {}): Promise<void> {
    await testDb
        .insertInto('workflow_runs')
        .values({
            id: 'wr-1',
            workflow_id: 'wf-1',
            item_id: 'ATL-1',
            project_id: 'p1',
            graph_snapshot: JSON.stringify({ nodes: [], edges: [] }),
            branch: BRANCH,
            worktree_path: worktreePath,
            ...overrides,
        } as never)
        .execute();
}

const getDiff = async () => {
    const res = await app.inject({ method: 'GET', url: '/api/workflow-runs/wr-1/diff' });
    return { status: res.statusCode, body: res.json() as WorkflowRunDiffResponse };
};

const getFile = (q: Record<string, string>) =>
    app.inject({ method: 'GET', url: `/api/workflow-runs/wr-1/diff/file?${new URLSearchParams(q).toString()}` });

beforeAll(async () => {
    app = await buildApp({ logger: false });
});

beforeEach(async () => {
    await truncateAll();
    // realpath: macOS tmpdir is a symlink, and git reports resolved paths.
    root = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-run-diff-')));
});

afterEach(() => {
    rmSync(root, { recursive: true, force: true });
});

afterAll(async () => {
    await app.close();
    await closeTestDb();
});

async function singleRepoProject(): Promise<string> {
    const { clone } = await makeClone('core');
    await insertProject('p1', 'ATL', { git_path: clone });
    await testDb.updateTable('project_repos').set({ name: 'core' }).where('id', '=', 'p1').execute();
    await testDb.insertInto('workflows').values({ id: 'wf-1', project_id: 'p1', name: 'wf', input_kind: 'item' } as never).execute();
    await insertItem({ id: 'ATL-1', type: 'task', project_id: 'p1', title: 'Task' });
    return clone;
}

describe('GET /api/workflow-runs/:id/diff', () => {
    it('404s for an unknown run, on both endpoints', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/workflow-runs/nope/diff' });
        expect(res.statusCode).toBe(404);
        const file = await app.inject({
            method: 'GET',
            url: '/api/workflow-runs/nope/diff/file?repo_id=p1&scope=committed&path=src/a.ts',
        });
        expect(file.statusCode).toBe(404);
    });

    it('reads a live worktree: both scopes, and one file patch per scope', async () => {
        const clone = await singleRepoProject();
        const wt = join(root, 'clones', 'worktrees', 'p1', SLUG);
        await makeWorktree(clone, wt);
        await insertRun(wt);

        const { status, body } = await getDiff();
        expect(status).toBe(200);
        expect(body.branch).toBe(BRANCH);
        expect(body.repos).toHaveLength(1);
        const [repo] = body.repos;
        expect(repo).toMatchObject({ repo_id: 'p1', repo_name: 'core', source: 'worktree', reason: null });
        expect(repo?.summary?.committed.files.map((f) => f.path)).toEqual(['src/a.ts']);
        expect(repo?.summary?.uncommitted.files.map((f) => f.path)).toEqual(['src/new.ts']);
        expect(repo?.summary?.current_branch).toBe(BRANCH);

        const committed = await getFile({ repo_id: 'p1', scope: 'committed', path: 'src/a.ts' });
        expect(committed.statusCode).toBe(200);
        expect(committed.json().patch).toContain('+two');
        const untracked = await getFile({ repo_id: 'p1', scope: 'uncommitted', path: 'src/new.ts', context: '0' });
        expect(untracked.json().patch).toContain('+fresh');
    });

    it("reads origin/<branch> from the repo's clone once delivery removed the worktree", async () => {
        const clone = await singleRepoProject();
        const wt = join(root, 'clones', 'worktrees', 'p1', SLUG);
        await makeWorktree(clone, wt);
        await git(wt, ['add', '-A']);
        await git(wt, ['commit', '-m', 'more']);
        await deliver(clone, wt);
        await insertRun(null, { status: 'completed' });

        const [repo] = (await getDiff()).body.repos;
        expect(repo?.source).toBe('branch');
        expect(repo?.summary?.uncommitted.total_files).toBe(0);
        expect(repo?.summary?.committed.files.map((f) => f.path)).toEqual(['src/a.ts', 'src/new.ts']);
        expect(repo?.summary?.commits_ahead_of_base).toBe(2);
        expect(repo?.summary?.current_branch).toBe(BRANCH);

        const patch = await getFile({ repo_id: 'p1', scope: 'committed', path: 'src/new.ts' });
        expect(patch.statusCode).toBe(200);
        expect(patch.json().patch).toContain('+fresh');
        // The clone's own working tree is not the run's work.
        write(clone, 'stray.txt', 'not the run\n');
        const unc = await getFile({ repo_id: 'p1', scope: 'uncommitted', path: 'stray.txt' });
        expect(unc.statusCode).toBe(404);
        const unchanged = await getFile({ repo_id: 'p1', scope: 'committed', path: 'README.md' });
        expect(unchanged.statusCode).toBe(404);
    });

    it('prefers a local branch the cleanup kept over the remote-tracking ref', async () => {
        const clone = await singleRepoProject();
        const wt = join(root, 'clones', 'worktrees', 'p1', SLUG);
        await makeWorktree(clone, wt);
        await git(wt, ['push', 'origin', BRANCH]);
        // A commit the push never carried, then the checkout goes.
        write(wt, 'src/late.ts', 'late\n');
        await git(wt, ['add', '-A']);
        await git(wt, ['commit', '-m', 'late']);
        await git(clone, ['worktree', 'remove', '--force', wt]);
        await insertRun(wt, { status: 'cancelled' });

        const [repo] = (await getDiff()).body.repos;
        expect(repo?.source).toBe('branch');
        expect(repo?.summary?.committed.files.map((f) => f.path)).toContain('src/late.ts');
    });

    it('says unavailable, honestly, when the branch was merged and deleted', async () => {
        const clone = await singleRepoProject();
        const wt = join(root, 'clones', 'worktrees', 'p1', SLUG);
        await makeWorktree(clone, wt);
        await deliver(clone, wt);
        await git(clone, ['push', 'origin', '--delete', BRANCH]);
        await insertRun(null, { status: 'completed' });

        const [repo] = (await getDiff()).body.repos;
        expect(repo?.source).toBe('unavailable');
        expect(repo?.summary).toBeNull();
        expect(repo?.reason).toContain(`The branch ${BRANCH} is gone from core`);
        const file = await getFile({ repo_id: 'p1', scope: 'committed', path: 'src/a.ts' });
        expect(file.statusCode).toBe(404);
    });

    it('says unavailable when the repo was never cloned', async () => {
        await insertProject('p1', 'ATL', { git_path: '' });
        await testDb.insertInto('workflows').values({ id: 'wf-1', project_id: 'p1', name: 'wf', input_kind: 'item' } as never).execute();
        await insertItem({ id: 'ATL-1', type: 'task', project_id: 'p1', title: 'Task' });
        await insertRun(null);
        const [repo] = (await getDiff()).body.repos;
        expect(repo?.source).toBe('unavailable');
        expect(repo?.reason).toMatch(/clone is not on this machine/);
    });

    it('lists no repos for a run without a branch', async () => {
        await singleRepoProject();
        await insertRun(null, { branch: null });
        const { status, body } = await getDiff();
        expect(status).toBe(200);
        expect(body).toEqual({ run_id: 'wr-1', branch: null, repos: [] });
    });

    it('reads each repo of a multi-repo run from its own best source', async () => {
        const core = await singleRepoProject();
        const { clone: web } = await makeClone('web');
        await insertProjectRepo('p1', { id: 'repo-web', name: 'web', git_path: web });
        await testDb.updateTable('items').set({ repo_ids: JSON.stringify(['p1', 'repo-web']) }).where('id', '=', 'ATL-1').execute();
        // ADR 0017 — the workspace sits next to the first repo's clone.
        const ws = join(root, 'clones', 'worktrees', 'p1', 'ws', SLUG);
        await makeWorktree(core, join(ws, 'core'));
        await makeWorktree(web, join(ws, 'web'));
        await deliver(web, join(ws, 'web'));
        await insertRun(ws);

        const { body } = await getDiff();
        expect(body.repos.map((r) => [r.repo_name, r.source])).toEqual([
            ['core', 'worktree'],
            ['web', 'branch'],
        ]);
        const web1 = await getFile({ repo_id: 'repo-web', scope: 'committed', path: 'src/a.ts' });
        expect(web1.statusCode).toBe(200);
    });

    it('rejects path traversal, a foreign repo and a bad query', async () => {
        const clone = await singleRepoProject();
        const wt = join(root, 'clones', 'worktrees', 'p1', SLUG);
        await makeWorktree(clone, wt);
        await insertRun(wt);

        const traversal = await getFile({ repo_id: 'p1', scope: 'committed', path: '../../etc/passwd' });
        expect(traversal.statusCode).toBe(400);
        expect(traversal.json().details).toEqual({ code: 'invalid_path' });
        const gitDir = await getFile({ repo_id: 'p1', scope: 'uncommitted', path: '.git/config' });
        expect(gitDir.statusCode).toBe(400);
        const foreign = await getFile({ repo_id: 'other-repo', scope: 'committed', path: 'src/a.ts' });
        expect(foreign.statusCode).toBe(404);
        const badScope = await getFile({ repo_id: 'p1', scope: 'staged', path: 'src/a.ts' });
        expect(badScope.statusCode).toBe(400);
        const noRepo = await getFile({ scope: 'committed', path: 'src/a.ts' });
        expect(noRepo.statusCode).toBe(400);
    });
});
