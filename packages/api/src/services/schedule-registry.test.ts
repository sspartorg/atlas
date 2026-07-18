import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    registerOne,
    unregisterOne,
    registeredCount,
    nextRun,
    bootSchedules,
    catchUpMissedFires,
    _resetForTests,
} from './schedule-registry.js';
import type { IProjectSchedule } from '@atlas/shared';

function schedule(over: Partial<IProjectSchedule>): IProjectSchedule {
    return {
        project_id: over.project_id ?? 'p1',
        enabled: true,
        preset: 'custom',
        cron_expression: over.cron_expression ?? '0 0 1 1 *',
        time_of_day: '00:00',
        weekday: null,
        skip_if_dirty: false,
        pause_while_agents_active: false,
        conflict_policy: 'skip',
        last_run_at: null,
        last_run_status: null,
        last_run_detail: null,
        next_run_at: null,
        auth_failure_count: 0,
        created_at: '',
        updated_at: '',
        ...over,
    };
}

// Mock the runner so we don't actually fire git operations.
const { runAutoFetchMock, listEnabledMock, recordRunMock } = vi.hoisted(() => ({
    runAutoFetchMock: vi.fn(),
    listEnabledMock: vi.fn(),
    recordRunMock: vi.fn(),
}));
vi.mock('./auto-fetch-runner.js', () => ({ runAutoFetch: runAutoFetchMock }));
vi.mock('./schedules.js', () => ({
    schedulesService: {
        listEnabled: listEnabledMock,
        recordRun: recordRunMock,
    },
}));

describe('schedule-registry', () => {
    beforeEach(() => {
        _resetForTests();
        runAutoFetchMock.mockReset();
        listEnabledMock.mockReset();
        recordRunMock.mockReset();
    });

    it('registerOne adds one job', () => {
        registerOne(schedule({ project_id: 'p1' }));
        expect(registeredCount()).toBe(1);
    });

    it('registerOne replaces an existing job for the same project_id', () => {
        registerOne(schedule({ project_id: 'p1', cron_expression: '0 0 1 1 *' }));
        registerOne(schedule({ project_id: 'p1', cron_expression: '0 0 2 1 *' }));
        expect(registeredCount()).toBe(1);
    });

    it('unregisterOne removes the job', () => {
        registerOne(schedule({ project_id: 'p1' }));
        unregisterOne('p1');
        expect(registeredCount()).toBe(0);
        expect(nextRun('p1')).toBeNull();
    });

    it('nextRun returns a Date for a registered cron', () => {
        registerOne(schedule({ project_id: 'p1', cron_expression: '0 0 1 1 *' }));
        expect(nextRun('p1')).toBeInstanceOf(Date);
    });

    it('nextRun returns null for an unregistered project', () => {
        expect(nextRun('does-not-exist')).toBeNull();
    });

    it('bootSchedules registers every enabled schedule and refreshes next_run_at', async () => {
        listEnabledMock.mockResolvedValue([
            schedule({ project_id: 'p1', cron_expression: '0 0 1 1 *' }),
            schedule({ project_id: 'p2', cron_expression: '0 0 1 1 *' }),
        ]);
        await bootSchedules();
        expect(registeredCount()).toBe(2);
        expect(recordRunMock).toHaveBeenCalledTimes(2);
        expect(recordRunMock).toHaveBeenCalledWith('p1', null, null, expect.any(String));
    });

    it('bootSchedules skips recordRun when no schedules are enabled (SREG-1)', async () => {
        // Covers the for-loop body NOT executing when the enabled list is empty.
        listEnabledMock.mockResolvedValue([]);
        await bootSchedules();
        expect(registeredCount()).toBe(0);
        expect(recordRunMock).not.toHaveBeenCalled();
    });

    it('catchUpMissedFires runs auto-fetch for schedules with a past next_run_at', async () => {
        listEnabledMock.mockResolvedValue([
            schedule({ project_id: 'p-past', next_run_at: '2020-01-01T00:00:00Z' }),
            schedule({ project_id: 'p-future', next_run_at: '2099-01-01T00:00:00Z' }),
            schedule({ project_id: 'p-null', next_run_at: null }),
        ]);
        await catchUpMissedFires();
        // Only the past one fires
        expect(runAutoFetchMock).toHaveBeenCalledTimes(1);
        expect(runAutoFetchMock).toHaveBeenCalledWith('p-past');
    });
});
