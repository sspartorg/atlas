import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { allocateIssueKey } from './_keys.js';
import { testDb, truncateAll, closeTestDb } from '../../tests/_pg-db.js';
// ADR 0018 — the project row no longer carries git fields; the shared fixture
// inserts the project, its counter row and its repo.
import { insertProject as seedProject } from '../../tests/_items.js';

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
        // The two prefixes must DIFFER — that is the whole assertion. The
        // 2026-09-20 rename (CER -> ATL) briefly collapsed both to 'ATL',
        // which the suite caught: with one prefix the test proves nothing
        // about per-project scoping.
        await seedProject('p1', 'ATL');
        await seedProject('p2', 'ZED');
        expect(await allocateIssueKey('p1')).toBe('ATL-1');
        expect(await allocateIssueKey('p2')).toBe('ZED-1');
        expect(await allocateIssueKey('p1')).toBe('ATL-2');
        expect(await allocateIssueKey('p2')).toBe('ZED-2');
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
