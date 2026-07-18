import { Suspense, useMemo, useState } from 'react';
import { lazyNamed } from '../utils/lazyNamed.js';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import MuiPagination from '@mui/material/Pagination';
import { BrandedFallback } from '../components/BrandedFallback.js';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import AddRounded from '@mui/icons-material/AddRounded';
import { ATLAS_PALETTE } from '../theme/tokens.js';
import { useProjects, useProjectsPaged } from '../hooks/useProjects.js';
import { useEpics } from '../hooks/useEpics.js';
import { useStories } from '../hooks/useStories.js';
import { useAgents } from '../hooks/useAgents.js';
import { useSettings } from '../hooks/useSettings.js';
import { useToast } from '../hooks/useToast.js';
import { api } from '../api/api.js';
import { ViewToggle, type ProjectsView } from './projects/ViewToggle.js';
import { ProjectFilterChips, type FilterKey } from './projects/ProjectFilterChips.js';
import { ProjectCard } from './projects/ProjectCard.js';
import { ProjectsTable, type ProjectRow } from './projects/ProjectsTable.js';
import { useEnabledSchedules } from '../hooks/useProjectSchedule.js';
import { ProjectsEmptyState } from './projects/ProjectsEmptyState.js';
const NewProjectModal = lazyNamed(
    () => import('./projects/NewProjectModal.js'),
    'NewProjectModal',
);
const DeleteProjectModal = lazyNamed(
    () => import('./projects/DeleteProjectModal.js'),
    'DeleteProjectModal',
);
const RecloneProjectModal = lazyNamed(
    () => import('./projects/RecloneProjectModal.js'),
    'RecloneProjectModal',
);
const AutoFetchScheduleModal = lazyNamed(
    () => import('./projects/AutoFetchScheduleModal.js'),
    'AutoFetchScheduleModal',
);
import type { IProject, AgentCategory } from '@atlas/shared';
import { relativeTime } from '../utils/time.js';
import { PageFab, useSetPageTitle } from '../components/shell/index.js';
import { useIsMobile } from '../hooks/useIsMobile.js';

const MONO_FONT = '"JetBrains Mono", monospace';

export function Projects() {
    useSetPageTitle('Projects');
    const isMobileLayout = useIsMobile();
    const navigate = useNavigate();

    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(20);
    const paged = useProjectsPaged({ page, limit });
    const projects: IProject[] = paged.data?.rows ?? [];
    const totalProjects = paged.data?.total ?? 0;
    const isPending = paged.isPending;
    // Onboarding/sidebar still consumes the full list via useProjects(); we
    // also reuse it here as a fallback when the empty-state branch needs to
    // know whether ANY project exists across pages, not just the visible one.
    const { data: allProjectsForEmpty = [] } = useProjects();

    const { data: allEpics = [] } = useEpics();
    const { data: allStories = [] } = useStories();
    const { data: agents = [] } = useAgents();
    const { data: settings } = useSettings();

    const [view, setView] = useState<ProjectsView>('cards');
    const [filter, setFilter] = useState<FilterKey>('all');
    const [newProjectOpen, setNewProjectOpen] = useState(false);
    const [activeProject, setActiveProject] = useState<IProject | null>(null);
    const [activeAction, setActiveAction] = useState<'delete' | 'reclone' | 'schedule' | null>(
        null
    );
    const toast = useToast();
    const { map: scheduleMap } = useEnabledSchedules();

    const sortedProjects = useMemo(
        () => [...projects].sort((a, b) => a.created_at.localeCompare(b.created_at)),
        [projects]
    );
    // Project display id is the issue key prefix picked at create time
    // (e.g. "CER"), so it lines up with the issue ids (CER-1, CER-2, …).
    const displayIdById = useMemo(() => {
        const map = new Map<string, string>();
        for (const p of sortedProjects) map.set(p.id, p.issue_key_prefix);
        return map;
    }, [sortedProjects]);

    // Map agent.id → agent.category for joining via epics.
    const agentCategoryById = useMemo(() => {
        const map = new Map<string, AgentCategory>();
        agents.forEach((w) => map.set(w.id, w.category));
        return map;
    }, [agents]);

    // For each project, collect the set of agent categories that have epic assignments.
    // Best-effort: project owner relationship lands later; this proxies "queue" by category.
    const categoriesByProject = useMemo(() => {
        const map = new Map<string, Set<AgentCategory>>();
        allEpics.forEach((epic) => {
            if (!epic.assignee_agent_id) return;
            const category = agentCategoryById.get(epic.assignee_agent_id);
            if (!category) return;
            let set = map.get(epic.project_id);
            if (!set) {
                set = new Set();
                map.set(epic.project_id, set);
            }
            set.add(category);
        });
        return map;
    }, [allEpics, agentCategoryById]);

    const epicCountByProject = useMemo(() => {
        const map = new Map<string, number>();
        allEpics.forEach((e) => map.set(e.project_id, (map.get(e.project_id) ?? 0) + 1));
        return map;
    }, [allEpics]);

    const storyCountByProject = useMemo(() => {
        const epicToProject = new Map(allEpics.map((e) => [e.id, e.project_id]));
        const map = new Map<string, number>();
        allStories.forEach((s) => {
            const projectId = epicToProject.get(s.epic_id);
            if (!projectId) return;
            map.set(projectId, (map.get(projectId) ?? 0) + 1);
        });
        return map;
    }, [allEpics, allStories]);

    // Filter logic.
    function matchesFilter(projectId: string): boolean {
        if (filter === 'all' || filter === 'mine') return true; // mine == all (single-tenant; owner relationship TBD)
        return categoriesByProject.get(projectId)?.has(filter as AgentCategory) ?? false;
    }

    const filteredProjects = useMemo(
        () => sortedProjects.filter((p) => matchesFilter(p.id)),
        [sortedProjects, filter, categoriesByProject]
    );

    const counts: Record<FilterKey, number> = useMemo(() => {
        const byKey = (key: FilterKey) =>
            sortedProjects.filter((p) => {
                if (key === 'all' || key === 'mine') return true;
                return categoriesByProject.get(p.id)?.has(key as AgentCategory) ?? false;
            }).length;
        return {
            all: byKey('all'),
            mine: byKey('mine'),
            'software-dev': byKey('software-dev'),
            marketing: byKey('marketing'),
            content: byKey('content'),
            design: byKey('design'),
        };
    }, [sortedProjects, categoriesByProject]);

    const totalEpics = allEpics.length;
    const totalStories = allStories.length;

    // All hooks must be called above any conditional early return — React keys
    // hook state by call order, so a useMemo introduced after `if (isPending) return`
    // would break the hook count on the transition from loading → loaded.
    const projectById = useMemo(() => {
        const map = new Map<string, IProject>();
        projects.forEach((p) => map.set(p.id, p));
        return map;
    }, [projects]);

    // Rendered both as table rows AND as card-grid props, so the mapping ran
    // twice per render before. Re-derives only when its inputs change.
    const tableRows: ProjectRow[] = useMemo(
        () =>
            filteredProjects.map((p) => ({
                id: p.id,
                displayId: displayIdById.get(p.id) ?? '',
                name: p.name,
                gitPath: p.git_url
                    ? p.git_url.replace(/^https?:\/\//, '').replace(/\.git\/?$/, '')
                    : '',
                epics: epicCountByProject.get(p.id) ?? 0,
                stories: storyCountByProject.get(p.id) ?? 0,
                lastActivity: relativeTime(p.updated_at),
                updatedAt: p.updated_at,
            })),
        [filteredProjects, displayIdById, epicCountByProject, storyCountByProject],
    );

    // Loading: don't fall through to the empty state while data is undefined.
    if (isPending) {
        return (
            <Box sx={{ minHeight: '60vh', display: 'flex' }}>
                <BrandedFallback />
            </Box>
        );
    }

    const ownerName = settings?.owner_name ?? 'Owner';

    async function handleOpen(p: IProject) {
        try {
            const res = await api.projects.reveal(p.id);
            toast.show({ message: 'Opened in File Explorer', detail: res.path });
        } catch (err) {
            toast.show({
                message: 'Could not open File Explorer',
                detail: err instanceof Error ? err.message : 'Unknown error',
            });
        }
    }

    async function handleCopyUrl(p: IProject) {
        const url = p.git_url || '';
        try {
            await navigator.clipboard.writeText(url);
            toast.show({
                message: 'Repo URL copied',
                detail: url,
                action: {
                    label: 'Undo',
                    onClick: () => void navigator.clipboard.writeText('').catch(() => {}),
                },
            });
        } catch {
            toast.show({ message: 'Clipboard blocked', detail: 'Browser denied clipboard access' });
        }
    }

    function handleReclone(p: IProject) {
        setActiveProject(p);
        setActiveAction('reclone');
    }

    function handleScheduleFetch(p: IProject) {
        setActiveProject(p);
        setActiveAction('schedule');
    }

    function handleDelete(p: IProject) {
        setActiveProject(p);
        setActiveAction('delete');
    }

    function handleRowAction(id: string, kind: 'open' | 'copy' | 'reclone' | 'delete'): void {
        const p = projectById.get(id);
        // Defensive guard: `id` always comes from a rendered ProjectsTable row,
        // and every row's id is drawn from `tableRows` (filteredProjects ⊆
        // sortedProjects ⊆ projects) — the exact same `projects` array
        // `projectById` is built from in the same render. A row can therefore
        // never carry an id absent from projectById; confirmed empirically —
        // forcing the paged cache to empty mid-click unmounts the row/menu
        // before the click can land, so this can't be reached even via a
        // simulated background-data race.
        /* v8 ignore next */
        if (!p) return;
        if (kind === 'open') void handleOpen(p);
        else if (kind === 'copy') void handleCopyUrl(p);
        else if (kind === 'reclone') handleReclone(p);
        else handleDelete(p);
    }

    // The modal must render at a stable JSX position so it survives the
    // empty→populated transition. If it sat inside the empty branch only,
    // React would remount it after the first successful clone and wipe the
    // success view.
    const pageCount = Math.max(1, Math.ceil(totalProjects / limit));

    return (
        <>
            {totalProjects === 0 && allProjectsForEmpty.length === 0 ? (
                <ProjectsEmptyState onNewProject={() => setNewProjectOpen(true)} />
            ) : (
                <Box sx={{ px: { xs: 3, md: 8 }, py: 4 }}>
                    {/* Header */}
                    <Box
                        sx={{
                            display: 'flex',
                            alignItems: 'flex-end',
                            justifyContent: 'space-between',
                            gap: 4,
                            flexWrap: 'wrap',
                        }}
                    >
                        <Box>
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
                                Projects
                            </Typography>
                            <Typography
                                sx={{
                                    fontFamily: MONO_FONT,
                                    fontSize: '0.8125rem',
                                    color: ATLAS_PALETTE.slate60,
                                    mt: 2,
                                }}
                            >
                                {totalProjects} projects · {totalEpics} epics · {totalStories}{' '}
                                stories
                            </Typography>
                        </Box>
                        <Box
                            sx={{
                                display: { xs: 'none', md: 'flex' },
                                alignItems: 'center',
                                gap: 2,
                            }}
                        >
                            <ViewToggle value={view} onChange={setView} />
                            <Button
                                variant="contained"
                                color="success"
                                startIcon={<AddRounded />}
                                onClick={() => setNewProjectOpen(true)}
                                sx={{ textTransform: 'none', fontWeight: 600 }}
                            >
                                New Project
                            </Button>
                        </Box>
                    </Box>

                    {/* Filter chips */}
                    <Box sx={{ mt: 5 }}>
                        <ProjectFilterChips value={filter} onChange={setFilter} counts={counts} />
                    </Box>

                    {/* Cards or Table */}
                    <Box sx={{ mt: 6 }}>
                        {view === 'cards' || isMobileLayout ? (
                            filteredProjects.length === 0 ? (
                                <Box
                                    sx={{
                                        py: 16,
                                        textAlign: 'center',
                                        color: ATLAS_PALETTE.slate40,
                                    }}
                                >
                                    No projects match this filter.
                                </Box>
                            ) : (
                                <Box
                                    sx={{
                                        display: 'grid',
                                        gridTemplateColumns: {
                                            xs: '1fr',
                                            sm: '1fr 1fr',
                                            lg: 'repeat(3, 1fr)',
                                        },
                                        gap: 6,
                                    }}
                                >
                                    {filteredProjects.map((p) => (
                                        <Box
                                            key={p.id}
                                            sx={{
                                                transition:
                                                    'transform 150ms ease, box-shadow 150ms ease',
                                                '&:hover': { transform: 'translateY(-2px)' },
                                            }}
                                        >
                                            <ProjectCard
                                                project={p}
                                                displayId={displayIdById.get(p.id) ?? ''}
                                                epicCount={epicCountByProject.get(p.id) ?? 0}
                                                storyCount={storyCountByProject.get(p.id) ?? 0}
                                                scheduleInfo={scheduleMap.get(p.id)}
                                                onOpen={() => void handleOpen(p)}
                                                onCopyUrl={() => void handleCopyUrl(p)}
                                                onReclone={() => handleReclone(p)}
                                                onScheduleFetch={() => handleScheduleFetch(p)}
                                                onDelete={() => handleDelete(p)}
                                            />
                                        </Box>
                                    ))}
                                </Box>
                            )
                        ) : (
                            <ProjectsTable
                                rows={tableRows}
                                ownerName={ownerName}
                                scheduleMap={scheduleMap}
                                onRowClick={(id) => navigate(`/projects/${id}`)}
                                onOpen={(id) => handleRowAction(id, 'open')}
                                onCopyUrl={(id) => handleRowAction(id, 'copy')}
                                onReclone={(id) => handleRowAction(id, 'reclone')}
                                onScheduleFetch={(id) => {
                                    const p = projects.find((x) => x.id === id);
                                    if (p) handleScheduleFetch(p);
                                }}
                                onDelete={(id) => handleRowAction(id, 'delete')}
                            />
                        )}
                    </Box>

                    {/* Pagination footer — only renders when there's more than one page. */}
                    {totalProjects > limit && (
                        <Box
                            sx={{
                                mt: 6,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 3,
                                flexWrap: 'wrap',
                            }}
                        >
                            <Typography
                                sx={{
                                    fontFamily: MONO_FONT,
                                    fontSize: 12,
                                    color: ATLAS_PALETTE.slate60,
                                }}
                            >
                                Showing {(page - 1) * limit + 1}–
                                {Math.min(page * limit, totalProjects)} of {totalProjects}
                            </Typography>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                <FormControl size="small" sx={{ minWidth: 110 }}>
                                    <InputLabel id="projects-rows-per-page">Rows</InputLabel>
                                    <Select
                                        labelId="projects-rows-per-page"
                                        label="Rows"
                                        value={limit}
                                        onChange={(e) => {
                                            setLimit(Number(e.target.value));
                                            setPage(1);
                                        }}
                                    >
                                        {[10, 20, 50, 100].map((n) => (
                                            <MenuItem key={n} value={n}>
                                                {n}
                                            </MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>
                                <MuiPagination
                                    page={page}
                                    count={pageCount}
                                    onChange={(_e, v) => setPage(v)}
                                    color="primary"
                                    shape="rounded"
                                    showFirstButton
                                    showLastButton
                                />
                            </Box>
                        </Box>
                    )}
                </Box>
            )}
            {newProjectOpen && (
                <Suspense fallback={null}>
                    <NewProjectModal
                        open={newProjectOpen}
                        onClose={() => setNewProjectOpen(false)}
                    />
                </Suspense>
            )}
            <PageFab onClick={() => setNewProjectOpen(true)} label="New Project" />
            {activeAction === 'delete' && (
                <Suspense fallback={null}>
                    <DeleteProjectModal
                        open
                        project={activeProject}
                        // Defensive guard: this block only renders when activeAction ===
                        // 'delete', which handleDelete() always sets in the same call that
                        // sets activeProject to a real IProject; the two are reset together
                        // to null in onClose. activeProject is therefore always truthy
                        // whenever this ternary evaluates.
                        displayId={
                            /* v8 ignore next */
                            activeProject ? (displayIdById.get(activeProject.id) ?? '') : ''
                        }
                        onClose={() => {
                            setActiveAction(null);
                            setActiveProject(null);
                        }}
                    />
                </Suspense>
            )}
            {activeAction === 'reclone' && (
                <Suspense fallback={null}>
                    <RecloneProjectModal
                        open
                        project={activeProject}
                        // Defensive guard: this block only renders when activeAction ===
                        // 'reclone', which handleReclone() always sets in the same call
                        // that sets activeProject to a real IProject; the two are reset
                        // together to null in onClose. activeProject is therefore always
                        // truthy whenever this ternary evaluates.
                        displayId={
                            /* v8 ignore next */
                            activeProject ? (displayIdById.get(activeProject.id) ?? '') : ''
                        }
                        onClose={() => {
                            setActiveAction(null);
                            setActiveProject(null);
                        }}
                    />
                </Suspense>
            )}
            {activeAction === 'schedule' && (
                <Suspense fallback={null}>
                    <AutoFetchScheduleModal
                        open
                        project={activeProject}
                        onClose={() => {
                            setActiveAction(null);
                            setActiveProject(null);
                        }}
                    />
                </Suspense>
            )}
        </>
    );
}
