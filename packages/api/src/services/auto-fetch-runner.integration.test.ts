import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AutoFetchCode, AutoFetchResult } from './auto-fetch.js';

vi.mock('./agent-activity.js', () => ({ isAnyAgentActiveForProject: vi.fn(() => false) }));
vi.mock('../routes/events.js', () => ({ broadcastSSE: vi.fn() }));
vi.mock('./external-notifications.js', () => ({
    sendExternalNotification: vi.fn(async () => {}),
}));
vi.mock('./notifications.js', () => ({
    notificationsService: { create: vi.fn(() => ({ id: 1 })) },
}));

const projectStub = {
    id: 'p1',
    name: 'Demo',
    git_path: '/tmp/repo',
    git_url: 'https://example.invalid/demo.git',
    default_branch: 'main',
    credential_id: 'c1',
} as const;

vi.mock('./projects.js', () => ({ projectsService: { get: vi.fn(() => projectStub) } }));
vi.mock('./credentials.js', () => ({
    credentialsService: { get: vi.fn(() => ({ username: 'bot' })), getToken: vi.fn(() => 'tok') },
}));

let scheduleRow = {
    project_id: 'p1',
    enabled: true,
    preset: 'custom' as const,
    cron_expression: '* * * * *',
    time_of_day: '00:00',
    weekday: null,
    skip_if_dirty: true,
    pause_while_agents_active: true,
    conflict_policy: 'skip' as const,
    last_run_at: null as string | null,
    last_run_status: null as null | 'success' | 'skipped' | 'failure' | 'conflict',
    last_run_detail: null as string | null,
    next_run_at: null as string | null,
    auth_failure_count: 0,
    created_at: '',
    updated_at: '',
};
const recorded: Array<{ status: unknown; detail: unknown }> = [];
vi.mock('./schedules.js', () => ({
    schedulesService: {
        getOrDefault: vi.fn(() => scheduleRow),
        recordRun: vi.fn((_p: string, status: unknown, detail: unknown) => {
            recorded.push({ status, detail });
        }),
        incrementAuthFailure: vi.fn(() => 1),
        resetAuthFailure: vi.fn(),
        disable: vi.fn(),
    },
}));

let scriptedResult: AutoFetchResult = { code: 'OK_UPDATED', detail: '' };
vi.mock('./auto-fetch.js', () => ({
    performAutoFetch: vi.fn(async () => scriptedResult),
}));

import { runAutoFetch } from './auto-fetch-runner.js';

describe('auto-fetch-runner', () => {
    beforeEach(() => {
        recorded.length = 0;
        scheduleRow = { ...scheduleRow, auth_failure_count: 0, last_run_status: null };
        scriptedResult = { code: 'OK_UPDATED', detail: '' };
    });

    it.each<[AutoFetchCode, 'success' | 'conflict' | 'failure']>([
        ['OK_UPDATED', 'success'],
        ['OK_UPTODATE', 'success'],
        ['OK_STASHED_AND_MERGED', 'success'],
        ['CONFLICT_SKIPPED', 'conflict'],
        ['CONFLICT_ABORTED', 'conflict'],
        ['CONFLICT_STASH_POPPED_WITH_CONFLICTS', 'conflict'],
        ['FETCH_FAILED', 'failure'],
    ])('maps %s → %s', async (code, expected) => {
        scriptedResult = { code, detail: 'x' };
        await runAutoFetch('p1');
        expect(recorded.at(-1)?.status).toBe(expected);
    });

    it('after 3 consecutive AUTH_FAILED disables the schedule', async () => {
        const { schedulesService } = await import('./schedules.js');
        vi.mocked(schedulesService.incrementAuthFailure)
            .mockReturnValueOnce(1)
            .mockReturnValueOnce(2)
            .mockReturnValueOnce(3);
        scriptedResult = { code: 'AUTH_FAILED', detail: 'fatal: Authentication failed' };
        await runAutoFetch('p1');
        await runAutoFetch('p1');
        await runAutoFetch('p1');
        expect(vi.mocked(schedulesService.disable)).toHaveBeenCalledWith('p1');
    });
});
