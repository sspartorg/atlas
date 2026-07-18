import { Suspense, useEffect, useMemo, useState } from 'react';
import { lazyNamed } from '../utils/lazyNamed.js';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Skeleton from '@mui/material/Skeleton';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import AddRounded from '@mui/icons-material/AddRounded';
import { ATLAS_PALETTE } from '../theme/tokens.js';
import {
    IssueFiltersBar,
    ViewModeToggle,
    WorkItemKanban,
    WorkItemTable,
    loadViewMode,
    saveViewMode,
    type IssueFilterKey,
    type ViewMode,
    type SortDir,
    type KanbanItem,
    type WorkItemSortKey,
    type WorkItemTableRow,
} from '../components/index.js';
import {
    useIssues,
    flattenIssueTree,
    type IIssueListRow,
    type IssueListKind,
    makeShortId,
} from '../hooks/useIssues.js';
import { useSettings } from '../hooks/useSettings.js';
import { useToast } from '../hooks/useToast.js';
import { api } from '../api/api.js';
import { useQueryClient } from '@tanstack/react-query';
import { type NewIssueKind } from '../components/issues/NewIssueModal.js';
const NewIssueModal = lazyNamed(
    () => import('../components/issues/NewIssueModal.js'),
    'NewIssueModal',
);
import type { IssueStatus } from '@atlas/shared';
import { relativeTime } from '../utils/time.js';
import { PageFab, useSetPageTitle } from '../components/shell/index.js';
import { useIsMobile } from '../hooks/useIsMobile.js';

const MONO = '"JetBrains Mono", monospace';

const SORTABLE_KEYS: ReadonlySet<WorkItemSortKey> = new Set(['id', 'title', 'updated', 'status']);

function statusOrder(s: IssueStatus): number {
    const order: IssueStatus[] = [
        'draft',
        'ready',
        'in_progress',
        'waiting_for_info',
        'in_review',
        'done',
    ];
    const idx = order.indexOf(s);
    return idx < 0 ? 99 : idx;
}

function transitionForKind(kind: IssueListKind, id: string, status: IssueStatus, override: boolean) {
    if (kind === 'story') return api.stories.transition(id, status, override);
    if (kind === 'bug') return api.bugs.transition(id, status, override);
    if (kind === 'sub_task') return api.subTasks.transition(id, status, override);
    return api.subBugs.transition(id, status, override);
}

function routeForRow(row: IIssueListRow): string {
    if (row.kind === 'story') return `/issues/stories/${row.id}`;
    if (row.kind === 'bug') return `/issues/bugs/${row.id}`;
    if (row.kind === 'sub_task') return `/issues/sub-tasks/${row.id}`;
    return `/issues/sub-bugs/${row.id}`;
}

export function Issues() {
    useSetPageTitle('Issues');
    const navigate = useNavigate();
    const isMobile = useIsMobile();
    const qc = useQueryClient();
    const toast = useToast();
    const [projectFilter, setProjectFilter] = useState<string | null>(null);
    const [statusFilter, setStatusFilter] = useState<string | null>(null);
    const [assigneeFilter, setAssigneeFilter] = useState<string | null>(null);
    const [pill, setPill] = useState<IssueFilterKey>('all');
    const [search, setSearch] = useState('');
    const [createOpen, setCreateOpen] = useState(false);
    const [initialKind, setInitialKind] = useState<NewIssueKind>('story');
    const [sortKey, setWorkItemSortKey] = useState<WorkItemSortKey>('updated');
    const [sortDir, setSortDir] = useState<SortDir>('desc');
    const [viewMode, setViewMode] = useState<ViewMode>(() => loadViewMode('issues'));
    const [showArchived, setShowArchived] = useState(false);

    useEffect(() => {
        saveViewMode('issues', viewMode);
    }, [viewMode]);

    const { data: settings } = useSettings();
    const { data: treeData, isPending } = useIssues({
        projectId: projectFilter ?? undefined,
        includeArchived: showArchived,
    });

    // `data` carries projects + agents inlined so the page doesn't need
    // separate /projects and /agents fetches.
    const projects = treeData?.projects ?? [];
    const agents = treeData?.agents ?? [];
    const rows = useMemo<IIssueListRow[]>(
        () => (treeData ? flattenIssueTree(treeData.tree) : []),
        [treeData]
    );

    const agentsById = useMemo(() => new Map(agents.map((w) => [w.id, w])), [agents]);
    const ownerName = settings?.owner_name ?? 'Owner';
    const ownerAccent = settings?.accent_color ?? ATLAS_PALETTE.slate;

    const counts = useMemo(() => {
        const c: Record<IssueFilterKey, number> = {
            all: rows.length,
            story: 0,
            bug: 0,
            sub_task: 0,
            sub_bug: 0,
            assigned_me: 0,
        };
        rows.forEach((r) => {
            if (r.kind === 'story') c.story++;
            if (r.kind === 'bug') c.bug++;
            if (r.kind === 'sub_task') c.sub_task++;
            if (r.kind === 'sub_bug') c.sub_bug++;
            if (r.assignee_agent_id === null) c.assigned_me++;
        });
        return c;
    }, [rows]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return rows.filter((r) => {
            if (pill === 'story' && r.kind !== 'story') return false;
            if (pill === 'bug' && r.kind !== 'bug') return false;
            if (pill === 'sub_task' && r.kind !== 'sub_task') return false;
            if (pill === 'sub_bug' && r.kind !== 'sub_bug') return false;
            if (pill === 'assigned_me' && r.assignee_agent_id !== null) return false;
            if (statusFilter && r.status !== statusFilter) return false;
            if (assigneeFilter) {
                if (assigneeFilter === 'owner' && r.assignee_agent_id !== null) return false;
                if (assigneeFilter !== 'owner' && r.assignee_agent_id !== assigneeFilter) return false;
            }
            if (
                q &&
                !r.title.toLowerCase().includes(q) &&
                !makeShortId(r.kind, r.id).toLowerCase().includes(q)
            )
                return false;
            return true;
        });
    }, [rows, pill, statusFilter, assigneeFilter, search]);

    const sorted = useMemo(() => {
        const arr = [...filtered];
        arr.sort((a, b) => {
            let cmp = 0;
            if (sortKey === 'id') cmp = makeShortId(a.kind, a.id).localeCompare(makeShortId(b.kind, b.id));
            else if (sortKey === 'title') cmp = a.title.localeCompare(b.title);
            else if (sortKey === 'updated')
                cmp = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
            else if (sortKey === 'status')
                cmp = statusOrder(a.status as IssueStatus) - statusOrder(b.status as IssueStatus);
            return sortDir === 'asc' ? cmp : -cmp;
        });
        return arr;
    }, [filtered, sortKey, sortDir]);

    function toggleSort(k: WorkItemSortKey) {
        if (sortKey === k) {
            setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        } else {
            setWorkItemSortKey(k);
            setSortDir(k === 'updated' ? 'desc' : 'asc');
        }
    }

    // Hierarchical ordering: applied when the "All" pill is active AND we're
    // not actively sorting by something other than updated, so stories appear
    // with their sub-tasks/sub-bugs nested. Otherwise the table stays flat.
    const ordered = useMemo<Array<{ row: IIssueListRow; isChild: boolean }>>(() => {
        if (pill !== 'all' || sortKey !== 'updated') {
            return sorted.map((row) => ({ row, isChild: false }));
        }
        const topLevel = sorted.filter((r) => r.kind === 'story' || r.kind === 'bug');
        const topLevelIds = new Set(topLevel.map((r) => r.id));

        const childrenByStory = new Map<string, IIssueListRow[]>();
        for (const r of sorted) {
            if (
                (r.kind === 'sub_task' || r.kind === 'sub_bug') &&
                r.parent_story_id &&
                topLevelIds.has(r.parent_story_id)
            ) {
                const arr = childrenByStory.get(r.parent_story_id) ?? [];
                arr.push(r);
                childrenByStory.set(r.parent_story_id, arr);
            }
        }
        for (const arr of childrenByStory.values()) {
            arr.sort((a, b) => a.created_at.localeCompare(b.created_at));
        }
        const out: Array<{ row: IIssueListRow; isChild: boolean }> = [];
        const placed = new Set<string>();
        for (const r of topLevel) {
            out.push({ row: r, isChild: false });
            placed.add(r.id);
            if (r.kind === 'story') {
                for (const k of childrenByStory.get(r.id) ?? []) {
                    out.push({ row: k, isChild: true });
                    placed.add(k.id);
                }
            }
        }
        for (const r of sorted) {
            if (!placed.has(r.id)) out.push({ row: r, isChild: false });
        }
        return out;
    }, [sorted, pill, sortKey]);

    const kanbanItems = useMemo<KanbanItem[]>(
        () =>
            sorted.map((r) => ({
                id: r.id,
                kind: r.kind,
                shortId: makeShortId(r.kind, r.id),
                title: r.title,
                status: r.status as IssueStatus,
                assignee_agent_id: r.assignee_agent_id,
            })),
        [sorted]
    );

    const tableRows = useMemo<WorkItemTableRow[]>(
        () =>
            ordered.map(({ row, isChild }) => ({
                id: row.id,
                kind: row.kind,
                shortId: makeShortId(row.kind, row.id),
                title: row.title,
                status: row.status,
                assignee_agent_id: row.assignee_agent_id,
                reporter_agent_id: row.reporter_agent_id,
                updated_at: row.updated_at,
                isChild,
            })),
        [ordered]
    );

    const subItemCount = counts.sub_task + counts.sub_bug;

    function openRow(row: IIssueListRow) {
        navigate(routeForRow(row));
    }

    function openTableRow(tr: WorkItemTableRow) {
        const found = rows.find((r) => r.id === tr.id);
        if (found) openRow(found);
    }

    async function handleKanbanTransition(item: KanbanItem, nextStatus: IssueStatus, override: boolean) {
        /* v8 ignore next -- defensive: kanbanItems is always built from `sorted`, typed IIssueListRow[] whose `kind` is IssueListKind (story/bug/sub_task/sub_bug); WorkItemKanban can never call onTransition with an epic-kind item through any real UI path. */
        if (item.kind === 'epic') return; // /issues never lists epics; satisfies the union.
        try {
            await transitionForKind(item.kind, item.id, nextStatus, override);
        } catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            toast.show({ message: `Couldn't move ${item.shortId}`, detail });
        }
        await qc.invalidateQueries({ queryKey: ['issues'] });
        await qc.invalidateQueries({ queryKey: ['stories'] });
        await qc.invalidateQueries({ queryKey: ['bugs'] });
    }

    return (
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
                        Issues
                    </Typography>
                    <Typography
                        sx={{
                            fontFamily: MONO,
                            fontSize: '0.8125rem',
                            color: ATLAS_PALETTE.slate60,
                            mt: 2,
                        }}
                    >
                        {counts.story} stories · {subItemCount} sub-items · {counts.bug} bugs
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
                                onChange={(e) => setShowArchived(e.target.checked)}
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
                        color="success"
                        startIcon={<AddRounded />}
                        onClick={() => {
                            setInitialKind('story');
                            setCreateOpen(true);
                        }}
                        sx={{ textTransform: 'none', fontWeight: 600 }}
                    >
                        New issue
                    </Button>
                </Box>
            </Box>

            <Box sx={{ mt: 5 }}>
                <IssueFiltersBar
                    filterKey={pill}
                    onFilterChange={setPill}
                    counts={counts}
                    projects={projects}
                    projectFilter={projectFilter}
                    onProjectChange={setProjectFilter}
                    agents={agents}
                    assigneeFilter={assigneeFilter}
                    onAssigneeChange={setAssigneeFilter}
                    statusFilter={statusFilter}
                    onStatusChange={setStatusFilter}
                    search={search}
                    onSearchChange={setSearch}
                />
            </Box>

            {viewMode === 'kanban' && !isMobile ? (
                <Box sx={{ mt: 2 }}>
                    <WorkItemKanban
                        items={kanbanItems}
                        agents={agents}
                        ownerName={ownerName}
                        ownerAccent={ownerAccent}
                        onTransition={(item, next, override) =>
                            void handleKanbanTransition(item, next, override)
                        }
                        onOpen={(item) => {
                            const row = rows.find((r) => r.id === item.id);
                            if (row) openRow(row);
                        }}
                    />
                </Box>
            ) : isPending ? (
                <Box sx={{ mt: 2 }}>
                    {[1, 2, 3, 4, 5, 6].map((i) => (
                        <Skeleton
                            key={i}
                            variant="rectangular"
                            height={48}
                            sx={{ borderRadius: '8px', mb: 1 }}
                        />
                    ))}
                </Box>
            ) : (
                <Box sx={{ mt: 2 }}>
                    <WorkItemTable
                        rows={tableRows}
                        agentsById={agentsById}
                        ownerName={ownerName}
                        ownerAccent={ownerAccent}
                        onRowClick={openTableRow}
                        formatRelative={relativeTime}
                        emptyMessage="No issues match this view."
                        showLiveDot
                        sort={{
                            current: sortKey,
                            dir: sortDir,
                            onChange: toggleSort,
                            sortable: SORTABLE_KEYS,
                        }}
                    />
                </Box>
            )}

            {createOpen && (
                <Suspense fallback={null}>
                    <NewIssueModal
                        open={createOpen}
                        onClose={() => setCreateOpen(false)}
                        initialKind={initialKind}
                        initialProjectId={projectFilter}
                    />
                </Suspense>
            )}
            <PageFab
                onClick={() => {
                    setInitialKind('story');
                    setCreateOpen(true);
                }}
                label="New Issue"
            />
        </Box>
    );
}
