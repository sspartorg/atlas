import { Suspense, useMemo, useState } from 'react';
import { lazyNamed } from '../utils/lazyNamed.js';
import { useParams, useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
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
    KindIcon,
    type AddRelatedMenuOption,
    type ParentLink,
    type WorkItemTableRow,
} from '../components/index.js';
const NewIssueModal = lazyNamed(
    () => import('../components/issues/NewIssueModal.js'),
    'NewIssueModal',
);
import type { NewIssueKind } from '../components/issues/NewIssueModal.js';
import {
    useEpicFull,
    useTransitionEpic,
    useAssignEpic,
    useResetRoundsEpic,
    useUpdateEpic,
    useDeleteEpic,
} from '../hooks/useEpics.js';
import { IssueDeleteAction } from '../components/ConfirmDeleteModal.js';
import { useProjectLabels } from '../hooks/useProjectLabels.js';
import { useSettings } from '../hooks/useSettings.js';
import { useItemAgentRuns } from '../hooks/useAgents.js';
import { IssueDetailShell, IssueDetailLoading } from './issues/IssueDetailShell.js';
import { ATLAS_PALETTE } from '../theme/tokens.js';
import { relativeTime } from '../utils/time.js';
import { useSetPageTitle } from '../components/shell/index.js';

export function EpicDetail() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    useSetPageTitle('Epic');

    // Single composite fetch — epic + project + stories + bugs + agents.
    const { data: full, isLoading } = useEpicFull(id ?? '');
    const { data: settings } = useSettings();
    const transitionEpic = useTransitionEpic();
    const assignEpic = useAssignEpic();
    const resetRoundsEpic = useResetRoundsEpic();
    const updateEpic = useUpdateEpic();
    const deleteEpic = useDeleteEpic();
    const [createKind, setCreateKind] = useState<NewIssueKind | null>(null);
    // tested_by is in the union to satisfy the RelatedItemsCard onOpenPicker
    // type, but allowAddTestLink is omitted on EpicDetail so the picker
    // never actually opens in tested_by mode from this page.
    const [pickerMode, setPickerMode] = useState<
        'relates_to' | 'depends_on' | 'tested_by' | null
    >(null);

    const epic = full?.epic;
    const project = full?.project ?? null;
    const stories = full?.stories ?? [];
    const bugs = full?.bugs ?? [];
    const agents = full?.agents ?? [];
    const { data: projectLabels } = useProjectLabels(project?.id);

    const agentsById = useMemo(() => new Map(agents.map((w) => [w.id, w])), [agents]);

    const { data: itemRuns } = useItemAgentRuns(id);
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
        return <IssueDetailLoading withBreadcrumb />;
    }

    if (!epic) {
        return (
            <Box sx={{ px: { xs: 3, md: 8 }, py: 4, textAlign: 'center' }}>
                <Typography sx={{ color: ATLAS_PALETTE.slate40, mb: 3 }}>
                    Epic not found
                </Typography>
                <Button onClick={() => navigate('/epics')}>Back to Epics</Button>
            </Box>
        );
    }

    const reporter = epic.reporter_agent_id
        ? (agentsById.get(epic.reporter_agent_id) ?? null)
        : null;
    const assignee = epic.assignee_agent_id
        ? (agentsById.get(epic.assignee_agent_id) ?? null)
        : null;
    const ownerName = settings?.owner_name ?? 'Owner';
    const ownerAccent = settings?.accent_color ?? ATLAS_PALETTE.slate;
    const seqLabel = epic.id;

    // Lock the assignee picker whenever an item is in progress so a agent
    // mid-task isn't yanked out from under itself. Toggle the item back to a
    // non-running status first if you need to reassign.
    const reassignLocked = epic.status === 'in_progress';

    const parents: ParentLink[] = [];

    const addOptions: AddRelatedMenuOption[] = [
        {
            label: 'Add story',
            icon: <KindIcon kind="story" size={14} />,
            onClick: () => setCreateKind('story'),
        },
        {
            label: 'Add bug',
            icon: <KindIcon kind="bug" size={14} />,
            onClick: () => setCreateKind('bug'),
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
                ...(project
                    ? [{ label: project.name, href: `/projects/${project.id}` }]
                    : []),
                { label: seqLabel, mono: true },
            ]}
            title={epic.title}
            onTitleSave={(next) =>
                updateEpic.mutateAsync({ id: epic.id, data: { title: next } })
            }
            titleSaving={updateEpic.isPending}
            issueType="epic"
            headerExtras={<AddRelatedMenu options={addOptions} label="Add child item" />}
            actions={
                <IssueDeleteAction
                    entityKind="epic"
                    entityTitle={epic.title}
                    onDelete={async () => {
                        await deleteEpic.mutateAsync(epic.id);
                    }}
                    redirectTo={project ? `/projects/${project.id}` : '/epics'}
                />
            }
            rightRail={
                <>
                    <DetailsRailCard
                        issueType="epic"
                        status={epic.status}
                        onStatusPick={(next, override) =>
                            void transitionEpic.mutateAsync({
                                id: epic.id,
                                status: next,
                                override,
                            })
                        }
                        assigneeAgentId={epic.assignee_agent_id}
                        onAssign={(agentId) => void assignEpic.mutateAsync({ id: epic.id, agentId })}
                        assignee={assignee}
                        reassignLocked={reassignLocked}
                        project={project}
                        parents={parents}
                        reporter={reporter}
                        ownerName={ownerName}
                        ownerAccent={ownerAccent}
                        priority={epic.priority}
                        onPriorityPick={(next) =>
                            void updateEpic.mutateAsync({ id: epic.id, data: { priority: next } })
                        }
                        labels={epic.labels ?? []}
                        labelSuggestions={projectLabels?.labels ?? []}
                        onLabelsChange={(next) =>
                            updateEpic.mutateAsync({ id: epic.id, data: { labels: next } })
                        }
                        createdAt={epic.created_at}
                        updatedAt={epic.updated_at}
                        roundCount={full?.round_count ?? null}
                        maxRounds={assignee?.max_rounds ?? null}
                        onResetRounds={() =>
                            void resetRoundsEpic.mutateAsync({ id: epic.id })
                        }
                        assigneeName={assignee?.name ?? null}
                        resetRoundsPending={resetRoundsEpic.isPending}
                        totalCostUsd={totalCostUsd}
                    />
                    <ActivityLogCard
                        issueType="epic"
                        issueId={epic.id}
                        activity={full?.activity}
                        agents={agents}
                    />
                </>
            }
        >
            <EditableMarkdownCard
                title="Description"
                value={epic.description}
                placeholder="Describe what this epic is for…"
                emptyHint="No description yet — click to add one."
                saving={updateEpic.isPending}
                onSave={(next) =>
                    updateEpic.mutateAsync({ id: epic.id, data: { description: next } })
                }
            />

            <WorkItemTable
                title="Stories"
                rows={stories.map((s) => ({
                    id: s.id,
                    kind: 'story',
                    shortId: s.id,
                    title: s.title,
                    status: s.status,
                    assignee_agent_id: s.assignee_agent_id,
                    reporter_agent_id: s.reporter_agent_id,
                    updated_at: s.updated_at,
                })) satisfies WorkItemTableRow[]}
                agentsById={agentsById}
                ownerName={ownerName}
                ownerAccent={ownerAccent}
                formatRelative={relativeTime}
                onRowClick={(row) => navigate(`/issues/stories/${row.id}`)}
                hideWhenEmpty
            />

            <WorkItemTable
                title="Bugs"
                rows={bugs.map((b) => ({
                    id: b.id,
                    kind: 'bug',
                    shortId: b.id,
                    title: b.title,
                    status: b.status,
                    assignee_agent_id: b.assignee_agent_id,
                    reporter_agent_id: b.reporter_agent_id,
                    updated_at: b.updated_at,
                })) satisfies WorkItemTableRow[]}
                agentsById={agentsById}
                ownerName={ownerName}
                ownerAccent={ownerAccent}
                formatRelative={relativeTime}
                onRowClick={(row) => navigate(`/issues/bugs/${row.id}`)}
                hideWhenEmpty
            />

            <RelatedItemsCard
                issueType="epic"
                issueId={epic.id}
                relatedLinks={full?.related_links}
                externalLinks={full?.external_links}
                agents={agents}
                onOpenPicker={setPickerMode}
            />

            <ConversationCard
                issueType="epic"
                issueId={epic.id}
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
                    initialParentEpicId={epic.id}
                />
            </Suspense>
        )}

        {pickerMode !== null && (
            <LinkPickerDialog
                open
                mode={pickerMode}
                fromIssueType="epic"
                fromIssueId={epic.id}
                links={full?.related_links}
                onClose={() => setPickerMode(null)}
            />
        )}
        </>
    );
}
