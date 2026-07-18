import { describe, expect, it, beforeEach, vi } from 'vitest';

const spawnAgentRunMock = vi.hoisted(() => vi.fn<() => Promise<string>>());
vi.mock('./agent-runner.js', () => ({ spawnAgentRun: spawnAgentRunMock }));

import { shouldAutoDispatch, findLiveRunOnItem, maybeAutoDispatch } from './agent-dispatcher.js';
import type { IAgent } from '@atlas/shared';
import { testDb, truncateAll } from '../../tests/_pg-db.js';
import { insertProject, insertAgent, insertItem } from '../../tests/_items.js';
import { DependenciesNotReadyError } from './dependency-guard.js';

const activeAgent: IAgent = {
    id: 'agent-coder',
    name: 'Coder',
    cli: 'claude',
    model: 'claude-opus-4-7',
    framework: 'claude-code',
    status: 'active',
    category: 'software-dev',
    accent_color: '#7AE0C7',
    prompt_md: '',
    prompt_version: 1,
    handoff_prompt_md: '',
    sort_order: 0,
    description: '',
    designation: '',
    max_rounds: 5,
    requires_item: true,
    schedule_hours: 0,
    concurrent_runs: 1,
    glyph: '',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
};

const inactiveAgent: IAgent = { ...activeAgent, status: 'inactive' };

describe('shouldAutoDispatch', () => {
    it('returns true when item is ready, has assignee, agent is active, and no live run exists', () => {
        expect(
            shouldAutoDispatch({
                item: { status: 'ready', assignee_agent_id: 'agent-coder' },
                agent: activeAgent,
                hasLiveRun: false,
            }),
        ).toBe(true);
    });

    it.each(['draft', 'in_progress', 'in_review', 'done', 'waiting_for_info'] as const)(
        'returns false when item status is %s',
        (status) => {
            expect(
                shouldAutoDispatch({
                    item: { status, assignee_agent_id: 'agent-coder' },
                    agent: activeAgent,
                    hasLiveRun: false,
                }),
            ).toBe(false);
        },
    );

    it('returns false when item has no assignee', () => {
        expect(
            shouldAutoDispatch({
                item: { status: 'ready', assignee_agent_id: null },
                agent: activeAgent,
                hasLiveRun: false,
            }),
        ).toBe(false);
    });

    it('returns false when the agent is inactive', () => {
        expect(
            shouldAutoDispatch({
                item: { status: 'ready', assignee_agent_id: 'agent-coder' },
                agent: inactiveAgent,
                hasLiveRun: false,
            }),
        ).toBe(false);
    });

    it('returns false when a live run already exists for this item+agent', () => {
        expect(
            shouldAutoDispatch({
                item: { status: 'ready', assignee_agent_id: 'agent-coder' },
                agent: activeAgent,
                hasLiveRun: true,
            }),
        ).toBe(false);
    });
});

describe('findLiveRunOnItem + maybeAutoDispatch (DB-backed)', () => {
    beforeEach(async () => {
        spawnAgentRunMock.mockReset();
        await truncateAll();
        await insertProject('p1', 'ATL');
        await insertAgent({ id: 'agent-coder', status: 'active' });
    });

    // Note: closeTestDb is intentionally omitted here — current-task-writer.test.ts
    // runs in the same vitest worker and owns the shared closeTestDb afterAll.

    // findLiveRunOnItem tests
    it('findLiveRunOnItem returns null when no live run exists', async () => {
        await insertItem({ id: 'ATL-100', type: 'epic', project_id: 'p1', title: 'Item' });
        const result = await findLiveRunOnItem('ATL-100');
        expect(result).toBeNull();
    });

    it('findLiveRunOnItem returns { runId, agentId } when a queued run exists', async () => {
        await insertItem({ id: 'ATL-101', type: 'epic', project_id: 'p1', title: 'Item' });
        await testDb
            .insertInto('agent_runs')
            .values({ id: 'run-queued-1', agent_id: 'agent-coder', item_id: 'ATL-101', status: 'queued' })
            .execute();
        const result = await findLiveRunOnItem('ATL-101');
        expect(result).toEqual({ runId: 'run-queued-1', agentId: 'agent-coder' });
    });

    it('findLiveRunOnItem returns { runId, agentId } when an in_progress run exists', async () => {
        await insertItem({ id: 'ATL-102', type: 'epic', project_id: 'p1', title: 'Item' });
        await testDb
            .insertInto('agent_runs')
            .values({ id: 'run-ip-1', agent_id: 'agent-coder', item_id: 'ATL-102', status: 'in_progress' })
            .execute();
        const result = await findLiveRunOnItem('ATL-102');
        expect(result).toEqual({ runId: 'run-ip-1', agentId: 'agent-coder' });
    });

    // maybeAutoDispatch tests
    it('returns item_not_found when item does not exist', async () => {
        const result = await maybeAutoDispatch('ATL-DOES-NOT-EXIST');
        expect(result).toEqual({ dispatched: false, reason: 'item_not_found' });
    });

    it('returns not_ready when item status is draft', async () => {
        await insertItem({ id: 'ATL-200', type: 'epic', project_id: 'p1', title: 'Draft item', status: 'draft', assignee_agent_id: 'agent-coder' });
        const result = await maybeAutoDispatch('ATL-200');
        expect(result).toEqual({ dispatched: false, reason: 'not_ready' });
    });

    it('returns no_assignee when item is ready but has no assignee', async () => {
        await insertItem({ id: 'ATL-201', type: 'epic', project_id: 'p1', title: 'Ready no assignee', status: 'ready', assignee_agent_id: null });
        const result = await maybeAutoDispatch('ATL-201');
        expect(result).toEqual({ dispatched: false, reason: 'no_assignee' });
    });

    it('returns agent_not_found when assignee agent does not exist in DB', async () => {
        // Insert the item first with a valid agent, then update assignee_agent_id
        // to a non-existent value via raw SQL (FK is ON DELETE SET NULL so we
        // can't just insert with a ghost agent). We use session_replication_role
        // to bypass FK checks for this test-only scenario.
        const { sql } = await import('kysely');
        await sql`SET session_replication_role = 'replica'`.execute(testDb);
        await testDb.insertInto('items').values({
            id: 'ATL-202',
            type: 'epic',
            project_id: 'p1',
            parent_id: null,
            parent_type: null,
            title: 'Missing agent',
            description: '',
            status: 'ready',
            priority: 'normal',
            assignee_agent_id: 'agent-ghost',
            reporter_agent_id: null,
            spec_md: null,
            pr_url: null,
            points: null,
            acceptance_criteria: null,
            steps_to_reproduce: null,
            expected: null,
            actual: null,
            frequency: null,
            failure_scope: null,
            occurrence_count: null,
            occurrence_total: null,
        }).execute();
        await sql`SET session_replication_role = 'origin'`.execute(testDb);
        const result = await maybeAutoDispatch('ATL-202');
        expect(result).toEqual({ dispatched: false, reason: 'agent_not_found' });
    });

    it('returns agent_inactive when the assigned agent is inactive', async () => {
        await insertAgent({ id: 'agent-inactive', status: 'inactive' });
        await insertItem({ id: 'ATL-203', type: 'epic', project_id: 'p1', title: 'Inactive agent', status: 'ready', assignee_agent_id: 'agent-inactive' });
        const result = await maybeAutoDispatch('ATL-203');
        expect(result).toEqual({ dispatched: false, reason: 'agent_inactive' });
    });

    it('returns live_run_exists when a queued run already exists for the item', async () => {
        await insertItem({ id: 'ATL-204', type: 'epic', project_id: 'p1', title: 'Live run item', status: 'ready', assignee_agent_id: 'agent-coder' });
        await testDb
            .insertInto('agent_runs')
            .values({ id: 'run-existing', agent_id: 'agent-coder', item_id: 'ATL-204', status: 'queued' })
            .execute();
        const result = await maybeAutoDispatch('ATL-204');
        expect(result).toEqual({ dispatched: false, reason: 'live_run_exists' });
    });

    it('returns dispatched:true with runId on success', async () => {
        spawnAgentRunMock.mockResolvedValue('run-123');
        await insertItem({ id: 'ATL-205', type: 'epic', project_id: 'p1', title: 'Dispatch me', status: 'ready', assignee_agent_id: 'agent-coder' });
        const result = await maybeAutoDispatch('ATL-205');
        expect(result).toEqual({ dispatched: true, runId: 'run-123' });
    });

    it('returns deps_blocked with blockers when spawnAgentRun throws DependenciesNotReadyError', async () => {
        const blockers = [{ id: 'ATL-1', title: 'Blocker', status: 'in_progress' as const }];
        spawnAgentRunMock.mockRejectedValue(new DependenciesNotReadyError(blockers));
        await insertItem({ id: 'ATL-206', type: 'epic', project_id: 'p1', title: 'Blocked item', status: 'ready', assignee_agent_id: 'agent-coder' });
        const result = await maybeAutoDispatch('ATL-206');
        expect(result).toEqual({ dispatched: false, reason: 'deps_blocked', blockers });
    });

    it('re-throws non-DependenciesNotReadyError errors from spawnAgentRun', async () => {
        spawnAgentRunMock.mockRejectedValue(new Error('Unexpected failure'));
        await insertItem({ id: 'ATL-207', type: 'epic', project_id: 'p1', title: 'Unexpected error', status: 'ready', assignee_agent_id: 'agent-coder' });
        await expect(maybeAutoDispatch('ATL-207')).rejects.toThrow('Unexpected failure');
    });
});
