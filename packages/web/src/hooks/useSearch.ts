import { useEffect, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { api } from '../api/api.js';

// P14 — TanStack Query wrapper around `GET /api/search`. The server does
// FTS + filtering in Postgres; this hook just translates the in-page
// filter state into query-string params and caches per-key.
//
// `q` is debounced upstream (in the page) so we don't fire one request
// per keystroke. We keep previous data on key changes so the UI doesn't
// flash empty while the user types — Postgres FTS is fast (<100ms on a
// 1000-item workspace) but the round-trip still feels nicer with
// `keepPreviousData`.

type SearchType = 'epic' | 'story' | 'sub_task' | 'sub_bug' | 'bug';
type SearchUpdatedRange = 'today' | 'last_7_days' | 'last_30_days' | 'older';

export interface SearchHitRow {
    issue_type: string;
    issue_id: string;
    title: string;
    description: string;
    status: string;
    project_id: string;
    assignee_agent_id: string | null;
    updated_at: string;
    rank: number;
}

export interface UseSearchArgs {
    q?: string;
    type?: SearchType[];
    project_id?: string[];
    agent_id?: string[];
    status?: string;
    updated?: SearchUpdatedRange;
    /** Task 2 — label filter (all-of containment). */
    labels?: string[];
    limit?: number;
}

/**
 * Returns `data: SearchHitRow[]`, plus loading/fetching flags. When no
 * filter is active AND the query is shorter than 2 chars the hook
 * skips the network call (the server short-circuits the same way), so
 * `data` stays `[]` and `isLoading` stays `false`.
 */
export function useSearch(args: UseSearchArgs) {
    const q = (args.q ?? '').trim();
    const hasQuery = q.length >= 2;
    const hasFilter = Boolean(
        (args.type && args.type.length > 0) ||
            (args.project_id && args.project_id.length > 0) ||
            (args.agent_id && args.agent_id.length > 0) ||
            args.status ||
            args.updated ||
            (args.labels && args.labels.length > 0),
    );
    const enabled = hasQuery || hasFilter;

    const query = useQuery<SearchHitRow[]>({
        queryKey: [
            'search',
            {
                q: hasQuery ? q : '',
                type: args.type ?? [],
                project_id: args.project_id ?? [],
                agent_id: args.agent_id ?? [],
                status: args.status ?? '',
                updated: args.updated ?? '',
                labels: args.labels ?? [],
                limit: args.limit ?? 50,
            },
        ],
        queryFn: () =>
            api.search.query({
                ...(hasQuery ? { q } : {}),
                ...(args.type ? { type: args.type } : {}),
                ...(args.project_id ? { project_id: args.project_id } : {}),
                ...(args.agent_id ? { agent_id: args.agent_id } : {}),
                ...(args.status ? { status: args.status } : {}),
                ...(args.updated ? { updated: args.updated } : {}),
                ...(args.labels ? { labels: args.labels } : {}),
                ...(args.limit ? { limit: args.limit } : {}),
            }),
        enabled,
        placeholderData: keepPreviousData,
        staleTime: 10_000,
    });

    return {
        data: enabled ? (query.data ?? []) : [],
        isLoading: enabled && query.isLoading,
        isFetching: query.isFetching,
        isEnabled: enabled,
    };
}

/** Generic debounce so the Search page can hold off network calls
 * until the user stops typing. Returns the latest stable value after
 * `delay` ms with no change. */
export function useDebouncedValue<T>(value: T, delay: number): T {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const t = window.setTimeout(() => setDebounced(value), delay);
        return () => window.clearTimeout(t);
    }, [value, delay]);
    return debounced;
}
