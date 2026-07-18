import { Suspense, useMemo, useState } from 'react';
import { lazyNamed } from '../utils/lazyNamed.js';
import { useParams, useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import { ATLAS_PALETTE } from '../theme/tokens.js';
import {
    WorkItemTable,
    type WorkItemTableRow,
} from '../components/index.js';
import {
    useStoryFull,
    useTransitionStory,
    useUpdateStory,
    useAssignStory,
    useResetRoundsStory,
    useDeleteStory,
} from '../hooks/useStories.js';
import { IssueDeleteAction } from '../components/ConfirmDeleteModal.js';
import { useSettings } from '../hooks/useSettings.js';
import { IssueDetailShell, IssueDetailLoading } from './issues/IssueDetailShell.js';
import { relativeTime } from '../utils/time.js';
import LinkRounded from '@mui/icons-material/LinkRounded';
import BlockRounded from '@mui/icons-material/BlockRounded';
import {
    AddRelatedMenu,
    DetailsRailCard,
    EditableMarkdownCard,
    ConversationCard,
    ActivityLogCard,
    RelatedItemsCard,
    LinkPickerDialog,
    KindIcon,
    type AddRelatedMenuOption,
    type ParentLink,
} from '../components/index.js';
import { useProjectLabels } from '../hooks/useProjectLabels.js';
import type { NewIssueKind } from '../components/issues/NewIssueModal.js';
const NewIssueModal = lazyNamed(
    () => import('../components/issues/NewIssueModal.js'),
    'NewIssueModal',
);
import { useItemAgentRuns } from '../hooks/useAgents.js';
import { makeShortId } from '../hooks/useIssues.js';
import { useSetPageTitle } from '../components/shell/index.js';

export function StoryDetail() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const storyId = id ?? '';
    useSetPageTitle(makeShortId('story', storyId), 'Story');

    // Single composite fetch — story + epic + project + sub_tasks + sub_bugs
    // + agents (and related_links + activity, consumed by inner cards in a
    // follow-up). Replaces the prior 6-call fan-out.
    const { data: full, isLoading } = useStoryFull(storyId);
    const { data: settings } = useSettings();
    const transition = useTransitionStory();
    const updateStory = useUpdateStory();
    const assignStory = useAssignStory();
    const resetRoundsStory = useResetRoundsStory();
    const deleteStory = useDeleteStory();
    const [createKind, setCreateKind] = useState<NewIssueKind | null>(null);
    const [pickerMode, setPickerMode] = useState<
        'relates_to' | 'depends_on' | 'tested_by' | null
    >(null);
    const [cloning, setCloning] = useState(false);

    const story = full?.story;
    const epic = full?.epic ?? null;
    const project = full?.project ?? null;
    const { data: projectLabels } = useProjectLabels(project?.id);
    const subTasks = full?.sub_tasks ?? [];
    const subBugs = full?.sub_bugs ?? [];
    const agents = full?.agents ?? [];

    const assignee = useMemo(
        () =>
            story?.assignee_agent_id
                ? agents.find((w) => w.id === story.assignee_agent_id)
                : null,
        [agents, story]
    );
    const reporter = useMemo(
        () =>
            story?.reporter_agent_id
                ? agents.find((w) => w.id === story.reporter_agent_id)
                : null,
        [agents, story]
    );

    const { data: itemRuns } = useItemAgentRuns(storyId);
    const totalCostUsd = useMemo(() => {
        if (!itemRuns?.length) return null;
        let sum = 0;
        let hasAny = false;
        for (const r of itemRuns) {
            if (r.total_cost_usd != null) { sum += r.total_cost_usd; hasAny = true; }
        }
        return hasAny ? sum : null;
    }, [itemRuns]);

    if (isLoading) {
        return <IssueDetailLoading />;
    }
    if (!story) {
        return (
            <Box sx={{ px: { xs: 3, md: 8 }, py: 4, textAlign: 'center' }}>
                <Typography sx={{ color: ATLAS_PALETTE.slate40 }}>Story not found</Typography>
                <Button sx={{ mt: 4 }} onClick={() => navigate('/issues')}>
                    Back to Issues
                </Button>
            </Box>
        );
    }

    const shortId = makeShortId('story', story.id);
    const epicShortId = epic ? makeShortId('story', epic.id).replace('STR', 'EPC') : '—';
    const ownerName = settings?.owner_name ?? 'Owner';
    const ownerAccent = settings?.accent_color ?? ATLAS_PALETTE.slate;

    const parents: ParentLink[] = epic
        ? [{ label: 'Epic', text: epicShortId, href: `/epics/${epic.id}` }]
        : [];

    const addOptions: AddRelatedMenuOption[] = [
        {
            label: 'Add sub-task',
            icon: <KindIcon kind="sub_task" size={14} />,
            onClick: () => setCreateKind('sub_task'),
        },
        {
            label: 'Add sub-bug',
            icon: <KindIcon kind="sub_bug" size={14} />,
            onClick: () => setCreateKind('sub_bug'),
        },
        {
            label: 'Add relates-to',
            icon: <LinkRounded sx={{ fontSize: 16 }} />,
            onClick: () => setPickerMode('relates_to'),
        },
        {
            label: 'Add blocked-by',
            icon: <BlockRounded sx={{ fontSize: 16 }} />,
            onClick: () => setPickerMode('depends_on'),
        },
    ];

    return (
        <>
            <IssueDetailShell
                breadcrumbs={[
                    { label: 'Projects', href: '/projects' },
                    {
                        label: project?.name ?? '—',
                        href: project ? `/projects/${project.id}` : undefined,
                    },
                    { label: 'Issues', href: '/issues' },
                    {
                        label: epicShortId,
                        href: epic ? `/epics/${epic.id}` : undefined,
                        mono: true,
                    },
                    { label: shortId, mono: true },
                ]}
                title={story.title}
                onTitleSave={(next) =>
                    updateStory.mutateAsync({ id: story.id, data: { title: next } })
                }
                titleSaving={updateStory.isPending}
                issueType="story"
                headerExtras={<AddRelatedMenu options={addOptions} label="Add sub-item" />}
                actions={
                    <IssueDeleteAction
                        entityKind="story"
                        entityTitle={story.title}
                        onDelete={async () => {
                            await deleteStory.mutateAsync(story.id);
                        }}
                        redirectTo={epic ? `/epics/${epic.id}` : '/issues'}
                        onClone={() => setCloning(true)}
                    />
                }
                rightRail={
                    <>
                        <DetailsRailCard
                            issueType="story"
                            status={story.status}
                            onStatusPick={(next, override) =>
                                void transition.mutateAsync({
                                    id: story.id,
                                    status: next,
                                    override,
                                })
                            }
                            assigneeAgentId={story.assignee_agent_id}
                            onAssign={(agentId) =>
                                void assignStory.mutateAsync({ id: story.id, agentId })
                            }
                            assignee={assignee ?? null}
                            reassignLocked={story.status === 'in_progress'}
                            project={project ?? null}
                            parents={parents}
                            reporter={reporter ?? null}
                            ownerName={ownerName}
                            ownerAccent={ownerAccent}
                            priority={story.priority}
                            onPriorityPick={(next) =>
                                void updateStory.mutateAsync({
                                    id: story.id,
                                    data: { priority: next },
                                })
                            }
                            labels={story.labels ?? []}
                            labelSuggestions={projectLabels?.labels ?? []}
                            onLabelsChange={(next) =>
                                updateStory.mutateAsync({
                                    id: story.id,
                                    data: { labels: next },
                                })
                            }
                            createdAt={story.created_at}
                            updatedAt={story.updated_at}
                            roundCount={full?.round_count ?? null}
                            maxRounds={assignee?.max_rounds ?? null}
                            onResetRounds={() =>
                                void resetRoundsStory.mutateAsync({ id: story.id })
                            }
                            assigneeName={assignee?.name ?? null}
                            resetRoundsPending={resetRoundsStory.isPending}
                            totalCostUsd={totalCostUsd}
                            worktreeBranch={story.worktree_branch}
                            worktreePath={story.worktree_path}
                        />
                        <ActivityLogCard
                            issueType="story"
                            issueId={story.id}
                            activity={full?.activity}
                            agents={agents}
                        />
                    </>
                }
            >
                <EditableMarkdownCard
                    title="Description"
                    value={story.description}
                    placeholder="Describe what this story is for…"
                    emptyHint="Click to add a description…"
                    saving={updateStory.isPending}
                    onSave={(next) =>
                        updateStory.mutateAsync({ id: story.id, data: { description: next } })
                    }
                />

                <EditableMarkdownCard
                    title="Acceptance criteria"
                    value={story.acceptance_criteria}
                    placeholder={'- User can…\n- System ensures…'}
                    emptyHint="Click to add acceptance criteria, one per line…"
                    saving={updateStory.isPending}
                    onSave={(next) =>
                        updateStory.mutateAsync({
                            id: story.id,
                            data: { acceptance_criteria: next },
                        })
                    }
                    renderBody={(body) => {
                        const lines = body.split('\n').filter((l) => l.trim().length > 0);
                        return (
                            <Box
                                component="ul"
                                sx={{
                                    pl: 3,
                                    m: 0,
                                    color: ATLAS_PALETTE.slate80,
                                    fontSize: 13.5,
                                    lineHeight: 1.8,
                                }}
                            >
                                {lines.map((line, i) => (
                                    <li key={i}>{line.replace(/^[-*]\s*/, '')}</li>
                                ))}
                            </Box>
                        );
                    }}
                />

                <WorkItemTable
                    title="Sub-items"
                    rows={
                        [
                            ...subTasks.map((t) => ({
                                id: t.id,
                                kind: 'sub_task' as const,
                                shortId: makeShortId('sub_task', t.id),
                                title: t.title,
                                status: t.status,
                                assignee_agent_id: t.assignee_agent_id,
                                reporter_agent_id: t.reporter_agent_id,
                                updated_at: t.updated_at,
                            })),
                            ...subBugs.map((b) => ({
                                id: b.id,
                                kind: 'sub_bug' as const,
                                shortId: makeShortId('sub_bug', b.id),
                                title: b.title,
                                status: b.status,
                                assignee_agent_id: b.assignee_agent_id,
                                reporter_agent_id: b.reporter_agent_id,
                                updated_at: b.updated_at,
                            })),
                        ] satisfies WorkItemTableRow[]
                    }
                    agentsById={
                        new Map(
                            agents.map((w) => [w.id, w] as const)
                        )
                    }
                    ownerName={ownerName}
                    ownerAccent={ownerAccent}
                    formatRelative={relativeTime}
                    onRowClick={(row) =>
                        navigate(
                            row.kind === 'sub_task'
                                ? `/issues/sub-tasks/${row.id}`
                                : `/issues/sub-bugs/${row.id}`
                        )
                    }
                    hideWhenEmpty
                />

                <RelatedItemsCard
                    issueType="story"
                    issueId={story.id}
                    relatedLinks={full?.related_links}
                    externalLinks={full?.external_links}
                    agents={agents}
                    onOpenPicker={setPickerMode}
                    allowAddTestLink
                />

                <ConversationCard
                    issueType="story"
                    issueId={story.id}
                    activity={full?.activity}
                    agents={agents}
                />
            </IssueDetailShell>

            {createKind !== null && (
                <Suspense fallback={null}>
                    <NewIssueModal
                        open={createKind !== null}
                        onClose={() => setCreateKind(null)}
                        initialKind={createKind}
                        initialProjectId={project?.id ?? null}
                        initialParentStoryId={story.id}
                    />
                </Suspense>
            )}

            {pickerMode !== null && (
                <LinkPickerDialog
                    open
                    mode={pickerMode}
                    fromIssueType="story"
                    fromIssueId={story.id}
                    links={full?.related_links}
                    restrictToEpicId={pickerMode === 'tested_by' ? story.epic_id : undefined}
                    onClose={() => setPickerMode(null)}
                />
            )}

            {cloning && (
                <Suspense fallback={null}>
                    <NewIssueModal
                        open={cloning}
                        onClose={() => setCloning(false)}
                        initialKind="story"
                        initialProjectId={project?.id ?? null}
                        initialParentEpicId={epic?.id ?? null}
                        initialValues={{
                            title: `CLONE ${story.title}`,
                            description: story.description,
                            acceptance_criteria: story.acceptance_criteria,
                        }}
                        cloneFromId={story.id}
                        cloneFromType="story"
                    />
                </Suspense>
            )}
        </>
    );
}
