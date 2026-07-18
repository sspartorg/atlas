import { describe, it, expect, vi } from 'vitest';
import type * as ChildProcess from 'node:child_process';

vi.mock('./agent-activity.js', () => ({ isAnyAgentActiveForProject: vi.fn() }));
vi.mock('node:child_process', async (orig) => {
    const mod = await orig<typeof ChildProcess>();
    return { ...mod, execFile: vi.fn() };
});

import { __internal } from './auto-fetch-runner.js';
import { isAnyAgentActiveForProject } from './agent-activity.js';

const schedule = {
    project_id: 'p1',
    enabled: true,
    preset: 'custom' as const,
    cron_expression: '* * * * *',
    time_of_day: '00:00',
    weekday: null,
    skip_if_dirty: true,
    pause_while_agents_active: true,
    conflict_policy: 'skip' as const,
    last_run_at: null,
    last_run_status: null,
    last_run_detail: null,
    next_run_at: null,
    auth_failure_count: 0,
    created_at: '',
    updated_at: '',
};

describe('mapCode', () => {
    it('OK_UPDATED → success', () =>
        expect(__internal.mapCode('OK_UPDATED', '').result).toBe('success'));
    it('OK_UPTODATE → success', () =>
        expect(__internal.mapCode('OK_UPTODATE', '').result).toBe('success'));
    it('CONFLICT_SKIPPED → conflict', () =>
        expect(__internal.mapCode('CONFLICT_SKIPPED', '').result).toBe('conflict'));
    it('FETCH_FAILED → failure', () =>
        expect(__internal.mapCode('FETCH_FAILED', 'bang').result).toBe('failure'));
    it('AUTH_FAILED → failure', () =>
        expect(__internal.mapCode('AUTH_FAILED', 'x').result).toBe('failure'));
});

describe('checkGuards', () => {
    it('agents-active guard trips when a agent is running', async () => {
        vi.mocked(isAnyAgentActiveForProject).mockReturnValue(true);
        const result = await __internal.checkGuards(
            { ...schedule, skip_if_dirty: false },
            { git_path: 'C:/tmp' }
        );
        expect(result?.detail).toMatch(/agent/);
    });

    it('no guard trips when everything is clear', async () => {
        vi.mocked(isAnyAgentActiveForProject).mockReturnValue(false);
        const result = await __internal.checkGuards(
            { ...schedule, skip_if_dirty: false },
            { git_path: 'C:/tmp' }
        );
        expect(result).toBeNull();
    });

    it('skip_if_dirty is ignored when conflict_policy is stash', async () => {
        // Even though isWorkingTreeDirty() may return true, picking the stash
        // policy means the runner script handles the dirty tree itself — the
        // guard must not short-circuit before we get there.
        vi.mocked(isAnyAgentActiveForProject).mockReturnValue(false);
        const result = await __internal.checkGuards(
            { ...schedule, skip_if_dirty: true, conflict_policy: 'stash' },
            { git_path: 'C:/nonexistent-so-isWorkingTreeDirty-returns-false' }
        );
        expect(result).toBeNull();
    });
});
