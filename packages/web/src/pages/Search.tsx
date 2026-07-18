import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { IAgent } from '@atlas/shared';
import { SearchTextInput } from '../components/index.js';
import { useAgents } from '../hooks/useAgents.js';
import { useProjects } from '../hooks/useProjects.js';
import { useProjectLabels } from '../hooks/useProjectLabels.js';
import { useSettings } from '../hooks/useSettings.js';
import { useSearch, useDebouncedValue } from '../hooks/useSearch.js';
import { useToast } from '../hooks/useToast.js';
import { ATLAS_PALETTE } from '../theme/tokens.js';
import { SearchModeToggle, type SearchMode } from './search/SearchModeToggle.js';
import { SearchFilterBuilder } from './search/SearchFilterBuilder.js';
import { SearchQueryInput } from './search/SearchQueryInput.js';
import { SearchResults, type SortKey } from './search/SearchResults.js';
import { SearchEmptyState } from './search/SearchEmptyState.js';
import {
    parseQuery,
    groupByType,
    EMPTY_FILTERS,
    filtersToServerArgs,
    serverRowToHit,
    promptHits,
    type FilterState,
    type SearchHit,
    type SearchType,
} from './search/searchViewModel.js';
import { useSetPageTitle } from '../components/shell/index.js';

// P14 — the page now sources hits from `GET /api/search` (Postgres FTS +
// filter pushdown) instead of building a client-side corpus from every
// epic/story/bug/sub-task/sub-bug. Filter chips translate into query-
// string flags; the text input is debounced so we don't fire a request
// per keystroke. Prompts live on the agents table (not items.search_tsv)
// so they're still filtered client-side and mixed into the result set.
export function Search() {
    useSetPageTitle('Search');
    const toast = useToast();
    const [urlParams, setUrlParams] = useSearchParams();
    const { data: agents = [] } = useAgents();
    const { data: projects = [] } = useProjects();
    const { data: settings } = useSettings();
    // Task 2 — label suggestions for the Labels filter chip; the Search
    // surface always wants workspace-wide suggestions, so opt in explicitly
    // (otherwise the hook stays disabled while `projectId` is undefined).
    const { data: projectLabels } = useProjectLabels(undefined, { workspace: true });

    const initialQ = urlParams.get('q') ?? '';
    const [mode, setMode] = useState<SearchMode>('filters');
    const [filters, setFilters] = useState<FilterState>({ ...EMPTY_FILTERS, text: initialQ });
    const [queryStr, setQueryStr] = useState('');
    const [committedQuery, setCommittedQuery] = useState('');
    const [sort, setSort] = useState<SortKey>('updated_desc');

    const ownerName = settings?.owner_name ?? 'Owner';

    // Debounce `?q=…` URL sync so deep links work and reload preserves the query.
    const urlSyncTimer = useRef<number | null>(null);
    useEffect(() => {
        if (urlSyncTimer.current) window.clearTimeout(urlSyncTimer.current);
        urlSyncTimer.current = window.setTimeout(() => {
            const next = new URLSearchParams(urlParams);
            if (filters.text) next.set('q', filters.text);
            else next.delete('q');
            if (next.toString() !== urlParams.toString()) setUrlParams(next, { replace: true });
        }, 250);
        return () => {
            if (urlSyncTimer.current) window.clearTimeout(urlSyncTimer.current);
        };
        // urlParams intentionally omitted — we only react to filters.text and
        // serialize one direction. Adding it loops with setUrlParams.
    }, [filters.text]);

    const agentsById = useMemo(() => {
        const m = new Map<string, IAgent>();
        for (const w of agents) m.set(w.id, w);
        return m;
    }, [agents]);

    const projectNameById = useMemo(() => {
        const m = new Map<string, string>();
        for (const p of projects) m.set(p.id, p.name);
        return m;
    }, [projects]);

    const queryParse = useMemo(
        () => parseQuery(committedQuery, { projects, agents, ownerName }),
        [committedQuery, projects, agents, ownerName]
    );

    const activeFilters: FilterState =
        mode === 'filters' ? filters : queryParse.ok ? queryParse.filters : EMPTY_FILTERS;

    // Debounce the *filter values* that feed the server hook so a user
    // typing in the text input doesn't fire one /api/search per keystroke.
    // 250ms matches the URL-sync debounce above and keeps the page feeling
    // live without flooding the server.
    const debouncedFilters = useDebouncedValue(activeFilters, 250);

    const serverArgs = useMemo(() => filtersToServerArgs(debouncedFilters), [debouncedFilters]);
    const { data: serverRows, isFetching } = useSearch(serverArgs);

    const results: SearchHit[] = useMemo(() => {
        const itemHits = serverRows.map(serverRowToHit);
        // Prompts aren't in the items FTS — combine the local prompt hits
        // (filtered the same way) so the UI keeps showing them.
        const prompts = promptHits(agents, debouncedFilters);
        return [...itemHits, ...prompts];
    }, [serverRows, agents, debouncedFilters]);

    const grouped = useMemo(() => groupByType(results), [results]);
    const typesPresent = useMemo(() => Array.from(grouped.keys()).length, [grouped]);

    function dropStatus() {
        if (mode === 'filters') setFilters({ ...filters, status: 'any' });
        else {
            const next = committedQuery
                .replace(/\s*AND\s+status\s*=\s*"[^"]*"/i, '')
                .replace(/^\s*status\s*=\s*"[^"]*"\s*(AND\s+)?/i, '');
            setQueryStr(next);
            setCommittedQuery(next);
        }
    }

    function dropProject() {
        if (mode === 'filters') setFilters({ ...filters, projectIds: [] });
        else {
            const next = committedQuery
                .replace(/\s*AND\s+project\s*=\s*[^\s]+/i, '')
                .replace(/^\s*project\s*=\s*[^\s]+\s*(AND\s+)?/i, '');
            setQueryStr(next);
            setCommittedQuery(next);
        }
    }

    function createType(_type: SearchType) {
        toast.show({ message: 'Create from search is not wired up yet.' });
    }

    return (
        <Box sx={{ px: { xs: 3, md: 8 }, py: 4 }}>
            {/* Header */}
            <Box sx={{ mb: 5 }}>
                <Box
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 4,
                        flexWrap: 'wrap',
                    }}
                >
                    <Typography
                        variant="h1"
                        sx={{
                            fontSize: '2.25rem',
                            fontWeight: 700,
                            lineHeight: 1.2,
                            letterSpacing: '-0.01em',
                            color: ATLAS_PALETTE.slate,
                        }}
                    >
                        Search
                    </Typography>
                    <SearchModeToggle mode={mode} onChange={setMode} />
                </Box>
                <Typography sx={{ fontSize: 14, color: ATLAS_PALETTE.slate60, mt: 1.5 }}>
                    Across{' '}
                    <Box component="b" sx={{ fontWeight: 600, color: ATLAS_PALETTE.slate }}>
                        epics
                    </Box>
                    ,{' '}
                    <Box component="b" sx={{ fontWeight: 600, color: ATLAS_PALETTE.slate }}>
                        stories
                    </Box>
                    ,{' '}
                    <Box component="b" sx={{ fontWeight: 600, color: ATLAS_PALETTE.slate }}>
                        bugs
                    </Box>
                    ,{' '}
                    <Box component="b" sx={{ fontWeight: 600, color: ATLAS_PALETTE.slate }}>
                        sub-tasks
                    </Box>
                    ,{' '}
                    <Box component="b" sx={{ fontWeight: 600, color: ATLAS_PALETTE.slate }}>
                        sub-bugs
                    </Box>
                    ,{' '}
                    <Box component="b" sx={{ fontWeight: 600, color: ATLAS_PALETTE.slate }}>
                        prompts
                    </Box>
                    , and{' '}
                    <Box component="b" sx={{ fontWeight: 600, color: ATLAS_PALETTE.slate }}>
                        conversation history
                    </Box>
                    .
                    {isFetching ? (
                        <Box
                            component="span"
                            sx={{ ml: 1, fontSize: 12, color: ATLAS_PALETTE.slate60 }}
                        >
                            · searching…
                        </Box>
                    ) : null}
                </Typography>
            </Box>

            <Box sx={{ mb: 4 }}>
                <SearchTextInput
                    value={filters.text}
                    onChange={(next) => setFilters((prev) => ({ ...prev, text: next }))}
                    label="Search by title, description, or ID…"
                />
            </Box>

            {mode === 'filters' ? (
                <SearchFilterBuilder
                    filters={filters}
                    setFilters={setFilters}
                    projects={projects}
                    resultCount={results.length}
                    resultTypeCount={typesPresent}
                    availableLabels={projectLabels?.labels ?? []}
                />
            ) : (
                <SearchQueryInput
                    query={queryStr}
                    setQuery={(q) => {
                        setQueryStr(q);
                        setCommittedQuery(q);
                    }}
                    projects={projects}
                    agents={agents}
                    ownerName={ownerName}
                    onSubmit={() => setCommittedQuery(queryStr)}
                    resultCount={results.length}
                    resultTypeCount={typesPresent}
                />
            )}

            {results.length === 0 ? (
                <SearchEmptyState
                    filters={activeFilters}
                    queryText={mode === 'query' ? committedQuery : null}
                    onDropStatus={dropStatus}
                    onDropProject={dropProject}
                    onCreateType={createType}
                />
            ) : (
                <SearchResults
                    hits={results}
                    agentsById={agentsById}
                    projectNameById={projectNameById}
                    highlightText={activeFilters.text}
                    sort={sort}
                    onSortChange={setSort}
                />
            )}
        </Box>
    );
}
