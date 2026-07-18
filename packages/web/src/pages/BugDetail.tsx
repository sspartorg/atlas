import { Suspense, useMemo, useState } from 'react';
import { lazyNamed } from '../utils/lazyNamed.js';
import { useParams, useNavigate } from 'react-router-dom';
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
import { BugBodyCards, type BugFieldsPatch } from './issues/BugBodyCards.js';
import { useProjectLabels } from '../hooks/useProjectLabels.js';
import { useSettings } from '../hooks/useSettings.js';
import {
    useBugFull,
    useUpdateBug,
    useTransitionBug,
    useAssignBug,
    useResetRoundsBug,
    useDeleteBug,
} from '../hooks/useBugs.js';
import { IssueDeleteAction } from '../components/ConfirmDeleteModal.js';
import { useItemAgentRuns } from '../hooks/useAgents.js';
import { makeShortId } from '../hooks/useIssues.js';
import { useSetPageTitle } from '../components/shell/index.js';

export function BugDetail() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const bugId = id ?? '';
    useSetPageTitle(makeShortId('bug', bugId), 'Bug');

    // Single composite fetch — bug + epic + project + agents (and
    // related_links + activity, consumed by inner cards in a follow-up).
    // Replaces the prior 4-call fan-out.
    const { data: full, isLoading } = useBugFull(bugId);
    const { data: settings } = useSettings();
    const updateBug = useUpdateBug();
    const transitionBug = useTransitionBug();
    const assignBug = useAssignBug();
    const resetRoundsBug = useResetRoundsBug();
    const deleteBug = useDeleteBug();
    const [pickerMode, setPickerMode] = useState<
        'relates_to' | 'depends_on' | 'tested_by' | null
    >(null);
    const [cloning, setCloning] = useState(false);

    const bug = full?.bug;
    const epic = full?.epic ?? null;
    const project = full?.project ?? null;
    const { data: projectLabels } = useProjectLabels(project?.id);
    const agents = full?.agents ?? [];

    const assignee = useMemo(
        () =>
            bug?.assignee_agent_id
                ? (agents.find((w) => w.id === bug.assignee_agent_id) ?? null)
                : null,
        [agents, bug]
    );
    const reporter = useMemo(
        () =>
            bug?.reporter_agent_id
                ? (agents.find((w) => w.id === bug.reporter_agent_id) ?? null)
                : null,
        [agents, bug]
    );

    const { data: itemRuns } = useItemAgentRuns(bugId);
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
    if (!bug) {
        return (
            <Box sx={{ px: { xs: 3, md: 8 }, py: 4, textAlign: 'center' }}>
                <Typography sx={{ color: ATLAS_PALETTE.slate40 }}>Bug not found</Typography>
                <Button sx={{ mt: 4 }} onClick={() => navigate('/issues')}>
                    Back to Issues
                </Button>
            </Box>
        );
    }

    const shortId = makeShortId('bug', bug.id);
    const epicShortId = epic ? makeShortId('story', epic.id).replace('STR', 'EPC') : '—';
    const ownerName = settings?.owner_name ?? 'Owner';
    const ownerAccent = settings?.accent_color ?? ATLAS_PALETTE.slate;

    const parents: ParentLink[] = epic
        ? [{ label: 'Epic', text: epicShortId, href: `/epics/${epic.id}` }]
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
                { label: epicShortId, href: epic ? `/epics/${epic.id}` : undefined, mono: true },
                { label: shortId, mono: true },
            ]}
            title={bug.title}
            onTitleSave={(next) => updateBug.mutateAsync({ id: bug.id, data: { title: next } })}
            titleSaving={updateBug.isPending}
            issueType="bug"
            headerExtras={<AddRelatedMenu options={addOptions} label="Add related item" />}
            actions={
                <IssueDeleteAction
                    entityKind="bug"
                    entityTitle={bug.title}
                    onDelete={async () => {
                        await deleteBug.mutateAsync(bug.id);
                    }}
                    redirectTo={epic ? `/epics/${epic.id}` : '/issues'}
                    onClone={() => setCloning(true)}
                />
            }
            rightRail={
                <>
                    <DetailsRailCard
                        issueType="bug"
                        status={bug.status}
                        onStatusPick={(next, override) =>
                            void transitionBug.mutateAsync({
                                id: bug.id,
                                status: next,
                                override,
                            })
                        }
                        assigneeAgentId={bug.assignee_agent_id}
                        onAssign={(agentId) =>
                            void assignBug.mutateAsync({ id: bug.id, agentId })
                        }
                        assignee={assignee}
                        reassignLocked={bug.status === 'in_progress'}
                        project={project}
                        parents={parents}
                        reporter={reporter}
                        ownerName={ownerName}
                        ownerAccent={ownerAccent}
                        priority={bug.priority}
                        onPriorityPick={(next) =>
                            void updateBug.mutateAsync({ id: bug.id, data: { priority: next } })
                        }
                        labels={bug.labels ?? []}
                        labelSuggestions={projectLabels?.labels ?? []}
                        onLabelsChange={(next) =>
                            updateBug.mutateAsync({ id: bug.id, data: { labels: next } })
                        }
                        createdAt={bug.created_at}
                        updatedAt={bug.updated_at}
                        roundCount={full?.round_count ?? null}
                        maxRounds={assignee?.max_rounds ?? null}
                        onResetRounds={() =>
                            void resetRoundsBug.mutateAsync({ id: bug.id })
                        }
                        assigneeName={assignee?.name ?? null}
                        resetRoundsPending={resetRoundsBug.isPending}
                        totalCostUsd={totalCostUsd}
                        worktreeBranch={bug.worktree_branch}
                        worktreePath={bug.worktree_path}
                    />
                    <ActivityLogCard
                        issueType="bug"
                        issueId={bug.id}
                        activity={full?.activity}
                        agents={agents}
                    />
                </>
            }
        >
            <EditableMarkdownCard
                title="Description"
                value={bug.description}
                placeholder="Describe what the bug is about…"
                emptyHint="Click to add a description…"
                saving={updateBug.isPending}
                onSave={(next) =>
                    updateBug.mutateAsync({ id: bug.id, data: { description: next } })
                }
            />

            <BugBodyCards
                acceptance_criteria={bug.acceptance_criteria}
                steps_to_reproduce={bug.steps_to_reproduce}
                expected={bug.expected}
                actual={bug.actual}
                frequency={bug.frequency}
                failure_scope={bug.failure_scope}
                saving={updateBug.isPending}
                onUpdate={(patch: BugFieldsPatch) =>
                    updateBug.mutateAsync({ id: bug.id, data: patch })
                }
            />

            <RelatedItemsCard
                issueType="bug"
                issueId={bug.id}
                relatedLinks={full?.related_links}
                externalLinks={full?.external_links}
                agents={agents}
                onOpenPicker={setPickerMode}
                allowAddTestLink
            />

            <ConversationCard
                issueType="bug"
                issueId={bug.id}
                activity={full?.activity}
                agents={agents}
            />
        </IssueDetailShell>

        {pickerMode !== null && (
            <LinkPickerDialog
                open
                mode={pickerMode}
                fromIssueType="bug"
                fromIssueId={bug.id}
                links={full?.related_links}
                restrictToEpicId={pickerMode === 'tested_by' ? bug.epic_id : undefined}
                onClose={() => setPickerMode(null)}
            />
        )}

        {cloning && (
            <Suspense fallback={null}>
                <NewIssueModal
                    open={cloning}
                    onClose={() => setCloning(false)}
                    initialKind="bug"
                    initialProjectId={project?.id ?? null}
                    initialParentEpicId={epic?.id ?? null}
                    initialValues={{
                        title: `CLONE ${bug.title}`,
                        description: bug.description,
                        acceptance_criteria: bug.acceptance_criteria,
                        steps_to_reproduce: bug.steps_to_reproduce,
                        expected: bug.expected,
                        actual: bug.actual,
                        frequency: bug.frequency,
                        failure_scope: bug.failure_scope,
                    }}
                    cloneFromId={bug.id}
                    cloneFromType="bug"
                />
            </Suspense>
        )}
        </>
    );
}
