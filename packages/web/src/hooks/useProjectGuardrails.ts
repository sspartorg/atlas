import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/api.js';

export function useProjectGuardrails(projectId: string | undefined) {
    return useQuery({
        queryKey: ['project-guardrails', projectId],
        queryFn: () => api.projectGuardrails.list(projectId!),
        enabled: Boolean(projectId),
    });
}

interface CreateInput {
    title: string;
    body_md: string;
    applies_to?: string;
    icon?: string;
    enabled?: number;
    sort_order?: number;
}

export function useCreateProjectGuardrail(projectId: string) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (data: CreateInput) => api.projectGuardrails.create(projectId, data),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['project-guardrails', projectId] });
        },
    });
}

export function useUpdateProjectGuardrail(projectId: string) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, data }: { id: string; data: Partial<CreateInput> }) =>
            api.projectGuardrails.update(projectId, id, data),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['project-guardrails', projectId] });
        },
    });
}

export function useToggleProjectGuardrail(projectId: string) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, enabled }: { id: string; enabled: number }) =>
            api.projectGuardrails.toggle(projectId, id, enabled),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['project-guardrails', projectId] });
        },
    });
}

export function useDeleteProjectGuardrail(projectId: string) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.projectGuardrails.remove(projectId, id),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['project-guardrails', projectId] });
        },
    });
}

interface ScriptCreateInput {
    name: string;
    description?: string;
    body_sh: string;
    body_ps1: string;
    sort_order?: number;
}

export function useProjectGuardrailScripts(projectId: string | undefined) {
    return useQuery({
        queryKey: ['project-guardrail-scripts', projectId],
        queryFn: () => api.projectGuardrailScripts.list(projectId!),
        enabled: Boolean(projectId),
    });
}

export function useCreateProjectGuardrailScript(projectId: string) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (data: ScriptCreateInput) =>
            api.projectGuardrailScripts.create(projectId, data),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['project-guardrail-scripts', projectId] });
        },
    });
}

export function useUpdateProjectGuardrailScript(projectId: string) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, patch }: { id: string; patch: Partial<ScriptCreateInput> }) =>
            api.projectGuardrailScripts.update(projectId, id, patch),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['project-guardrail-scripts', projectId] });
        },
    });
}

export function useDeleteProjectGuardrailScript(projectId: string) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.projectGuardrailScripts.remove(projectId, id),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['project-guardrail-scripts', projectId] });
        },
    });
}
