import { useMemo, useState } from 'react';
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
import { useSubTaskFull, useDeleteSubTask } from '../hooks/useSubTasks.js';
import { IssueDeleteAction } from '../components/ConfirmDeleteModal.js';
import { useProjectLabels } from '../hooks/useProjectLabels.js';
import { useSettings } from '../hooks/useSettings.js';
import { useItemAgentRuns } from '../hooks/useAgents.js';
import { api } from '../api/api.js';
import type { ISubTask, IssueStatus } from '@atlas/shared';
import { useSetPageTitle } from '../components/shell/index.js';

export function SubTaskDetail() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const qc = useQueryClient();
    const subTaskId = id ?? '';
    useSetPageTitle(subTaskId, 'Sub-task');

    const { data: full, isLoading } = useSubTaskFull(subTaskId);
    const { data: settings } = useSettings();
    const deleteSubTask = useDeleteSubTask();

    const [saving, setSaving] = useState(false);
    const [pickerMode, setPickerMode] = useState<
        'relates_to' | 'depends_on' | 'tested_by' | null
    >(null);

    const subTask = full?.sub_task;
    const parentTask = full?.task ?? null;
    const project = full?.project ?? null;
    const agents = full?.agents ?? [];
    const { data: projectLabels } = useProjectLabels(project?.id);

    const assignee = useMemo(
        () =>
            subTask?.assignee_agent_id
                ? (agents.find((w) => w.id === subTask.assignee_agent_id) ?? null)
                : null,
        [agents, subTask]
    );
    const reporter = useMemo(
        () =>
            subTask?.reporter_agent_id
                ? (agents.find((w) => w.id === subTask.reporter_agent_id) ?? null)
                : null,
        [agents, subTask]
    );

    const { data: itemRuns } = useItemAgentRuns(subTaskId);
    const totalCostUsd = useMemo(() => {
        if (!itemRuns?.length) return null;
        let sum = 0;
        let hasAny = false;
        for (const r of itemRuns) {
            if (r.total_cost_usd != null) { sum += r.total_cost_usd; hasAny = true; }
        }
        return hasAny ? sum : null;
    }, [itemRuns]);

    async function patchSubTask(data: Partial<ISubTask>) {
        if (!subTask) return;
        setSaving(true);
        try {
            await api.subTasks.update(subTask.id, data);
            // ['sub-tasks'] prefix covers ['sub-tasks', subTaskId, 'full'];
            // ['tasks'] covers the parent task's sub-task list.
            await qc.invalidateQueries({ queryKey: ['tasks'] });
            await qc.invalidateQueries({ queryKey: ['sub-tasks'] });
            await qc.invalidateQueries({ queryKey: ['issues'] });
            await qc.invalidateQueries({ queryKey: ['labels'] });
        } finally {
            setSaving(false);
        }
    }

    async function handleStatusPick(next: IssueStatus, override: boolean) {
        if (!subTask) return;
        await api.subTasks.transition(subTask.id, next, override);
        await qc.invalidateQueries({ queryKey: ['tasks'] });
        await qc.invalidateQueries({ queryKey: ['sub-tasks'] });
        await qc.invalidateQueries({ queryKey: ['issues'] });
    }

    async function handleAssign(agentId: string | null) {
        if (!subTask) return;
        await api.subTasks.assign(subTask.id, agentId);
        await qc.invalidateQueries({ queryKey: ['tasks'] });
        await qc.invalidateQueries({ queryKey: ['sub-tasks'] });
        await qc.invalidateQueries({ queryKey: ['issues'] });
    }


    if (isLoading) {
        return <IssueDetailLoading />;
    }
    if (!subTask) {
        return (
            <Box sx={{ px: { xs: 3, md: 8 }, py: 4, textAlign: 'center' }}>
                <Typography sx={{ color: ATLAS_PALETTE.slate40 }}>Sub-task not found</Typography>
                <Button sx={{ mt: 4 }} onClick={() => navigate('/tasks')}>
                    Back to Tasks
                </Button>
            </Box>
        );
    }

    const ownerName = settings?.owner_name ?? 'Owner';
    const ownerAccent = settings?.accent_color ?? ATLAS_PALETTE.slate;

    const parents: ParentLink[] = parentTask
        ? [{ label: 'Task', text: parentTask.id, href: `/tasks/${parentTask.id}` }]
        : [];

    // Clone lands next to the source under the same task and links back to
    // it; the Owner edits the copy on its own page.
    async function handleClone() {
        if (!subTask) return;
        const created = await api.subTasks.create(subTask.task_id, {
            title: `CLONE ${subTask.title}`,
            description: subTask.description,
            acceptance_criteria: subTask.acceptance_criteria,
            labels: subTask.labels,
        });
        await api.issueLinks
            .create('sub_task', created.id, 'sub_task', subTask.id, 'relates_to')
            .catch(() => undefined);
        await qc.invalidateQueries({ queryKey: ['tasks'] });
        navigate(`/sub-tasks/${created.id}`);
    }

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
                {
                    label: parentTask?.id ?? '—',
                    href: parentTask ? `/tasks/${parentTask.id}` : undefined,
                    mono: true,
                },
                { label: subTask.id, mono: true },
            ]}
            title={subTask.title}
            onTitleSave={(next) => patchSubTask({ title: next })}
            titleSaving={saving}
            issueType="sub_task"
            headerExtras={<AddRelatedMenu options={addOptions} label="Add related item" />}
            actions={
                <IssueDeleteAction
                    entityKind="sub_task"
                    entityTitle={subTask.title}
                    onDelete={async () => {
                        await deleteSubTask.mutateAsync(subTask.id);
                    }}
                    redirectTo={parentTask ? `/tasks/${parentTask.id}` : '/tasks'}
                    onClone={() => void handleClone()}
                />
            }
            rightRail={
                <>
                    <DetailsRailCard
                        issueType="sub_task"
                        issueId={subTask.id}
                        externalLinks={full?.external_links}
                        status={subTask.status}
                        onStatusPick={(next, override) => void handleStatusPick(next, override)}
                        assigneeAgentId={subTask.assignee_agent_id}
                        onAssign={(agentId) => void handleAssign(agentId)}
                        assignee={assignee}
                        reassignLocked={subTask.status === 'in_progress'}
                        project={project}
                        parents={parents}
                        reporter={reporter}
                        ownerName={ownerName}
                        ownerAccent={ownerAccent}
                        priority={subTask.priority}
                        onPriorityPick={(next) => void patchSubTask({ priority: next })}
                        labels={subTask.labels ?? []}
                        labelSuggestions={projectLabels?.labels ?? []}
                        onLabelsChange={(next) => patchSubTask({ labels: next })}
                        createdAt={subTask.created_at}
                        updatedAt={subTask.updated_at}
                        totalCostUsd={totalCostUsd}
                    />
                    <ActivityLogCard
                        issueType="sub_task"
                        issueId={subTask.id}
                        activity={full?.activity}
                        agents={agents}
                    />
                </>
            }
        >
            <EditableMarkdownCard
                title="Description"
                value={subTask.description}
                placeholder="Describe what this sub-task does…"
                emptyHint="Click to add a description…"
                saving={saving}
                onSave={(next) => patchSubTask({ description: next })}
            />

            <EditableMarkdownCard
                title="Acceptance criteria"
                value={subTask.acceptance_criteria}
                placeholder={'- User can…\n- System ensures…'}
                emptyHint="Click to add acceptance criteria, one per line…"
                saving={saving}
                onSave={(next) => patchSubTask({ acceptance_criteria: next })}
            />

            <RelatedItemsCard
                issueType="sub_task"
                issueId={subTask.id}
                relatedLinks={full?.related_links}
                externalLinks={full?.external_links}
                agents={agents}
                onOpenPicker={setPickerMode}
                allowAddTestLink
            />

            <ConversationCard
                issueType="sub_task"
                issueId={subTask.id}
                activity={full?.activity}
                agents={agents}
                status={subTask.status}
                assigneeAgentId={subTask.assignee_agent_id}
                runs={itemRuns}
            />
        </IssueDetailShell>

        {pickerMode !== null && (
            <LinkPickerDialog
                open
                mode={pickerMode}
                fromIssueType="sub_task"
                fromIssueId={subTask.id}
                links={full?.related_links}
                restrictToTaskId={pickerMode === 'tested_by' ? subTask.task_id : undefined}
                onClose={() => setPickerMode(null)}
            />
        )}
        </>
    );
}
