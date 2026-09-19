import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { server } from '../test-setup.js';
import { makeWrapper } from '../test-utils/renderWithProviders.js';
import {
    useEnabledSchedules,
    useFireRepoSchedule,
    useRepoSchedule,
    useSaveRepoSchedule,
} from './useProjectSchedule.js';

const ok = (b: JsonBodyType) => HttpResponse.json(b);

describe('useEnabledSchedules', () => {
    it('returns a map keyed by repo_id', async () => {
        server.use(
            http.get('http://localhost:3000/api/schedules', () =>
                ok([
                    {
                        repo_id: 'r1',
                        project_id: 'p1',
                        preset: 'daily',
                        next_run_at: '2026-05-17T09:00:00.000Z',
                    },
                ]),
            ),
        );
        const { result } = renderHook(() => useEnabledSchedules(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.map.get('r1')?.preset).toBe('daily');
    });
});

describe('useRepoSchedule', () => {
    it('fetches for a given repo of a project', async () => {
        server.use(
            http.get('http://localhost:3000/api/projects/p1/repos/r1/schedule', () =>
                ok({ repo_id: 'r1', project_id: 'p1', enabled: true }),
            ),
        );
        const { result } = renderHook(() => useRepoSchedule('p1', 'r1'), {
            wrapper: makeWrapper(),
        });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    it('idle when either id is null', () => {
        const { result } = renderHook(() => useRepoSchedule(null, null), {
            wrapper: makeWrapper(),
        });
        expect(result.current.fetchStatus).toBe('idle');
    });
});

describe('useSaveRepoSchedule + useFireRepoSchedule', () => {
    it('save and fire mutations', async () => {
        server.use(
            http.put('http://localhost:3000/api/projects/p1/repos/r1/schedule', () =>
                ok({ repo_id: 'r1', project_id: 'p1', enabled: true }),
            ),
            http.post('http://localhost:3000/api/projects/p1/repos/r1/schedule/fire', () =>
                ok({ autofetch_id: 'a1' }),
            ),
        );
        const save = renderHook(() => useSaveRepoSchedule('p1', 'r1'), { wrapper: makeWrapper() });
        const r = await save.result.current.mutateAsync({
            enabled: true,
            preset: 'daily',
            time_of_day: '09:00',
            weekday: null,
            cron_expression: '',
            skip_if_dirty: false,
            pause_while_agents_active: false,
            conflict_policy: 'skip',
        });
        expect(r.project_id).toBe('p1');
        const fire = renderHook(() => useFireRepoSchedule('p1', 'r1'), { wrapper: makeWrapper() });
        const f = await fire.result.current.mutateAsync();
        expect(f.autofetch_id).toBe('a1');
    });
});
