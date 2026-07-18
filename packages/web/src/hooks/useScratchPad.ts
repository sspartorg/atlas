import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { CreateScratchPadInput, UpdateScratchPadInput } from '@atlas/shared';
import { api } from '../api/api.js';

// P12 — Data hooks for the Scratch Pad page. List drives the tile grid;
// individual update + delete invalidate the list on success so the grid
// re-renders without a manual refetch.

export function useScratchPadList() {
    return useQuery({
        queryKey: ['scratch-pad'],
        queryFn: () => api.scratchPad.list(),
    });
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
    void qc.invalidateQueries({ queryKey: ['scratch-pad'] });
}

export function useCreateScratchPad() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (input: CreateScratchPadInput = {}) => api.scratchPad.create(input),
        onSuccess: () => invalidate(qc),
    });
}

export function useUpdateScratchPad() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, patch }: { id: string; patch: UpdateScratchPadInput }) =>
            api.scratchPad.update(id, patch),
        onSuccess: () => invalidate(qc),
    });
}

export function useDeleteScratchPad() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.scratchPad.delete(id),
        onSuccess: () => invalidate(qc),
    });
}
