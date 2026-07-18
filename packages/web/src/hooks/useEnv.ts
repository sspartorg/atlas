import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/api.js';

// Audit 2026-06-09 (B2) — env vars are workspace-stable; they only change
// via `useUpdateEnv()` which calls `setQueryData` to refresh the cache in
// place. Long-cache mirrors `useSettings` / `useSidenavCounts` — single
// fetch per session, refresh on focus (`ATLAS_FEEDBACK_URL` can be edited
// from outside the app + an env-restart needs to pick it up).
export function useEnv() {
    return useQuery({
        queryKey: ['settings', 'env'],
        queryFn: () => api.settings.getEnv(),
        staleTime: Infinity,
        gcTime: Infinity,
        refetchOnMount: false,
        refetchOnWindowFocus: true,
        refetchOnReconnect: false,
    });
}

export function useUpdateEnv() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (updates: Array<{ key: string; value: string }>) =>
            api.settings.updateEnv(updates),
        onSuccess: (data) => {
            qc.setQueryData(['settings', 'env'], data);
        },
    });
}

