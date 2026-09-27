import { describe, expect, it, beforeEach, afterEach, afterAll, vi } from 'vitest';

vi.mock('../routes/events.js', () => ({ broadcastSSE: vi.fn() }));
// A real run would provision a worktree and spawn an agent. Everything else
// here — the link, the comment, the notification, the sub-task — is real rows.
vi.mock('./workflow-engine.js', async (importOriginal) => ({
    ...(await importOriginal<typeof WorkflowEngine>()),
    startWorkflowRun: vi.fn(async () => 'run-new'),
}));

import type * as WorkflowEngine from './workflow-engine.js';
import { externalLinks } from './external-links.js';
import { startWorkflowRun } from './workflow-engine.js';
import { credentialsService } from './credentials.js';
import { commentsService } from './comments.js';
import { notificationsService } from './notifications.js';
import { followThroughRedCi } from './ci-follow-through.js';
import { testDb, truncateAll, closeTestDb } from '../../tests/_pg-db.js';
import { insertProject, insertItem } from '../../tests/_items.js';

const PR = 'https://github.com/foo/bar/pull/7';
const TASK = 'ATL-T';
const SUBTASKS_GRAPH = JSON.stringify({ nodes: [{ id: 'start', type: 'start' }, { id: 'st', type: 'subtasks' }], edges: [] });
const PLAIN_GRAPH = JSON.stringify({ nodes: [{ id: 'start', type: 'start' }, { id: 'a', type: 'agent' }], edges: [] });

let headSha = 'sha1';
let checks: unknown[] = [];

async function seedWorkflow(graph: string) {
    await testDb.insertInto('workflows').values({ id: 'wf', project_id: 'p1', name: 'Delivery', input_kind: 'item', graph } as never).execute();
    await testDb
        .insertInto('workflow_runs')
        .values({ id: 'r-done', workflow_id: 'wf', item_id: TASK, project_id: 'p1', status: 'completed', graph_snapshot: graph } as never)
        .execute();
}

/** Force the TTL open and run the scheduler tick, the real entry point. */
async function tick() {
    await testDb.updateTable('item_external_links').set({ pr_state_checked_at: null }).execute();
    await externalLinks.syncReviewedTaskPrs();
}

const comments = () => commentsService.list('task', TASK);
const notifications = () => testDb.selectFrom('notifications').selectAll().where('item_id', '=', TASK).execute();
const link = () => testDb.selectFrom('item_external_links').selectAll().where('item_id', '=', TASK).executeTakeFirstOrThrow();
const subtasks = () => testDb.selectFrom('items').selectAll().where('parent_id', '=', TASK).execute();

beforeEach(async () => {
    await truncateAll();
    vi.mocked(startWorkflowRun).mockClear();
    vi.mocked(startWorkflowRun).mockResolvedValue('run-new');
    headSha = 'sha1';
    checks = [{ name: 'test', status: 'completed', conclusion: 'failure', output: { title: '3 tests failed' } }];
    await insertProject('p1', 'ATL');
    await testDb
        .insertInto('credentials')
        .values({
            id: 'cred-1',
            label: 'GH PAT',
            host: 'github',
            kind: 'pat',
            username: 'octocat',
            token_encrypted: 'enc',
            token_fingerprint: 'fp',
            scope: 'repo',
            expires_at: null,
        })
        .execute();
    await testDb
        .updateTable('project_repos')
        .set({ credential_id: 'cred-1', git_url: 'https://github.com/foo/bar.git' })
        .where('id', '=', 'p1')
        .execute();
    vi.spyOn(credentialsService, 'getToken').mockResolvedValue('tok');
    vi.stubGlobal(
        'fetch',
        vi.fn(async (u: string) => {
            const body = u.includes('/pulls/')
                ? { state: 'open', merged_at: null, head: { sha: headSha } }
                : u.includes('/check-runs')
                  ? { check_runs: checks }
                  : { statuses: [] };
            return new Response(JSON.stringify(body), { status: 200 });
        }),
    );
    await insertItem({ id: TASK, type: 'task', project_id: 'p1', title: 'Task', status: 'in_review' });
    await externalLinks.create({ itemId: TASK, url: PR, linkKind: 'pull_request' });
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

afterAll(async () => {
    await closeTestDb();
});

describe('red CI on a Task in review', () => {
    it('comments, notifies, adds a fix sub-task and continues from the Sub-tasks step', async () => {
        await seedWorkflow(SUBTASKS_GRAPH);
        await tick();

        const [sub] = await subtasks();
        expect(sub?.title).toBe('Fix failing CI: test');
        expect(sub?.description).toContain('3 tests failed');
        expect(sub?.description).toContain(PR);
        expect(startWorkflowRun).toHaveBeenCalledWith('wf', TASK, undefined, { fromSubtasks: true });

        const [c] = await comments();
        expect(c?.author).toBe('agent');
        expect(c?.agent_id).toBeNull();
        expect(c?.body).toContain('**test**: 3 tests failed');
        expect(c?.body).toContain(`sub-task ${sub?.id}`);
        expect(c?.body).toContain('automatic fix 1 of 2');

        const [n] = await notifications();
        expect(n?.kind).toBe('needs_you');
        expect(n?.event_type).toBe('ci_failed');
        expect(n?.message).toContain('CI failed on ATL-T (test)');

        const l = await link();
        expect(l.ci_state).toBe('failure');
        expect(l.ci_handled_sha).toBe('sha1');
        expect(l.ci_fix_attempts).toBe(1);
    });

    it('restarts the workflow on the same branch when it has no Sub-tasks step', async () => {
        await seedWorkflow(PLAIN_GRAPH);
        await tick();
        expect(startWorkflowRun).toHaveBeenCalledWith('wf', TASK);
        expect(await subtasks()).toHaveLength(0);
        expect((await comments())[0]?.body).toContain('restarted **Delivery** on the same branch');
    });

    it('acts once per head commit, and again on a new one', async () => {
        await seedWorkflow(SUBTASKS_GRAPH);
        await tick();
        await tick();
        expect(startWorkflowRun).toHaveBeenCalledTimes(1);
        expect(await comments()).toHaveLength(1);
        expect(await notifications()).toHaveLength(1);

        headSha = 'sha2';
        await tick();
        expect(startWorkflowRun).toHaveBeenCalledTimes(2);
        expect((await link()).ci_fix_attempts).toBe(2);
    });

    it('stops fixing after 2 attempts and only tells the Owner', async () => {
        await seedWorkflow(SUBTASKS_GRAPH);
        await testDb.updateTable('item_external_links').set({ ci_fix_attempts: 2 }).execute();
        await tick();
        expect(startWorkflowRun).not.toHaveBeenCalled();
        expect(await subtasks()).toHaveLength(0);
        expect((await comments())[0]?.body).toContain('No automatic fix: Atlas already tried 2 automatic fixes.');
        expect(await notifications()).toHaveLength(1);
        expect((await link()).ci_handled_sha).toBe('sha1');
    });

    it('never starts a fix while a run for the Task is live', async () => {
        await seedWorkflow(SUBTASKS_GRAPH);
        await testDb
            .insertInto('workflow_runs')
            .values({ id: 'r-live', workflow_id: 'wf', item_id: TASK, project_id: 'p1', status: 'running', graph_snapshot: SUBTASKS_GRAPH } as never)
            .execute();
        await tick();
        expect(startWorkflowRun).not.toHaveBeenCalled();
        expect((await comments())[0]?.body).toContain('a workflow run is already working this Task');
    });

    it('only notifies when the Task has no completed run to continue', async () => {
        await tick();
        expect(startWorkflowRun).not.toHaveBeenCalled();
        expect((await comments())[0]?.body).toContain('no completed workflow run to continue');
    });

    it('does nothing for green or pending CI, or a Task not in review', async () => {
        await seedWorkflow(SUBTASKS_GRAPH);
        checks = [{ name: 'test', status: 'in_progress' }];
        await tick();
        checks = [{ name: 'test', status: 'completed', conclusion: 'success' }];
        await tick();
        expect(await comments()).toHaveLength(0);

        checks = [{ name: 'test', status: 'completed', conclusion: 'failure' }];
        await testDb.updateTable('items').set({ status: 'in_progress' }).where('id', '=', TASK).execute();
        await externalLinks.refreshPrStates(TASK);
        expect(await comments()).toHaveLength(0);
        expect(startWorkflowRun).not.toHaveBeenCalled();
    });

    it('says so when the fix run cannot start, without counting it as an attempt', async () => {
        await seedWorkflow(PLAIN_GRAPH);
        vi.mocked(startWorkflowRun).mockRejectedValueOnce(new Error('Workflow graph is invalid'));
        await tick();
        expect((await comments())[0]?.body).toContain('Could not start an automatic fix: Workflow graph is invalid');
        expect((await link()).ci_fix_attempts).toBe(0);
    });

    it('lists an unnamed failure honestly', async () => {
        await seedWorkflow(PLAIN_GRAPH);
        await testDb.updateTable('item_external_links').set({ ci_fix_attempts: 2 }).execute();
        await followThroughRedCi(TASK, { linkId: (await link()).id, url: PR, headSha: 'shaX', handledSha: null, failing: [] });
        expect((await comments())[0]?.body).toContain('GitHub did not name the failing check');
        expect((await notifications())[0]?.message).toContain('(a check)');
    });

    it('a second caller for the same commit loses the claim and does nothing', async () => {
        await seedWorkflow(PLAIN_GRAPH);
        await testDb.updateTable('item_external_links').set({ ci_handled_sha: 'sha1' }).execute();
        // Stale `handledSha` in hand, as a concurrent refresh would have.
        await followThroughRedCi(TASK, { linkId: (await link()).id, url: PR, headSha: 'sha1', handledSha: null, failing: [] });
        expect(startWorkflowRun).not.toHaveBeenCalled();
        expect(await comments()).toHaveLength(0);
    });

    it('is a no-op for an unknown item', async () => {
        await followThroughRedCi('ATL-NOPE', { linkId: 1, url: PR, headSha: 'x', handledSha: null, failing: [] });
        expect(startWorkflowRun).not.toHaveBeenCalled();
    });

    it('a failing comment or notification write never breaks the poll', async () => {
        await seedWorkflow(SUBTASKS_GRAPH);
        vi.spyOn(commentsService, 'create').mockRejectedValue(new Error('db down'));
        vi.spyOn(notificationsService, 'create').mockRejectedValue(new Error('db down'));
        await expect(tick()).resolves.toBeUndefined();
        expect(startWorkflowRun).toHaveBeenCalledTimes(1);
    });
});
