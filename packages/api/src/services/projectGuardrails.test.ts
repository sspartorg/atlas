import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { projectGuardrailsService } from './projectGuardrails.js';
import { testDb, truncateAll, closeTestDb } from '../../tests/_pg-db.js';

async function insertProject(id: string, prefix: string): Promise<void> {
    await testDb
        .insertInto('projects')
        .values({ id, name: 'Project ' + id, issue_key_prefix: prefix, git_path: '', status: 'active' })
        .execute();
    await testDb
        .insertInto('project_issue_counters')
        .values({ project_id: id, last_seq: 0 })
        .execute();
}

beforeEach(async () => {
    await truncateAll();
    await insertProject('p1', 'ATL');
});

afterAll(async () => {
    await closeTestDb();
});

describe('projectGuardrailsService', () => {
    describe('create / get / list', () => {
        it('creates a guardrail with defaults', async () => {
            const g = await projectGuardrailsService.create('p1', {
                title: 'No prod deploys',
                body_md: '## Reason',
            });
            expect(g.id).toBeTruthy();
            expect(g.title).toBe('No prod deploys');
            expect(g.body_md).toBe('## Reason');
            expect(g.icon).toBe('shield');
            expect(g.enabled).toBe(1);
            expect(g.sort_order).toBe(0);
        });

        it('honors explicit defaults overrides', async () => {
            const g = await projectGuardrailsService.create('p1', {
                title: 'GR2',
                body_md: 'b',
                icon: 'lock',
                enabled: 0,
                sort_order: 5,
            });
            expect(g.icon).toBe('lock');
            expect(g.enabled).toBe(0);
            expect(g.sort_order).toBe(5);
        });

        it('list returns rows ordered by sort_order then created_at', async () => {
            await projectGuardrailsService.create('p1', { title: 'b', body_md: '', sort_order: 2 });
            await projectGuardrailsService.create('p1', { title: 'a', body_md: '', sort_order: 1 });
            const list = await projectGuardrailsService.list('p1');
            expect(list[0]!.title).toBe('a');
            expect(list[1]!.title).toBe('b');
        });

        it('list scopes to the given project', async () => {
            await insertProject('p2', 'BBB');
            await projectGuardrailsService.create('p1', { title: 'p1', body_md: '' });
            await projectGuardrailsService.create('p2', { title: 'p2', body_md: '' });
            expect(await projectGuardrailsService.list('p1')).toHaveLength(1);
            expect(await projectGuardrailsService.list('p2')).toHaveLength(1);
        });

        it('get returns row or undefined', async () => {
            const g = await projectGuardrailsService.create('p1', { title: 'x', body_md: '' });
            expect((await projectGuardrailsService.get(g.id))?.id).toBe(g.id);
            expect(await projectGuardrailsService.get('nope')).toBeUndefined();
        });
    });

    describe('update / toggle / delete / activeCount', () => {
        it('update patches the named fields', async () => {
            const g = await projectGuardrailsService.create('p1', { title: 'a', body_md: 'old' });
            const u = await projectGuardrailsService.update(g.id, {
                title: 'b',
                body_md: 'new',
                icon: 'fire',
            });
            expect(u.title).toBe('b');
            expect(u.body_md).toBe('new');
            expect(u.icon).toBe('fire');
        });

        it('update is a no-op when no defined keys', async () => {
            const g = await projectGuardrailsService.create('p1', { title: 'x', body_md: '' });
            const u = await projectGuardrailsService.update(g.id, {});
            expect(u.id).toBe(g.id);
        });

        it('update skips explicit undefined keys mixed with a defined key (v !== undefined false branch)', async () => {
            const g = await projectGuardrailsService.create('p1', { title: 'a', body_md: 'old', icon: 'lock' });
            const u = await projectGuardrailsService.update(g.id, {
                title: 'b',
                icon: undefined,
            });
            expect(u.title).toBe('b');
            expect(u.icon).toBe('lock');
        });

        it('toggle flips enabled flag', async () => {
            const g = await projectGuardrailsService.create('p1', { title: 'x', body_md: '' });
            expect(g.enabled).toBe(1);
            const off = await projectGuardrailsService.toggle(g.id, 0);
            expect(off.enabled).toBe(0);
            const on = await projectGuardrailsService.toggle(g.id, 1);
            expect(on.enabled).toBe(1);
        });

        it('delete removes the row', async () => {
            const g = await projectGuardrailsService.create('p1', { title: 'x', body_md: '' });
            await projectGuardrailsService.delete(g.id);
            expect(await projectGuardrailsService.get(g.id)).toBeUndefined();
        });

        it('activeCount counts only enabled=1 rows scoped to the project', async () => {
            await projectGuardrailsService.create('p1', { title: 'a', body_md: '', enabled: 1 });
            await projectGuardrailsService.create('p1', { title: 'b', body_md: '', enabled: 0 });
            await projectGuardrailsService.create('p1', { title: 'c', body_md: '', enabled: 1 });
            expect(await projectGuardrailsService.activeCount('p1')).toBe(2);
        });

        it('activeCount returns 0 when the project has no guardrails at all', async () => {
            // Exercises Number(r?.n ?? 0) resolving through the '0' string
            // aggregate result rather than the `r?.n` undefined fallback.
            expect(await projectGuardrailsService.activeCount('p1')).toBe(0);
        });

        it('project delete cascades the guardrails via ON DELETE CASCADE', async () => {
            await projectGuardrailsService.create('p1', { title: 'a', body_md: '' });
            await testDb.deleteFrom('projects').where('id', '=', 'p1').execute();
            expect(await projectGuardrailsService.list('p1')).toEqual([]);
        });
    });
});
