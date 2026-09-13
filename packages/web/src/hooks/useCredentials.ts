import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../api/api.js';

export function useCredentials() {
    return useQuery({ queryKey: ['credentials'], queryFn: () => api.credentials.list() });
}

/**
 * On-demand reveal for one stored PAT. A mutation, not a query — the
 * plaintext must never land in the React Query cache. Mirrors
 * useRevealEnvironmentSecret / useRevealProjectEnv.
 */
export function useRevealCredentialToken() {
    return useMutation({
        mutationFn: (id: string) => api.credentials.revealToken(id),
    });
}
