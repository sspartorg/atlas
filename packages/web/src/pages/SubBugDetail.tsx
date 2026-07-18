import { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import { ATLAS_PALETTE } from '../theme/tokens.js';
import { IssueDetailShell, IssueDetailLoading } from './issues/IssueDetailShell.js';
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
    type AddRelatedMenuOption,
    type ParentLink,
} from '../components/index.js';
import { Suspense } from 'react';
import { lazyNamed } from '../utils/lazyNamed.js';
const NewIssueModal = lazyNamed(
    () => import('../components/issues/NewIssueModal.js'),
    'NewIssueModal',
);
import { BugBodyCards, type BugFieldsPatch } from './issues/BugBodyCards.js';
import { useSubBugFull, useDeleteSubBug } from '../hooks/useStories.js';
import { IssueDeleteAction } from '../components/ConfirmDeleteModal.js';
import { useProjectLabels } from '../hooks/useProjectLabels.js';
import { useSettings } from '../hooks/useSettings.js';
import { useItemAgentRuns } from '../hooks/useAgents.js';
import { api } from '../api/api.js';
import { makeShortId } from '../hooks/useIssues.js';
import type { ISubBug, IssueStatus } from '@atlas/shared';
import { useSetPageTitle } from '../components/shell/index.js';

export function SubBugDetail() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const qc = useQueryClient();
    const bugId = id ?? '';
    useSetPageTitle(makeShortId('sub_bug', bugId), 'Sub-bug');

    // Single composite fetch — sub-bug + parent_story + epic + project +
    // agents (and related_links + activity, consumed by inner cards in a
    // follow-up). Replaces the prior multi-call fan-out and the
    // qc.fetchQuery(['sub-bugs']) full-list scan.
    const { data: full, isLoading } = useSubBugFull(bugId);
    const { data: settings } = useSettings();
    const deleteSubBug = useDeleteSubBug();

    const [saving, setSaving] = useState(false);
    const [pickerMode, setPickerMode] = useState<
        'relates_to' | 'depends_on' | 'tested_by' | null
    >(null);
    const [cloning, setCloning] = useState(false);

    const bug = full?.sub_bug;
    const parentStory = full?.parent_story ?? null;
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

    async function patchBug(data: Partial<ISubBug>) {
        if (!bug) return;
        setSaving(true);
        try {
            await api.subBugs.update(bug.id, data);
            // ['sub-bugs'] prefix covers ['sub-bugs', bugId, 'full'];
            // ['stories'] covers parent story's sub-bug list.
            await qc.invalidateQueries({ queryKey: ['stories'] });
            await qc.invalidateQueries({ queryKey: ['sub-bugs'] });
            await qc.invalidateQueries({ queryKey: ['issues'] });
            await qc.invalidateQueries({ queryKey: ['labels'] });
        } finally {
            setSaving(false);
        }
    }

    async function handleStatusPick(next: IssueStatus, override: boolean) {
        if (!bug) return;
        await api.subBugs.transition(bug.id, next, override);
        await qc.invalidateQueries({ queryKey: ['stories'] });
        await qc.invalidateQueries({ queryKey: ['sub-bugs'] });
        await qc.invalidateQueries({ queryKey: ['issues'] });
    }

    async function handleAssign(agentId: string | null) {
        if (!bug) return;
        await api.subBugs.assign(bug.id, agentId);
        // ['stories'] is a prefix match — covers ['stories', :id, 'sub-bugs']
        // which StoryDetail's useSubBugs() reads, so the parent story's
        // sub-bug list refreshes the next time it mounts.
        await qc.invalidateQueries({ queryKey: ['stories'] });
        await qc.invalidateQueries({ queryKey: ['sub-bugs'] });
        await qc.invalidateQueries({ queryKey: ['issues'] });
    }

    async function handleResetRounds() {
        if (!bug) return;
        await api.subBugs.resetRounds(bug.id);
        await qc.invalidateQueries({ queryKey: ['sub-bugs', bug.id, 'full'] });
    }


    if (isLoading) {
        return <IssueDetailLoading />;
    }
    if (!bug) {
        return (
            <Box sx={{ px: { xs: 3, md: 8 }, py: 4, textAlign: 'center' }}>
                <Typography sx={{ color: ATLAS_PALETTE.slate40 }}>Sub-bug not found</Typography>
                <Button sx={{ mt: 4 }} onClick={() => navigate('/issues')}>
                    Back to Issues
                </Button>
            </Box>
        );
    }

    const shortId = makeShortId('sub_bug', bug.id);
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
            title={bug.title}
            onTitleSave={(next) => patchBug({ title: next })}
            titleSaving={saving}
            issueType="sub_bug"
            headerExtras={<AddRelatedMenu options={addOptions} label="Add related item" />}
            actions={
                <IssueDeleteAction
                    entityKind="sub_bug"
                    entityTitle={bug.title}
                    onDelete={async () => {
                        await deleteSubBug.mutateAsync(bug.id);
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
                        issueType="sub_bug"
                        status={bug.status}
                        onStatusPick={(next, override) => void handleStatusPick(next, override)}
                        assigneeAgentId={bug.assignee_agent_id}
                        onAssign={(agentId) => void handleAssign(agentId)}
                        assignee={assignee}
                        reassignLocked={bug.status === 'in_progress'}
                        project={project}
                        parents={parents}
                        reporter={reporter}
                        ownerName={ownerName}
                        ownerAccent={ownerAccent}
                        priority={bug.priority}
                        onPriorityPick={(next) => void patchBug({ priority: next })}
                        labels={bug.labels ?? []}
                        labelSuggestions={projectLabels?.labels ?? []}
                        onLabelsChange={(next) => patchBug({ labels: next })}
                        createdAt={bug.created_at}
                        updatedAt={bug.updated_at}
                        roundCount={full?.round_count ?? null}
                        maxRounds={assignee?.max_rounds ?? null}
                        onResetRounds={() => void handleResetRounds()}
                        assigneeName={assignee?.name ?? null}
                        totalCostUsd={totalCostUsd}
                        worktreeBranch={bug.worktree_branch}
                        worktreePath={bug.worktree_path}
                    />
                    <ActivityLogCard
                        issueType="sub_bug"
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
                placeholder="Describe what this sub-bug is about…"
                emptyHint="Click to add a description…"
                saving={saving}
                onSave={(next) => patchBug({ description: next })}
            />

            <BugBodyCards
                acceptance_criteria={bug.acceptance_criteria}
                steps_to_reproduce={bug.steps_to_reproduce}
                expected={bug.expected}
                actual={bug.actual}
                frequency={bug.frequency}
                failure_scope={bug.failure_scope}
                saving={saving}
                onUpdate={(patch: BugFieldsPatch) => patchBug(patch)}
            />

            <RelatedItemsCard
                issueType="sub_bug"
                issueId={bug.id}
                relatedLinks={full?.related_links}
                externalLinks={full?.external_links}
                agents={agents}
                onOpenPicker={setPickerMode}
                allowAddTestLink
            />

            <ConversationCard
                issueType="sub_bug"
                issueId={bug.id}
                activity={full?.activity}
                agents={agents}
            />
        </IssueDetailShell>

        {pickerMode !== null && (
            <LinkPickerDialog
                open
                mode={pickerMode}
                fromIssueType="sub_bug"
                fromIssueId={bug.id}
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
                    initialKind="sub_bug"
                    initialProjectId={project?.id ?? null}
                    initialParentStoryId={parentStory?.id ?? null}
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
                    cloneFromType="sub_bug"
                />
            </Suspense>
        )}
        </>
    );
}
