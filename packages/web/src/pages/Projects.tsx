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
import { useAllRepos } from '../hooks/useProjectRepos.js';
import { useTasks } from '../hooks/useTasks.js';
import { useAgents } from '../hooks/useAgents.js';
import { useSettings } from '../hooks/useSettings.js';
import { useToast } from '../hooks/useToast.js';
import { ViewToggle, type ProjectsView } from './projects/ViewToggle.js';
import { ProjectFilterChips, type FilterKey } from './projects/ProjectFilterChips.js';
import { ProjectCard, shortRemote } from './projects/ProjectCard.js';
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
import type { IProject, IProjectRepo, AgentCategory } from '@atlas/shared';
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

    // ADR 0018 — a project has 0..N equal repos. One round trip for the whole
    // page, grouped client-side: a per-card useProjectRepos would be an N+1.
    const { data: allRepos = [] } = useAllRepos();

    const { data: allTasks = [] } = useTasks();
    const { data: agents = [] } = useAgents();
    const { data: settings } = useSettings();

    const [view, setView] = useState<ProjectsView>('cards');
    const [filter, setFilter] = useState<FilterKey>('all');
    const [newProjectOpen, setNewProjectOpen] = useState(false);
    const [activeProject, setActiveProject] = useState<IProject | null>(null);
    const toast = useToast();
    const { map: scheduleMap } = useEnabledSchedules();

    const reposByProject = useMemo(() => {
        const map = new Map<string, IProjectRepo[]>();
        for (const repo of allRepos) {
            const list = map.get(repo.project_id);
            if (list) list.push(repo);
            else map.set(repo.project_id, [repo]);
        }
        return map;
    }, [allRepos]);

    // `scheduleMap` is keyed by repo; the list shows one badge per project, so
    // a project counts as scheduled as soon as any of its repos is.
    const scheduleByProject = useMemo(() => {
        const map = new Map<string, { preset: string; next_run_at: string | null }>();
        for (const repo of allRepos) {
            const schedule = scheduleMap.get(repo.id);
            if (schedule && !map.has(repo.project_id)) map.set(repo.project_id, schedule);
        }
        return map;
    }, [allRepos, scheduleMap]);

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

    // Map agent.id → agent.category for joining via tasks.
    const agentCategoryById = useMemo(() => {
        const map = new Map<string, AgentCategory>();
        agents.forEach((w) => map.set(w.id, w.category));
        return map;
    }, [agents]);

    // For each project, collect the set of agent categories that have task assignments.
    // Best-effort: project owner relationship lands later; this proxies "queue" by category.
    const categoriesByProject = useMemo(() => {
        const map = new Map<string, Set<AgentCategory>>();
        allTasks.forEach((task) => {
            if (!task.assignee_agent_id) return;
            const category = agentCategoryById.get(task.assignee_agent_id);
            if (!category) return;
            let set = map.get(task.project_id);
            if (!set) {
                set = new Set();
                map.set(task.project_id, set);
            }
            set.add(category);
        });
        return map;
    }, [allTasks, agentCategoryById]);

    const taskCountByProject = useMemo(() => {
        const map = new Map<string, number>();
        allTasks.forEach((t) => map.set(t.project_id, (map.get(t.project_id) ?? 0) + 1));
        return map;
    }, [allTasks]);

    const subTaskCountByProject = useMemo(() => {
        const map = new Map<string, number>();
        allTasks.forEach((t) =>
            map.set(t.project_id, (map.get(t.project_id) ?? 0) + t.sub_task_count),
        );
        return map;
    }, [allTasks]);

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

    const totalTasks = allTasks.length;
    const totalSubTasks = allTasks.reduce((n, t) => n + t.sub_task_count, 0);

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
            filteredProjects.map((p) => {
                const repos = reposByProject.get(p.id) ?? [];
                const first = repos[0];
                const extra = repos.length - 1;
                return {
                    id: p.id,
                    displayId: displayIdById.get(p.id) ?? '',
                    name: p.name,
                    gitPath: first?.git_url
                        ? `${shortRemote(first.git_url)}${extra > 0 ? ` +${extra}` : ''}`
                        : '',
                    tasks: taskCountByProject.get(p.id) ?? 0,
                    subTasks: subTaskCountByProject.get(p.id) ?? 0,
                    lastActivity: relativeTime(p.updated_at),
                    updatedAt: p.updated_at,
                };
            }),
        [
            filteredProjects,
            displayIdById,
            reposByProject,
            taskCountByProject,
            subTaskCountByProject,
        ],
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

    async function handleCopyUrl(p: IProject) {
        const url = reposByProject.get(p.id)?.[0]?.git_url ?? '';
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

    function handleDelete(p: IProject) {
        setActiveProject(p);
    }

    function handleRowAction(id: string, kind: 'copy' | 'delete'): void {
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
        if (kind === 'copy') void handleCopyUrl(p);
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
                                {totalProjects} {totalProjects === 1 ? 'project' : 'projects'} ·{' '}
                                {totalTasks} {totalTasks === 1 ? 'task' : 'tasks'} ·{' '}
                                {totalSubTasks} {totalSubTasks === 1 ? 'sub-task' : 'sub-tasks'}
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
                                                repos={reposByProject.get(p.id) ?? []}
                                                taskCount={taskCountByProject.get(p.id) ?? 0}
                                                subTaskCount={subTaskCountByProject.get(p.id) ?? 0}
                                                scheduleInfo={scheduleByProject.get(p.id)}
                                                onCopyUrl={() => void handleCopyUrl(p)}
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
                                scheduleMap={scheduleByProject}
                                onRowClick={(id) => navigate(`/projects/${id}`)}
                                onCopyUrl={(id) => handleRowAction(id, 'copy')}
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
            {activeProject && (
                <Suspense fallback={null}>
                    <DeleteProjectModal
                        open
                        project={activeProject}
                        displayId={displayIdById.get(activeProject.id) ?? ''}
                        onClose={() => setActiveProject(null)}
                    />
                </Suspense>
            )}
        </>
    );
}
