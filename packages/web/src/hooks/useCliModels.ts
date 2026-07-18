import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AgentCli } from '@atlas/shared';
import { api } from '../api/api.js';

export function useCliModels() {
    return useQuery({
        queryKey: ['cli-models'],
        queryFn: () => api.cliModels.list(),
    });
}

export function useCreateCliModel() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (data: { cli: AgentCli; model_name: string; note?: string | null }) =>
            api.cliModels.create(data),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['cli-models'] });
        },
    });
}

export function useUpdateCliModel() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (data: {
            id: string;
            note?: string | null;
            sort_order?: number;
        }) => {
            const { id, ...patch } = data;
            return api.cliModels.update(id, patch);
        },
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['cli-models'] });
        },
    });
}

export function useRemoveCliModel() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.cliModels.remove(id),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['cli-models'] });
        },
    });
}
