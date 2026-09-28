import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../routes/events.js', () => ({ broadcastSSE: vi.fn() }));

import { ensureTestProject } from './test-project.js';
import { projectReposService } from './project-repos.js';
import { closeTestDb, testDb, truncateAll } from '../../tests/_pg-db.js';
import { insertProject } from '../../tests/_items.js';

let root: string;

beforeEach(async () => {
    await truncateAll();
    root = mkdtempSync(join(tmpdir(), 'atlas-sandbox-'));
    await testDb.updateTable('settings').set({ workspace_path: root } as never).execute();
});

afterEach(() => {
    rmSync(root, { recursive: true, force: true });
});

afterAll(async () => {
    await closeTestDb();
});

describe('ensureTestProject', () => {
    it('creates the Tests project with a committed local sample repo and a verify command', async () => {
        const id = await ensureTestProject();
        const project = await testDb
            .selectFrom('projects')
            .select(['name', 'issue_key_prefix', 'is_test_sandbox'])
            .where('id', '=', id)
            .executeTakeFirstOrThrow();
        expect(project).toEqual({ name: 'Tests', issue_key_prefix: 'TST', is_test_sandbox: true });

        const [repo] = await projectReposService.list(id);
        expect(repo).toMatchObject({ name: 'atlas-test-sample', credential_id: null, verify_command: 'npm test' });
        expect(repo?.git_path).toBe(join(root, 'atlas-test-sample'));
        expect(existsSync(join(root, 'atlas-test-sample', 'src', 'strings.js'))).toBe(true);
        // Committed, on main, with no remote — nothing here can be pushed.
        const git = (...args: string[]) =>
            execFileSync('git', args, { cwd: join(root, 'atlas-test-sample'), encoding: 'utf8' }).trim();
        expect(git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
        expect(git('log', '--oneline')).toMatch(/Sample project for agent tests/);
        expect(git('remote')).toBe('');
    });

    it('returns the same project on every call, including concurrent ones', async () => {
        const [a, b] = await Promise.all([ensureTestProject(), ensureTestProject()]);
        expect(a).toBe(b);
        expect(await ensureTestProject()).toBe(a);
        const count = await testDb
            .selectFrom('projects')
            .select(({ fn }) => fn.countAll<string>().as('n'))
            .executeTakeFirstOrThrow();
        expect(Number(count.n)).toBe(1);
    });

    it('takes another prefix when the Owner already uses TST', async () => {
        await insertProject('mine', 'TST');
        const id = await ensureTestProject();
        expect(id).not.toBe('mine');
        const p = await testDb.selectFrom('projects').select('issue_key_prefix').where('id', '=', id).executeTakeFirstOrThrow();
        expect(p.issue_key_prefix).toBe('TSX');
    });

    it('gives the sample repo back to a sandbox that lost it, reusing the folder', async () => {
        const id = await ensureTestProject();
        const [repo] = await projectReposService.list(id);
        await testDb.deleteFrom('project_repos').where('id', '=', repo!.id).execute();
        expect(await ensureTestProject()).toBe(id);
        const [again] = await projectReposService.list(id);
        expect(again?.git_path).toBe(repo?.git_path);
    });

    it('gives up rather than guessing when every candidate prefix is taken', async () => {
        for (const [i, p] of ['TST', 'TSX', 'TSY', 'TSZ', 'TXT'].entries()) await insertProject(`p${i}`, p);
        await expect(ensureTestProject()).rejects.toThrow(/No free issue prefix/);
    });
});
