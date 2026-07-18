import { describe, it, expect, beforeEach, afterAll, afterEach } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { verifyRunCommits } from './commit-verifier.js';
import { testDb, truncateAll, closeTestDb } from '../../tests/_pg-db.js';
import { insertProject, insertItem } from '../../tests/_items.js';
import { agentsService } from './agents.js';

const execFileP = promisify(execFile);

// Build a throwaway git repo per test so we can run real `git log`
// against it. The verifier shells out to git, so unit-style mocking
// would just test the mock; an actual repo with controlled commits
// is the honest fixture.
async function makeRepo(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'cvt-'));
    await execFileP('git', ['init', '-b', 'main'], { cwd: dir });
    await execFileP('git', ['config', 'user.email', 'test@local'], { cwd: dir });
    await execFileP('git', ['config', 'user.name', 'Test'], { cwd: dir });
    // Commit signing config — turn off in case the host has it on.
    await execFileP('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir });
    return dir;
}

async function gitCommit(dir: string, file: string, content: string, message: string): Promise<void> {
    await writeFile(join(dir, file), content, 'utf8');
    await execFileP('git', ['add', file], { cwd: dir });
    await execFileP('git', ['commit', '-m', message], { cwd: dir });
}

let repos: string[] = [];

beforeEach(async () => {
    await truncateAll();
    repos = [];
});

afterEach(async () => {
    for (const dir of repos) {
        await rm(dir, { recursive: true, force: true });
    }
});

afterAll(async () => {
    await closeTestDb();
});

const agentBase = {
    name: 'Coder',
    category: 'software-dev' as const,
    cli: 'claude' as const,
    model: 'claude-opus-4-7',
    framework: '',
    prompt_md: '',
    accent_color: '#000',
    sort_order: 1,
};

describe('verifyRunCommits', () => {
    it('clean — no commits, no dirty tree', async () => {
        const dir = await makeRepo();
        repos.push(dir);
        const agent = await agentsService.create(agentBase);
        await insertProject('p1', 'ATL');
        await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'E' });

        const out = await verifyRunCommits({
            runId: 'run-1',
            agentId: agent.id,
            itemId: 'ATL-1',
            cwd: dir,
            runStartedAtIso: new Date(Date.now() - 60_000).toISOString(),
            itemType: 'epic',
        });
        expect(out.result).toBe('clean');

        const row = await testDb
            .selectFrom('commit_verifications')
            .selectAll()
            .where('run_id', '=', 'run-1')
            .executeTakeFirstOrThrow();
        expect(row.result).toBe('clean');
        expect(row.commit_count).toBe(0);
    });

    it('silent — files changed but never committed', async () => {
        const dir = await makeRepo();
        repos.push(dir);
        // Need at least one commit so `git log` doesn't error.
        await gitCommit(dir, 'README.md', 'init\n', 'chore: init');
        // Now leave a dirty modification.
        await writeFile(join(dir, 'dirty.txt'), 'uncommitted', 'utf8');

        const agent = await agentsService.create(agentBase);
        await insertProject('p1', 'ATL');
        await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'E' });

        const out = await verifyRunCommits({
            runId: 'run-2',
            agentId: agent.id,
            itemId: 'ATL-1',
            cwd: dir,
            runStartedAtIso: new Date(Date.now() + 60_000).toISOString(), // after init commit
            itemType: 'epic',
        });
        expect(out.result).toBe('silent');
    });

    it('compliant — one well-formed commit with Refs', async () => {
        const dir = await makeRepo();
        repos.push(dir);
        const sinceIso = new Date(Date.now() - 60_000).toISOString();
        await gitCommit(
            dir,
            'a.txt',
            'A\n',
            'feat(api): add a thing\n\nRefs: ATL-1',
        );

        const agent = await agentsService.create(agentBase);
        await insertProject('p1', 'ATL');
        await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'E' });

        const out = await verifyRunCommits({
            runId: 'run-3',
            agentId: agent.id,
            itemId: 'ATL-1',
            cwd: dir,
            runStartedAtIso: sinceIso,
            itemType: 'epic',
        });
        expect(out.result).toBe('compliant');
        expect(out.commitCount).toBe(1);
        expect(out.problems).toEqual([]);
    });

    it('partial — commit missing Refs: line', async () => {
        const dir = await makeRepo();
        repos.push(dir);
        const sinceIso = new Date(Date.now() - 60_000).toISOString();
        await gitCommit(dir, 'b.txt', 'B\n', 'feat(api): no ref');

        const agent = await agentsService.create(agentBase);
        await insertProject('p1', 'ATL');
        await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'E' });

        const out = await verifyRunCommits({
            runId: 'run-4',
            agentId: agent.id,
            itemId: 'ATL-1',
            cwd: dir,
            runStartedAtIso: sinceIso,
            itemType: 'epic',
        });
        expect(out.result).toBe('partial');
        expect(out.problems.some((p) => p.reason === 'refs-missing')).toBe(true);
    });

    it('partial — non-conventional subject', async () => {
        const dir = await makeRepo();
        repos.push(dir);
        const sinceIso = new Date(Date.now() - 60_000).toISOString();
        await gitCommit(dir, 'c.txt', 'C\n', 'just a fix\n\nRefs: ATL-1');

        const agent = await agentsService.create(agentBase);
        await insertProject('p1', 'ATL');
        await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'E' });

        const out = await verifyRunCommits({
            runId: 'run-5',
            agentId: agent.id,
            itemId: 'ATL-1',
            cwd: dir,
            runStartedAtIso: sinceIso,
            itemType: 'epic',
        });
        expect(out.result).toBe('partial');
        expect(
            out.problems.some((p) => p.reason === 'subject-not-conventional'),
        ).toBe(true);
    });

    it('clean — non-git cwd records a row without erroring', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'no-git-'));
        repos.push(dir);

        const agent = await agentsService.create(agentBase);
        await insertProject('p1', 'ATL');
        await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'E' });

        const out = await verifyRunCommits({
            runId: 'run-6',
            agentId: agent.id,
            itemId: 'ATL-1',
            cwd: dir,
            runStartedAtIso: new Date().toISOString(),
            itemType: 'epic',
        });
        expect(out.result).toBe('clean');
    });

    it('appends a system comment on non-clean problems', async () => {
        const dir = await makeRepo();
        repos.push(dir);
        const sinceIso = new Date(Date.now() - 60_000).toISOString();
        await gitCommit(dir, 'd.txt', 'D\n', 'feat(api): missing ref');

        const agent = await agentsService.create(agentBase);
        await insertProject('p1', 'ATL');
        await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'E' });

        await verifyRunCommits({
            runId: 'run-7',
            agentId: agent.id,
            itemId: 'ATL-1',
            cwd: dir,
            runStartedAtIso: sinceIso,
            itemType: 'epic',
        });
        const comments = await testDb
            .selectFrom('comments')
            .selectAll()
            .where('item_id', '=', 'ATL-1')
            .execute();
        expect(comments.length).toBeGreaterThan(0);
        expect(comments[0]!.body).toMatch(/commit-discipline verifier/);
    });

    it('silent result with no problems: system comment body has no Problems suffix (problemSummary empty branch)', async () => {
        // `silent` result fires when there are commits=0 and dirty=true.
        // `problems` is [] so `problemSummary` is '' and the ternary picks the empty branch.
        const dir = await makeRepo();
        repos.push(dir);
        // Commit so git is happy, then leave a dirty file.
        await gitCommit(dir, 'README.md', 'init\n', 'chore: init');
        await writeFile(join(dir, 'dirty2.txt'), 'modified', 'utf8');

        const agent = await agentsService.create(agentBase);
        await insertProject('p1', 'ATL');
        await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'E' });

        const out = await verifyRunCommits({
            runId: 'run-silent-noprob',
            agentId: agent.id,
            itemId: 'ATL-1',
            cwd: dir,
            runStartedAtIso: new Date(Date.now() + 60_000).toISOString(),
            itemType: 'epic',
        });
        expect(out.result).toBe('silent');
        expect(out.problems).toHaveLength(0);

        const comments = await testDb
            .selectFrom('comments')
            .selectAll()
            .where('item_id', '=', 'ATL-1')
            .execute();
        // There should be a system comment about the silent result.
        expect(comments.length).toBeGreaterThan(0);
        const body = comments[0]!.body;
        // The body should NOT have `. Problems:` since there are no problems.
        expect(body).not.toContain('Problems:');
        expect(body).toContain('silent');
    });

    it('freedom-mode (itemId=null): commit without Refs does NOT add refs-missing problem (CVT-FREEDOM-1)', async () => {
        // Covers `if (args.itemId !== null && ...)` false branch at line 145 when itemId=null.
        // Also covers the `args.itemId !== null && ...` false branch at line 188 (no system comment).
        const dir = await makeRepo();
        repos.push(dir);
        const sinceIso = new Date(Date.now() - 60_000).toISOString();
        // A commit without Refs: — for item runs this would add refs-missing,
        // but for freedom runs (itemId=null) it should NOT.
        await gitCommit(dir, 'f.txt', 'F\n', 'feat(api): freedom commit no refs');

        const agent = await agentsService.create(agentBase);

        const out = await verifyRunCommits({
            runId: 'run-freedom',
            agentId: agent.id,
            itemId: null,
            cwd: dir,
            runStartedAtIso: sinceIso,
            itemType: null,
        });
        // No refs-missing problem (itemId is null, so the check is skipped).
        expect(out.problems).not.toContain(expect.objectContaining({ reason: 'refs-missing' }));
        // Result is compliant (no problems, has commits, no dirty).
        expect(out.result).toBe('compliant');
    });
});
