import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/api.js';
import { runBulkInstall } from '../pages/marketplace/bulkInstall.js';
import { useAgents } from './useAgents.js';

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

export interface IMissingHandoffTarget {
    /** Catalog id — also the local agent id the handoff rule points at. */
    id: string;
    name: string;
    /** Names of the catalog entries whose rules hand off to this target. */
    sourceNames: string[];
}

/**
 * Handoff targets of `sourceIds` that are neither installed locally nor
 * among `sourceIds` themselves (i.e. already being installed). Only targets
 * present in the catalog are returned — those are the ones we can offer to
 * install; `owner` routes never match.
 */
export function useMissingHandoffTargets(sourceIds: readonly string[]): IMissingHandoffTarget[] {
    const enabled = sourceIds.length > 0;
    const fulls = useQueries({
        queries: sourceIds.map((id) => ({
            queryKey: ['marketplace', 'full', id],
            queryFn: () => api.marketplace.get(id),
        })),
    });
    const { data: agents } = useAgents({ enabled });
    const { data: catalog } = useMarketplaceCatalog({ enabled });
    if (!enabled || !agents || !catalog) return [];

    const localIds = new Set(agents.map((a) => a.id));
    const byId = new Map(catalog.map((c) => [c.id, c]));
    const out = new Map<string, IMissingHandoffTarget>();
    fulls.forEach((q, i) => {
        const sourceName = byId.get(sourceIds[i] ?? '')?.name ?? sourceIds[i] ?? '';
        for (const rule of q.data?.handoff_rules ?? []) {
            const target = byId.get(rule.target_agent_id);
            if (!target || target.is_installed || localIds.has(target.id)) continue;
            if (sourceIds.includes(target.id)) continue;
            const row = out.get(target.id) ?? { id: target.id, name: target.name, sourceNames: [] };
            if (!row.sourceNames.includes(sourceName)) row.sourceNames.push(sourceName);
            out.set(target.id, row);
        }
    });
    return [...out.values()];
}

export function useInstallCatalogAgents() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (ids: string[]) =>
            runBulkInstall(ids, (id, opts) => api.marketplace.install(id, opts ?? {})),
        onSettled: async () => {
            await qc.invalidateQueries({ queryKey: ['agents'] });
            await qc.invalidateQueries({ queryKey: ['marketplace'] });
        },
    });
}
