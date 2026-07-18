import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/api.js';
import type {
    ICliSession,
    ICliSessionTranscriptResponse,
    CliSessionCreateInput,
    CliSessionPreflightStopResponse,
    CliSessionStopInput,
    CliSessionStopResponse,
    CliSessionStatus,
} from '@atlas/shared';

// 2026-06-22 - Terminal v1. React Query hooks for the cli_sessions REST
// surface. SSE wiring in `useSSE` invalidates these queries on the
// `cli_session_status` / `cli_session_closed` event types.

export function useCliSessions(opts?: { projectId?: string }) {
    const projectId = opts?.projectId;
    return useQuery<ICliSession[]>({
        queryKey: projectId ? ['cli-sessions', { projectId }] : ['cli-sessions'],
        queryFn: () => api.cli.sessions.list(projectId ? { project_id: projectId } : undefined),
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
