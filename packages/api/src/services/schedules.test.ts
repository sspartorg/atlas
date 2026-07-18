import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { schedulesService, type UpsertScheduleInput } from './schedules.js';
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

const baseInput = (): UpsertScheduleInput => ({
    project_id: 'p1',
    enabled: true,
    preset: 'daily',
    cron_expression: '0 6 * * *',
    time_of_day: '06:00',
    weekday: null,
    skip_if_dirty: true,
    pause_while_agents_active: false,
    conflict_policy: 'skip',
    next_run_at: null,
});

describe('schedulesService', () => {
    describe('getOrDefault', () => {
        it('returns a synthesized default for a project without a row', async () => {
            const s = await schedulesService.getOrDefault('p1');
            expect(s.project_id).toBe('p1');
            expect(s.enabled).toBe(false);
            expect(s.preset).toBe('daily');
            expect(s.cron_expression).toBe('0 6 * * *');
            expect(s.auth_failure_count).toBe(0);
        });

        it('returns the stored row when present', async () => {
            await schedulesService.upsert(baseInput());
            const s = await schedulesService.getOrDefault('p1');
            expect(s.enabled).toBe(true);
            expect(s.preset).toBe('daily');
        });
    });

    describe('upsert', () => {
        it('inserts on first call', async () => {
            const s = await schedulesService.upsert(baseInput());
            expect(s.enabled).toBe(true);
            expect(s.skip_if_dirty).toBe(true);
            expect(s.pause_while_agents_active).toBe(false);
        });

        it('updates on conflict (same project_id)', async () => {
            await schedulesService.upsert(baseInput());
            const updated = await schedulesService.upsert({
                ...baseInput(),
                enabled: false,
                preset: 'weekly',
                weekday: 3,
                conflict_policy: 'stash',
                pause_while_agents_active: true,
            });
            expect(updated.enabled).toBe(false);
            expect(updated.preset).toBe('weekly');
            expect(updated.weekday).toBe(3);
            expect(updated.conflict_policy).toBe('stash');
            expect(updated.pause_while_agents_active).toBe(true);
        });

        it('round-trips boolean columns through storage', async () => {
            const s = await schedulesService.upsert({
                ...baseInput(),
                enabled: false,
                skip_if_dirty: false,
                pause_while_agents_active: false,
            });
            expect(s.enabled).toBe(false);
            expect(s.skip_if_dirty).toBe(false);
            expect(s.pause_while_agents_active).toBe(false);
        });
    });

    describe('listEnabled', () => {
        it('returns only enabled rows', async () => {
            await insertProject('p2', 'BBB');
            await schedulesService.upsert({ ...baseInput(), project_id: 'p1', enabled: true });
            await schedulesService.upsert({ ...baseInput(), project_id: 'p2', enabled: false });
            const list = await schedulesService.listEnabled();
            expect(list).toHaveLength(1);
            expect(list[0]!.project_id).toBe('p1');
        });
    });

    describe('recordRun / disable / delete', () => {
        it('recordRun stamps last_run_status + last_run_detail + next_run_at', async () => {
            await schedulesService.upsert(baseInput());
            await schedulesService.recordRun('p1', 'success', 'all green', '2026-06-01T00:00:00');
            const s = await schedulesService.getOrDefault('p1');
            expect(s.last_run_status).toBe('success');
            expect(s.last_run_detail).toBe('all green');
            // PG hands timestamptz back as a Date; normalise to UTC ISO for
            // the assertion. Naive '...T00:00:00' input is interpreted as
            // local TZ on insert, so we just check it stored *some* June-1
            // instant.
            const nra =
                s.next_run_at instanceof Date
                    ? s.next_run_at.toISOString()
                    : (s.next_run_at ?? '');
            expect(nra).toMatch(/2026-0[56]-/);
            expect(s.last_run_at).toBeTruthy();
        });

        it('disable flips enabled=false and clears next_run_at', async () => {
            await schedulesService.upsert({ ...baseInput(), next_run_at: '2026-06-01' });
            await schedulesService.disable('p1');
            const s = await schedulesService.getOrDefault('p1');
            expect(s.enabled).toBe(false);
            expect(s.next_run_at).toBeNull();
        });

        it('delete removes the row, getOrDefault falls back', async () => {
            await schedulesService.upsert(baseInput());
            await schedulesService.delete('p1');
            const s = await schedulesService.getOrDefault('p1');
            expect(s.enabled).toBe(false);
        });
    });

    describe('incrementAuthFailure / resetAuthFailure', () => {
        it('incrementAuthFailure increments auth_failure_count from 0 to 1', async () => {
            await schedulesService.upsert(baseInput());
            const count = await schedulesService.incrementAuthFailure('p1');
            expect(count).toBe(1);
        });

        it('incrementAuthFailure accumulates across multiple calls', async () => {
            await schedulesService.upsert(baseInput());
            await schedulesService.incrementAuthFailure('p1');
            await schedulesService.incrementAuthFailure('p1');
            const count = await schedulesService.incrementAuthFailure('p1');
            expect(count).toBe(3);
        });

        it('resetAuthFailure brings count back to 0', async () => {
            await schedulesService.upsert(baseInput());
            await schedulesService.incrementAuthFailure('p1');
            await schedulesService.incrementAuthFailure('p1');
            await schedulesService.resetAuthFailure('p1');
            const s = await schedulesService.getOrDefault('p1');
            expect(s.auth_failure_count).toBe(0);
        });

        it('resetAuthFailure on a row with count 0 keeps count at 0', async () => {
            await schedulesService.upsert(baseInput());
            await schedulesService.resetAuthFailure('p1');
            const s = await schedulesService.getOrDefault('p1');
            expect(s.auth_failure_count).toBe(0);
        });

        it('incrementAuthFailure returns 0 when no schedule row exists (row?.auth_failure_count ?? 0)', async () => {
            // No upsert → no row → executeTakeFirst() returns undefined
            // → row?.auth_failure_count is undefined → ?? 0 → returns 0.
            const count = await schedulesService.incrementAuthFailure('p1');
            expect(count).toBe(0);
        });
    });

    describe('rowToSchedule ?? fallback arms', () => {
        it('auth_failure_count defaults to 0 when column value is falsy', async () => {
            // Insert a schedule row with auth_failure_count=0 via testDb to exercise
            // the `(r['auth_failure_count'] as number) ?? 0` left branch (0 is falsy
            // but NOT nullish — the ?? only fires on null/undefined, so 0 is covered
            // by the existing upsert tests). The true ?? fallback fires when
            // getOrDefault returns defaultSchedule (no row). Both already covered.
            const s = await schedulesService.getOrDefault('p1');
            // defaultSchedule path — auth_failure_count is explicitly 0
            expect(s.auth_failure_count).toBe(0);
        });
    });
});
