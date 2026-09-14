import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateWorkflowInput, UpdateWorkflowInput } from '@atlas/shared';
import { api } from '../api/api.js';

// Every workflow query sits under ['workflows'] so one prefix invalidation
// (SSE `workflow_run_updated`, a save) refreshes list, detail and templates.

export function useWorkflows(projectId?: string | null) {
    return useQuery({
        queryKey: ['workflows', 'list', projectId ?? null],
        queryFn: () => api.workflows.list(projectId ?? undefined),
    });
}

export function useWorkflow(id: string) {
    return useQuery({
        queryKey: ['workflows', 'detail', id],
        queryFn: () => api.workflows.get(id),
        enabled: Boolean(id),
    });
}

export function useWorkflowTemplates(opts: { enabled?: boolean } = {}) {
    return useQuery({
        queryKey: ['workflows', 'templates'],
        queryFn: () => api.workflows.templates(),
        enabled: opts.enabled ?? true,
        staleTime: Infinity,
    });
}

export function useCreateWorkflow() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (input: CreateWorkflowInput) => api.workflows.create(input),
        onSuccess: () => void qc.invalidateQueries({ queryKey: ['workflows'] }),
    });
}

export function useCreateWorkflowFromTemplate() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ templateId, projectId }: { templateId: string; projectId: string }) =>
            api.workflows.createFromTemplate(templateId, projectId),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['workflows'] });
            // Installing a template can add catalog agents.
            void qc.invalidateQueries({ queryKey: ['agents'] });
        },
    });
}

export function useUpdateWorkflow() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, input }: { id: string; input: UpdateWorkflowInput }) =>
            api.workflows.update(id, input),
        onSuccess: (wf) => {
            qc.setQueryData(['workflows', 'detail', wf.id], wf);
            void qc.invalidateQueries({ queryKey: ['workflows', 'list'] });
        },
    });
}

export function useDeleteWorkflow() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.workflows.delete(id),
        onSuccess: () => void qc.invalidateQueries({ queryKey: ['workflows', 'list'] }),
    });
}

export function useWorkflowRuns(workflowId: string) {
    return useQuery({
        queryKey: ['workflow-runs', workflowId],
        queryFn: () => api.workflows.runs(workflowId),
        enabled: Boolean(workflowId),
    });
}

export function useWorkflowRun(runId: string) {
    return useQuery({
        queryKey: ['workflow-run', runId],
        queryFn: () => api.workflowRuns.get(runId),
        enabled: Boolean(runId),
    });
}

export function useItemWorkflowRuns(itemId: string) {
    return useQuery({
        queryKey: ['item-workflow-runs', itemId],
        queryFn: () => api.workflows.itemRuns(itemId),
        enabled: Boolean(itemId),
    });
}

export function useStartWorkflowRun() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ workflowId, itemId }: { workflowId: string; itemId?: string }) =>
            api.workflows.startRun(workflowId, itemId),
        onSuccess: (_res, { workflowId, itemId }) => {
            void qc.invalidateQueries({ queryKey: ['workflow-runs', workflowId] });
            if (itemId) void qc.invalidateQueries({ queryKey: ['item-workflow-runs', itemId] });
        },
    });
}

function useRunAction(action: (id: string) => ReturnType<typeof api.workflowRuns.stop>) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: action,
        onSuccess: (run) => {
            qc.setQueryData(['workflow-run', run.id], run);
            void qc.invalidateQueries({ queryKey: ['workflow-runs', run.workflow_id] });
            if (run.item_id) {
                void qc.invalidateQueries({ queryKey: ['item-workflow-runs', run.item_id] });
            }
        },
    });
}

export function useStopWorkflowRun() {
    return useRunAction((id) => api.workflowRuns.stop(id));
}

export function useResumeWorkflowRun() {
    return useRunAction((id) => api.workflowRuns.resume(id));
}

export function useSetItemWorkflow() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ itemId, workflowId }: { itemId: string; workflowId: string | null }) =>
            api.workflows.setItemWorkflow(itemId, workflowId),
        onSuccess: (_res, { itemId }) => {
            // The item row lives under its kind's key; refresh every kind
            // rather than threading the type through.
            for (const key of ['epics', 'stories', 'bugs', 'sub-tasks', 'sub-bugs', 'issues']) {
                void qc.invalidateQueries({ queryKey: [key] });
            }
            void qc.invalidateQueries({ queryKey: ['item-workflow-runs', itemId] });
        },
    });
}
