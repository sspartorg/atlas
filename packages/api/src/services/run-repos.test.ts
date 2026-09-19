import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../routes/events.js', () => ({ eventsRoutes: async () => undefined, broadcastSSE: vi.fn() }));

import { join } from 'node:path';
import { closeTestDb, testDb, truncateAll } from '../../tests/_pg-db.js';
import { insertItem, insertProject } from '../../tests/_items.js';
import { repositoriesMarkdown, runRepos } from './run-repos.js';

const BRANCH = 'atlas/wf/ATL-1';

beforeEach(async () => {
    await truncateAll();
    await insertProject('p1', 'ATL', { git_path: '/ws/core', git_url: 'https://github.com/o/core' });
    await testDb
        .insertInto('project_repos')
        .values({ id: 'repo-web', project_id: 'p1', name: 'web', git_url: 'https://github.com/o/web', git_path: '/ws/web' })
        .execute();
    await insertItem({ id: 'ATL-1', type: 'task', project_id: 'p1', title: 'Task' });
    await insertItem({ id: 'ATL-2', type: 'sub_task', project_id: 'p1', parent_id: 'ATL-1', title: 'Sub' });
});

afterAll(async () => {
    await closeTestDb();
});

describe('runRepos', () => {
    it('keeps a single-repo Task on the checkout the run recorded', async () => {
        const r = await runRepos({ project_id: 'p1', item_id: 'ATL-1', branch: BRANCH, worktree_path: '/wt/here' });
        expect(r.workspace).toBeNull();
        expect(r.repos.map((x) => [x.repo.id, x.path])).toEqual([['p1', '/wt/here']]);
    });

    it("nests a multi-repo Task's checkouts in one workspace, and a sub-task uses its Task's repos", async () => {
        await testDb.updateTable('items').set({ repo_ids: JSON.stringify(['repo-web', 'p1']) }).where('id', '=', 'ATL-1').execute();
        const r = await runRepos({ project_id: 'p1', item_id: 'ATL-2', branch: BRANCH, worktree_path: '/ignored' });
        const ws = join('/ws', 'worktrees', 'p1', 'ws', 'atlas__wf__ATL-1');
        expect(r.workspace).toBe(ws);
        expect(r.repos.map((x) => [x.repo.name, x.path])).toEqual([
            ['web', join(ws, 'web')],
            ['core', join(ws, 'core')],
        ]);

        const md = repositoriesMarkdown(r.repos, BRANCH);
        expect(md).toContain('| `./core` | https://github.com/o/core | `main` |');
        expect(md).toContain('| `./web` (first) | https://github.com/o/web | `main` |');
        expect(md).toContain('Put Task-wide files (specs, QA CSVs) in the first repo, `./web`');
    });

    it('gives each repo its own folder even if the primary is renamed onto an extra repo name', async () => {
        await testDb.updateTable('projects').set({ git_path: '/ws/web' }).where('id', '=', 'p1').execute();
        await testDb.updateTable('items').set({ repo_ids: JSON.stringify(['p1', 'repo-web']) }).where('id', '=', 'ATL-1').execute();
        const r = await runRepos({ project_id: 'p1', item_id: 'ATL-1', branch: BRANCH });
        expect(r.repos.map((x) => x.path.split('/').pop())).toEqual(['web', 'web-2']);
    });
});
