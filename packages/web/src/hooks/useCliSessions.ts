import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/api.js';
import type {
    ICliSession,
    ICliSessionTranscriptResponse,
    CliSessionCreateInput,
    CliSessionStandaloneCreateInput,
    CliSessionPreflightStopResponse,
    CliSessionStopInput,
    CliSessionStopResponse,
    CliSessionStatus,
    CliSessionDiffScopeName,
    CliSessionDiffSummaryResponse,
    CliSessionFilePatchResponse,
} from '@atlas/shared';

// 2026-06-22 - Terminal v1. React Query hooks for the cli_sessions REST
// surface. SSE wiring in `useSSE` invalidates these queries on the
// `cli_session_status` / `cli_session_closed` event types.

/**
 * `standalone` splits the two terminal surfaces: `true` is the folder-scoped
 * sessions on /terminal/standalone, `false` the project ones on /terminal,
 * omitted means both (the multi-pane workspace attaches to either).
 *
 * The split happens server-side rather than here because the list endpoint
 * caps at 200 rows — a busy project could otherwise push every standalone
 * session off the end of its own page's list.
 *
 * Every variant shares the `['cli-sessions']` key prefix so the existing SSE
 * invalidation (and every mutation's `invalidateQueries`) refreshes them all.
 */
export function useCliSessions(opts?: { projectId?: string; standalone?: boolean }) {
    const projectId = opts?.projectId;
    const standalone = opts?.standalone;
    const filter = {
        ...(projectId ? { project_id: projectId } : {}),
        ...(standalone !== undefined ? { standalone } : {}),
    };
    const hasFilter = Object.keys(filter).length > 0;
    return useQuery<ICliSession[]>({
        queryKey: hasFilter ? ['cli-sessions', filter] : ['cli-sessions'],
        queryFn: () => api.cli.sessions.list(hasFilter ? filter : undefined),
        staleTime: 15_000,
    });
}

export function useCliSession(id: string | null | undefined) {
    return useQuery<ICliSession>({
        queryKey: ['cli-session', id],
        queryFn: () => api.cli.sessions.get(id as string),
        enabled: Boolean(id),
        // Cost rollups arrive via SSE invalidation; modest stale time avoids
        // flicker when the session detail page re-renders.
        staleTime: 5_000,
    });
}

export function useCreateCliSession() {
    const qc = useQueryClient();
    return useMutation<ICliSession, Error, CliSessionCreateInput>({
        mutationFn: (input) => api.cli.sessions.create(input),
        onSuccess: (created) => {
            void qc.invalidateQueries({ queryKey: ['cli-sessions'] });
            qc.setQueryData(['cli-session', created.id], created);
        },
    });
}

export function useCreateStandaloneCliSession() {
    const qc = useQueryClient();
    return useMutation<ICliSession, Error, CliSessionStandaloneCreateInput>({
        mutationFn: (input) => api.cli.sessions.createStandalone(input),
        onSuccess: (created) => {
            void qc.invalidateQueries({ queryKey: ['cli-sessions'] });
            qc.setQueryData(['cli-session', created.id], created);
        },
    });
}

export function usePauseCliSession() {
    const qc = useQueryClient();
    return useMutation<ICliSession, Error, string>({
        mutationFn: (id) => api.cli.sessions.pause(id),
        onSuccess: (updated) => {
            void qc.invalidateQueries({ queryKey: ['cli-sessions'] });
            qc.setQueryData(['cli-session', updated.id], updated);
        },
    });
}

export function useResumeCliSession() {
    const qc = useQueryClient();
    return useMutation<ICliSession, Error, string>({
        mutationFn: (id) => api.cli.sessions.resume(id),
        onSuccess: (updated) => {
            void qc.invalidateQueries({ queryKey: ['cli-sessions'] });
            qc.setQueryData(['cli-session', updated.id], updated);
        },
    });
}

export function usePreflightStopCliSession() {
    return useMutation<CliSessionPreflightStopResponse, Error, string>({
        mutationFn: (id) => api.cli.sessions.preflightStop(id),
    });
}

export function useStopCliSession() {
    const qc = useQueryClient();
    return useMutation<CliSessionStopResponse, Error, { id: string; input: CliSessionStopInput }>({
        mutationFn: ({ id, input }) => api.cli.sessions.stop(id, input),
        onSuccess: (result) => {
            void qc.invalidateQueries({ queryKey: ['cli-sessions'] });
            qc.setQueryData(['cli-session', result.session.id], result.session);
        },
    });
}

// 2026-08-04 — Terminal finalize diff. Two queries, because a session can
// touch hundreds of files: the summary is small and always needed, the
// per-file patches are large and fetched only for the file being viewed.

export function useCliSessionDiff(id: string, enabled: boolean) {
    return useQuery<CliSessionDiffSummaryResponse>({
        queryKey: ['cli-session-diff', id],
        queryFn: () => api.cli.sessions.diff(id),
        enabled: enabled && Boolean(id),
        // The worktree can change under us between opens (the PTY is still
        // live during preflight), so don't serve a stale snapshot on reopen.
        staleTime: 0,
        gcTime: 5 * 60_000,
        retry: false,
    });
}

export function useCliSessionFilePatch(
    id: string,
    scope: CliSessionDiffScopeName,
    path: string | null,
    context: number,
    enabled: boolean,
) {
    return useQuery<CliSessionFilePatchResponse>({
        queryKey: ['cli-session-diff-patch', id, scope, path, context],
        queryFn: () =>
            api.cli.sessions.diffFile(id, { scope, path: path as string, context }),
        enabled: enabled && Boolean(id) && Boolean(path),
        // Immutable for the modal's lifetime — the PTY was killed before the
        // modal opened in the stop path, and the summary query above owns
        // freshness. Refetching a 500 KB patch on every focus is pure waste.
        staleTime: Infinity,
        gcTime: 5 * 60_000,
        retry: false,
    });
}

export function useCliSessionTranscript(id: string | null | undefined, status: CliSessionStatus | undefined) {
    const isTerminal = status === 'closed' || status === 'errored';
    return useQuery<ICliSessionTranscriptResponse>({
        queryKey: ['cli-session-transcript', id],
        queryFn: async () => api.cli.sessions.transcript(id as string),
        // Only fire for sessions that are actually finished — transcript is
        // 409 for active/paused on the server side, so we'd just be burning
        // a request otherwise.
        enabled: Boolean(id) && isTerminal,
        // When the transcript content is present, it's immutable — stale-
        // forever is the right cache policy. When the content is null (the
        // CLI's on-disk file was missing or unreadable at ingest time), let
        // the query refetch on the next navigation so a later visit can
        // re-trigger the lazy server-side ingest. select() doesn't change
        // the cached value; the dynamic staleTime flips based on the cached
        // payload via the function form.
        staleTime: (q) => (q.state.data?.jsonl_content ? Infinity : 0),
    });
}

export function useDeleteCliSession() {
    const qc = useQueryClient();
    return useMutation<void, Error, string>({
        mutationFn: (id) => api.cli.sessions.delete(id),
        onSuccess: (_, id) => {
            void qc.invalidateQueries({ queryKey: ['cli-sessions'] });
            qc.removeQueries({ queryKey: ['cli-session', id] });
        },
    });
}
