import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/api.js';

// 2026-06-10 — Global tier of the two-scope secrets model. Settings >
// Shared Secrets tab is the only consumer today; the setup runner
// reads server-side via `environmentSecretsService.decryptAll()`.
//
// Batch-9 audit (enterprise-secrets read model): list is metadata-only
// (`{key, updated_at, has_value}`), reveal fetches the plaintext for a
// single key on demand. Never store the revealed plaintext in
// TanStack Query cache — it belongs in transient component state that
// clears on unmount / countdown expiry.

const KEY = ['settings', 'environment-secrets'] as const;

export function useEnvironmentSecrets() {
    return useQuery({
        queryKey: KEY,
        queryFn: () => api.environmentSecrets.list(),
        staleTime: Infinity,
        gcTime: Infinity,
    });
}

export function useSaveEnvironmentSecrets() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (vars: Array<{ key: string; value: string }>) =>
            api.environmentSecrets.save(vars),
        onSuccess: (data) => {
            qc.setQueryData(KEY, data);
        },
    });
}

/**
 * On-demand reveal for one shared secret. Returns a mutation, not a
 * query — the plaintext MUST NOT be cached. Callers hold the resolved
 * `{value}` in local component state, display it with a countdown, and
 * discard it when the countdown fires.
 */
export function useRevealEnvironmentSecret() {
    return useMutation({
        mutationFn: (key: string) => api.environmentSecrets.reveal(key),
    });
}
