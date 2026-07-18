import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { server } from '../test-setup.js';
import { makeWrapper } from '../test-utils/renderWithProviders.js';
import {
    useEnabledSchedules,
    useFireProjectSchedule,
    useProjectSchedule,
    useSaveProjectSchedule,
} from './useProjectSchedule.js';

const ok = (b: JsonBodyType) => HttpResponse.json(b);

describe('useEnabledSchedules', () => {
    it('returns a map keyed by project_id', async () => {
        server.use(
            http.get('http://localhost:3000/api/schedules', () =>
                ok([
                    { project_id: 'p1', preset: 'daily', next_run_at: '2026-05-17T09:00:00.000Z' },
                ]),
            ),
        );
        const { result } = renderHook(() => useEnabledSchedules(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.map.get('p1')?.preset).toBe('daily');
    });
});

describe('useProjectSchedule', () => {
    it('fetches for given project id', async () => {
        server.use(
            http.get('http://localhost:3000/api/projects/p1/schedule', () =>
                ok({ project_id: 'p1', enabled: true }),
            ),
        );
        const { result } = renderHook(() => useProjectSchedule('p1'), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    it('idle when projectId null', () => {
        const { result } = renderHook(() => useProjectSchedule(null), { wrapper: makeWrapper() });
        expect(result.current.fetchStatus).toBe('idle');
    });
});

describe('useSaveProjectSchedule + useFireProjectSchedule', () => {
    it('save and fire mutations', async () => {
        server.use(
            http.put('http://localhost:3000/api/projects/p1/schedule', () =>
                ok({ project_id: 'p1', enabled: true }),
            ),
            http.post('http://localhost:3000/api/projects/p1/schedule/fire', () =>
                ok({ autofetch_id: 'a1' }),
            ),
        );
        const save = renderHook(() => useSaveProjectSchedule('p1'), { wrapper: makeWrapper() });
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
        const fire = renderHook(() => useFireProjectSchedule('p1'), { wrapper: makeWrapper() });
        const f = await fire.result.current.mutateAsync();
        expect(f.autofetch_id).toBe('a1');
    });
});
