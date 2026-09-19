import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { projectReposService } from './project-repos.js';
import { closeTestDb, testDb, truncateAll } from '../../tests/_pg-db.js';
import { insertItem, insertProject, insertProjectRepo } from '../../tests/_items.js';

// ADR 0018 — a project's repos are all equal: no primary, any of them can go,
// and the order they come back in is what a Task's "first repo" means.

afterAll(closeTestDb);

beforeEach(async () => {
    await truncateAll();
});

describe('projectReposService', () => {
    it('lists a project repos in position order, with no primary flag', async () => {
        await insertProject('p1', 'ATL');
        const web = await projectReposService.insert({
            project_id: 'p1',
            name: 'web',
            git_url: 'https://github.com/acme/web.git',
            git_path: '/tmp/web',
            credential_id: null,
            default_branch: 'main',
        });

        const repos = await projectReposService.list('p1');

        expect(repos.map((r) => r.id)).toEqual(['p1', web.id]);
        expect(repos[0]).not.toHaveProperty('primary');
    });

    it('gives a project with no repos an empty list, not an error', async () => {
        await insertProject('p1', 'ATL', { no_repo: true });
        expect(await projectReposService.list('p1')).toEqual([]);
    });

    it('404s for a project that does not exist', async () => {
        await expect(projectReposService.list('nope')).rejects.toMatchObject({ status: 404 });
    });

    it('removes the last repo, leaving the project with none', async () => {
        await insertProject('p1', 'ATL');

        await projectReposService.remove('p1', 'p1');

        expect(await projectReposService.list('p1')).toEqual([]);
    });

    it('drops a removed repo from its Tasks', async () => {
        await insertProject('p1', 'ATL');
        const web = await insertProjectRepo('p1', { name: 'web' });
        const id = await insertItem({ id: 'i1', project_id: 'p1', type: 'task', repo_ids: ['p1', web] });

        await projectReposService.remove('p1', web);

        const row = await testDb
            .selectFrom('items')
            .select('repo_ids')
            .where('id', '=', id)
            .executeTakeFirst();
        expect(row?.repo_ids).toEqual(['p1']);
    });

    it('numbers a new repo after the last one, even when an earlier one went', async () => {
        await insertProject('p1', 'ATL');
        const web = await projectReposService.insert({
            project_id: 'p1',
            name: 'web',
            git_url: '',
            git_path: '/tmp/web',
            credential_id: null,
            default_branch: 'main',
        });
        await projectReposService.remove('p1', 'p1');
        const engine = await projectReposService.insert({
            project_id: 'p1',
            name: 'engine',
            git_url: '',
            git_path: '/tmp/engine',
            credential_id: null,
            default_branch: 'main',
        });

        const repos = await projectReposService.list('p1');
        expect(repos.map((r) => r.id)).toEqual([web.id, engine.id]);
    });

    it('forTask keeps the Task order and falls back to the first repo', async () => {
        await insertProject('p1', 'ATL');
        const web = await insertProjectRepo('p1', { name: 'web' });

        const picked = await projectReposService.forTask({ project_id: 'p1', repo_ids: [web, 'p1'] });
        expect(picked.map((r) => r.id)).toEqual([web, 'p1']);

        const legacy = await projectReposService.forTask({ project_id: 'p1', repo_ids: [] });
        expect(legacy.map((r) => r.id)).toEqual(['p1']);
    });

    it('listAll spans projects', async () => {
        await insertProject('p1', 'ATL');
        await insertProject('p2', 'WEB');

        const all = await projectReposService.listAll();

        expect(all.map((r) => r.project_id).sort()).toEqual(['p1', 'p2']);
    });
});
