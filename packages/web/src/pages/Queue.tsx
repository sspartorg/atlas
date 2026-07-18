import { Suspense, useMemo, useState } from 'react';
import { lazyNamed } from '../utils/lazyNamed.js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Skeleton from '@mui/material/Skeleton';
import type { IAgent, IAgentRun } from '@atlas/shared';
import { useStories } from '../hooks/useStories.js';
import { useBugs } from '../hooks/useBugs.js';
import { useAgents, useUpdateAgent } from '../hooks/useAgents.js';
import { useEpics } from '../hooks/useEpics.js';
import { useProjects } from '../hooks/useProjects.js';
import { useToast } from '../hooks/useToast.js';
import { api } from '../api/api.js';
import { ATLAS_PALETTE } from '../theme/tokens.js';
import { QueueFiltersBar, type QueueFilterKey } from './queue/QueueFiltersBar.js';
import { QueueAgentCard } from './queue/QueueAgentCard.js';
import { QueueWaitingOnYou } from './queue/QueueWaitingOnYou.js';
const QueueAgentDrawer = lazyNamed(
    () => import('./queue/QueueAgentDrawer.js'),
    'QueueAgentDrawer',
);
import {
    buildQueueItems,
    isWaitingStatus,
    summarizeAgents,
    getAgentStatusLabel,
    lastRunErrored,
} from './queue/queueViewModel.js';
import { useSetPageTitle } from '../components/shell/index.js';

export function Queue() {
    useSetPageTitle('Queue');
    const queryClient = useQueryClient();
    const toast = useToast();
    const { data: stories = [], isLoading: storiesLoading } = useStories();
    const { data: bugs = [], isLoading: bugsLoading } = useBugs();
    const { data: epics = [], isLoading: epicsLoading } = useEpics();
    const { data: agents = [], isLoading: agentsLoading } = useAgents();
    const { data: projects = [] } = useProjects();
    const updateAgent = useUpdateAgent();

    const runsQuery = useQuery({
        // Shared cache key with Agents.tsx — both pages need the same
        // recent-runs payload, no point fetching twice.
        queryKey: ['runs', 'all'],
        queryFn: () => api.run.list({ limit: 500 }),
        staleTime: 30_000,
    });

    const [activeFilters, setActiveFilters] = useState<Set<QueueFilterKey>>(new Set());
    const [drawerAgent, setDrawerAgent] = useState<IAgent | null>(null);

    const projectNameById = useMemo(() => {
        const m = new Map<string, string>();
        for (const p of projects) m.set(p.id, p.name);
        return m;
    }, [projects]);

    const projectIdByEpic = useMemo(() => {
        const m = new Map<string, string | null>();
        for (const e of epics) m.set(e.id, e.project_id ?? null);
        return m;
    }, [epics]);

    const projectIdByStory = useMemo(() => {
        const m = new Map<string, string | null>();
        for (const s of stories) m.set(s.id, projectIdByEpic.get(s.epic_id) ?? null);
        return m;
    }, [stories, projectIdByEpic]);

    const items = useMemo(
        () => buildQueueItems({ epics, stories, bugs, projectIdByStory, projectIdByEpic }),
        [epics, stories, bugs, projectIdByStory, projectIdByEpic]
    );

    const itemsById = useMemo(() => {
        const m = new Map<string, ReturnType<typeof buildQueueItems>[number]>();
        for (const it of items) m.set(it.id, it);
        return m;
    }, [items]);

    const runsByAgent = useMemo(() => {
        const m = new Map<string, IAgentRun[]>();
        for (const r of runsQuery.data ?? []) {
            const arr = m.get(r.agent_id) ?? [];
            arr.push(r);
            m.set(r.agent_id, arr);
        }
        return m;
    }, [runsQuery.data]);

    const agentsById = useMemo(() => {
        const m = new Map<string, IAgent>();
        for (const w of agents) m.set(w.id, w);
        return m;
    }, [agents]);

    const summaries = useMemo(
        () => summarizeAgents({ agents, items, runsByAgent, itemsById }),
        [agents, items, runsByAgent, itemsById]
    );

    const statusLabelByAgent = useMemo(() => {
        const m = new Map<string, ReturnType<typeof getAgentStatusLabel>>();
        for (const s of summaries) {
            const failed = lastRunErrored(s.lastRun);
            m.set(s.agent.id, getAgentStatusLabel(s, failed));
        }
        return m;
    }, [summaries]);

    const totals = useMemo(() => {
        let running = 0,
            queued = 0,
            waiting = 0,
            idle = 0,
            failed = 0;
        for (const s of summaries) {
            const label = statusLabelByAgent.get(s.agent.id) ?? 'Idle';
            if (label === 'Running') running += 1;
            else if (label === 'Failed') failed += 1;
            else if (label === 'Paused') idle += 1;
            else idle += 1;
            queued += s.queued.length;
        }
        waiting = items.filter((i) => isWaitingStatus(i.status as string)).length;
        return { running, queued, waiting, idle, failed };
    }, [summaries, statusLabelByAgent, items]);

    const waitingItems = useMemo(
        () =>
            items
                .filter((i) => isWaitingStatus(i.status as string))
                .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
        [items]
    );

    // Apply filter set: an empty set = show all agents. Otherwise keep agents
    // whose computed status falls in the active set, or whose queue/waiting state
    // matches a filter (e.g. `queued` shows any agent with queued items).
    const visibleSummaries = useMemo(() => {
        if (activeFilters.size === 0) return summaries;
        return summaries.filter((s) => {
            const label = statusLabelByAgent.get(s.agent.id) ?? 'Idle';
            if (activeFilters.has('running') && label === 'Running') return true;
            if (activeFilters.has('failed') && label === 'Failed') return true;
            if (activeFilters.has('idle') && (label === 'Idle' || label === 'Paused')) return true;
            if (activeFilters.has('queued') && s.queued.length > 0) return true;
            if (
                activeFilters.has('waiting') &&
                s.queued.some((q) => isWaitingStatus(q.status as string))
            )
                return true;
            return false;
        });
    }, [summaries, statusLabelByAgent, activeFilters]);

    function toggleFilter(k: QueueFilterKey) {
        setActiveFilters((prev) => {
            const next = new Set(prev);
            if (next.has(k)) next.delete(k);
            else next.add(k);
            return next;
        });
    }

    function handlePauseAll() {
        const targets = agents.filter((w) => w.status === 'active');
        if (targets.length === 0) {
            toast.show({ message: 'No active agents to pause.' });
            return;
        }
        Promise.all(targets.map((w) => api.agents.update(w.id, { status: 'inactive' })))
            .then(() => queryClient.invalidateQueries({ queryKey: ['agents'] }))
            .then(() =>
                toast.show({
                    message: `Paused ${targets.length} agent${targets.length === 1 ? '' : 's'}`,
                })
            )
            .catch((err: Error) => toast.show({ message: 'Pause failed', detail: err.message }));
    }

    function handleTogglePause(agent: IAgent) {
        const nextStatus = agent.status === 'active' ? 'inactive' : 'active';
        updateAgent.mutate(
            { id: agent.id, data: { status: nextStatus } },
            {
                onSuccess: () =>
                    toast.show({
                        message:
                            nextStatus === 'inactive'
                                ? `${agent.name} paused`
                                : `${agent.name} resumed`,
                    }),
            }
        );
    }

    const isLoading = storiesLoading || bugsLoading || agentsLoading || epicsLoading;

    const drawerSummary = drawerAgent
        ? (summaries.find((s) => s.agent.id === drawerAgent.id) ?? null)
        : null;
    const drawerStatus = drawerAgent
        ? (statusLabelByAgent.get(drawerAgent.id) ?? 'Idle')
        : 'Idle';

    return (
        <Box sx={{ px: { xs: 3, md: 8 }, py: 4 }}>
            {/* Header */}
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 4, mb: 5 }}>
                <Box sx={{ flex: 1 }}>
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
                        Queue
                    </Typography>
                </Box>
                <Button
                    variant="outlined"
                    size="small"
                    onClick={handlePauseAll}
                    startIcon={
                        <Box
                            component="span"
                            className="material-symbols-rounded"
                            sx={{ fontSize: 16 }}
                        >
                            pause
                        </Box>
                    }
                    sx={{ height: 36, fontSize: 12, textTransform: 'none' }}
                >
                    Pause All Agents
                </Button>
            </Box>

            <QueueFiltersBar
                filters={[
                    {
                        key: 'running' as const,
                        label: 'running',
                        count: totals.running,
                        color: ATLAS_PALETTE.green,
                    },
                    {
                        key: 'queued' as const,
                        label: 'queued across agents',
                        count: totals.queued,
                        color: ATLAS_PALETTE.brandBlue,
                    },
                    {
                        key: 'waiting' as const,
                        label: 'waiting on you',
                        count: totals.waiting,
                        color: ATLAS_PALETTE.orange,
                    },
                    {
                        key: 'idle' as const,
                        label: 'idle',
                        count: totals.idle,
                        color: ATLAS_PALETTE.slate60,
                    },
                    {
                        key: 'failed' as const,
                        label: 'failed',
                        count: totals.failed,
                        color: ATLAS_PALETTE.error,
                    },
                ]}
                active={activeFilters}
                onToggle={toggleFilter}
                onRefresh={async () => {
                    await Promise.all([
                        queryClient.invalidateQueries({ queryKey: ['runs'] }),
                        queryClient.invalidateQueries({ queryKey: ['stories'] }),
                        queryClient.invalidateQueries({ queryKey: ['bugs'] }),
                        queryClient.invalidateQueries({ queryKey: ['epics'] }),
                        queryClient.invalidateQueries({ queryKey: ['agents'] }),
                        queryClient.invalidateQueries({ queryKey: ['projects'] }),
                    ]);
                    toast.show({ message: 'Queue refreshed' });
                }}
            />

            {/* Agents section header */}
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 2, mb: 3 }}>
                <Typography
                    sx={{
                        fontSize: 12,
                        fontWeight: 600,
                        letterSpacing: '.06em',
                        textTransform: 'uppercase',
                        color: ATLAS_PALETTE.slate60,
                    }}
                >
                    Agents
                    <Box
                        component="span"
                        sx={{ ml: 1, fontWeight: 500, color: ATLAS_PALETTE.slate30 }}
                    >
                        {visibleSummaries.length}
                    </Box>
                </Typography>
                <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>
                    each agent has its own queue · click open to see live run and what&apos;s up
                    next
                </Typography>
            </Box>

            {/* Agent grid */}
            {isLoading ? (
                <Box
                    sx={{
                        display: 'grid',
                        gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
                        gap: 3,
                    }}
                >
                    {Array.from({ length: 6 }).map((_, i) => (
                        <Skeleton
                            key={i}
                            variant="rectangular"
                            height={240}
                            sx={{ borderRadius: '12px' }}
                        />
                    ))}
                </Box>
            ) : visibleSummaries.length === 0 ? (
                <Box
                    sx={{
                        background: ATLAS_PALETTE.white,
                        border: `1px dashed ${ATLAS_PALETTE.slate12}`,
                        borderRadius: '12px',
                        p: 6,
                        textAlign: 'center',
                    }}
                >
                    <Typography sx={{ fontSize: 14, color: ATLAS_PALETTE.slate60 }}>
                        No agents match the active filters.
                    </Typography>
                </Box>
            ) : (
                <Box
                    sx={{
                        display: 'grid',
                        gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
                        gap: 3,
                    }}
                >
                    {visibleSummaries.map((s) => (
                        <QueueAgentCard
                            key={s.agent.id}
                            summary={s}
                            statusLabel={statusLabelByAgent.get(s.agent.id) ?? 'Idle'}
                            projectNameById={projectNameById}
                            selected={drawerAgent?.id === s.agent.id}
                            onOpen={(w) => setDrawerAgent(w)}
                        />
                    ))}
                </Box>
            )}

            <QueueWaitingOnYou
                items={waitingItems}
                agentsById={agentsById}
                projectNameById={projectNameById}
            />

            {drawerAgent !== null && (
                <Suspense fallback={null}>
                    <QueueAgentDrawer
                        open
                        agent={drawerAgent}
                        summary={drawerSummary}
                        statusLabel={drawerStatus}
                        runs={runsByAgent.get(drawerAgent.id) ?? []}
                        itemsById={itemsById}
                        projectNameById={projectNameById}
                        onClose={() => setDrawerAgent(null)}
                        onPause={handleTogglePause}
                    />
                </Suspense>
            )}
        </Box>
    );
}
