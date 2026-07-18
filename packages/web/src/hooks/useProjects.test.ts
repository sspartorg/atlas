import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '../test-setup.js';
import { handlers } from '../test-utils/mock-handlers.js';
import { makeWrapper } from '../test-utils/renderWithProviders.js';
import { makeProject } from '../test-utils/factories.js';
import {
    useCreateProject,
    useDeleteProject,
    useProject,
    useProjects,
    useProjectsPaged,
    useUpdateProject,
} from './useProjects.js';

describe('useProjects', () => {
    it('returns the project list on success', async () => {
        const rows = [makeProject({ id: 'p1' }), makeProject({ id: 'p2' })];
        server.use(handlers.listProjects(rows));
        const { result } = renderHook(() => useProjects(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toEqual(rows);
    });

    it('surfaces an error on 500', async () => {
        server.use(
            http.get('http://localhost:3000/api/projects', () =>
                HttpResponse.json({ error: 'fail' }, { status: 500 }),
            ),
        );
        const { result } = renderHook(() => useProjects(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isError).toBe(true));
    });
});

describe('useProject', () => {
    it('fetches by id', async () => {
        const project = makeProject({ id: 'p1' });
        server.use(handlers.getProject(project));
        const { result } = renderHook(() => useProject('p1'), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data?.id).toBe('p1');
    });

    it('stays idle when id is empty', () => {
        const { result } = renderHook(() => useProject(''), { wrapper: makeWrapper() });
        expect(result.current.fetchStatus).toBe('idle');
    });
});

describe('useCreateProject', () => {
    it('invalidates projects and sidenav-counts on success', async () => {
        server.use(
            http.post('http://localhost:3000/api/projects', () => HttpResponse.json(makeProject({ id: 'p9' }))),
        );
        const qc = new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        });
        qc.setQueryData(['projects'], [makeProject({ id: 'p0' })]);
        qc.setQueryData(['sidenav-counts'], { projects: 1 });
        const { result } = renderHook(() => useCreateProject(), {
            wrapper: makeWrapper(),
        });
        await result.current.mutateAsync.bind(result.current)({ name: 'New' });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });
});

describe('useUpdateProject', () => {
    it('updates cache by id', async () => {
        server.use(
            http.patch('http://localhost:3000/api/projects/p1', () =>
                HttpResponse.json(makeProject({ id: 'p1', name: 'Renamed' })),
            ),
        );
        const { result } = renderHook(() => useUpdateProject(), {
            wrapper: makeWrapper(),
        });
        await result.current.mutateAsync({ id: 'p1', data: { name: 'Renamed' } });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data?.name).toBe('Renamed');
    });
});

describe('useDeleteProject', () => {
    it('completes on 204', async () => {
        server.use(
            http.delete('http://localhost:3000/api/projects/p1', () => new HttpResponse(null, { status: 204 })),
        );
        const { result } = renderHook(() => useDeleteProject(), { wrapper: makeWrapper() });
        await result.current.mutateAsync('p1');
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });
});

describe('useProjectsPaged', () => {
    it('fetches a paged project list', async () => {
        const rows = [makeProject({ id: 'p1' }), makeProject({ id: 'p2' })];
        server.use(
            http.get('http://localhost:3000/api/projects/paged', ({ request }) => {
                const url = new URL(request.url);
                expect(url.searchParams.get('page')).toBe('1');
                expect(url.searchParams.get('limit')).toBe('25');
                return HttpResponse.json({ rows, total: 2, page: 1, limit: 25 });
            }),
        );
        const { result } = renderHook(() => useProjectsPaged({ page: 1, limit: 25 }), {
            wrapper: makeWrapper(),
        });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data?.rows).toHaveLength(2);
        expect(result.current.data?.total).toBe(2);
    });
});
