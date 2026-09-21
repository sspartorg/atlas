import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import { useNavigate } from 'react-router-dom';
import LockOutlined from '@mui/icons-material/LockOutlined';
import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded';
import CheckRounded from '@mui/icons-material/CheckRounded';
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import type {
    IProject,
    IAgent,
    IItemExternalLink,
    IssueStatus,
    IssueType,
    IssuePriority,
} from '@atlas/shared';
import { StatusChip } from './StatusChip.js';
import { PriorityChip } from './PriorityChip.js';
import { AgentChip } from './AgentChip.js';
import { AssigneePickerPopover } from './AssigneePickerPopover.js';
import { StatusPickerPopover } from './StatusPickerPopover.js';
import { PriorityPickerPopover } from './PriorityPickerPopover.js';
import { InfoPanel, InfoRow } from './InfoPanel.js';
import { LabelsRailRow } from './LabelsRailRow.js';
import { TaskReposRow } from './TaskReposRow.js';
import { ConfirmActionModal } from './ConfirmActionModal.js';
import { useRefreshIssueExternalLinks } from '../hooks/useIssueExternalLinks.js';
import { ATLAS_PALETTE } from '../theme/tokens.js';
import { formatDate, relativeTime } from '../utils/time.js';
import { formatCostUsd } from '../utils/formatCost.js';
import { ItemWorkflowPanel } from '../pages/workflows/ItemWorkflowPanel.js';

const MONO = '"JetBrains Mono", monospace';

export interface ParentLink {
    label: string; // "Task", "Project"
    text: string; // Display string, typically the issue id (e.g. "ATL-7")
    href: string;
}

interface Props {
    issueType: IssueType;
    /** With `externalLinks`, enables the unmerged-PR check before Done. */
    issueId?: string | undefined;
    externalLinks?: IItemExternalLink[] | undefined;
    status: IssueStatus;
    onStatusPick: (status: IssueStatus, override: boolean) => void;
    statusLocked?: boolean | undefined;

    assigneeAgentId: string | null;
    onAssign: (agentId: string | null) => void;
    assignee: IAgent | null;
    reassignLocked?: boolean | undefined;

    project: IProject | null;
    parents?: ParentLink[] | undefined;
    reporter?: IAgent | null | undefined;
    ownerName: string;
    ownerAccent: string;
    priority?: IssuePriority | undefined;
    /** When provided, the Priority row becomes a dropdown trigger that opens
     *  the picker; omit on read-only views. */
    onPriorityPick?: ((next: IssuePriority) => void) | undefined;

    createdAt: string;
    updatedAt: string;

    /** Sum of total_cost_usd across all agent runs for this item. */
    totalCostUsd?: number | null | undefined;

    /**
     * The Task's run branch and its on-disk checkout, provisioned by its
     * workflow run. Both nullable. When EITHER prop is provided (even as
     * null) the Branch + Path rows render; pass nothing on sub-tasks,
     * which share their Task's worktree.
     */
    worktreeBranch?: string | null | undefined;
    worktreePath?: string | null | undefined;

    /**
     * Task 1c — Jira-style labels row inside the Details panel. When
     * `labels` is supplied the row renders; chip removals + new entries
     * go through `onLabelsChange`. `labelSuggestions` powers the
     * autocomplete drop-down (project-scoped distinct values).
     */
    labels?: string[] | undefined;
    onLabelsChange?: ((next: string[]) => Promise<unknown> | void) | undefined;
    labelSuggestions?: string[] | undefined;

    /**
     * ADR 0017 — the Task's repos in order (`[]` = the project's primary).
     * With `onRepoIdsChange` the Repos row renders; Tasks only.
     */
    repoIds?: string[] | undefined;
    onRepoIdsChange?: ((next: string[]) => Promise<unknown>) | undefined;
}

function CopyValueButton({ value }: { value: string }) {
    const [copied, setCopied] = useState(false);
    const handleClick = async (e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
        } catch {
            // Clipboard write can fail in non-secure contexts; silently no-op.
        }
    };
    return (
        <Tooltip title={copied ? 'Copied' : 'Copy'} placement="top">
            <IconButton
                size="small"
                onClick={handleClick}
                sx={{
                    p: 0.25,
                    color: copied ? ATLAS_PALETTE.brandBlue : ATLAS_PALETTE.slate40,
                    '&:hover': { color: ATLAS_PALETTE.slate },
                }}
            >
                {copied ? (
                    <CheckRounded sx={{ fontSize: 14 }} />
                ) : (
                    <ContentCopyRounded sx={{ fontSize: 14 }} />
                )}
            </IconButton>
        </Tooltip>
    );
}

const unmergedPrs = (links: IItemExternalLink[]) =>
    links.filter((l) => l.link_kind === 'pull_request' && l.pr_state !== 'merged');

export function DetailsRailCard({
    issueType,
    issueId,
    externalLinks,
    status,
    onStatusPick,
    statusLocked,
    assigneeAgentId,
    onAssign,
    assignee,
    reassignLocked,
    project,
    parents,
    reporter,
    ownerName,
    ownerAccent,
    priority,
    onPriorityPick,
    createdAt,
    updatedAt,
    totalCostUsd,
    worktreeBranch,
    worktreePath,
    labels,
    onLabelsChange,
    labelSuggestions,
    repoIds,
    onRepoIdsChange,
}: Props) {
    const showWorktree = worktreeBranch !== undefined || worktreePath !== undefined;
    const navigate = useNavigate();
    const [assigneeAnchor, setAssigneeAnchor] = useState<HTMLElement | null>(null);
    const [statusAnchor, setStatusAnchor] = useState<HTMLElement | null>(null);
    const [priorityAnchor, setPriorityAnchor] = useState<HTMLElement | null>(null);
    const refreshPrs = useRefreshIssueExternalLinks(issueType, issueId ?? '');
    const [doneGuard, setDoneGuard] = useState<{
        override: boolean;
        prs: IItemExternalLink[];
    } | null>(null);

    // pr_state is only as fresh as the API's last GitHub lookup, so re-check
    // before asking — a PR merged a minute ago shouldn't trigger the dialog.
    async function pickStatus(next: IssueStatus, override: boolean) {
        if (next !== 'done' || !issueId || unmergedPrs(externalLinks ?? []).length === 0) {
            onStatusPick(next, override);
            return;
        }
        let latest = externalLinks ?? [];
        try {
            latest = await refreshPrs.mutateAsync();
        } catch {
            // Lookup failed: fall back to what we had; the dialog still guards.
        }
        const prs = unmergedPrs(latest);
        if (prs.length === 0) onStatusPick(next, override);
        else setDoneGuard({ override, prs });
    }

    return (
        <InfoPanel label="Details">
            <InfoRow label="Project">
                {project ? (
                    <Typography
                        onClick={() => navigate(`/projects/${project.id}`)}
                        sx={{
                            fontSize: 12.5,
                            fontWeight: 500,
                            color: ATLAS_PALETTE.brandBlue,
                            fontFamily: MONO,
                            cursor: 'pointer',
                            '&:hover': { textDecoration: 'underline' },
                        }}
                    >
                        {project.name}
                    </Typography>
                ) : (
                    <Typography sx={{ fontSize: 12.5, color: ATLAS_PALETTE.slate40 }}>—</Typography>
                )}
            </InfoRow>

            {project && repoIds !== undefined && onRepoIdsChange && (
                <TaskReposRow projectId={project.id} repoIds={repoIds} onChange={onRepoIdsChange} />
            )}

            {parents?.map((p) => (
                <InfoRow key={`${p.label}-${p.href}`} label={p.label}>
                    <Typography
                        onClick={() => navigate(p.href)}
                        sx={{
                            fontSize: 12.5,
                            fontWeight: 500,
                            color: ATLAS_PALETTE.brandBlue,
                            fontFamily: MONO,
                            cursor: 'pointer',
                            '&:hover': { textDecoration: 'underline' },
                        }}
                    >
                        {p.text}
                    </Typography>
                </InfoRow>
            ))}

            <InfoRow
                label="Status"
                clickable={!statusLocked}
                onClick={
                    !statusLocked
                        ? (e) => setStatusAnchor(e.currentTarget as HTMLElement)
                        : undefined
                }
            >
                <StatusChip status={status} size="sm" />
                {!statusLocked && (
                    <Box
                        component="span"
                        className="material-symbols-rounded"
                        aria-hidden="true"
                        sx={{ fontSize: 16, color: ATLAS_PALETTE.slate40 }}
                    >
                        arrow_drop_down
                    </Box>
                )}
            </InfoRow>

            <InfoRow
                label="Assignee"
                clickable={!reassignLocked}
                onClick={
                    !reassignLocked
                        ? (e) => setAssigneeAnchor(e.currentTarget as HTMLElement)
                        : undefined
                }
            >
                {assignee ? (
                    <AgentChip agent={assignee} size="sm" layout="stacked" />
                ) : (
                    <AgentChip
                        agent={{ name: ownerName, accent_color: ownerAccent }}
                        size="sm"
                        layout="stacked"
                    />
                )}
                {reassignLocked ? (
                    <LockOutlined sx={{ fontSize: 13, color: ATLAS_PALETTE.slate40 }} />
                ) : (
                    <Box
                        component="span"
                        className="material-symbols-rounded"
                        aria-hidden="true"
                        sx={{ fontSize: 16, color: ATLAS_PALETTE.slate40 }}
                    >
                        arrow_drop_down
                    </Box>
                )}
            </InfoRow>

            {issueType === 'task' && issueId && project && (
                <ItemWorkflowPanel itemId={issueId} projectId={project.id} />
            )}

            {reporter !== undefined && (
                <InfoRow label="Reporter">
                    {reporter ? (
                        <AgentChip agent={reporter} size="sm" layout="stacked" />
                    ) : (
                        <AgentChip
                            agent={{ name: ownerName, accent_color: ownerAccent }}
                            size="sm"
                            layout="stacked"
                        />
                    )}
                </InfoRow>
            )}

            {priority && (
                <InfoRow
                    label="Priority"
                    clickable={Boolean(onPriorityPick)}
                    onClick={
                        onPriorityPick
                            ? (e) => setPriorityAnchor(e.currentTarget as HTMLElement)
                            : undefined
                    }
                >
                    <PriorityChip priority={priority} size="sm" />
                    {onPriorityPick && (
                        <Box
                            component="span"
                            className="material-symbols-rounded"
                            aria-hidden="true"
                            sx={{ fontSize: 16, color: ATLAS_PALETTE.slate40 }}
                        >
                            arrow_drop_down
                        </Box>
                    )}
                </InfoRow>
            )}

            {labels !== undefined && onLabelsChange && (
                <LabelsRailRow
                    labels={labels}
                    onChange={onLabelsChange}
                    suggestions={labelSuggestions ?? []}
                />
            )}

            {totalCostUsd != null && (
                <InfoRow label="AI cost">
                    <Typography
                        sx={{
                            fontSize: 12.5,
                            color: ATLAS_PALETTE.slate,
                            fontFamily: MONO,
                        }}
                    >
                        {formatCostUsd(totalCostUsd)}
                    </Typography>
                </InfoRow>
            )}

            <InfoRow label="Created">
                <Typography sx={{ fontSize: 12.5, color: ATLAS_PALETTE.slate, fontFamily: MONO }}>
                    {relativeTime(createdAt)} · {formatDate(createdAt)}
                </Typography>
            </InfoRow>

            <InfoRow label="Last updated">
                <Typography sx={{ fontSize: 12.5, color: ATLAS_PALETTE.slate, fontFamily: MONO }}>
                    {relativeTime(updatedAt)}
                </Typography>
            </InfoRow>

            {showWorktree && (
                <InfoRow label="Branch">
                    {worktreeBranch ? (
                        <>
                            <Typography
                                sx={{
                                    fontSize: 12.5,
                                    color: ATLAS_PALETTE.slate,
                                    fontFamily: MONO,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                }}
                                title={worktreeBranch}
                            >
                                {worktreeBranch}
                            </Typography>
                            <CopyValueButton value={worktreeBranch} />
                        </>
                    ) : (
                        <Typography
                            sx={{
                                fontSize: 12.5,
                                color: ATLAS_PALETTE.slate40,
                                fontStyle: 'italic',
                            }}
                        >
                            not provisioned
                        </Typography>
                    )}
                </InfoRow>
            )}

            {showWorktree && (
                <InfoRow label="Path">
                    {worktreePath ? (
                        <>
                            <Typography
                                sx={{
                                    fontSize: 12.5,
                                    color: ATLAS_PALETTE.slate,
                                    fontFamily: MONO,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                }}
                                title={worktreePath}
                            >
                                {worktreePath}
                            </Typography>
                            {(repoIds?.length ?? 0) > 1 && (
                                <Tooltip
                                    title="Workspace folder — one checkout per repo"
                                    placement="top"
                                >
                                    <InfoOutlined
                                        sx={{ fontSize: 14, color: ATLAS_PALETTE.slate40 }}
                                    />
                                </Tooltip>
                            )}
                            <CopyValueButton value={worktreePath} />
                        </>
                    ) : (
                        <Typography
                            sx={{
                                fontSize: 12.5,
                                color: ATLAS_PALETTE.slate40,
                                fontStyle: 'italic',
                            }}
                        >
                            not provisioned
                        </Typography>
                    )}
                </InfoRow>
            )}

            {/* Popovers mount only when their anchor is set so the internal
             *  hook calls (useAgents / useSettings) don't fire on every
             *  detail-page mount. Hooks-rules-safe alternative to an
             *  early-return inside the popover component. */}
            {assigneeAnchor && (
                <AssigneePickerPopover
                    anchorEl={assigneeAnchor}
                    open
                    onClose={() => setAssigneeAnchor(null)}
                    assigneeAgentId={assigneeAgentId}
                    suggestedRole={issueType === 'task' ? 'po' : undefined}
                    onAssign={(agentId) => {
                        onAssign(agentId);
                        setAssigneeAnchor(null);
                    }}
                />
            )}

            {statusAnchor && (
                <StatusPickerPopover
                    anchorEl={statusAnchor}
                    open
                    onClose={() => setStatusAnchor(null)}
                    issueType={issueType}
                    current={status}
                    onPick={(next, override) => {
                        void pickStatus(next, override);
                        setStatusAnchor(null);
                    }}
                />
            )}

            {priorityAnchor && onPriorityPick && (
                <PriorityPickerPopover
                    anchorEl={priorityAnchor}
                    open
                    onClose={() => setPriorityAnchor(null)}
                    current={priority}
                    onPick={(next) => {
                        onPriorityPick(next);
                        setPriorityAnchor(null);
                    }}
                />
            )}

            <ConfirmActionModal
                open={doneGuard !== null}
                title="Mark done anyway?"
                body={[
                    "These pull requests aren't merged yet:",
                    ...(doneGuard?.prs ?? []).map(
                        (l) =>
                            `${l.external_ref ? `#${l.external_ref}` : 'PR'} ${l.title ?? l.url} (${l.pr_state ?? 'state unknown'})`
                    ),
                ].join('\n')}
                confirmLabel="Mark done"
                tone="warning"
                onCancel={() => setDoneGuard(null)}
                onConfirm={() => {
                    if (doneGuard) onStatusPick('done', doneGuard.override);
                    setDoneGuard(null);
                }}
            />
        </InfoPanel>
    );
}
