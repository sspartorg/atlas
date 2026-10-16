import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../routes/events.js', () => ({ broadcastSSE: vi.fn() }));
const sendExternal = vi.hoisted(() => vi.fn(async (_id: number, _m: string, _k?: string) => {}));
vi.mock('./external-notifications.js', () => ({ sendExternalForNotification: sendExternal }));
vi.mock('./web-push.js', () => ({ sendWebPushForNotification: vi.fn().mockResolvedValue(undefined) }));

import { spawnAgentRun } from './agent-runner.js';
import { closeTestDb, testDb, truncateAll } from '../../tests/_pg-db.js';
import { insertAgent, insertItem, insertProject } from '../../tests/_items.js';

// The real error path: AI on, the CLI binary missing from PATH → the child's
// 'error' event → errorRun. Each failure must notify under its own toggle.

const env = { ai: process.env['ATLAS_AI_ENABLED'], path: process.env['PATH'] };

beforeEach(async () => {
    await truncateAll();
    sendExternal.mockClear();
    await insertProject('p1', 'ATL');
    await insertAgent({ id: 'agent-coder', status: 'active' });
    process.env['ATLAS_AI_ENABLED'] = 'true';
    process.env['PATH'] = '/nonexistent-atlas-bin';
});

afterEach(() => {
    process.env['PATH'] = env.path;
    if (env.ai === undefined) delete process.env['ATLAS_AI_ENABLED'];
    else process.env['ATLAS_AI_ENABLED'] = env.ai;
});

afterAll(closeTestDb);

async function errorRow(eventType: string) {
    await vi.waitFor(
        async () => {
            const row = await testDb
                .selectFrom('notifications')
                .select(['id', 'event_type', 'kind', 'external_event_key', 'message', 'link_url'])
                .where('event_type', '=', eventType)
                .executeTakeFirst();
            if (!row) throw new Error('no notification yet');
        },
        { timeout: 15_000, interval: 100 },
    );
    return testDb
        .selectFrom('notifications')
        .select(['id', 'event_type', 'kind', 'external_event_key', 'message', 'link_url'])
        .where('event_type', '=', eventType)
        .executeTakeFirstOrThrow();
}

describe('errorRun outside a workflow', () => {
    it('a standalone run that fails to start notifies under "Agent Run Failed (no item)", not run-finished', { timeout: 30_000 }, async () => {
        const runId = await spawnAgentRun({ agentId: 'agent-coder', issueType: null, issueId: null });
        const n = await errorRow('agent_error_no_item');
        expect(n.kind).toBe('needs_you');
        expect(n.external_event_key).toBe('agent.failed_no_item');
        expect(n.link_url).toBe(`/agents/agent-coder/runs/${runId}`);
        await vi.waitFor(() => expect(sendExternal).toHaveBeenCalledWith(Number(n.id), n.message, 'agent.failed_no_item'));
        const run = await testDb.selectFrom('agent_runs').select('status').where('id', '=', runId).executeTakeFirstOrThrow();
        expect(run.status).toBe('error');
    });

    it('a run on a Task that fails to start notifies under "Agent Failed"', { timeout: 30_000 }, async () => {
        const taskId = await insertItem({ type: 'task', project_id: 'p1', status: 'ready', assignee_agent_id: 'agent-coder' });
        await spawnAgentRun({ agentId: 'agent-coder', issueType: 'task', issueId: taskId });
        const n = await errorRow('agent_error');
        expect(n.external_event_key).toBe('agent.failed');
        await vi.waitFor(() => expect(sendExternal).toHaveBeenCalledWith(Number(n.id), n.message, 'agent.failed'));
    });
});
