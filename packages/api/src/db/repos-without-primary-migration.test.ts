import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import Knex from 'knex';
import type { Knex as KnexT } from 'knex';
import { closeTestDb, truncateAll } from '../../tests/_pg-db.js';
import { down, up } from './migrations/045_repos_without_primary.js';

const knex = Knex({
    client: 'pg',
    connection: process.env['DATABASE_URL'] ?? '',
    pool: { min: 0, max: 1 },
});

afterAll(async () => {
    await knex.destroy();
    await closeTestDb();
});

beforeEach(async () => {
    await truncateAll();
});

// Every case runs against the pre-045 schema and is always rolled back, so the
// shared `atlas_test` database keeps the migrated schema the other suites use.
async function inPre045(fn: (trx: KnexT.Transaction) => Promise<void>): Promise<void> {
    const trx = await knex.transaction();
    try {
        await down(trx);
        await fn(trx);
    } finally {
        await trx.rollback();
    }
}

async function plantProject(
    trx: KnexT.Transaction,
    id: string,
    prefix: string,
    over: Record<string, unknown> = {}
): Promise<void> {
    await trx('projects').insert({
        id,
        name: `Project ${id}`,
        issue_key_prefix: prefix,
        git_path: `/tmp/atlas/${id}`,
        git_url: `https://github.com/acme/${id}.git`,
        default_branch: 'main',
        clone_status: 'ready',
        status: 'active',
        ...over,
    });
    await trx('project_issue_counters').insert({ project_id: id, last_seq: 0 });
}

describe('migration 045 — repos without a primary', () => {
    it('moves a project git row into project_repos, keeping the project id', async () => {
        await inPre045(async (trx) => {
            await plantProject(trx, 'alpha', 'ALP', { setup_sh_body: 'echo hi' });

            await up(trx);

            const repos = await trx('project_repos').select('*').where('project_id', 'alpha');
            expect(repos).toHaveLength(1);
            expect(repos[0]).toMatchObject({
                id: 'alpha',
                project_id: 'alpha',
                name: 'alpha',
                git_path: '/tmp/atlas/alpha',
                git_url: 'https://github.com/acme/alpha.git',
                default_branch: 'main',
                clone_status: 'ready',
                setup_sh_body: 'echo hi',
                position: 0,
            });
        });
    });

    it('drops the git columns from projects', async () => {
        await inPre045(async (trx) => {
            await plantProject(trx, 'alpha', 'ALP');

            await up(trx);

            const cols = await trx('information_schema.columns')
                .select('column_name')
                .where('table_schema', 'public')
                .where('table_name', 'projects');
            const names = cols.map((c: { column_name: string }) => c.column_name);
            for (const dropped of [
                'git_path',
                'git_url',
                'credential_id',
                'default_branch',
                'clone_status',
                'setup_sh_body',
                'setup_ps1_body',
            ]) {
                expect(names).not.toContain(dropped);
            }
        });
    });

    it('keeps an existing extra repo after the migrated one', async () => {
        await inPre045(async (trx) => {
            await plantProject(trx, 'alpha', 'ALP');
            await trx('project_repos').insert({
                id: 'r-extra',
                project_id: 'alpha',
                name: 'web',
                git_url: 'https://github.com/acme/web.git',
                git_path: '/tmp/atlas/web',
                default_branch: 'main',
                clone_status: 'ready',
                position: 1,
            });

            await up(trx);

            const rows = await trx('project_repos')
                .select('id')
                .where('project_id', 'alpha')
                .orderBy('position');
            expect(rows.map((r: { id: string }) => r.id)).toEqual(['alpha', 'r-extra']);
        });
    });

    it('de-duplicates a folder name an extra repo already took', async () => {
        await inPre045(async (trx) => {
            await plantProject(trx, 'alpha', 'ALP');
            await trx('project_repos').insert({
                id: 'r-extra',
                project_id: 'alpha',
                name: 'alpha',
                git_url: '',
                git_path: '/tmp/atlas/other',
                position: 1,
            });

            await up(trx);

            const row = await trx('project_repos').select('name').where('id', 'alpha').first();
            expect(row.name).toBe('alpha-2');
        });
    });

    it('gives a project with no clone no repo row', async () => {
        await inPre045(async (trx) => {
            await plantProject(trx, 'empty', 'EMP', { git_path: '', git_url: '' });

            await up(trx);

            const rows = await trx('project_repos').select('id').where('project_id', 'empty');
            expect(rows).toHaveLength(0);
        });
    });

    it('backfills items.repo_ids with the project id', async () => {
        await inPre045(async (trx) => {
            await plantProject(trx, 'alpha', 'ALP');
            await trx('items').insert({
                id: 'i1',
                project_id: 'alpha',
                type: 'task',
                title: 'A Task',
                status: 'draft',
                repo_ids: JSON.stringify([]),
            });

            await up(trx);

            const row = await trx('items').select('repo_ids').where('id', 'i1').first();
            expect(row.repo_ids).toEqual(['alpha']);
        });
    });

    it('leaves a Task that already named its repos alone', async () => {
        await inPre045(async (trx) => {
            await plantProject(trx, 'alpha', 'ALP');
            await trx('project_repos').insert({
                id: 'r-extra',
                project_id: 'alpha',
                name: 'web',
                git_url: '',
                git_path: '/tmp/atlas/web',
                position: 1,
            });
            await trx('items').insert({
                id: 'i1',
                project_id: 'alpha',
                type: 'task',
                title: 'A Task',
                status: 'draft',
                repo_ids: JSON.stringify(['r-extra']),
            });

            await up(trx);

            const row = await trx('items').select('repo_ids').where('id', 'i1').first();
            expect(row.repo_ids).toEqual(['r-extra']);
        });
    });

    it('re-keys project_schedules and cli_sessions on repo_id', async () => {
        await inPre045(async (trx) => {
            await plantProject(trx, 'alpha', 'ALP');
            await trx('project_schedules').insert({
                project_id: 'alpha',
                enabled: 1,
                preset: 'daily',
                cron_expression: '0 6 * * *',
                time_of_day: '06:00',
            });
            await trx('cli_sessions').insert({
                id: 's1',
                project_id: 'alpha',
                title: 'Session',
                model: 'claude-opus-4-7',
                status: 'active',
                worktree_branch: 'atlas/x',
            });

            await up(trx);

            const sched = await trx('project_schedules').select('repo_id').first();
            expect(sched.repo_id).toBe('alpha');
            const sess = await trx('cli_sessions').select('repo_id').where('id', 's1').first();
            expect(sess.repo_id).toBe('alpha');
        });
    });

    it('drops a schedule whose project never had a clone', async () => {
        await inPre045(async (trx) => {
            await plantProject(trx, 'empty', 'EMP', { git_path: '', git_url: '' });
            await trx('project_schedules').insert({
                project_id: 'empty',
                enabled: 1,
                preset: 'daily',
                cron_expression: '0 6 * * *',
                time_of_day: '06:00',
            });

            await up(trx);

            expect(await trx('project_schedules').select('repo_id')).toHaveLength(0);
        });
    });

    it('down() restores the project git columns from the repo row', async () => {
        await inPre045(async (trx) => {
            await plantProject(trx, 'alpha', 'ALP', { setup_ps1_body: 'Write-Host hi' });

            await up(trx);
            await down(trx);

            const row = await trx('projects')
                .select('git_path', 'git_url', 'clone_status', 'setup_ps1_body')
                .where('id', 'alpha')
                .first();
            expect(row).toMatchObject({
                git_path: '/tmp/atlas/alpha',
                git_url: 'https://github.com/acme/alpha.git',
                clone_status: 'ready',
                setup_ps1_body: 'Write-Host hi',
            });
            expect(await trx('project_repos').select('id').where('id', 'alpha')).toHaveLength(0);
        });
    });
});
