import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/api.js';
import { useToast } from './useToast.js';
import type { IAgent, IAgentMemory } from '@atlas/shared';

// Re-fetch the agents list when stale. The earlier "session-stable +
// mutations invalidate" optimization left users staring at stale data
// when changes landed outside the React Query mutation path (catalog
// seed runs, server-side back-fills, the marketplace install flow's
// slug rename, another tab). The list is only ~20 rows so refetch-on-
// stale is cheap.
//
// 2026-06-25 — switched `refetchOnMount: 'always'` → `true` (+ short
// staleTime) to dedupe concurrent mounts on pages where multiple
// callers use this hook (ProjectDetail + OverviewTabContent both call
// useAgents; without dedupe the live MCP walkthrough showed /api/agents
// hitting the API twice on /projects/:id). 30s is short enough that a
// page-level remount after navigation still gets fresh data; concurrent
// child mounts within the same paint share the in-flight fetch.
export function useAgents(opts: { enabled?: boolean } = {}) {
    const { enabled = true } = opts;
    return useQuery({
        queryKey: ['agents'],
        queryFn: () => api.agents.list(),
        enabled,
        refetchOnMount: true,
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
    });
}

export function useAgent(id: string) {
    return useQuery({
        queryKey: ['agents', id],
        queryFn: () => api.agents.get(id),
        enabled: Boolean(id),
    });
}

export function useUpdateAgent() {
    const queryClient = useQueryClient();
    const toast = useToast();
    return useMutation({
        mutationFn: ({ id, data }: { id: string; data: Partial<IAgent> }) =>
            api.agents.update(id, data),
        onSuccess: (updated) => {
            void queryClient.invalidateQueries({ queryKey: ['agents'] });
            void queryClient.setQueryData(['agents', updated.id], updated);
        },
        // Default error toast so PATCH failures aren't silent. Caller-supplied
        // onError on individual mutate() calls still runs (react-query fires
        // both); callers can also pass their own toast detail if they want.
        onError: (err: unknown) => {
            const detail = err instanceof Error ? err.message : 'Unknown error';
            toast.show({ message: 'Could not save agent', detail });
        },
    });
}

export function useAgentRuns(id: string) {
    return useQuery({
        queryKey: ['agents', id, 'runs'],
        queryFn: () => api.agents.getRuns(id),
        enabled: Boolean(id),
    });
}

// Project History tab — every agent run that touched any item in this
// project, ordered newest-first. Implemented as a single server query
// (items.project_id join in /api/run) rather than a client-side
// enumeration of project items + sub-items, because sub-tasks and
// sub-bugs aren't loaded at the project level.
//
// 2026-06-28 — added `staleTime: 30_000` to dedupe concurrent mounts
// from React StrictMode's double-mount and from sibling tab-content
// callers (OverviewTabContent + HistoryTabContent both subscribe).
// Without this, ProjectDetail fires /api/run?project_id=… twice on
// first paint. Same fix pattern as useAgents (commit 54dc1b7).
export function useProjectAgentRuns(projectId: string) {
    return useQuery({
        queryKey: ['projects', projectId, 'agent-runs'],
        queryFn: () => api.run.list({ project_id: projectId, limit: 200 }),
        enabled: Boolean(projectId),
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
    });
}

export function useItemAgentRuns(itemId: string | null | undefined) {
    return useQuery({
        queryKey: ['items', itemId, 'agent-runs'],
        queryFn: () => api.run.list({ issue_id: itemId!, limit: 100 }),
        enabled: Boolean(itemId),
        // 2026-06-28 — same dedupe pattern; item detail pages sometimes
        // render twice from sibling activity-card + run-list subscribers.
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
    });
}

export function useHandoffRules(id: string) {
    return useQuery({
        queryKey: ['agents', id, 'handoff-rules'],
        queryFn: () => api.agents.getHandoffRules(id),
        enabled: Boolean(id),
    });
}

export function useAgentChecklists(id: string) {
    return useQuery({
        queryKey: ['agents', id, 'checklists'],
        queryFn: () => api.agents.getChecklists(id),
        enabled: Boolean(id),
    });
}

export function useAgentMemory(id: string, opts: { enabled?: boolean } = {}) {
    const { enabled = true } = opts;
    return useQuery({
        queryKey: ['agents', id, 'memory'],
        queryFn: () => api.agents.getMemory(id),
        enabled: Boolean(id) && enabled,
    });
}

export function useSetAgentMemory() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, body_md }: { id: string; body_md: string }) =>
            api.agents.setMemory(id, body_md),
        onSuccess: (next: IAgentMemory) => {
            queryClient.setQueryData(['agents', next.agent_id, 'memory'], next);
        },
    });
}

export function useRegenerateAgentMemory() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.agents.regenerateMemory(id),
        onSuccess: (next: IAgentMemory) => {
            queryClient.setQueryData(['agents', next.agent_id, 'memory'], next);
        },
    });
}

export function useAgentRun(runId: string) {
    return useQuery({
        queryKey: ['agent-run', runId],
        queryFn: () => api.run.get(runId),
        enabled: Boolean(runId),
    });
}

export function useAgentPromptVersions(id: string) {
    return useQuery({
        queryKey: ['agents', id, 'prompt-versions'],
        queryFn: () => api.agents.getPromptVersions(id),
        enabled: Boolean(id),
    });
}

export function useRevertAgentPrompt() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, version }: { id: string; version: number }) =>
            api.agents.revertPrompt(id, version),
        onSuccess: (updated) => {
            queryClient.setQueryData(['agents', updated.id], updated);
            void queryClient.invalidateQueries({ queryKey: ['agents'] });
            void queryClient.invalidateQueries({
                queryKey: ['agents', updated.id, 'prompt-versions'],
            });
        },
    });
}
