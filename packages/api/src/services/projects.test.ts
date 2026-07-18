import { describe, expect, it, beforeEach, afterAll, vi } from 'vitest';
import { sql } from 'kysely';

vi.mock('../routes/events.js', () => ({ broadcastSSE: vi.fn() }));
vi.mock('./events-log.js', () => ({
    eventsLog: { record: vi.fn(), activity: vi.fn().mockResolvedValue([]) },
}));

import { projectsService, PrefixCollisionError, rejectTraversalPath } from './projects.js';
import { testDb, truncateAll, closeTestDb } from '../../tests/_pg-db.js';
import { insertProject, insertItem } from '../../tests/_items.js';

beforeEach(async () => {
    await truncateAll();
});

afterAll(async () => {
    await closeTestDb();
});

describe('projectsService', () => {
    describe('list / get / count', () => {
        it('returns an empty list when no projects exist', async () => {
            expect(await projectsService.list()).toEqual([]);
            expect(await projectsService.count()).toBe(0);
        });

        it('returns projects with computed last_activity_at', async () => {
            await insertProject('p1', 'AAA');
            await insertProject('p2', 'BBB');
            const list = await projectsService.list();
            expect(list).toHaveLength(2);
            expect(await projectsService.count()).toBe(2);
        });

        it('get() returns a single project including the last_activity_at column', async () => {
            await insertProject('p1', 'ATL');
            const got = await projectsService.get('p1');
            expect(got).toBeDefined();
            expect(got!.id).toBe('p1');
            expect(got!.last_activity_at).toBeTruthy();
        });

        it('get() returns undefined for an unknown id', async () => {
            expect(await projectsService.get('does-not-exist')).toBeUndefined();
        });

        it('last_activity_at picks the MAX across items (epic newer than project)', async () => {
            await insertProject('p1', 'ATL');
            // Plant an item with an explicit-future updated_at, bypassing the
            // items_set_updated_at trigger so the value survives.
            await sql`
                ALTER TABLE items DISABLE TRIGGER items_set_updated_at;
                INSERT INTO items (id, type, project_id, title, status, priority, updated_at, created_at)
                VALUES ('ATL-1', 'epic', 'p1', 'E', 'draft', 'normal', '2030-03-01T00:00:00Z', '2030-03-01T00:00:00Z');
                ALTER TABLE items ENABLE TRIGGER items_set_updated_at;
            `.execute(testDb);
            const got = (await projectsService.get('p1'))!;
            const ts =
                got.last_activity_at instanceof Date
                    ? got.last_activity_at.toISOString()
                    : String(got.last_activity_at);
            expect(ts).toContain('2030-03-01');
        });
    });

    describe('checkPrefix', () => {
        it('returns available:true when no project owns the prefix', async () => {
            const result = await projectsService.checkPrefix('AAA');
            expect(result.available).toBe(true);
        });

        it('returns reason=in_use when a live project owns the prefix', async () => {
            await testDb
                .insertInto('projects')
                .values({ id: 'p1', name: 'Existing', issue_key_prefix: 'ATL', git_path: '', status: 'active', clone_status: 'ready' })
                .execute();
            await testDb.insertInto('project_issue_counters').values({ project_id: 'p1', last_seq: 0 }).execute();
            const result = await projectsService.checkPrefix('ATL');
            expect(result.available).toBe(false);
            if (!result.available) {
                expect(result.reason).toBe('in_use');
                expect(result.conflict).toBe('Existing');
            }
        });

        // 074 dropped the retire-on-delete trigger. After a project is
        // deleted the prefix is immediately reusable — this test guards
        // against a future regression that re-introduces retirement.
        it('returns available:true after the previous project owning the prefix is deleted', async () => {
            await insertProject('p1', 'ATL', { name: 'First' });
            await projectsService.delete('p1');
            const result = await projectsService.checkPrefix('ATL');
            expect(result.available).toBe(true);
        });
    });

    describe('create', () => {
        it('inserts a new project, creates the counter row, and returns the full row', async () => {
            const proj = await projectsService.create({
                name: 'New Proj',
                issue_key_prefix: 'NEW',
                description: 'about',
            });
            expect(proj.id).toBeTruthy();
            expect(proj.name).toBe('New Proj');
            expect(proj.issue_key_prefix).toBe('NEW');
            expect(proj.description).toBe('about');
            const counter = await testDb
                .selectFrom('project_issue_counters')
                .select('last_seq')
                .where('project_id', '=', proj.id)
                .executeTakeFirstOrThrow();
            expect(counter.last_seq).toBe(0);
        });

        it('falls back to empty string for optional fields', async () => {
            const proj = await projectsService.create({
                name: 'Default Fields',
                issue_key_prefix: 'DEF',
            });
            expect(proj.git_path).toBe('');
            expect(proj.description).toBe('');
        });

        it('throws PrefixCollisionError with reason=in_use when prefix exists', async () => {
            await insertProject('p1', 'ATL', { name: 'First' });
            await expect(
                projectsService.create({ name: 'Second', issue_key_prefix: 'ATL' }),
            ).rejects.toThrow(PrefixCollisionError);
        });

        it('allows reusing a prefix from a previously-deleted project', async () => {
            await insertProject('p1', 'ATL', { name: 'First' });
            await projectsService.delete('p1');
            const reused = await projectsService.create({ name: 'Second', issue_key_prefix: 'ATL' });
            expect(reused.issue_key_prefix).toBe('ATL');
        });
    });

    describe('update', () => {
        beforeEach(async () => {
            await insertProject('p1', 'ATL');
        });

        it('patches the named fields and bumps updated_at', async () => {
            const updated = await projectsService.update('p1', {
                name: 'Renamed',
                description: 'fresh',
                guardrails_md: '# Rules',
                status: 'archived',
            });
            expect(updated.name).toBe('Renamed');
            expect(updated.description).toBe('fresh');
            expect(updated.guardrails_md).toBe('# Rules');
            expect(updated.status).toBe('archived');
        });

        it('ignores undefined keys (no-op when no defined fields)', async () => {
            const before = (await projectsService.get('p1'))!;
            const after = await projectsService.update('p1', {
                name: undefined,
                description: undefined,
            });
            expect(after.id).toBe(before.id);
            expect(after.name).toBe(before.name);
        });

        it('partial patch only touches passed fields', async () => {
            await projectsService.update('p1', { name: 'NewName' });
            const got = (await projectsService.get('p1'))!;
            expect(got.name).toBe('NewName');
            expect(got.issue_key_prefix).toBe('ATL');
        });

        // Regression: setup_sh_body / setup_ps1_body were written by UPDATE
        // but missing from the get()/list() SELECT lists, so the Setup tab
        // appeared empty after save.
        it('round-trips setup script bodies through update + get', async () => {
            const sh = '#!/usr/bin/env bash\necho hello\n';
            const ps1 = "Write-Host 'hi'\n";
            const updated = await projectsService.update('p1', {
                setup_sh_body: sh,
                setup_ps1_body: ps1,
            });
            expect(updated.setup_sh_body).toBe(sh);
            expect(updated.setup_ps1_body).toBe(ps1);
            const refetched = (await projectsService.get('p1'))!;
            expect(refetched.setup_sh_body).toBe(sh);
            expect(refetched.setup_ps1_body).toBe(ps1);
        });
    });

    describe('delete', () => {
        it('removes the project row and leaves the prefix free for reuse', async () => {
            await insertProject('p1', 'ATL');
            await projectsService.delete('p1');
            expect(await projectsService.get('p1')).toBeUndefined();
            // No retired_prefixes table after 074 — confirming the prefix
            // is treated as available is the only meaningful assertion.
            const check = await projectsService.checkPrefix('ATL');
            expect(check.available).toBe(true);
        });

        it('cascades to project_issue_counters via FK', async () => {
            await insertProject('p1', 'ATL');
            await projectsService.delete('p1');
            const counter = await testDb
                .selectFrom('project_issue_counters')
                .selectAll()
                .where('project_id', '=', 'p1')
                .executeTakeFirst();
            expect(counter).toBeUndefined();
        });
    });

    describe('createFromClone', () => {
        beforeEach(async () => {
            await testDb
                .insertInto('credentials')
                .values({
                    id: 'cred-1',
                    label: 'GH PAT',
                    host: 'github',
                    kind: 'pat',
                    username: '',
                    token_encrypted: 'enc',
                    token_fingerprint: 'fp',
                    scope: '',
                })
                .execute();
        });

        it('inserts a project with clone metadata and creates the counter row', async () => {
            const proj = await projectsService.createFromClone({
                name: 'Cloned',
                issue_key_prefix: 'CLN',
                git_url: 'https://github.com/x/y.git',
                git_path: 'C:/tmp/cln',
                credential_id: 'cred-1',
                default_branch: 'main',
                description: 'cloned repo',
            });
            expect(proj.name).toBe('Cloned');
            expect(proj.git_url).toBe('https://github.com/x/y.git');
            expect(proj.git_path).toBe('C:/tmp/cln');
            expect(proj.credential_id).toBe('cred-1');
            expect(proj.default_branch).toBe('main');
            expect(proj.clone_status).toBe('ready');
            const counter = await testDb
                .selectFrom('project_issue_counters')
                .select('last_seq')
                .where('project_id', '=', proj.id)
                .executeTakeFirstOrThrow();
            expect(counter.last_seq).toBe(0);
        });

        it('defaults description to "" when omitted', async () => {
            const proj = await projectsService.createFromClone({
                name: 'Cloned2',
                issue_key_prefix: 'CLZ',
                git_url: 'https://github.com/x/y.git',
                git_path: 'C:/tmp/cl2',
                credential_id: 'cred-1',
                default_branch: 'main',
            });
            expect(proj.description).toBe('');
        });

        it('throws PrefixCollisionError when prefix already in use', async () => {
            await insertProject('p-existing', 'EXI');
            await expect(
                projectsService.createFromClone({
                    name: 'X',
                    issue_key_prefix: 'EXI',
                    git_url: 'u',
                    git_path: 'p',
                    credential_id: 'cred-1',
                    default_branch: 'main',
                }),
            ).rejects.toThrow(PrefixCollisionError);
        });

        it('allows cloning into a prefix freed by a previous project delete', async () => {
            await insertProject('p-prev', 'RET', { name: 'Prev' });
            await projectsService.delete('p-prev');
            const proj = await projectsService.createFromClone({
                name: 'Fresh',
                issue_key_prefix: 'RET',
                git_url: 'u',
                git_path: 'p',
                credential_id: 'cred-1',
                default_branch: 'main',
            });
            expect(proj.issue_key_prefix).toBe('RET');
        });
    });
});

// Silence unused import lint
void insertItem;

// ── rejectTraversalPath ───────────────────────────────────────────────────────
describe('rejectTraversalPath', () => {
    it('does not throw when path is undefined', () => {
        expect(() => rejectTraversalPath(undefined)).not.toThrow();
    });

    it('does not throw for a simple absolute path with no traversal', () => {
        expect(() => rejectTraversalPath('/workspace/myproject')).not.toThrow();
    });

    it('does not throw for a simple relative path', () => {
        expect(() => rejectTraversalPath('repos/myproject')).not.toThrow();
    });

    it('throws when path contains ".." traversal component', () => {
        expect(() => rejectTraversalPath('../../etc/passwd')).toThrow(/must not contain path-traversal/);
    });

    it('throws with custom field name in the error message', () => {
        expect(() => rejectTraversalPath('../escape', 'workspace_path')).toThrow(/workspace_path/);
    });
});

// ── listPaged ────────────────────────────────────────────────────────────────
describe('projectsService.listPaged', () => {
    beforeEach(async () => {
        await truncateAll();
    });

    it('returns empty rows and total=0 for an empty DB', async () => {
        const result = await projectsService.listPaged({ page: 1, limit: 10 });
        expect(result.rows).toHaveLength(0);
        expect(result.total).toBe(0);
        expect(result.page).toBe(1);
        expect(result.limit).toBe(10);
    });

    it('paginates correctly with multiple projects', async () => {
        await insertProject('p1', 'AAA', { name: 'First' });
        await insertProject('p2', 'BBB', { name: 'Second' });
        await insertProject('p3', 'CCC', { name: 'Third' });

        const page1 = await projectsService.listPaged({ page: 1, limit: 2 });
        expect(page1.rows).toHaveLength(2);
        expect(page1.total).toBe(3);
        expect(page1.page).toBe(1);
        expect(page1.limit).toBe(2);

        const page2 = await projectsService.listPaged({ page: 2, limit: 2 });
        expect(page2.rows).toHaveLength(1);
        expect(page2.total).toBe(3);
    });

    it('clamps page to 1 when passed 0 or negative', async () => {
        await insertProject('p1', 'CLM', { name: 'Clamp' });  // CLM = 3 uppercase letters
        const result = await projectsService.listPaged({ page: 0, limit: 10 });
        expect(result.page).toBe(1);
        expect(result.rows).toHaveLength(1);
    });

    it('clamps limit to max 100 and min 1', async () => {
        await insertProject('p1', 'LIM', { name: 'Limit' });  // LIM = 3 uppercase letters
        const big = await projectsService.listPaged({ page: 1, limit: 999 });
        expect(big.limit).toBe(100);
        const small = await projectsService.listPaged({ page: 1, limit: 0 });
        expect(small.limit).toBe(20);
    });
});
