import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import { useNavigate } from 'react-router-dom';
import LockOutlined from '@mui/icons-material/LockOutlined';
import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded';
import CheckRounded from '@mui/icons-material/CheckRounded';
import type {
    IProject,
    IAgent,
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
import { ResetRoundsPopover } from './ResetRoundsPopover.js';
import { InfoPanel, InfoRow } from './InfoPanel.js';
import { LabelsRailRow } from './LabelsRailRow.js';
import { ATLAS_PALETTE } from '../theme/tokens.js';
import { formatDate, relativeTime } from '../utils/time.js';
import { formatCostUsd } from '../utils/formatCost.js';

const MONO = '"JetBrains Mono", monospace';

export interface ParentLink {
    label: string; // "Epic", "Story", "Project"
    text: string; // Display string, typically the issue id (e.g. "CER-7")
    href: string;
}

interface Props {
    issueType: IssueType;
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

    /**
     * A04 — total CLI invocations the assigned agent has run against this
     * item (performer leg, reviewer leg, and any retries each count as 1).
     * Null when no agent is assigned (Owner holds the item) or the agent
     * has not started yet. Renders as `Rounds: X / Y` against `maxRounds`.
     */
    roundCount?: number | null | undefined;
    /** `agents.max_rounds` for the current assignee; pair with `roundCount`. */
    maxRounds?: number | null | undefined;
    /**
     * A04 — when provided, the Rounds row becomes clickable and opens the
     * reset-rounds popover. Omit on read-only views (project rail,
     * non-Owner contexts).
     */
    onResetRounds?: (() => void) | undefined;
    /** Display name piped into the popover copy. Falls back to a
     *  generic "this agent" when null. */
    assigneeName?: string | null | undefined;
    /** Disables the popover's confirm button while the parent's mutation
     *  is in-flight; the row still renders normally. */
    resetRoundsPending?: boolean | undefined;
    /** Sum of total_cost_usd across all agent runs for this item. */
    totalCostUsd?: number | null | undefined;

    /**
     * T2 — per-item git worktree association. PO Writer fills
     * `worktreeBranch` (`atlas/<role>/<id>`); the worktree-orchestrator
     * resolves and writes back `worktreePath` so re-runs reuse the same
     * checkout. Both nullable. When EITHER prop is provided (even as
     * null) the Branch + Path rows render; pass nothing on kinds that
     * don't carry worktrees (Epic).
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

export function DetailsRailCard({
    issueType,
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
    roundCount,
    maxRounds,
    onResetRounds,
    assigneeName,
    resetRoundsPending,
    totalCostUsd,
    worktreeBranch,
    worktreePath,
    labels,
    onLabelsChange,
    labelSuggestions,
}: Props) {
    const showWorktree = worktreeBranch !== undefined || worktreePath !== undefined;
    const navigate = useNavigate();
    const [assigneeAnchor, setAssigneeAnchor] = useState<HTMLElement | null>(null);
    const [statusAnchor, setStatusAnchor] = useState<HTMLElement | null>(null);
    const [priorityAnchor, setPriorityAnchor] = useState<HTMLElement | null>(null);
    const [roundsAnchor, setRoundsAnchor] = useState<HTMLElement | null>(null);
    // The Rounds row is only clickable when (a) the parent wired an
    // `onResetRounds` handler AND (b) we have meaningful values to render.
    // Off otherwise — keeps Owner-less / no-assignee surfaces read-only.
    const roundsClickable =
        Boolean(onResetRounds) && roundCount != null && maxRounds != null && maxRounds > 0;

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
                        sx={{ fontSize: 16, color: ATLAS_PALETTE.slate40 }}
                    >
                        arrow_drop_down
                    </Box>
                )}
            </InfoRow>

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

            {roundCount != null && maxRounds != null && maxRounds > 0 && (
                <InfoRow
                    label="Rounds"
                    clickable={roundsClickable}
                    onClick={
                        roundsClickable
                            ? (e) => setRoundsAnchor(e.currentTarget as HTMLElement)
                            : undefined
                    }
                >
                    <Typography
                        sx={{
                            fontSize: 12.5,
                            color: ATLAS_PALETTE.slate,
                            fontFamily: MONO,
                        }}
                    >
                        {roundCount} / {maxRounds}
                    </Typography>
                    {roundsClickable && (
                        <Box
                            component="span"
                            className="material-symbols-rounded"
                            sx={{ fontSize: 16, color: ATLAS_PALETTE.slate40 }}
                        >
                            arrow_drop_down
                        </Box>
                    )}
                </InfoRow>
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
                <Typography
                    sx={{ fontSize: 12.5, color: ATLAS_PALETTE.slate, fontFamily: MONO }}
                >
                    {relativeTime(createdAt)} · {formatDate(createdAt)}
                </Typography>
            </InfoRow>

            <InfoRow label="Last updated">
                <Typography
                    sx={{ fontSize: 12.5, color: ATLAS_PALETTE.slate, fontFamily: MONO }}
                >
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
                        onStatusPick(next, override);
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

            {roundsAnchor &&
                onResetRounds &&
                roundCount != null &&
                maxRounds != null && (
                    <ResetRoundsPopover
                        anchorEl={roundsAnchor}
                        open
                        onClose={() => setRoundsAnchor(null)}
                        roundCount={roundCount}
                        maxRounds={maxRounds}
                        assigneeName={assigneeName ?? null}
                        pending={resetRoundsPending}
                        onConfirm={() => {
                            onResetRounds();
                            setRoundsAnchor(null);
                        }}
                    />
                )}
        </InfoPanel>
    );
}
