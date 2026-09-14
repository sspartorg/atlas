import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnAgentRun } from './agent-runner.js';
import { closeTestDb, testDb, truncateAll } from '../../tests/_pg-db.js';
import { insertAgent, insertItem, insertProject } from '../../tests/_items.js';

// Fake timers stop the simulated CLI (400ms setTimeout when ATLAS_AI_ENABLED
// is unset) from completing the run after the test — same reason as
// agent-dispatcher.integration.test.ts.

beforeEach(async () => {
    vi.useFakeTimers();
    await truncateAll();
    await insertProject('p1', 'ATL');
    await insertAgent({ id: 'agent-coder', status: 'active', model: 'claude-sonnet-4-6', prompt_version: 4 });
    await testDb.updateTable('agents').set({ effort: 'high' }).where('id', '=', 'agent-coder').execute();
    await insertItem({ id: 'ATL-100', type: 'epic', project_id: 'p1', title: 'Parent epic' });
    await insertItem({
        id: 'ATL-2',
        type: 'story',
        project_id: 'p1',
        parent_id: 'ATL-100',
        parent_type: 'epic',
        title: 'Story',
        status: 'ready',
        assignee_agent_id: 'agent-coder',
    });
});

afterEach(() => {
    vi.useRealTimers();
});

afterAll(async () => {
    await closeTestDb();
});

const EXPECTED = { cli: 'claude', model: 'claude-sonnet-4-6', effort: 'high', prompt_version: 4 };

describe('spawnAgentRun — agent config snapshot', () => {
    it('records cli, model, effort and prompt_version on the inserted run', async () => {
        const runId = await spawnAgentRun({ agentId: 'agent-coder', issueType: 'story', issueId: 'ATL-2' });

        const row = await testDb
            .selectFrom('agent_runs')
            .select(['cli', 'model', 'effort', 'prompt_version'])
            .where('id', '=', runId)
            .executeTakeFirstOrThrow();
        expect(row).toEqual(EXPECTED);
    });

    it('records the same snapshot when the caller pre-inserted the row (POST /api/run path)', async () => {
        await testDb
            .insertInto('agent_runs')
            .values({ id: 'run-pre', agent_id: 'agent-coder', item_id: 'ATL-2', status: 'queued', prompt_snapshot: null })
            .execute();

        await spawnAgentRun({ agentId: 'agent-coder', issueType: 'story', issueId: 'ATL-2', existingRunId: 'run-pre' });

        const row = await testDb
            .selectFrom('agent_runs')
            .select(['cli', 'model', 'effort', 'prompt_version'])
            .where('id', '=', 'run-pre')
            .executeTakeFirstOrThrow();
        expect(row).toEqual(EXPECTED);
    });
});
