import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Skeleton from '@mui/material/Skeleton';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import {
    TaskFiltersBar,
    TaskTable,
    ViewModeToggle,
    WorkItemKanban,
    loadViewMode,
    saveViewMode,
    type TaskFilterKey,
    type ViewMode,
    type KanbanItem,
} from '../components/index.js';
import { useTasks, useTaskStats, useTransitionTask } from '../hooks/useTasks.js';
import { useProjects } from '../hooks/useProjects.js';
import { useAgents } from '../hooks/useAgents.js';
import { useSettings } from '../hooks/useSettings.js';
import { ATLAS_PALETTE } from '../theme/tokens.js';
import type { IssueStatus } from '@atlas/shared';
import { PageFab, useSetPageTitle } from '../components/shell/index.js';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { useToast } from '../hooks/useToast.js';

export function Tasks() {
    useSetPageTitle('Tasks');
    const navigate = useNavigate();
    const isMobile = useIsMobile();
    const toast = useToast();
    const qc = useQueryClient();
    const [params, setParams] = useSearchParams();
    const [viewMode, setViewMode] = useState<ViewMode>(() => loadViewMode('tasks'));
    const transitionTask = useTransitionTask();

    useEffect(() => {
        saveViewMode('tasks', viewMode);
    }, [viewMode]);

    const projectSlug = params.get('project');
    const statusFilter = params.get('status');
    const filterKey = (params.get('filter') as TaskFilterKey | null) ?? 'all';
    const searchQuery = params.get('q') ?? '';
    const showArchived = params.get('include_archived') === 'true';

    const { data: projects = [] } = useProjects();
    const { data: agents = [] } = useAgents();
    const { data: settings } = useSettings();

    const projectByName = useMemo(() => new Map(projects.map((p) => [p.name, p])), [projects]);
    const projectByIdMap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
    const projectId = projectSlug ? projectByName.get(projectSlug)?.id : undefined;

    const { data: scopedTasks = [], isLoading } = useTasks(projectId, showArchived);
    const { data: stats } = useTaskStats();

    const ownerName = settings?.owner_name ?? 'Owner';
    const ownerAccent = settings?.accent_color ?? ATLAS_PALETTE.slate;

    const filtered = useMemo(() => {
        return scopedTasks.filter((e) => {
            if (filterKey === 'mine' && e.assignee_agent_id !== null) return false;
            if (filterKey === 'ai' && e.assignee_agent_id === null) return false;
            if (statusFilter && e.status !== statusFilter) return false;
            if (searchQuery) {
                const q = searchQuery.toLowerCase();
                if (
                    !e.title.toLowerCase().includes(q) &&
                    !e.description.toLowerCase().includes(q)
                ) {
                    return false;
                }
            }
            return true;
        });
    }, [scopedTasks, filterKey, statusFilter, searchQuery]);

    const counts = useMemo<Record<TaskFilterKey, number>>(() => {
        const base = scopedTasks.filter((e) => {
            if (statusFilter && e.status !== statusFilter) return false;
            if (searchQuery) {
                const q = searchQuery.toLowerCase();
                if (
                    !e.title.toLowerCase().includes(q) &&
                    !e.description.toLowerCase().includes(q)
                ) {
                    return false;
                }
            }
            return true;
        });
        return {
            all: base.length,
            mine: base.filter((e) => e.assignee_agent_id === null).length,
            ai: base.filter((e) => e.assignee_agent_id !== null).length,
        };
    }, [scopedTasks, statusFilter, searchQuery]);

    function setParam(key: string, value: string | null) {
        const next = new URLSearchParams(params);
        if (value === null || value === '') next.delete(key);
        else next.set(key, value);
        setParams(next, { replace: true });
    }

    const project = projectId ? projectByIdMap.get(projectId) : undefined;
    const totalTasks = stats?.total ?? scopedTasks.length;
    const awaitingPickup = stats?.awaiting_pickup ?? 0;

    return (
        <Box sx={{ px: { xs: 3, md: 8 }, py: 4 }}>
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'flex-end',
                    justifyContent: 'space-between',
                    gap: 4,
                    flexWrap: 'wrap',
                    mb: 5,
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
                        Tasks
                    </Typography>
                    <Typography
                        sx={{
                            fontFamily: '"JetBrains Mono", monospace',
                            fontSize: '0.8125rem',
                            color: ATLAS_PALETTE.slate60,
                            mt: 2,
                        }}
                    >
                        {project ? scopedTasks.length : totalTasks} tasks
                        {project ? ` · ${project.name}` : ''}
                        {awaitingPickup > 0 ? ` · ${awaitingPickup} awaiting pickup` : ''}
                    </Typography>
                </Box>
                <Box
                    sx={{
                        display: { xs: 'none', md: 'flex' },
                        alignItems: 'center',
                        gap: 2,
                    }}
                >
                    <FormControlLabel
                        control={
                            <Switch
                                size="small"
                                checked={showArchived}
                                onChange={(e) =>
                                    setParam('include_archived', e.target.checked ? 'true' : null)
                                }
                            />
                        }
                        label={
                            <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60 }}>
                                Show archived
                            </Typography>
                        }
                    />
                    <ViewModeToggle value={viewMode} onChange={setViewMode} />
                    <Button
                        variant="contained"
                        startIcon={
                            <Box
                                component="span"
                                className="material-symbols-rounded"
                                aria-hidden="true"
                                sx={{ fontSize: 18 }}
                            >
                                add
                            </Box>
                        }
                        onClick={() => navigate('/tasks/new')}
                        disabled={projects.length === 0}
                    >
                        New Task
                    </Button>
                </Box>
            </Box>

            <TaskFiltersBar
                filterKey={filterKey}
                onFilterChange={(k) => setParam('filter', k === 'all' ? null : k)}
                counts={counts}
                projects={projects}
                projectFilter={projectSlug}
                onProjectChange={(pid) => {
                    if (!pid) return setParam('project', null);
                    const p = projects.find((pr) => pr.id === pid);
                    setParam('project', p?.name ?? null);
                }}
                statusFilter={statusFilter}
                onStatusChange={(s) => setParam('status', s)}
                search={searchQuery}
                onSearchChange={(v) => setParam('q', v)}
            />

            {isLoading ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {[1, 2, 3, 4, 5].map((i) => (
                        <Skeleton
                            key={i}
                            variant="rectangular"
                            height={60}
                            sx={{ borderRadius: '8px' }}
                        />
                    ))}
                </Box>
            ) : projects.length === 0 ? (
                <Box
                    sx={{
                        textAlign: 'center',
                        py: 16,
                        background: ATLAS_PALETTE.white,
                        border: `1px solid ${ATLAS_PALETTE.slate10}`,
                        borderRadius: '12px',
                    }}
                >
                    <Box
                        component="span"
                        className="material-symbols-rounded"
                        aria-hidden="true"
                        sx={{
                            fontSize: 48,
                            color: ATLAS_PALETTE.slate40,
                            display: 'block',
                            mb: 3,
                        }}
                    >
                        flag
                    </Box>
                    <Typography
                        sx={{ fontSize: 16, fontWeight: 600, color: ATLAS_PALETTE.slate60, mb: 2 }}
                    >
                        No projects yet
                    </Typography>
                    <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate40, mb: 5 }}>
                        Create a project first, then add tasks.
                    </Typography>
                    <Button variant="outlined" onClick={() => navigate('/projects')}>
                        Go to Projects
                    </Button>
                </Box>
            ) : viewMode === 'kanban' && !isMobile ? (
                <WorkItemKanban
                    items={
                        filtered.map((e) => ({
                            id: e.id,
                            kind: 'task',
                            shortId: e.id,
                            title: e.title,
                            status: e.status,
                            assignee_agent_id: e.assignee_agent_id,
                        })) satisfies KanbanItem[]
                    }
                    agents={agents}
                    ownerName={ownerName}
                    ownerAccent={ownerAccent}
                    onTransition={async (item, nextStatus: IssueStatus, override) => {
                        try {
                            await transitionTask.mutateAsync({
                                id: item.id,
                                status: nextStatus,
                                override,
                            });
                        } catch (err) {
                            // Was an empty catch claiming "invalid moves are
                            // filtered upstream" — they weren't, and this also
                            // swallowed genuine refusals. Closing an task with
                            // open children returns 422 with the blocking
                            // children named; that message never reached the
                            // Owner, so the card just snapped back in silence.
                            toast.show({
                                message: `Couldn't move ${item.shortId}`,
                                detail: err instanceof Error ? err.message : String(err),
                            });
                        }
                        await qc.invalidateQueries({ queryKey: ['tasks'] });
                    }}
                    onOpen={(item) => navigate(`/tasks/${item.id}`)}
                />
            ) : (
                <TaskTable
                    rows={filtered}
                    projects={projects}
                    agents={agents}
                    ownerName={ownerName}
                    ownerAccent={ownerAccent}
                    onCreate={() => navigate('/tasks/new')}
                />
            )}
            <PageFab onClick={() => navigate('/tasks/new')} label="New Task" />
        </Box>
    );
}
