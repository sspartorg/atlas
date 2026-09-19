import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import Knex from 'knex';
import { closeTestDb, testDb, truncateAll } from '../../tests/_pg-db.js';
import { insertProject } from '../../tests/_items.js';
import { down, up } from './migrations/044_jira_sources.js';

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
    await insertProject('p1', 'ATL');
    await insertProject('p2', 'WEB');
});

describe('migration 044 — Jira sources', () => {
    it('turns label rules into sources ahead of a catch-all, keeping where issues went', async () => {
        const trx = await knex.transaction();
        try {
            await down(trx);
            await trx('jira_config').insert({
                id: 1,
                jql: 'project = DHEQ',
                project_id: 'p1',
                label_workflows: JSON.stringify([
                    { label: 'web', project_id: 'p2', workflow_id: 'wf-web' },
                    // Saved before rules carried a project: goes to the default one.
                    { label: 'say "hi"', workflow_id: 'wf-dev' },
                    { label: 'infra', project_id: null, workflow_id: null },
                ]),
            });

            await up(trx);

            const row = (await trx('jira_config').where('id', 1).first()) as Record<
                string,
                unknown
            >;
            expect(row['sources']).toEqual([
                {
                    repo_id: 'p2',
                    jql: '(project = DHEQ) AND labels = "web"',
                    workflow_id: 'wf-web',
                },
                {
                    repo_id: 'p1',
                    jql: '(project = DHEQ) AND labels = "say \\"hi\\""',
                    workflow_id: 'wf-dev',
                },
                {
                    repo_id: 'p1',
                    jql: '(project = DHEQ) AND labels = "infra"',
                    workflow_id: null,
                },
                { repo_id: 'p1', jql: 'project = DHEQ', workflow_id: null },
            ]);
            expect(row).not.toHaveProperty('jql');
            expect(row).not.toHaveProperty('label_workflows');
        } finally {
            await trx.rollback();
        }
    });

    it('converts a config without a JQL to no sources', async () => {
        const trx = await knex.transaction();
        try {
            await down(trx);
            await trx('jira_config').insert({ id: 1, project_id: 'p1' });
            await up(trx);
            const row = (await trx('jira_config').where('id', 1).first()) as Record<
                string,
                unknown
            >;
            expect(row['sources']).toEqual([]);
        } finally {
            await trx.rollback();
        }
    });

    it("down() ORs the sources into one JQL for the first source's project", async () => {
        await testDb
            .insertInto('project_repos')
            .values({
                id: 'r-site',
                project_id: 'p2',
                name: 'site',
                git_url: 'u',
                git_path: '/ws/site',
            })
            .execute();
        await testDb
            .insertInto('jira_config')
            .values({
                id: 1,
                sources: JSON.stringify([
                    { repo_id: 'r-site', jql: 'labels = site', workflow_id: null },
                    { repo_id: 'p1', jql: 'project = DHEQ', workflow_id: null },
                ]),
            })
            .execute();
        const trx = await knex.transaction();
        try {
            await down(trx);
            expect(await trx('jira_config').select('jql', 'project_id').first()).toEqual({
                jql: '(labels = site) OR (project = DHEQ)',
                project_id: 'p2',
            });
        } finally {
            await trx.rollback();
        }
    });
});
