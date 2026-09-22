import { Suspense, useCallback, useMemo, useState } from 'react';
import { lazyNamed } from '../utils/lazyNamed.js';
import { useParams, useNavigate } from 'react-router-dom';
import { useQueryClient, useIsFetching } from '@tanstack/react-query';
import { useTabParam } from '../hooks/useTabParam.js';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Skeleton from '@mui/material/Skeleton';
import Button from '@mui/material/Button';
import { useProject } from '../hooks/useProjects.js';
import { useProjectRepos } from '../hooks/useProjectRepos.js';
import { useAgents } from '../hooks/useAgents.js';
import { useSettings } from '../hooks/useSettings.js';
import { useProjectCounts } from '../hooks/useProjectCounts.js';
import { flattenIssueTree, useIssues } from '../hooks/useIssues.js';
import { ATLAS_PALETTE } from '../theme/tokens.js';
import { RefreshButton } from '../components/index.js';
import { ProjectHeader } from './project/ProjectHeader.js';
import { ProjectRightRail } from './project/ProjectRightRail.js';
import { OverviewTab } from './project/OverviewTab.js';
import { TasksTab } from './project/TasksTab.js';
import { GuardrailsTab } from './project/GuardrailsTab.js';
import { HistoryTab } from './project/HistoryTab.js';
import { SetupTab } from './project/SetupTab.js';
import { ProjectJiraCard } from './project/ProjectJiraCard.js';
import { ProjectReposCard } from './project/ProjectReposCard.js';
const DeleteProjectModal = lazyNamed(
    () => import('./projects/DeleteProjectModal.js'),
    'DeleteProjectModal'
);
const ProjectEnvSecretsModal = lazyNamed(
    () => import('./project/ProjectEnvSecretsModal.js'),
    'ProjectEnvSecretsModal'
);
import { RenameProjectModal } from './project/RenameProjectModal.js';
import { GenerateAiScaffoldDialog } from './projects/GenerateAiScaffoldDialog.js';
import { useSetPageTitle } from '../components/shell/index.js';

import { relativeTime } from '../utils/time.js';
import type { IProjectRepo } from '@atlas/shared';

type TabKey = 'overview' | 'tasks' | 'guardrails' | 'repos' | 'jira' | 'setup' | 'history';
const TAB_KEYS = ['overview', 'tasks', 'guardrails', 'repos', 'jira', 'setup', 'history'] as const;

// Module-scoped so the `repos` prop keeps a stable identity while the query
// is still pending — `ProjectHeader` is memo'd.
const NO_REPOS: IProjectRepo[] = [];

export function ProjectDetail() {
    const { id = '' } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [currentTab, setTab] = useTabParam<TabKey>(TAB_KEYS, 'overview');
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [secretsOpen, setSecretsOpen] = useState(false);
    const [renameOpen, setRenameOpen] = useState(false);
    // Theme 09b — AI-Readiness Agent trigger dialog
    const [aiScaffoldOpen, setAiScaffoldOpen] = useState(false);

    // Stable handler identities so `ProjectHeader` (memo'd) can bail on tab
    // clicks. Without these, every parent re-render produces fresh arrow
    // functions and the memo never gets a chance to skip.
    const handleRename = useCallback(() => setRenameOpen(true), []);
    const handleEditGuardrails = useCallback(() => setTab('guardrails'), [setTab]);
    const handleManageSecrets = useCallback(() => setSecretsOpen(true), []);
    const handleDelete = useCallback(() => setDeleteOpen(true), []);
    const handleJumpToHistory = useCallback(() => setTab('history'), [setTab]);
    const handleGenerateAiScaffold = useCallback(() => setAiScaffoldOpen(true), []);

    // Single-record fetch — the list endpoint scaled O(n) with project count
    // and shipped the whole catalog just to render one row's metadata.
    const { data: project = null, isLoading: projectsLoading } = useProject(id);
    const { data: repos = NO_REPOS } = useProjectRepos(id);
    const { data: agents = [] } = useAgents();
    const { data: settings } = useSettings();
    // Lifted from per-tab containers so tab swaps are pure-render. The fetches
    // happen once on page mount, the tab containers gate on `data === undefined`
    // and otherwise pass the data straight through.
    const { data: counts } = useProjectCounts(id);
    const { data: issueTree } = useIssues({ projectId: id });
    const subTasks = useMemo(
        () =>
            issueTree ? flattenIssueTree(issueTree.tree).filter((n) => n.kind === 'sub_task') : [],
        [issueTree]
    );
    // TasksTab wants `ITaskListItem` (ITask + sub_task_count); the tree
    // already carries every sub-task in the project, so count client-side.
    const tasks = useMemo(() => {
        const countByTask = new Map<string, number>();
        for (const s of subTasks) {
            if (s.task_id) countByTask.set(s.task_id, (countByTask.get(s.task_id) ?? 0) + 1);
        }
        return (issueTree?.tasks ?? []).map((t) => ({
            ...t,
            sub_task_count: countByTask.get(t.id) ?? 0,
        }));
    }, [issueTree?.tasks, subTasks]);

    const queryClient = useQueryClient();
    // Tracks only the two queries this page owns.
    const projectFetching = useIsFetching({
        predicate: (q) => {
            const k = q.queryKey;
            if (!Array.isArray(k)) return false;
            const first = k[0];
            return (
                (first === 'projects' && k[1] === id) ||
                (first === 'issues' &&
                    k[1] === 'tree' &&
                    typeof k[2] === 'object' &&
                    k[2] !== null &&
                    (k[2] as { projectId?: string | null }).projectId === id)
            );
        },
    });
    const handleRefresh = useCallback(() => {
        void queryClient.invalidateQueries({ queryKey: ['projects', id] });
        void queryClient.invalidateQueries({ queryKey: ['issues'] });
    }, [queryClient, id]);

    const ownerName = settings?.owner_name ?? 'Owner';
    const ownerAccent = settings?.accent_color ?? ATLAS_PALETTE.slate;

    useSetPageTitle(project?.name ?? 'Project', project ? 'Project' : undefined);

    const displayId = project?.issue_key_prefix ?? '';

    // Active agents = agents assigned to any open task or sub-task in this project.
    const activeAgents = useMemo(() => {
        const ids = new Set<string>();
        for (const i of [...tasks, ...subTasks]) {
            if (i.assignee_agent_id && i.status !== 'done') ids.add(i.assignee_agent_id);
        }
        return agents.filter((w) => ids.has(w.id));
    }, [tasks, subTasks, agents]);

    const guardrailsActive = project ? project.guardrails_md.trim().length > 0 : false;

    if (projectsLoading) {
        return (
            <Box sx={{ px: { xs: 3, md: 8 }, py: 4 }}>
                <Skeleton variant="text" width={200} height={20} sx={{ mb: 3 }} />
                <Skeleton variant="rectangular" height={80} sx={{ borderRadius: '12px', mb: 5 }} />
                <Skeleton variant="rectangular" height={400} sx={{ borderRadius: '12px' }} />
            </Box>
        );
    }

    if (!project) {
        return (
            <Box sx={{ px: { xs: 3, md: 8 }, py: 4, textAlign: 'center' }}>
                <Typography sx={{ color: ATLAS_PALETTE.slate40, mb: 3 }}>
                    Project not found
                </Typography>
                <Button onClick={() => navigate('/projects')}>Back to Projects</Button>
            </Box>
        );
    }

    const showRail = currentTab !== 'guardrails';

    return (
        <Box sx={{ px: { xs: 3, md: 8 }, py: 4 }}>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: -3 }}>
                <RefreshButton
                    onRefresh={handleRefresh}
                    isFetching={projectFetching > 0}
                    tooltipLabel="Refresh project data"
                />
            </Box>
            <ProjectHeader
                project={project}
                repos={repos}
                displayId={displayId}
                guardrailsActive={guardrailsActive}
                lastActivity={relativeTime(project.updated_at)}
                onRename={handleRename}
                onEditGuardrails={handleEditGuardrails}
                onManageSecrets={handleManageSecrets}
                onDelete={handleDelete}
                onGenerateAiScaffold={handleGenerateAiScaffold}
                // ADR 0018 — the scaffold reads a checkout: it needs at least one.
                aiScaffoldEnabled={repos.some((r) => r.clone_status === 'ready')}
            />

            <Tabs
                value={currentTab}
                onChange={(_, v) => setTab(v as TabKey)}
                variant="scrollable"
                scrollButtons={false}
                sx={{
                    mb: 5,
                    borderBottom: `1px solid ${ATLAS_PALETTE.slate10}`,
                    minHeight: 40,
                    '& .MuiTab-root': {
                        textTransform: 'none',
                        fontFamily: '"Inter", system-ui, sans-serif',
                        fontSize: 13,
                        color: ATLAS_PALETTE.slate60,
                        minHeight: 40,
                        px: 2,
                        '&.Mui-selected': { color: ATLAS_PALETTE.slate, fontWeight: 600 },
                    },
                    '& .MuiTabs-indicator': { background: ATLAS_PALETTE.slate },
                }}
            >
                <Tab
                    value="overview"
                    icon={
                        <Box
                            component="span"
                            className="material-symbols-rounded"
                            aria-hidden="true"
                            sx={{ fontSize: 16 }}
                        >
                            dashboard
                        </Box>
                    }
                    iconPosition="start"
                    label="Overview"
                />
                <Tab
                    value="tasks"
                    icon={
                        <Box
                            component="span"
                            className="material-symbols-rounded"
                            aria-hidden="true"
                            sx={{ fontSize: 16 }}
                        >
                            flag
                        </Box>
                    }
                    iconPosition="start"
                    label={`Tasks  ${tasks.length}`}
                />
                <Tab
                    value="guardrails"
                    icon={
                        <Box
                            component="span"
                            className="material-symbols-rounded"
                            aria-hidden="true"
                            sx={{ fontSize: 16 }}
                        >
                            shield
                        </Box>
                    }
                    iconPosition="start"
                    label="Guard-rails"
                />
                <Tab
                    value="repos"
                    icon={
                        <Box
                            component="span"
                            className="material-symbols-rounded"
                            aria-hidden="true"
                            sx={{ fontSize: 16 }}
                        >
                            source
                        </Box>
                    }
                    iconPosition="start"
                    label="Repos"
                />
                <Tab
                    value="jira"
                    icon={
                        <Box
                            component="span"
                            className="material-symbols-rounded"
                            aria-hidden="true"
                            sx={{ fontSize: 16 }}
                        >
                            sync_alt
                        </Box>
                    }
                    iconPosition="start"
                    label="Jira"
                />
                <Tab
                    value="setup"
                    icon={
                        <Box
                            component="span"
                            className="material-symbols-rounded"
                            aria-hidden="true"
                            sx={{ fontSize: 16 }}
                        >
                            terminal
                        </Box>
                    }
                    iconPosition="start"
                    label="Setup"
                />
                <Tab
                    value="history"
                    icon={
                        <Box
                            component="span"
                            className="material-symbols-rounded"
                            aria-hidden="true"
                            sx={{ fontSize: 16 }}
                        >
                            history
                        </Box>
                    }
                    iconPosition="start"
                    label="History"
                />
            </Tabs>

            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: showRail ? { xs: '1fr', md: '1fr 320px' } : '1fr',
                    gap: 4,
                    alignItems: 'flex-start',
                }}
            >
                <Box sx={{ minWidth: 0 }}>
                    {currentTab === 'overview' && (
                        <OverviewTab
                            counts={counts}
                            projectId={id}
                            onJumpToHistory={handleJumpToHistory}
                        />
                    )}
                    {currentTab === 'tasks' && (
                        <TasksTab
                            projectId={id}
                            tasks={issueTree ? tasks : undefined}
                            projects={project ? [project] : []}
                            agents={agents}
                            ownerName={ownerName}
                            ownerAccent={ownerAccent}
                        />
                    )}
                    {currentTab === 'guardrails' && <GuardrailsTab project={project} />}
                    {currentTab === 'repos' && (
                        <ProjectReposCard project={project} displayId={displayId} />
                    )}
                    {currentTab === 'jira' && <ProjectJiraCard project={project} />}
                    {currentTab === 'setup' && <SetupTab projectId={id} />}
                    {currentTab === 'history' && <HistoryTab projectId={id} />}
                </Box>

                {showRail && (
                    <ProjectRightRail
                        projectId={id}
                        activeAgents={activeAgents}
                        guardrailsMd={project.guardrails_md}
                        onEditGuardrails={handleEditGuardrails}
                    />
                )}
            </Box>

            {deleteOpen && (
                <Suspense fallback={null}>
                    <DeleteProjectModal
                        open
                        project={project}
                        displayId={displayId}
                        onClose={() => setDeleteOpen(false)}
                    />
                </Suspense>
            )}

            {secretsOpen && (
                <Suspense fallback={null}>
                    <ProjectEnvSecretsModal
                        open
                        project={project}
                        displayId={displayId}
                        onClose={() => setSecretsOpen(false)}
                    />
                </Suspense>
            )}

            <RenameProjectModal
                open={renameOpen}
                project={project}
                displayId={displayId}
                onClose={() => setRenameOpen(false)}
            />

            <GenerateAiScaffoldDialog
                project={project}
                open={aiScaffoldOpen}
                onClose={() => setAiScaffoldOpen(false)}
            />
        </Box>
    );
}
