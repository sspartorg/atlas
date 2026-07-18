import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { isAnyAgentActiveForProject } from './agent-activity.js';
import { testDb, truncateAll, closeTestDb } from '../../tests/_pg-db.js';
import { insertProject, insertAgent, insertItem } from '../../tests/_items.js';

beforeEach(async () => {
    await truncateAll();
    await insertProject('p1', 'ATL');
    await insertAgent({ id: 'agent-coder' });
    await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'E' });
    await insertItem({
        id: 'ATL-2',
        type: 'story',
        project_id: 'p1',
        parent_id: 'ATL-1',
        parent_type: 'epic',
        title: 'S',
    });
    await insertItem({
        id: 'ATL-3',
        type: 'sub_task',
        project_id: 'p1',
        parent_id: 'ATL-2',
        parent_type: 'story',
        title: 'T',
    });
    await insertItem({
        id: 'ATL-5',
        type: 'bug',
        project_id: 'p1',
        parent_id: 'ATL-1',
        parent_type: 'epic',
        title: 'B',
        acceptance_criteria: '',
        steps_to_reproduce: '',
        expected: '',
        actual: '',
        frequency: 'sometimes',
        failure_scope: 'cosmetic',
    });
});

afterAll(async () => {
    await closeTestDb();
});

async function seedRun(item_id: string, status: string): Promise<void> {
    await testDb
        .insertInto('agent_runs')
        .values({
            id: `r-${item_id}-${status}`,
            agent_id: 'agent-coder',
            item_id,
            status: status as 'queued',
        })
        .execute();
}

describe('isAnyAgentActiveForProject', () => {
    it('returns false when there are no agent_runs', async () => {
        expect(await isAnyAgentActiveForProject('p1')).toBe(false);
    });

    it('returns false for a non-existent project id', async () => {
        expect(await isAnyAgentActiveForProject('does-not-exist')).toBe(false);
    });

    it('returns true when a queued run targets an epic in the project', async () => {
        await seedRun('ATL-1', 'queued');
        expect(await isAnyAgentActiveForProject('p1')).toBe(true);
    });

    it('returns true when a story-level run is in_progress', async () => {
        await seedRun('ATL-2', 'in_progress');
        expect(await isAnyAgentActiveForProject('p1')).toBe(true);
    });

    it('returns true when a sub_task-level run is queued', async () => {
        await seedRun('ATL-3', 'queued');
        expect(await isAnyAgentActiveForProject('p1')).toBe(true);
    });

    it('returns false when matching rows are completed (not queued/in_progress)', async () => {
        await seedRun('ATL-2', 'completed');
        expect(await isAnyAgentActiveForProject('p1')).toBe(false);
    });
});
