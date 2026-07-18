import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../test-setup.js';
import { makeWrapper } from '../test-utils/renderWithProviders.js';
import { useAllSubBugs, useAllSubTasks, useSearchPing } from './useSearchCorpus.js';

describe('useAllSubTasks + useAllSubBugs', () => {
    it('return loaded data', async () => {
        server.use(
            http.get('http://localhost:3000/api/sub-tasks', () => HttpResponse.json([])),
            http.get('http://localhost:3000/api/sub-bugs', () => HttpResponse.json([])),
        );
        const t = renderHook(() => useAllSubTasks(), { wrapper: makeWrapper() });
        const b = renderHook(() => useAllSubBugs(), { wrapper: makeWrapper() });
        await waitFor(() => expect(t.result.current.isLoading).toBe(false));
        await waitFor(() => expect(b.result.current.isLoading).toBe(false));
        expect(t.result.current.data).toEqual([]);
        expect(b.result.current.data).toEqual([]);
    });

    it('passes through non-empty array response for useAllSubTasks', async () => {
        const tasks = [{ id: 'st-1', title: 'First task' }, { id: 'st-2', title: 'Second task' }];
        server.use(
            http.get('http://localhost:3000/api/sub-tasks', () => HttpResponse.json(tasks)),
        );
        const { result } = renderHook(() => useAllSubTasks(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(result.current.data).toEqual(tasks);
    });

    it('passes through non-empty array response for useAllSubBugs', async () => {
        const bugs = [{ id: 'sb-1', title: 'First bug' }, { id: 'sb-2', title: 'Second bug' }];
        server.use(
            http.get('http://localhost:3000/api/sub-bugs', () => HttpResponse.json(bugs)),
        );
        const { result } = renderHook(() => useAllSubBugs(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(result.current.data).toEqual(bugs);
    });

    it('starts with isLoading=true before the request resolves', () => {
        server.use(
            http.get('http://localhost:3000/api/sub-tasks', () => HttpResponse.json([])),
        );
        const { result } = renderHook(() => useAllSubTasks(), { wrapper: makeWrapper() });
        // On the very first render, before the query has resolved, isLoading is true
        expect(result.current.isLoading).toBe(true);
    });
});

describe('useSearchPing', () => {
    it('always resolves to true', async () => {
        const { result } = renderHook(() => useSearchPing(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toBe(true);
    });
});
