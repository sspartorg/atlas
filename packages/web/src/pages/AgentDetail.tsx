import { useCallback, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTabParam } from '../hooks/useTabParam.js';
import Box from '@mui/material/Box';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import { useQueryClient, useIsFetching } from '@tanstack/react-query';
import { ATLAS_PALETTE } from '../theme/tokens.js';
import { useAgent, useUpdateAgent, useAgentRuns, useAgents, useAgentMemory } from '../hooks/useAgents.js';
import { RefreshButton } from '../components/index.js';
import { useToast } from '../hooks/useToast.js';
import { api } from '../api/api.js';
import { CATEGORY_LABEL, getRuntimeStats, getAgentView } from './agents/agentViewModel.js';
import { AgentBreadcrumbs } from './agents/AgentBreadcrumbs.js';
import { AgentHero } from './agents/AgentHero.js';
import { AgentSidebar } from './agents/AgentSidebar.js';
import { OverviewTab } from './agents/OverviewTab.js';
import { PromptTab } from './agents/PromptTab.js';
import { HandoffsTab } from './agents/HandoffsTab.js';
import { TestRunTab } from './agents/TestRunTab.js';
import { RunsTab } from './agents/RunsTab.js';
import { MemoryTab } from './agents/MemoryTab.js';
import { RunNowDialog } from './agents/RunNowDialog.js';
import { DuplicateAgentModal } from './agents/DuplicateAgentModal.js';
import { EditAgentColorModal } from './agents/EditAgentColorModal.js';
import { GlyphPickerModal } from './agents/GlyphPickerModal.js';
import { DeleteAgentModal } from './agents/DeleteAgentModal.js';
import { MarketplaceUpgradeBanner } from './agents/MarketplaceUpgradeBanner.js';
import { useSetPageTitle } from '../components/shell/index.js';

const TAB_KEYS = [
    'overview',
    'prompt',
    'handoffs',
    'test',
    'runs',
    'memory',
] as const;
type TabKey = (typeof TAB_KEYS)[number];

export function AgentDetail() {
    const { id = '' } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const toast = useToast();
    const { data: agent, isLoading } = useAgent(id);
    const updateAgent = useUpdateAgent();
    const { data: runs } = useAgentRuns(id);
    const [duplicateOpen, setDuplicateOpen] = useState(false);
    const [runNowOpen, setRunNowOpen] = useState(false);
    const [colorOpen, setColorOpen] = useState(false);
    const [glyphOpen, setGlyphOpen] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [deleting, setDeleting] = useState(false);

    // Local-state-first tab via useTabParam: click → useState update → render in
    // a single React pass. URL sync happens in a useEffect after the swap, so
    // it never appears in the click-to-paint hot path.
    const [tab, setTab] = useTabParam<TabKey>(TAB_KEYS, 'overview');

    // Defer secondary queries until the Owner actually opens the consumer.
    // DuplicateAgentModal needs the full agent list for collision detection;
    // MemoryTab needs the agent's memory body. Neither is on the critical
    // overview path, so they're gated by their own open / tab state.
    const { data: allAgents = [] } = useAgents({ enabled: duplicateOpen });
    const { data: memory } = useAgentMemory(id, { enabled: tab === 'memory' });

    // Aggregate fetch indicator — used only to drive the RefreshButton's
    // spinning icon in the breadcrumb row. The previous LinearProgress under
    // the tab strip was removed (felt like a glitch on tab clicks).
    const fetchingCount = useIsFetching({ queryKey: ['agents', id] });

    const view = useMemo(() => (agent ? getAgentView(agent) : null), [agent]);
    const stats = useMemo(() => getRuntimeStats(runs), [runs]);

    useSetPageTitle(agent?.name ?? 'Agent', agent ? CATEGORY_LABEL[agent.category] : undefined);

    // Hooks below must stay above any early return — Rules of Hooks. `agent`
    // can be undefined on first paint; the handlers tolerate that with a guard.
    const isPaused = agent?.status === 'inactive';

    const handlePauseToggle = useCallback(() => {
        if (!agent) return;
        updateAgent.mutate(
            { id: agent.id, data: { status: isPaused ? 'active' : 'inactive' } },
            {
                onSuccess: () =>
                    toast.show({
                        message: isPaused ? `${agent.name} resumed` : `${agent.name} paused`,
                    }),
            }
        );
    }, [agent, isPaused, updateAgent, toast]);

    const handleRunNow = useCallback(() => setRunNowOpen(true), []);
    const handleDuplicate = useCallback(() => setDuplicateOpen(true), []);
    const handleDelete = useCallback(() => setDeleteOpen(true), []);
    const handleEditColor = useCallback(() => setColorOpen(true), []);
    const handleReplaceGlyph = useCallback(() => setGlyphOpen(true), []);
    const handleRefresh = useCallback(() => {
        void queryClient.invalidateQueries({ queryKey: ['agents', id] });
    }, [queryClient, id]);

    // Stable object identity so AgentHero (memo'd) doesn't tear down on every
    // parent re-render. handlePauseToggle is the only non-trivial dep.
    const handleExport = useCallback(() => {
        if (!agent) return;
        window.location.href = api.agents.exportZipUrl(agent.id);
    }, [agent]);

    const menuActions = useMemo(
        () => ({
            onDuplicate: handleDuplicate,
            onPause: handlePauseToggle,
            onDelete: handleDelete,
            onExport: handleExport,
        }),
        [handleDuplicate, handlePauseToggle, handleDelete, handleExport],
    );

    if (isLoading) {
        return (
            <Box sx={{ p: 8, display: 'flex', justifyContent: 'center' }}>
                <CircularProgress size={32} sx={{ color: ATLAS_PALETTE.brandBlue }} />
            </Box>
        );
    }

    if (!agent || !view) {
        return (
            <Box sx={{ px: { xs: 3, md: 8 }, py: 4 }}>
                <Typography sx={{ fontSize: 16, color: ATLAS_PALETTE.slate60 }}>
                    Agent not found.
                </Typography>
            </Box>
        );
    }

    function confirmDelete() {
        if (!agent) return;
        setDeleting(true);
        void api.agents
            .delete(agent.id)
            .then(() => {
                void queryClient.invalidateQueries({ queryKey: ['agents'] });
                toast.show({ message: `${agent.name} deleted` });
                setDeleteOpen(false);
                navigate('/agents');
            })
            .catch((e: Error) => {
                toast.show({ message: 'Could not delete agent', detail: e.message });
            })
            .finally(() => setDeleting(false));
    }

    return (
        <Box sx={{ px: { xs: 3, md: 8 }, py: 4 }}>
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    mb: 1,
                }}
            >
                <AgentBreadcrumbs
                    category={CATEGORY_LABEL[agent.category]}
                    agentName={agent.name}
                />
                <RefreshButton
                    onRefresh={handleRefresh}
                    isFetching={fetchingCount > 0}
                    tooltipLabel="Refresh agent data"
                />
            </Box>

            <AgentHero
                agent={agent}
                view={view}
                stats={stats}
                onRunNow={handleRunNow}
                onPauseToggle={handlePauseToggle}
                menuActions={menuActions}
            />

            <MarketplaceUpgradeBanner agent={agent} />

            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: {
                        xs: 'minmax(0, 1fr)',
                        md: 'minmax(0, 1fr) 300px',
                    },
                    gap: 4,
                    alignItems: 'flex-start',
                }}
            >
                <Box>
                    <Box sx={{ borderBottom: `1px solid ${ATLAS_PALETTE.slate10}`, mb: 4 }}>
                        <Tabs
                            value={tab}
                            onChange={(_, v: TabKey) => setTab(v)}
                            variant="scrollable"
                            scrollButtons={false}
                            allowScrollButtonsMobile
                            sx={{
                                minHeight: 42,
                                '& .MuiTabs-indicator': {
                                    backgroundColor: ATLAS_PALETTE.brandBlue,
                                    height: 2,
                                },
                                '& .MuiTab-root': {
                                    minHeight: 42,
                                    textTransform: 'none',
                                    fontWeight: 500,
                                    fontSize: 13.5,
                                    color: ATLAS_PALETTE.slate60,
                                    px: 2,
                                    '&.Mui-selected': {
                                        color: ATLAS_PALETTE.brandBlue,
                                        fontWeight: 600,
                                    },
                                },
                            }}
                        >
                            <Tab
                                value="overview"
                                label="Overview"
                                icon={
                                    <Box
                                        component="span"
                                        className="material-symbols-rounded"
                                        sx={{ fontSize: 16 }}
                                    >
                                        info
                                    </Box>
                                }
                                iconPosition="start"
                            />
                            <Tab
                                value="prompt"
                                label="Prompt"
                                icon={
                                    <Box
                                        component="span"
                                        className="material-symbols-rounded"
                                        sx={{ fontSize: 16 }}
                                    >
                                        article
                                    </Box>
                                }
                                iconPosition="start"
                            />
                            <Tab
                                value="handoffs"
                                label="Handoffs"
                                icon={
                                    <Box
                                        component="span"
                                        className="material-symbols-rounded"
                                        sx={{ fontSize: 16 }}
                                    >
                                        fork_right
                                    </Box>
                                }
                                iconPosition="start"
                            />
                            <Tab
                                value="test"
                                label="Test Run"
                                icon={
                                    <Box
                                        component="span"
                                        className="material-symbols-rounded"
                                        sx={{ fontSize: 16 }}
                                    >
                                        terminal
                                    </Box>
                                }
                                iconPosition="start"
                            />
                            <Tab
                                value="runs"
                                label="Runs"
                                icon={
                                    <Box
                                        component="span"
                                        className="material-symbols-rounded"
                                        sx={{ fontSize: 16 }}
                                    >
                                        history
                                    </Box>
                                }
                                iconPosition="start"
                            />
                            <Tab
                                value="memory"
                                label="Memory"
                                icon={
                                    <Box
                                        component="span"
                                        className="material-symbols-rounded"
                                        sx={{ fontSize: 16 }}
                                    >
                                        psychology
                                    </Box>
                                }
                                iconPosition="start"
                            />
                        </Tabs>
                    </Box>

                    {tab === 'overview' && <OverviewTab agent={agent} view={view} />}
                    {tab === 'prompt' && <PromptTab agent={agent} />}
                    {tab === 'handoffs' && <HandoffsTab agent={agent} />}
                    {tab === 'test' && <TestRunTab agent={agent} view={view} />}
                    {tab === 'runs' && <RunsTab agent={agent} runs={runs ?? []} />}
                    {tab === 'memory' && <MemoryTab agent={agent} memory={memory} />}
                </Box>

                <Box sx={{ position: { xs: 'static', md: 'sticky' }, top: 24 }}>
                    <AgentSidebar
                        agent={agent}
                        view={view}
                        stats={stats}
                        onEditColor={handleEditColor}
                        onReplaceGlyph={handleReplaceGlyph}
                    />
                </Box>
            </Box>

            {/* Conditionally mount modals so their internal hooks (RunNowDialog
                pulls /api/projects + /api/epics + /api/stories + /api/bugs;
                DuplicateAgentModal needs the full agent list) don't fire until
                the Owner actually opens them. Each modal still gets its
                expected `open` prop in case React Query needs it for warmup. */}
            {duplicateOpen && (
                <DuplicateAgentModal
                    open
                    agent={agent}
                    existingIds={allAgents.map((w) => w.id)}
                    onClose={() => setDuplicateOpen(false)}
                />
            )}

            {runNowOpen && (
                <RunNowDialog open agent={agent} onClose={() => setRunNowOpen(false)} />
            )}

            {colorOpen && (
                <EditAgentColorModal open agent={agent} onClose={() => setColorOpen(false)} />
            )}

            {glyphOpen && (
                <GlyphPickerModal
                    open
                    agent={agent}
                    currentGlyph={view.glyph}
                    onClose={() => setGlyphOpen(false)}
                />
            )}

            {deleteOpen && (
                <DeleteAgentModal
                    open
                    agent={agent}
                    busy={deleting}
                    onConfirm={confirmDelete}
                    onClose={() => setDeleteOpen(false)}
                />
            )}
        </Box>
    );
}
