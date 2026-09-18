import { describe, expect, it, beforeEach, afterAll, vi } from 'vitest';

vi.mock('../routes/events.js', () => ({ broadcastSSE: vi.fn() }));

import { issueFullService } from './issue-full.js';
import { itemLinks } from './item-links.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testDb, truncateAll, closeTestDb } from '../../tests/_pg-db.js';
import { seedFullTree } from '../../tests/_items.js';

beforeEach(async () => {
    await truncateAll();
    await seedFullTree();
});

afterAll(async () => {
    await closeTestDb();
});

describe('issueFullService', () => {
    describe('task', () => {
        it('returns the task with project, sub-tasks, links, activity, agents', async () => {
            const res = (await issueFullService.task('ATL-1'))!;
            expect(res.task.id).toBe('ATL-1');
            expect(res.project!.id).toBe('p1');
            expect(res.sub_tasks.map((s) => s.id)).toEqual(['ATL-2', 'ATL-3']);
            expect(res.sub_tasks[0]!.task_id).toBe('ATL-1');
            expect(res.agents).toHaveLength(1);
            expect(Array.isArray(res.related_links)).toBe(true);
            expect(Array.isArray(res.activity)).toBe(true);
        });

        it('returns null for a missing id or a sub-task id', async () => {
            expect(await issueFullService.task('nope')).toBeNull();
            expect(await issueFullService.task('ATL-2')).toBeNull();
        });
    });

    describe('task worktree path', () => {
        async function runWith(worktreePath: string): Promise<void> {
            await testDb.insertInto('workflows').values({ id: 'wf-1', project_id: 'p1', name: 'Delivery' } as never).execute();
            await testDb
                .insertInto('workflow_runs')
                .values({ id: 'run-1', workflow_id: 'wf-1', item_id: 'ATL-1', project_id: 'p1', graph_snapshot: '{"nodes":[],"edges":[]}', worktree_path: worktreePath })
                .execute();
        }

        it('shows the latest run’s worktree while that folder exists', async () => {
            const dir = mkdtempSync(join(tmpdir(), 'atlas-wt-'));
            try {
                await runWith(dir);
                expect((await issueFullService.task('ATL-1'))?.task.worktree_path).toBe(dir);
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        it('shows none once delivery removed it', async () => {
            await runWith(join(tmpdir(), 'atlas-wt-gone-for-good'));
            expect((await issueFullService.task('ATL-1'))?.task.worktree_path).toBeNull();
        });
    });

    describe('subTask', () => {
        it('returns sub-task with its parent task and project', async () => {
            const res = (await issueFullService.subTask('ATL-2'))!;
            expect(res.sub_task.id).toBe('ATL-2');
            expect(res.task!.id).toBe('ATL-1');
            expect(res.project!.id).toBe('p1');
            expect(res.agents).toHaveLength(1);
        });

        it('returns null for a missing id or a task id', async () => {
            expect(await issueFullService.subTask('nope')).toBeNull();
            expect(await issueFullService.subTask('ATL-1')).toBeNull();
        });
    });

    describe('related_links shape', () => {
        it('maps each item-link row through to the IIssueLinkRow projection', async () => {
            const created = await itemLinks.create('ATL-2', 'ATL-3', 'relates_to');
            expect(created.ok).toBe(true);
            const res = (await issueFullService.subTask('ATL-2'))!;
            expect(res.related_links).toHaveLength(1);
            const link = res.related_links[0]!;
            expect(link.item_id).toBe('ATL-3');
            expect(link.relation_type).toBe('relates_to');
            expect(link.title).toBeDefined();
            expect(link.status).toBeDefined();
            expect(link.created_at).toBeDefined();
        });
    });
});
