import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api } from '../api/api.js';
import type { IProject } from '@atlas/shared';

// Projects rarely change between sessions and every mutation in this file
// invalidates `['projects']` on success. SSE also broadcasts on remote
// changes. So we long-cache the same way useSettings does — re-fetching on
// every page mount was the single biggest contributor to the ~600 ms cold
// reload waterfall.
export function useProjects() {
    return useQuery({
        queryKey: ['projects'],
        queryFn: () => api.projects.list(),
        staleTime: Infinity,
        gcTime: Infinity,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
    });
}

// Page-scoped variant for the visible /projects table. Keeps payloads bounded
// even after the workspace grows past a few hundred projects, and lets the
// table render the next page near-instantly via keepPreviousData.
export function useProjectsPaged(params: { page: number; limit: number }) {
    return useQuery({
        queryKey: ['projects-paged', params.page, params.limit],
        queryFn: () => api.projects.listPaged(params),
        placeholderData: keepPreviousData,
        staleTime: 30_000,
    });
}

export function useProject(id: string) {
    return useQuery({
        queryKey: ['projects', id],
        queryFn: () => api.projects.get(id),
        enabled: Boolean(id),
    });
}

export function useCreateProject() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (data: Partial<IProject>) => api.projects.create(data),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['projects'] });
            void qc.invalidateQueries({ queryKey: ['projects-paged'] });
            void qc.invalidateQueries({ queryKey: ['sidenav-counts'] });
        },
    });
}

export function useUpdateProject() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, data }: { id: string; data: Partial<IProject> }) =>
            api.projects.update(id, data),
        onSuccess: (updated) => {
            void qc.invalidateQueries({ queryKey: ['projects'] });
            void qc.invalidateQueries({ queryKey: ['projects-paged'] });
            void qc.setQueryData(['projects', updated.id], updated);
        },
    });
}

export function useDeleteProject() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.projects.delete(id),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['projects'] });
            void qc.invalidateQueries({ queryKey: ['projects-paged'] });
            void qc.invalidateQueries({ queryKey: ['sidenav-counts'] });
        },
    });
}
