import { useMemo, useState, type ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Link from '@mui/material/Link';
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
    WorkItemTable,
    type AddRelatedMenuOption,
    type WorkItemTableRow,
} from '../components/index.js';
import { LabelsFormField } from '../components/LabelsFormField.js';
import { MarkdownPreview } from '../components/MarkdownPreview.js';
import {
    useTaskFull,
    useTransitionTask,
    useAssignTask,
    useUpdateTask,
    useDeleteTask,
} from '../hooks/useTasks.js';
import { useCreateSubTask } from '../hooks/useSubTasks.js';
import { IssueDeleteAction } from '../components/ConfirmDeleteModal.js';
import { useProjectLabels } from '../hooks/useProjectLabels.js';
import { useSettings } from '../hooks/useSettings.js';
import { useItemAgentRuns } from '../hooks/useAgents.js';
import { useDraftGuard } from '../hooks/useDraftGuard.js';
import { IssueDetailShell, IssueDetailLoading } from './issues/IssueDetailShell.js';
import { ATLAS_PALETTE } from '../theme/tokens.js';
import { relativeTime } from '../utils/time.js';
import { ReorderSubTasksDialog } from './tasks/ReorderSubTasksDialog.js';
import { useSetPageTitle } from '../components/shell/index.js';

const CARD_SX = {
    background: ATLAS_PALETTE.white,
    border: `1px solid ${ATLAS_PALETTE.slate10}`,
    borderRadius: '12px',
    p: 5,
};

const CARD_TITLE_SX = {
    fontSize: 11,
    fontWeight: 600,
    color: ATLAS_PALETTE.slate60,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    mb: 2,
} as const;

function ReadOnlyCard({ title, children }: { title: string; children: ReactNode }) {
    return (
        <Box sx={CARD_SX}>
            <Typography sx={CARD_TITLE_SX}>{title}</Typography>
            {children}
        </Box>
    );
}

function AddSubTaskForm({
    taskId,
    labelSuggestions,
    onDone,
}: {
    taskId: string;
    labelSuggestions: string[];
    onDone: () => void;
}) {
    const createSubTask = useCreateSubTask();
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [acceptanceCriteria, setAcceptanceCriteria] = useState('');
    const [labels, setLabels] = useState<string[]>([]);

    useDraftGuard(Boolean(title.trim() || description.trim() || acceptanceCriteria.trim()));

    async function submit() {
        await createSubTask.mutateAsync({
            taskId,
            data: {
                title: title.trim(),
                description,
                acceptance_criteria: acceptanceCriteria,
                labels,
            },
        });
        onDone();
    }

    return (
        <Box
            component="form"
            aria-label="Add sub-task"
            onSubmit={(e) => {
                e.preventDefault();
                void submit().catch(() => undefined);
            }}
            sx={{ ...CARD_SX, display: 'flex', flexDirection: 'column', gap: 3 }}
        >
            <Typography sx={{ ...CARD_TITLE_SX, mb: 0 }}>New sub-task</Typography>
            <TextField
                size="small"
                label="Title"
                required
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
            />
            <TextField
                size="small"
                label="Description"
                multiline
                minRows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
            />
            <TextField
                size="small"
                label="Acceptance criteria"
                multiline
                minRows={2}
                placeholder={'- User can…\n- System ensures…'}
                value={acceptanceCriteria}
                onChange={(e) => setAcceptanceCriteria(e.target.value)}
            />
            <LabelsFormField labels={labels} onChange={setLabels} suggestions={labelSuggestions} />
            {createSubTask.error && (
                <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.error }}>
                    {createSubTask.error.message}
                </Typography>
            )}
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
                <Button variant="text" onClick={onDone} disabled={createSubTask.isPending}>
                    Cancel
                </Button>
                <Button
                    type="submit"
                    variant="contained"
                    disabled={!title.trim() || createSubTask.isPending}
                >
                    Add sub-task
                </Button>
            </Box>
        </Box>
    );
}

export function TaskDetail() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    useSetPageTitle('Task');

    const { data: full, isLoading } = useTaskFull(id ?? '');
    const { data: settings } = useSettings();
    const transitionTask = useTransitionTask();
    const assignTask = useAssignTask();
    const updateTask = useUpdateTask();
    const deleteTask = useDeleteTask();
    const [adding, setAdding] = useState(false);
    const [reordering, setReordering] = useState(false);
    // tested_by is in the union to satisfy the RelatedItemsCard onOpenPicker
    // type, but allowAddTestLink is omitted on TaskDetail so the picker
    // never actually opens in tested_by mode from this page.
    const [pickerMode, setPickerMode] = useState<'relates_to' | 'depends_on' | 'tested_by' | null>(
        null
    );

    const task = full?.task;
    const project = full?.project ?? null;
    const subTasks = full?.sub_tasks ?? [];
    const agents = full?.agents ?? [];
    const { data: projectLabels } = useProjectLabels(project?.id);

    const agentsById = useMemo(() => new Map(agents.map((w) => [w.id, w])), [agents]);

    const { data: itemRuns } = useItemAgentRuns(id);
    const totalCostUsd = useMemo(() => {
        if (!itemRuns?.length) return null;
        let sum = 0;
        let hasAny = false;
        for (const r of itemRuns) {
            if (r.total_cost_usd != null) {
                sum += r.total_cost_usd;
                hasAny = true;
            }
        }
        return hasAny ? sum : null;
    }, [itemRuns]);

    if (isLoading) {
        return <IssueDetailLoading withBreadcrumb />;
    }

    if (!task) {
        return (
            <Box sx={{ px: { xs: 3, md: 8 }, py: 4, textAlign: 'center' }}>
                <Typography sx={{ color: ATLAS_PALETTE.slate40, mb: 3 }}>Task not found</Typography>
                <Button onClick={() => navigate('/tasks')}>Back to Tasks</Button>
            </Box>
        );
    }

    const reporter = task.reporter_agent_id
        ? (agentsById.get(task.reporter_agent_id) ?? null)
        : null;
    const assignee = task.assignee_agent_id
        ? (agentsById.get(task.assignee_agent_id) ?? null)
        : null;
    const ownerName = settings?.owner_name ?? 'Owner';
    const ownerAccent = settings?.accent_color ?? ATLAS_PALETTE.slate;
    const labelSuggestions = projectLabels?.labels ?? [];

    // Lock the assignee picker whenever an item is in progress so an agent
    // mid-task isn't yanked out from under itself. Toggle the item back to a
    // non-running status first if you need to reassign.
    const reassignLocked = task.status === 'in_progress';

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
                    { label: 'Tasks', href: '/tasks' },
                    { label: task.id, mono: true },
                ]}
                title={task.title}
                onTitleSave={(next) =>
                    updateTask.mutateAsync({ id: task.id, data: { title: next } })
                }
                titleSaving={updateTask.isPending}
                issueType="task"
                headerExtras={<AddRelatedMenu options={addOptions} label="Add related item" />}
                actions={
                    <IssueDeleteAction
                        entityKind="task"
                        entityTitle={task.title}
                        onDelete={async () => {
                            await deleteTask.mutateAsync(task.id);
                        }}
                        redirectTo="/tasks"
                    />
                }
                rightRail={
                    <>
                        <DetailsRailCard
                            issueType="task"
                            issueId={task.id}
                            externalLinks={full?.external_links}
                            status={task.status}
                            onStatusPick={(next, override) =>
                                void transitionTask.mutateAsync({
                                    id: task.id,
                                    status: next,
                                    override,
                                })
                            }
                            assigneeAgentId={task.assignee_agent_id}
                            onAssign={(agentId) =>
                                void assignTask.mutateAsync({ id: task.id, agentId })
                            }
                            assignee={assignee}
                            reassignLocked={reassignLocked}
                            project={project}
                            reporter={reporter}
                            ownerName={ownerName}
                            ownerAccent={ownerAccent}
                            priority={task.priority}
                            onPriorityPick={(next) =>
                                void updateTask.mutateAsync({
                                    id: task.id,
                                    data: { priority: next },
                                })
                            }
                            labels={task.labels ?? []}
                            labelSuggestions={labelSuggestions}
                            onLabelsChange={(next) =>
                                updateTask.mutateAsync({ id: task.id, data: { labels: next } })
                            }
                            repoIds={task.repo_ids ?? []}
                            onRepoIdsChange={(next) =>
                                updateTask.mutateAsync({ id: task.id, data: { repo_ids: next } })
                            }
                            createdAt={task.created_at}
                            updatedAt={task.updated_at}
                            totalCostUsd={totalCostUsd}
                            worktreeBranch={task.worktree_branch}
                            worktreePath={task.worktree_path}
                        />
                        <ActivityLogCard
                            issueType="task"
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
                    placeholder="Describe what this task is for…"
                    emptyHint="No description yet — click to add one."
                    saving={updateTask.isPending}
                    onSave={(next) =>
                        updateTask.mutateAsync({ id: task.id, data: { description: next } })
                    }
                />

                <EditableMarkdownCard
                    title="Acceptance criteria"
                    value={task.acceptance_criteria}
                    placeholder={'- User can…\n- System ensures…'}
                    emptyHint="Click to add acceptance criteria, one per line…"
                    saving={updateTask.isPending}
                    onSave={(next) =>
                        updateTask.mutateAsync({ id: task.id, data: { acceptance_criteria: next } })
                    }
                />

                {task.spec_md?.trim() && (
                    <ReadOnlyCard title="Spec">
                        <MarkdownPreview source={task.spec_md} />
                    </ReadOnlyCard>
                )}

                {task.pr_url && (
                    <ReadOnlyCard title="Pull request">
                        <Link
                            href={task.pr_url}
                            target="_blank"
                            rel="noreferrer"
                            sx={{ fontSize: 13 }}
                        >
                            {task.pr_url}
                        </Link>
                    </ReadOnlyCard>
                )}

                <WorkItemTable
                    title="Sub-tasks"
                    rows={
                        subTasks.map((s) => ({
                            id: s.id,
                            kind: 'sub_task',
                            shortId: s.id,
                            title: s.title,
                            status: s.status,
                            labels: s.labels,
                            assignee_agent_id: s.assignee_agent_id,
                            reporter_agent_id: s.reporter_agent_id,
                            updated_at: s.updated_at,
                        })) satisfies WorkItemTableRow[]
                    }
                    agentsById={agentsById}
                    ownerName={ownerName}
                    ownerAccent={ownerAccent}
                    formatRelative={relativeTime}
                    onRowClick={(row) => navigate(`/sub-tasks/${row.id}`)}
                    headerRight={
                        adding ? null : (
                            <Stack direction="row" spacing={1}>
                                {subTasks.length > 1 && (
                                    <Button
                                        size="small"
                                        variant="text"
                                        onClick={() => setReordering(true)}
                                    >
                                        Reorder
                                    </Button>
                                )}
                                <Button
                                    size="small"
                                    variant="outlined"
                                    onClick={() => setAdding(true)}
                                >
                                    Add sub-task
                                </Button>
                            </Stack>
                        )
                    }
                />

                {reordering && (
                    <ReorderSubTasksDialog
                        taskId={task.id}
                        subTasks={subTasks}
                        onClose={() => setReordering(false)}
                    />
                )}

                {adding && (
                    <AddSubTaskForm
                        taskId={task.id}
                        labelSuggestions={labelSuggestions}
                        onDone={() => setAdding(false)}
                    />
                )}

                <RelatedItemsCard
                    issueType="task"
                    issueId={task.id}
                    relatedLinks={full?.related_links}
                    externalLinks={full?.external_links}
                    agents={agents}
                    onOpenPicker={setPickerMode}
                />

                <ConversationCard
                    issueType="task"
                    issueId={task.id}
                    activity={full?.activity}
                    agents={agents}
                    status={task.status}
                    assigneeAgentId={task.assignee_agent_id}
                    runs={itemRuns}
                />
            </IssueDetailShell>

            {pickerMode !== null && (
                <LinkPickerDialog
                    open
                    mode={pickerMode}
                    fromIssueType="task"
                    fromIssueId={task.id}
                    links={full?.related_links}
                    onClose={() => setPickerMode(null)}
                />
            )}
        </>
    );
}
