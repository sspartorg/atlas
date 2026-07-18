import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { GuardrailCategory, GuardrailSeverity } from '@atlas/shared';
import { api } from '../api/api.js';

export function useGuardrails() {
    return useQuery({
        queryKey: ['guardrails'],
        queryFn: () => api.guardrails.list(),
    });
}

interface CreateInput {
    category: GuardrailCategory;
    rule_text: string;
    detail: string | null;
    severity: GuardrailSeverity;
}

export function useCreateGuardrail() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (data: CreateInput) => api.guardrails.create(data),
        onSuccess: () => void qc.invalidateQueries({ queryKey: ['guardrails'] }),
    });
}

export function useUpdateGuardrail() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, patch }: { id: string; patch: Partial<CreateInput> }) =>
            api.guardrails.update(id, patch),
        onSuccess: () => void qc.invalidateQueries({ queryKey: ['guardrails'] }),
    });
}

export function useDeleteGuardrail() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.guardrails.remove(id),
        onSuccess: () => void qc.invalidateQueries({ queryKey: ['guardrails'] }),
    });
}

export function useSaveGuardrails() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: () => api.guardrails.save(),
        onSuccess: () => void qc.invalidateQueries({ queryKey: ['guardrails'] }),
    });
}

interface ScriptCreateInput {
    name: string;
    description?: string;
    body_sh: string;
    body_ps1: string;
    sort_order?: number;
}

export function useGuardrailScripts() {
    return useQuery({
        queryKey: ['guardrail-scripts'],
        queryFn: () => api.guardrailScripts.list(),
    });
}

export function useCreateGuardrailScript() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (data: ScriptCreateInput) => api.guardrailScripts.create(data),
        onSuccess: () => void qc.invalidateQueries({ queryKey: ['guardrail-scripts'] }),
    });
}

export function useUpdateGuardrailScript() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, patch }: { id: string; patch: Partial<ScriptCreateInput> }) =>
            api.guardrailScripts.update(id, patch),
        onSuccess: () => void qc.invalidateQueries({ queryKey: ['guardrail-scripts'] }),
    });
}

export function useDeleteGuardrailScript() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.guardrailScripts.remove(id),
        onSuccess: () => void qc.invalidateQueries({ queryKey: ['guardrail-scripts'] }),
    });
}
