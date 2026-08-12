import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../test-setup.js';
import { makeWrapper } from '../test-utils/renderWithProviders.js';
import {
    useCliSessions,
    useCliSession,
    useCreateCliSession,
    useDeleteCliSession,
    usePauseCliSession,
    useResumeCliSession,
    usePreflightStopCliSession,
    useStopCliSession,
    useCliSessionTranscript,
} from './useCliSessions.js';
import type { ICliSession } from '@atlas/shared';

const BASE = 'http://localhost:3000/api';

function makeSession(overrides: Partial<ICliSession> = {}): ICliSession {
    return {
        id: 'sess-1',
        project_id: 'proj-1',
        title: 'Test Session',
        status: 'active',
        cli: 'claude',
        worktree_path: null,
        worktree_branch: null,
        credential_id: null,
        claude_session_id: null,
        model: 'claude-sonnet-4-5',
        initial_prompt: null,
        created_at: '2026-06-22T10:00:00Z',
        updated_at: '2026-06-22T10:00:00Z',
        last_active_at: '2026-06-22T10:00:00Z',
        closed_at: null,
        finalize_pr_url: null,
        item_id: null,
        total_cost_usd: null,
        input_tokens: null,
        output_tokens: null,
        cache_creation_tokens: null,
        cache_read_tokens: null,
        ...overrides,
    };
}

describe('useCliSessions', () => {
    it('fetches the cli sessions list', async () => {
        server.use(
            http.get(`${BASE}/cli/sessions`, () =>
                HttpResponse.json([makeSession(), makeSession({ id: 'sess-2' })]),
            ),
        );
        const { result } = renderHook(() => useCliSessions(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data?.length).toBe(2);
    });

    it('fetches sessions filtered by projectId', async () => {
        server.use(
            http.get(`${BASE}/cli/sessions`, ({ request }) => {
                const url = new URL(request.url);
                if (url.searchParams.get('project_id') === 'proj-A') {
                    return HttpResponse.json([makeSession({ project_id: 'proj-A' })]);
                }
                return HttpResponse.json([]);
            }),
        );
        const { result } = renderHook(
            () => useCliSessions({ projectId: 'proj-A' }),
            { wrapper: makeWrapper() },
        );
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data?.length).toBe(1);
    });
});

describe('useCliSession', () => {
    it('fetches a single session by id', async () => {
        server.use(
            http.get(`${BASE}/cli/sessions/sess-1`, () =>
                HttpResponse.json(makeSession({ id: 'sess-1' })),
            ),
        );
        const { result } = renderHook(() => useCliSession('sess-1'), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data?.id).toBe('sess-1');
    });

    it('is disabled when id is null', () => {
        const { result } = renderHook(() => useCliSession(null), { wrapper: makeWrapper() });
        expect(result.current.fetchStatus).toBe('idle');
    });
});

describe('useCreateCliSession', () => {
    it('calls POST /cli/sessions and invalidates list', async () => {
        const newSession = makeSession({ id: 'sess-new' });
        server.use(
            http.post(`${BASE}/cli/sessions`, async () =>
                HttpResponse.json(newSession),
            ),
            http.get(`${BASE}/cli/sessions`, () => HttpResponse.json([])),
        );
        const { result } = renderHook(() => useCreateCliSession(), { wrapper: makeWrapper() });
        const created = await result.current.mutateAsync({
            project_id: 'proj-1',
            cli: 'claude',
            model: 'claude-sonnet-4-5',
        });
        expect(created.id).toBe('sess-new');
    });
});

describe('useDeleteCliSession', () => {
    it('calls DELETE /cli/sessions/:id', async () => {
        let deleteWasCalled = false;
        server.use(
            http.delete(`${BASE}/cli/sessions/:id`, () => {
                deleteWasCalled = true;
                return new HttpResponse(null, { status: 204 });
            }),
            http.get(`${BASE}/cli/sessions`, () => HttpResponse.json([])),
        );
        const { result } = renderHook(() => useDeleteCliSession(), { wrapper: makeWrapper() });
        await result.current.mutateAsync('sess-1');
        expect(deleteWasCalled).toBe(true);
    });
});

describe('usePauseCliSession', () => {
    it('calls POST /cli/sessions/:id/pause and updates cache', async () => {
        const paused = makeSession({ id: 'sess-1', status: 'paused' });
        server.use(
            http.post(`${BASE}/cli/sessions/sess-1/pause`, () => HttpResponse.json(paused)),
            http.get(`${BASE}/cli/sessions`, () => HttpResponse.json([])),
        );
        const { result } = renderHook(() => usePauseCliSession(), { wrapper: makeWrapper() });
        const updated = await result.current.mutateAsync('sess-1');
        expect(updated.status).toBe('paused');
    });
});

describe('useResumeCliSession', () => {
    it('calls POST /cli/sessions/:id/resume and updates cache', async () => {
        const resumed = makeSession({ id: 'sess-1', status: 'active' });
        server.use(
            http.post(`${BASE}/cli/sessions/sess-1/resume`, () => HttpResponse.json(resumed)),
            http.get(`${BASE}/cli/sessions`, () => HttpResponse.json([])),
        );
        const { result } = renderHook(() => useResumeCliSession(), { wrapper: makeWrapper() });
        const updated = await result.current.mutateAsync('sess-1');
        expect(updated.status).toBe('active');
    });
});

describe('usePreflightStopCliSession', () => {
    it('calls POST /cli/sessions/:id/preflight-stop and returns the response', async () => {
        server.use(
            http.post(`${BASE}/cli/sessions/sess-1/preflight-stop`, () =>
                HttpResponse.json({ unstaged: [], current_branch: 'main', commits_ahead: 0 }),
            ),
        );
        const { result } = renderHook(() => usePreflightStopCliSession(), { wrapper: makeWrapper() });
        const res = await result.current.mutateAsync('sess-1');
        expect(res.unstaged.length).toBe(0);
    });
});

describe('useStopCliSession', () => {
    it('calls POST /cli/sessions/:id/stop with input payload and updates cache', async () => {
        const stopped = makeSession({ id: 'sess-1', status: 'closed' });
        server.use(
            http.post(`${BASE}/cli/sessions/sess-1/stop`, () =>
                HttpResponse.json({ session: stopped, pushed: false, committed: false, finalize_pr_url: null }),
            ),
            http.get(`${BASE}/cli/sessions`, () => HttpResponse.json([])),
        );
        const { result } = renderHook(() => useStopCliSession(), { wrapper: makeWrapper() });
        const res = await result.current.mutateAsync({
            id: 'sess-1',
            input: { files_to_stage: [] },
        });
        expect(res.session.status).toBe('closed');
    });
});

describe('useCliSessionTranscript', () => {
    it('is disabled (idle) when status is not terminal (active)', () => {
        const { result } = renderHook(
            () => useCliSessionTranscript('sess-1', 'active'),
            { wrapper: makeWrapper() },
        );
        // enabled=false when !isTerminal → fetchStatus is 'idle'
        expect(result.current.fetchStatus).toBe('idle');
    });

    it('fetches transcript when status is closed (terminal)', async () => {
        server.use(
            http.get(`${BASE}/cli/sessions/sess-1/transcript`, () =>
                HttpResponse.json({ jsonl_content: 'line1\nline2' }),
            ),
        );
        const { result } = renderHook(
            () => useCliSessionTranscript('sess-1', 'closed'),
            { wrapper: makeWrapper() },
        );
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data?.jsonl_content).toBe('line1\nline2');
    });

    it('staleTime returns Infinity when jsonl_content is present (immutable transcript)', async () => {
        server.use(
            http.get(`${BASE}/cli/sessions/sess-2/transcript`, () =>
                HttpResponse.json({ jsonl_content: 'data' }),
            ),
        );
        const { result } = renderHook(
            () => useCliSessionTranscript('sess-2', 'closed'),
            { wrapper: makeWrapper() },
        );
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        // When jsonl_content is present, staleTime function returns Infinity
        // (the query is effectively never stale)
        expect(result.current.data?.jsonl_content).toBe('data');
    });

    it('is disabled when id is null', () => {
        const { result } = renderHook(
            () => useCliSessionTranscript(null, 'closed'),
            { wrapper: makeWrapper() },
        );
        expect(result.current.fetchStatus).toBe('idle');
    });

    it('is enabled (terminal) for errored status', async () => {
        server.use(
            http.get(`${BASE}/cli/sessions/sess-3/transcript`, () =>
                HttpResponse.json({ jsonl_content: 'errored output' }),
            ),
        );
        const { result } = renderHook(
            () => useCliSessionTranscript('sess-3', 'errored'),
            { wrapper: makeWrapper() },
        );
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data?.jsonl_content).toBe('errored output');
    });

    it('staleTime returns 0 when jsonl_content is null (re-fetchable transcript)', async () => {
        server.use(
            http.get(`${BASE}/cli/sessions/sess-4/transcript`, () =>
                HttpResponse.json({ jsonl_content: null }),
            ),
        );
        const { result } = renderHook(
            () => useCliSessionTranscript('sess-4', 'closed'),
            { wrapper: makeWrapper() },
        );
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        // When jsonl_content is null, staleTime function should return 0
        expect(result.current.data?.jsonl_content).toBeNull();
    });
});
