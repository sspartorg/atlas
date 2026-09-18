import { useQuery } from '@tanstack/react-query';
import { api } from '../api/api.js';

export function useMarketplaceAgentFull(id: string | undefined) {
    return useQuery({
        queryKey: ['marketplace', 'full', id],
        queryFn: () => api.marketplace.get(id ?? ''),
        enabled: Boolean(id),
    });
}

// The search endpoint does NOT match `q` against the catalog id, so id
// lookups read the whole (unfiltered) catalog and filter in memory.
export function useMarketplaceCatalog(opts: { enabled?: boolean } = {}) {
    return useQuery({
        queryKey: ['marketplace', 'list', 'detail'],
        queryFn: () => api.marketplace.list({ limit: 100 }),
        staleTime: 30_000,
        enabled: opts.enabled ?? true,
    });
}
