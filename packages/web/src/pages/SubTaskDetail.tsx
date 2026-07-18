import { Suspense, useMemo, useState } from 'react';
import { lazyNamed } from '../utils/lazyNamed.js';
import { useParams, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import LinkRounded from '@mui/icons-material/LinkRounded';
import BlockRounded from '@mui/icons-material/BlockRounded';
import { ATLAS_PALETTE } from '../theme/tokens.js';
import { IssueDetailShell, IssueDetailLoading } from './issues/IssueDetailShell.js';
import {
    AddRelatedMenu,
    DetailsRailCard,
    EditableMarkdownCard,
    ConversationCard,
    ActivityLogCard,
    RelatedItemsCard,
    LinkPickerDialog,
    type AddRelatedMenuOption,
    type ParentLink,
} from '../components/index.js';
const NewIssueModal = lazyNamed(
    () => import('../components/issues/NewIssueModal.js'),
    'NewIssueModal',
);
import { useSubTaskFull, useDeleteSubTask } from '../hooks/useStories.js';
import { IssueDeleteAction } from '../components/ConfirmDeleteModal.js';
import { useProjectLabels } from '../hooks/useProjectLabels.js';
import { useSettings } from '../hooks/useSettings.js';
import { useItemAgentRuns } from '../hooks/useAgents.js';
import { api } from '../api/api.js';
import { makeShortId } from '../hooks/useIssues.js';
import type { ISubTask, IssueStatus } from '@atlas/shared';
import { useSetPageTitle } from '../components/shell/index.js';

export function SubTaskDetail() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const qc = useQueryClient();
    const taskId = id ?? '';
    useSetPageTitle(makeShortId('sub_task', taskId), 'Sub-task');

    // Single composite fetch — sub-task + parent_story + epic + project +
    // agents (and related_links + activity, consumed by inner cards in a
    // follow-up). Replaces the prior multi-call fan-out and the
    // qc.fetchQuery(['sub-tasks']) full-list scan.
    const { data: full, isLoading } = useSubTaskFull(taskId);
    const { data: settings } = useSettings();
    const deleteSubTask = useDeleteSubTask();

    const [saving, setSaving] = useState(false);
    const [pickerMode, setPickerMode] = useState<
        'relates_to' | 'depends_on' | 'tested_by' | null
    >(null);
    const [cloning, setCloning] = useState(false);

    const task = full?.sub_task;
    const parentStory = full?.parent_story ?? null;
    const project = full?.project ?? null;
    const agents = full?.agents ?? [];
    const { data: projectLabels } = useProjectLabels(project?.id);

    const assignee = useMemo(
        () =>
            task?.assignee_agent_id
                ? (agents.find((w) => w.id === task.assignee_agent_id) ?? null)
                : null,
        [agents, task]
    );
    const reporter = useMemo(
        () =>
            task?.reporter_agent_id
                ? (agents.find((w) => w.id === task.reporter_agent_id) ?? null)
                : null,
        [agents, task]
    );

    const { data: itemRuns } = useItemAgentRuns(taskId);
    const totalCostUsd = useMemo(() => {
        if (!itemRuns?.length) return null;
        let sum = 0;
        let hasAny = false;
        for (const r of itemRuns) {
            if (r.total_cost_usd != null) { sum += r.total_cost_usd; hasAny = true; }
        }
        return hasAny ? sum : null;
    }, [itemRuns]);

    async function patchTask(data: Partial<ISubTask>) {
        if (!task) return;
        setSaving(true);
        try {
            await api.subTasks.update(task.id, data);
            // ['sub-tasks'] prefix covers ['sub-tasks', taskId, 'full'];
            // ['stories'] covers parent story's sub-task list.
            await qc.invalidateQueries({ queryKey: ['stories'] });
            await qc.invalidateQueries({ queryKey: ['sub-tasks'] });
            await qc.invalidateQueries({ queryKey: ['issues'] });
            await qc.invalidateQueries({ queryKey: ['labels'] });
        } finally {
            setSaving(false);
        }
    }

    async function handleStatusPick(next: IssueStatus, override: boolean) {
        if (!task) return;
        await api.subTasks.transition(task.id, next, override);
        await qc.invalidateQueries({ queryKey: ['stories'] });
        await qc.invalidateQueries({ queryKey: ['sub-tasks'] });
        await qc.invalidateQueries({ queryKey: ['issues'] });
    }

    async function handleAssign(agentId: string | null) {
        if (!task) return;
        await api.subTasks.assign(task.id, agentId);
        // ['stories'] is a prefix match — covers ['stories', :id, 'sub-tasks']
        // which StoryDetail's useSubTasks() reads, so the parent story's
        // sub-task list refreshes the next time it mounts.
        await qc.invalidateQueries({ queryKey: ['stories'] });
        await qc.invalidateQueries({ queryKey: ['sub-tasks'] });
        await qc.invalidateQueries({ queryKey: ['issues'] });
    }

    async function handleResetRounds() {
        if (!task) return;
        await api.subTasks.resetRounds(task.id);
        await qc.invalidateQueries({ queryKey: ['sub-tasks', task.id, 'full'] });
    }


    if (isLoading) {
        return <IssueDetailLoading />;
    }
    if (!task) {
        return (
            <Box sx={{ px: { xs: 3, md: 8 }, py: 4, textAlign: 'center' }}>
                <Typography sx={{ color: ATLAS_PALETTE.slate40 }}>Sub-task not found</Typography>
                <Button sx={{ mt: 4 }} onClick={() => navigate('/issues')}>
                    Back to Issues
                </Button>
            </Box>
        );
    }

    const shortId = makeShortId('sub_task', task.id);
    const ownerName = settings?.owner_name ?? 'Owner';
    const ownerAccent = settings?.accent_color ?? ATLAS_PALETTE.slate;

    const parents: ParentLink[] = parentStory
        ? [
              {
                  label: 'Parent story',
                  text: makeShortId('story', parentStory.id),
                  href: `/issues/stories/${parentStory.id}`,
              },
          ]
        : [];

    const addOptions: AddRelatedMenuOption[] = [
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
                    label: parentStory ? makeShortId('story', parentStory.id) : '—',
                    href: parentStory ? `/issues/stories/${parentStory.id}` : undefined,
                    mono: true,
                },
                { label: shortId, mono: true },
            ]}
            title={task.title}
            onTitleSave={(next) => patchTask({ title: next })}
            titleSaving={saving}
            issueType="sub_task"
            headerExtras={<AddRelatedMenu options={addOptions} label="Add related item" />}
            actions={
                <IssueDeleteAction
                    entityKind="sub_task"
                    entityTitle={task.title}
                    onDelete={async () => {
                        await deleteSubTask.mutateAsync(task.id);
                    }}
                    redirectTo={
                        parentStory ? `/issues/stories/${parentStory.id}` : '/issues'
                    }
                    onClone={() => setCloning(true)}
                />
            }
            rightRail={
                <>
                    <DetailsRailCard
                        issueType="sub_task"
                        status={task.status}
                        onStatusPick={(next, override) => void handleStatusPick(next, override)}
                        assigneeAgentId={task.assignee_agent_id}
                        onAssign={(agentId) => void handleAssign(agentId)}
                        assignee={assignee}
                        reassignLocked={task.status === 'in_progress'}
                        project={project}
                        parents={parents}
                        reporter={reporter}
                        ownerName={ownerName}
                        ownerAccent={ownerAccent}
                        priority={task.priority}
                        onPriorityPick={(next) => void patchTask({ priority: next })}
                        labels={task.labels ?? []}
                        labelSuggestions={projectLabels?.labels ?? []}
                        onLabelsChange={(next) => patchTask({ labels: next })}
                        createdAt={task.created_at}
                        updatedAt={task.updated_at}
                        roundCount={full?.round_count ?? null}
                        maxRounds={assignee?.max_rounds ?? null}
                        onResetRounds={() => void handleResetRounds()}
                        assigneeName={assignee?.name ?? null}
                        totalCostUsd={totalCostUsd}
                        worktreeBranch={task.worktree_branch}
                        worktreePath={task.worktree_path}
                    />
                    <ActivityLogCard
                        issueType="sub_task"
                        issueId={task.id}
                        activity={full?.activity}
                        agents={agents}
                    />
                </>
            }
        >
            <EditableMarkdownCard
                title="Description"
                value={task.description}
                placeholder="Describe what this sub-task does…"
                emptyHint="Click to add a description…"
                saving={saving}
                onSave={(next) => patchTask({ description: next })}
            />

            <EditableMarkdownCard
                title="Acceptance criteria"
                value={task.acceptance_criteria}
                placeholder={'- User can…\n- System ensures…'}
                emptyHint="Click to add acceptance criteria, one per line…"
                saving={saving}
                onSave={(next) => patchTask({ acceptance_criteria: next })}
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

            <RelatedItemsCard
                issueType="sub_task"
                issueId={task.id}
                relatedLinks={full?.related_links}
                externalLinks={full?.external_links}
                agents={agents}
                onOpenPicker={setPickerMode}
                allowAddTestLink
            />

            <ConversationCard
                issueType="sub_task"
                issueId={task.id}
                activity={full?.activity}
                agents={agents}
            />
        </IssueDetailShell>

        {pickerMode !== null && (
            <LinkPickerDialog
                open
                mode={pickerMode}
                fromIssueType="sub_task"
                fromIssueId={task.id}
                links={full?.related_links}
                restrictToEpicId={
                    pickerMode === 'tested_by' ? (parentStory?.epic_id ?? undefined) : undefined
                }
                onClose={() => setPickerMode(null)}
            />
        )}

        {cloning && (
            <Suspense fallback={null}>
                <NewIssueModal
                    open={cloning}
                    onClose={() => setCloning(false)}
                    initialKind="sub_task"
                    initialProjectId={project?.id ?? null}
                    initialParentStoryId={parentStory?.id ?? null}
                    initialValues={{
                        title: `CLONE ${task.title}`,
                        description: task.description,
                        acceptance_criteria: task.acceptance_criteria,
                    }}
                    cloneFromId={task.id}
                    cloneFromType="sub_task"
                />
            </Suspense>
        )}
        </>
    );
}
