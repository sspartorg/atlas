import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import InputLabel from '@mui/material/InputLabel';
import FormControl from '@mui/material/FormControl';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import type { IAgent, IAgentRun, AgentCategory, AgentCli } from '@atlas/shared';
import { BRAND_SECONDARY_ACCENTS } from '@atlas/shared';
import { CLI_OPTIONS } from '../utils/cliPresentation.js';
import { AgentCard, ModelSelect } from '../components/index.js';
import { AccentColorPicker } from './settings/AccentColorPicker.js';
import { useAgents, useUpdateAgent } from '../hooks/useAgents.js';
import { useAgentFavorites } from '../hooks/useAgentFavorites.js';
import { useToast } from '../hooks/useToast.js';
import { api } from '../api/api.js';
import { ATLAS_PALETTE } from '../theme/tokens.js';
import { AgentListHeader } from './agents/AgentListHeader.js';
import { ImportAgentZipModal } from './agents/ImportAgentZipModal.js';
import {
    AgentFilterChips,
    type FilterKey,
    type RoleFilterKey,
    type SortKey,
} from './agents/AgentFilterChips.js';
import { AgentCategorySection } from './agents/AgentCategorySection.js';
import { AgentsEmptyState } from './agents/AgentsEmptyState.js';
import { AgentsErrorBanner } from './agents/AgentsErrorBanner.js';
import { DuplicateAgentModal } from './agents/DuplicateAgentModal.js';
import { DeleteAgentModal } from './agents/DeleteAgentModal.js';
import { CATEGORY_LABEL, getRuntimeStats } from './agents/agentViewModel.js';
import { PageFab, useSetPageTitle } from '../components/shell/index.js';

const CATEGORIES_ORDER: AgentCategory[] = ['software-dev', 'marketing', 'content', 'design'];

interface NewAgentForm {
    name: string;
    category: AgentCategory;
    cli: AgentCli;
    model: string;
    framework: string;
    accent_color: string;
}

/* v8 ignore next -- BRAND_SECONDARY_ACCENTS is a fixed non-empty 7-entry array (see packages/shared/src/constants/index.ts) with every entry carrying a valid `hex`; the `?.`/`??` fallbacks guard a shape that can never occur at this module-level constant. */
const DEFAULT_ACCENT = BRAND_SECONDARY_ACCENTS[0]?.hex ?? '#2E2E2E';

export function Agents() {
    useSetPageTitle('Agents');
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const toast = useToast();
    const { data: agents, isLoading, isError, refetch } = useAgents();
    const updateAgent = useUpdateAgent();
    const favorites = useAgentFavorites();

    const runsQuery = useQuery({
        // Share the cache key with Queue.tsx so navigating between Agents
        // and Queue doesn't refetch the same 500-row payload twice. SSE
        // invalidations from `agent_run_*` events still keep this live.
        queryKey: ['runs', 'all'],
        queryFn: () => api.run.list({ limit: 500 }),
        staleTime: 30_000,
    });

    // Marketplace summary list — used to surface a per-card "Upgrade" pill
    // when the catalog has moved ahead of the back-linked local agent. One
    // query for the whole page; the result is keyed by local agent id.
    const marketplaceQuery = useQuery({
        queryKey: ['marketplace', 'list', 'agents-page'],
        queryFn: () => api.marketplace.list({ limit: 100 }),
        staleTime: 60_000,
    });
    // Compute upgrade-available per LOCAL agent (not per catalog row), so
    // every linked fork independently lights up its own pill. The
    // marketplace summary's `installed_agent_id` only carries one of the
    // linked agents — if the Owner has installed the same catalog id under
    // multiple slugs, we need the per-agent version comparison.
    const catalogVersionById = useMemo(() => {
        const map = new Map<string, number>();
        for (const row of marketplaceQuery.data ?? []) {
            map.set(row.id, row.version);
        }
        return map;
    }, [marketplaceQuery.data]);
    const upgradeByAgentId = useMemo(() => {
        const map = new Map<string, boolean>();
        for (const a of agents ?? []) {
            if (!a.marketplace_source_id || a.marketplace_pulled_version == null) continue;
            const catalogVersion = catalogVersionById.get(a.marketplace_source_id);
            if (catalogVersion != null && a.marketplace_pulled_version < catalogVersion) {
                map.set(a.id, true);
            }
        }
        return map;
    }, [agents, catalogVersionById]);

    const [filter, setFilter] = useState<FilterKey>('all');
    // A08 — Role filter is a second axis on top of category. 'all' is
    // the no-op default; selecting a specific role narrows to agents
    // with that role_id (autonomous agents drop out unless 'all').
    const [roleFilter, setRoleFilter] = useState<RoleFilterKey>('all');
    const [sort, setSort] = useState<SortKey>('category-role');
    const [addOpen, setAddOpen] = useState(false);
    const [importOpen, setImportOpen] = useState(false);
    const [duplicateTarget, setDuplicateTarget] = useState<IAgent | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<IAgent | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [newAgent, setNewAgent] = useState<NewAgentForm>({
        name: '',
        category: 'software-dev',
        cli: 'claude',
        model: 'claude-sonnet-4-6',
        framework: '',
        accent_color: DEFAULT_ACCENT,
    });
    const [saving, setSaving] = useState(false);

    const runsByAgent = useMemo(() => {
        const map = new Map<string, IAgentRun[]>();
        for (const r of runsQuery.data ?? []) {
            const list = map.get(r.agent_id) ?? [];
            list.push(r);
            map.set(r.agent_id, list);
        }
        return map;
    }, [runsQuery.data]);

    const counts: Record<FilterKey, number> = useMemo(() => {
        const base: Record<FilterKey, number> = {
            all: agents?.length ?? 0,
            'software-dev': 0,
            marketing: 0,
            content: 0,
            design: 0,
            favorites: 0,
        };
        for (const w of agents ?? []) {
            base[w.category] += 1;
            if (favorites.isFav(w.id)) base.favorites += 1;
        }
        return base;
    }, [agents, favorites]);

    // A08 — Per-role counts for the Role dropdown. `all` is the total
    // agent count (matches `counts.all`). Each role bucket counts agents
    // whose `role_id` matches; autonomous agents (role_id === null) are
    // not counted in any specific role.
    const roleCounts: Record<RoleFilterKey, number> = useMemo(() => {
        const base: Record<RoleFilterKey, number> = {
            all: agents?.length ?? 0,
            po: 0,
            'spec-writer': 0,
            engineer: 0,
            qa: 0,
            architect: 0,
            tester: 0,
            automation: 0,
            devops: 0,
            security: 0,
            designer: 0,
        };
        for (const w of agents ?? []) {
            if (w.role_id) base[w.role_id] += 1;
        }
        return base;
    }, [agents]);

    const filtered = useMemo(() => {
        const all = agents ?? [];
        let result: IAgent[];
        if (filter === 'all') result = all;
        else if (filter === 'favorites') result = all.filter((w) => favorites.isFav(w.id));
        else result = all.filter((w) => w.category === filter);

        // A08 — Role narrows whatever the category filter left. Selecting
        // a role excludes autonomous agents (role_id null) entirely.
        if (roleFilter !== 'all') {
            result = result.filter((w) => w.role_id === roleFilter);
        }

        const sorted = [...result];
        sorted.sort((a, b) => {
            if (sort === 'role') return a.name.localeCompare(b.name);
            if (sort === 'last-run') {
                const la = getRuntimeStats(runsByAgent.get(a.id)).lastRunAt;
                const lb = getRuntimeStats(runsByAgent.get(b.id)).lastRunAt;
                if (la === lb) return a.name.localeCompare(b.name);
                if (!la) return 1;
                if (!lb) return -1;
                return new Date(lb).getTime() - new Date(la).getTime();
            }
            if (sort === 'queue-depth') {
                const qa = getRuntimeStats(runsByAgent.get(a.id)).queueDepth;
                const qb = getRuntimeStats(runsByAgent.get(b.id)).queueDepth;
                if (qa === qb) return a.name.localeCompare(b.name);
                return qb - qa;
            }
            const ca = CATEGORIES_ORDER.indexOf(a.category);
            const cb = CATEGORIES_ORDER.indexOf(b.category);
            if (ca !== cb) return ca - cb;
            return a.name.localeCompare(b.name);
        });
        return sorted;
    }, [agents, filter, roleFilter, sort, favorites, runsByAgent]);

    const grouped = useMemo(() => {
        if (sort !== 'category-role' || filter === 'favorites') return null;
        const buckets = new Map<AgentCategory, IAgent[]>();
        for (const w of filtered) {
            const arr = buckets.get(w.category) ?? [];
            arr.push(w);
            buckets.set(w.category, arr);
        }
        return CATEGORIES_ORDER.map((cat) => ({ cat, list: buckets.get(cat) ?? [] })).filter(
            (g) => g.list.length > 0
        );
    }, [filtered, sort, filter]);

    async function handleAddAgent() {
        setSaving(true);
        try {
            await api.agents.create({
                ...newAgent,
                sort_order: (agents?.length ?? 0) + 1,
            });
            await queryClient.invalidateQueries({ queryKey: ['agents'] });
            setAddOpen(false);
            setNewAgent({
                name: '',
                category: 'software-dev',
                cli: 'claude',
                model: 'claude-sonnet-4-6',
                framework: '',
                accent_color: DEFAULT_ACCENT,
            });
            toast.show({ message: 'Agent added' });
        } finally {
            setSaving(false);
        }
    }

    function handleCardMenu(agent: IAgent) {
        return {
            onDuplicate: () => setDuplicateTarget(agent),
            onPause: () =>
                updateAgent.mutate(
                    {
                        id: agent.id,
                        data: { status: agent.status === 'active' ? 'inactive' : 'active' },
                    },
                    {
                        onSuccess: () =>
                            toast.show({
                                message:
                                    agent.status === 'active'
                                        ? `${agent.name} paused`
                                        : `${agent.name} resumed`,
                            }),
                    }
                ),
            onDelete: () => setDeleteTarget(agent),
            onExport: () => {
                // Browsers prefer an anchor click for downloads — the API
                // endpoint streams the zip with Content-Disposition set.
                window.location.href = api.agents.exportZipUrl(agent.id);
            },
        };
    }

    const showError = !!runsQuery.error && !runsQuery.isLoading && !!agents && agents.length > 0;
    const installedCount = agents?.length ?? 0;
    const categoryCount = useMemo(
        () => new Set((agents ?? []).map((w) => w.category)).size,
        [agents]
    );

    return (
        <Box sx={{ px: { xs: 3, md: 8 }, py: 4 }}>
            <AgentListHeader
                installedCount={installedCount}
                categoryCount={categoryCount}
                onAdd={() => setAddOpen(true)}
                onImport={() => setImportOpen(true)}
            />

            {!isLoading && !isError && agents && agents.length > 0 ? (
                <AgentFilterChips
                    active={filter}
                    counts={counts}
                    onChange={setFilter}
                    sort={sort}
                    onSortChange={setSort}
                    role={roleFilter}
                    onRoleChange={setRoleFilter}
                    roleCounts={roleCounts}
                />
            ) : null}

            {showError ? (
                <AgentsErrorBanner
                    onRetry={() => {
                        void runsQuery.refetch();
                    }}
                />
            ) : null}

            {isLoading ? (
                <Box
                    sx={{
                        display: 'grid',
                        gridTemplateColumns: {
                            xs: '1fr',
                            sm: 'repeat(2, minmax(0, 1fr))',
                            md: 'repeat(3, minmax(0, 1fr))',
                            xl: 'repeat(4, minmax(0, 1fr))',
                        },
                        gap: 3,
                    }}
                >
                    {Array.from({ length: 6 }).map((_, i) => (
                        <Box
                            key={i}
                            sx={{
                                p: 3,
                                borderRadius: '12px',
                                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                                background: ATLAS_PALETTE.white,
                                minHeight: 196,
                            }}
                        >
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
                                <Skeleton
                                    variant="rectangular"
                                    width={36}
                                    height={36}
                                    sx={{ borderRadius: '8px' }}
                                />
                                <Skeleton variant="text" width="40%" height={18} />
                            </Box>
                            <Skeleton variant="text" width="90%" height={14} />
                            <Skeleton variant="text" width="60%" height={14} sx={{ mb: 2 }} />
                            <Skeleton
                                variant="rectangular"
                                width="100%"
                                height={60}
                                sx={{ borderRadius: '8px' }}
                            />
                        </Box>
                    ))}
                </Box>
            ) : isError ? (
                <Box
                    sx={{
                        border: `1px solid ${ATLAS_PALETTE.slate10}`,
                        borderRadius: '14px',
                        p: 6,
                        textAlign: 'center',
                        background: ATLAS_PALETTE.white,
                    }}
                >
                    <Typography
                        sx={{ fontSize: 15, fontWeight: 600, color: ATLAS_PALETTE.slate, mb: 1 }}
                    >
                        Couldn&apos;t load agents
                    </Typography>
                    <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60, mb: 3 }}>
                        The API is unreachable. Check the server and try again.
                    </Typography>
                    <Button
                        variant="outlined"
                        onClick={() => {
                            void refetch();
                        }}
                    >
                        Retry
                    </Button>
                </Box>
            ) : !agents || agents.length === 0 ? (
                <AgentsEmptyState onBrowse={() => navigate('/agents/marketplace')} />
            ) : filtered.length === 0 ? (
                <Box
                    sx={{
                        border: `1.5px dashed ${ATLAS_PALETTE.slate12}`,
                        borderRadius: '12px',
                        p: 6,
                        textAlign: 'center',
                    }}
                >
                    <Typography sx={{ fontSize: 14, color: ATLAS_PALETTE.slate60 }}>
                        {filter === 'favorites'
                            ? 'No favorites yet — tap the star on any agent to add it here.'
                            : 'No agents in this category yet.'}
                    </Typography>
                </Box>
            ) : grouped ? (
                grouped.map(({ cat, list }) => (
                    <AgentCategorySection
                        key={cat}
                        label={CATEGORY_LABEL[cat]}
                        count={list.length}
                    >
                        {list.map((w) => (
                            <AgentCard
                                key={w.id}
                                agent={w}
                                runs={runsByAgent.get(w.id) ?? []}
                                isFavorite={favorites.isFav(w.id)}
                                onToggleFavorite={() => favorites.toggle(w.id)}
                                onClick={() => navigate(`/agents/${w.id}`)}
                                menuActions={handleCardMenu(w)}
                                runtimeError={!!runsQuery.error}
                                upgradeAvailable={upgradeByAgentId.get(w.id) === true}
                            />
                        ))}
                    </AgentCategorySection>
                ))
            ) : (
                <Box
                    sx={{
                        display: 'grid',
                        gridTemplateColumns: {
                            xs: '1fr',
                            sm: 'repeat(2, minmax(0, 1fr))',
                            md: 'repeat(3, minmax(0, 1fr))',
                            xl: 'repeat(4, minmax(0, 1fr))',
                        },
                        gap: 3,
                    }}
                >
                    {filtered.map((w) => (
                        <AgentCard
                            key={w.id}
                            agent={w}
                            runs={runsByAgent.get(w.id) ?? []}
                            isFavorite={favorites.isFav(w.id)}
                            onToggleFavorite={() => favorites.toggle(w.id)}
                            onClick={() => navigate(`/agents/${w.id}`)}
                            menuActions={handleCardMenu(w)}
                            runtimeError={!!runsQuery.error}
                            upgradeAvailable={upgradeByAgentId.get(w.id) === true}
                        />
                    ))}
                </Box>
            )}

            {/* Conditionally mount so the modal's internal effects + queries
                only run when the Owner actually opens them. */}
            {duplicateTarget !== null && (
                <DuplicateAgentModal
                    open
                    agent={duplicateTarget}
                    /* v8 ignore next -- duplicateTarget is only ever set from a card's menu action, which requires `agents` to already be a populated, resolved array; refetchOnMount keeps `agents` defined (previous data) while this modal is mounted, so the `agents ?? []` nullish path can't occur through the UI. */
                    existingIds={(agents ?? []).map((w) => w.id)}
                    onClose={() => setDuplicateTarget(null)}
                />
            )}

            {deleteTarget !== null && (
                <DeleteAgentModal
                    open
                    agent={deleteTarget}
                    busy={deleting}
                    onClose={() => (deleting ? undefined : setDeleteTarget(null))}
                    onConfirm={() => {
                        const target = deleteTarget;
                        /* v8 ignore next -- this DeleteAgentModal only mounts while `deleteTarget !== null` (see the guard above), and `target` is captured from that same closure, so the falsy branch is an unreachable defensive fallback, not a live UI path. */
                        if (!target) return;
                        setDeleting(true);
                        void api.agents
                            .delete(target.id)
                            .then(() => {
                                void queryClient.invalidateQueries({ queryKey: ['agents'] });
                                toast.show({ message: `${target.name} deleted` });
                                setDeleteTarget(null);
                            })
                            .catch((e: Error) =>
                                toast.show({
                                    message: 'Could not delete agent',
                                    detail: e.message,
                                })
                            )
                            .finally(() => setDeleting(false));
                    }}
                />
            )}

            <Dialog open={addOpen} onClose={() => setAddOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle sx={{ fontSize: 18, fontWeight: 600, pb: 2 }}>Add Agent</DialogTitle>
                <DialogContent
                    sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                        // MUI sets pt:0 on DialogContent after a DialogTitle.
                        // The first TextField's floating label needs ~8px of
                        // clearance so it doesn't get clipped by the title row.
                        pt: '8px !important',
                    }}
                >
                    <TextField
                        label="Agent name"
                        fullWidth
                        value={newAgent.name}
                        onChange={(e) => setNewAgent((p) => ({ ...p, name: e.target.value }))}
                        placeholder="e.g. PO Writer · Frontend"
                        autoFocus
                    />
                    <FormControl fullWidth>
                        <InputLabel>Category</InputLabel>
                        <Select
                            value={newAgent.category}
                            label="Category"
                            onChange={(e) =>
                                setNewAgent((p) => ({
                                    ...p,
                                    category: e.target.value as AgentCategory,
                                }))
                            }
                        >
                            <MenuItem value="software-dev">Software dev</MenuItem>
                            <MenuItem value="marketing">Marketing</MenuItem>
                            <MenuItem value="content">Content</MenuItem>
                            <MenuItem value="design">Design</MenuItem>
                        </Select>
                    </FormControl>
                    <Box sx={{ display: 'flex', gap: 3 }}>
                        <FormControl fullWidth>
                            <InputLabel>CLI</InputLabel>
                            <Select
                                value={newAgent.cli}
                                label="CLI"
                                onChange={(e) =>
                                    setNewAgent((p) => ({
                                        ...p,
                                        cli: e.target.value as AgentCli,
                                    }))
                                }
                            >
                                {CLI_OPTIONS.map((opt) => (
                                    <MenuItem key={opt.value} value={opt.value}>
                                        {opt.label}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        <ModelSelect
                            cli={newAgent.cli}
                            value={newAgent.model}
                            onChange={(v) => setNewAgent((p) => ({ ...p, model: v }))}
                            fullWidth
                            showLabel
                            size="dialog"
                        />
                    </Box>
                    <Box>
                        <Typography
                            sx={{
                                fontSize: 12,
                                fontWeight: 500,
                                color: ATLAS_PALETTE.slate60,
                                mb: 2,
                            }}
                        >
                            Accent color
                        </Typography>
                        <AccentColorPicker
                            value={newAgent.accent_color}
                            onChange={(hex) =>
                                setNewAgent((p) => ({ ...p, accent_color: hex }))
                            }
                        />
                    </Box>
                </DialogContent>
                <DialogActions sx={{ px: 6, pb: 4, gap: 2 }}>
                    <Button variant="outlined" onClick={() => setAddOpen(false)}>
                        Cancel
                    </Button>
                    <Button
                        variant="contained"
                        onClick={() => void handleAddAgent()}
                        disabled={!newAgent.name.trim() || saving}
                    >
                        {saving ? 'Adding…' : 'Add Agent'}
                    </Button>
                </DialogActions>
            </Dialog>
            <ImportAgentZipModal
                open={importOpen}
                onClose={() => setImportOpen(false)}
                onImported={(agent) => {
                    setImportOpen(false);
                    toast.show({ message: `Imported ${agent.name}` });
                    navigate(`/agents/${agent.id}`);
                }}
            />
            <PageFab onClick={() => setAddOpen(true)} label="Add Agent" />
        </Box>
    );
}
