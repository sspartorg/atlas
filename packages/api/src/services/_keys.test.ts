import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { allocateIssueKey, resolveProjectIdFromEpic, resolveProjectIdFromStory } from './_keys.js';
import { testDb, truncateAll, closeTestDb } from '../../tests/_pg-db.js';

async function seedProject(id = 'p1', prefix = 'ATL'): Promise<void> {
    await testDb
        .insertInto('projects')
        .values({ id, name: 'Project ' + id, issue_key_prefix: prefix, git_path: '', status: 'active' })
        .execute();
    await testDb
        .insertInto('project_issue_counters')
        .values({ project_id: id, last_seq: 0 })
        .execute();
}

async function seedEpic(id: string, project_id: string): Promise<void> {
    await testDb
        .insertInto('items')
        .values({
            id,
            type: 'epic',
            project_id,
            title: 'E',
            status: 'draft',
            priority: 'normal',
            description: '',
        })
        .execute();
}

async function seedStory(id: string, parent_id: string, project_id: string): Promise<void> {
    await testDb
        .insertInto('items')
        .values({
            id,
            type: 'story',
            project_id,
            parent_id,
            parent_type: 'epic',
            title: 'S',
            status: 'draft',
            priority: 'normal',
            description: '',
        })
        .execute();
}

beforeEach(async () => {
    await truncateAll();
});

afterAll(async () => {
    await closeTestDb();
});

describe('allocateIssueKey', () => {
    it('returns sequential keys for the project prefix', async () => {
        await seedProject('p1', 'ATL');
        expect(await allocateIssueKey('p1')).toBe('ATL-1');
        expect(await allocateIssueKey('p1')).toBe('ATL-2');
        expect(await allocateIssueKey('p1')).toBe('ATL-3');
    });

    it('scopes counters per project — separate prefixes increment independently', async () => {
        await seedProject('p1', 'ATL');
        await seedProject('p2', 'CER');
        expect(await allocateIssueKey('p1')).toBe('ATL-1');
        expect(await allocateIssueKey('p2')).toBe('CER-1');
        expect(await allocateIssueKey('p1')).toBe('ATL-2');
        expect(await allocateIssueKey('p2')).toBe('CER-2');
    });

    it('persists last_seq in project_issue_counters', async () => {
        await seedProject('p1', 'ATL');
        await allocateIssueKey('p1');
        await allocateIssueKey('p1');
        const row = await testDb
            .selectFrom('project_issue_counters')
            .select('last_seq')
            .where('project_id', '=', 'p1')
            .executeTakeFirstOrThrow();
        expect(row.last_seq).toBe(2);
    });

    it('throws when the counter row is missing (e.g. typo in project_id)', async () => {
        await expect(allocateIssueKey('does-not-exist')).rejects.toThrow(
            /No project_issue_counters row/,
        );
    });
});

describe('resolveProjectIdFromEpic', () => {
    it('returns the project_id for a known epic', async () => {
        await seedProject('p1', 'ATL');
        await seedEpic('ATL-1', 'p1');
        expect(await resolveProjectIdFromEpic('ATL-1')).toBe('p1');
    });

    it('throws when the epic does not exist', async () => {
        await expect(resolveProjectIdFromEpic('nope')).rejects.toThrow(/Epic nope not found/);
    });
});

describe('resolveProjectIdFromStory', () => {
    it('returns the project_id from the items row directly', async () => {
        await seedProject('p1', 'ATL');
        await seedEpic('ATL-1', 'p1');
        await seedStory('ATL-2', 'ATL-1', 'p1');
        expect(await resolveProjectIdFromStory('ATL-2')).toBe('p1');
    });

    it('throws when the story does not exist', async () => {
        await expect(resolveProjectIdFromStory('nope')).rejects.toThrow(/Story nope not found/);
    });
});
