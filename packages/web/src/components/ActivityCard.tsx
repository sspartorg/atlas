import { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import SwapHorizRounded from '@mui/icons-material/SwapHorizRounded';
import PersonRounded from '@mui/icons-material/PersonRounded';
import EditNoteRounded from '@mui/icons-material/EditNoteRounded';
import FiberManualRecordRounded from '@mui/icons-material/FiberManualRecordRounded';
import ChatBubbleOutlineRounded from '@mui/icons-material/ChatBubbleOutlineRounded';
import LinkRounded from '@mui/icons-material/LinkRounded';
import LinkOffRounded from '@mui/icons-material/LinkOffRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import RestartAltRounded from '@mui/icons-material/RestartAltRounded';
import BlockRounded from '@mui/icons-material/BlockRounded';
import {
    STATUS_LABELS,
    type IActivityItem,
    type IComment,
    type IIssueEvent,
    type IssueType,
    type IAgent,
} from '@atlas/shared';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import { useActivity } from '../hooks/useActivity.js';
import { useAgents } from '../hooks/useAgents.js';
import { useSettings } from '../hooks/useSettings.js';
import { useCreateComment, useUpdateComment } from '../hooks/useComments.js';
import { useDeleteComment } from '../hooks/useDeleteComment.js';
import { ATLAS_PALETTE } from '../theme/tokens.js';
import { relativeTime, formatAbsolute } from '../utils/time.js';
import { InitialAvatar } from './InitialAvatar.js';
import { MarkdownPreview } from './MarkdownPreview.js';

interface Props {
    issueType: IssueType;
    issueId: string;
    /** When supplied, skips the internal useActivity fetch. */
    activity?: IActivityItem[];
    /** When supplied, skips the internal useAgents fetch. */
    agents?: IAgent[];
}

// B11 — human-friendly labels for the `field_updated` activity entries.
// Anything not in the map falls back to the raw field name with underscores
// turned into spaces, so a new IssueEventField doesn't render as 'unknown'.
const FIELD_LABELS: Record<string, string> = {
    title: 'title',
    description: 'description',
    acceptance_criteria: 'acceptance criteria',
    priority: 'priority',
    points: 'points',
    spec_md: 'spec',
    pr_url: 'PR link',
    steps_to_reproduce: 'steps to reproduce',
    expected: 'expected behavior',
    actual: 'actual behavior',
    frequency: 'frequency',
    failure_scope: 'failure scope',
    reporter: 'reporter',
};

function humanFieldLabel(field: string | null | undefined): string {
    if (!field) return 'a field';
    return FIELD_LABELS[field] ?? field.replace(/_/g, ' ');
}

// Cap free-text before/after values so a paragraph-long description edit
// doesn't push every other event off-screen. Mirrors the 280-char server
// truncate() in events-log.ts but tighter for inline activity display.
function truncateValue(value: string | null | undefined, max = 60): string | null {
    if (value == null || value === '') return null;
    if (value.length <= max) return value;
    return value.slice(0, max) + '…';
}

function Initial({ name, color, size = 26 }: { name: string; color: string; size?: number }) {
    return (
        <InitialAvatar
            name={name}
            color={color}
            size={size}
            fontSize={Math.max(10, Math.round(size * 0.4))}
        />
    );
}

function CommentRow({
    comment,
    agentsById,
    ownerName,
    ownerAccent,
}: {
    comment: IComment;
    agentsById: Map<string, IAgent>;
    ownerName: string;
    ownerAccent: string;
}) {
    const agent = comment.agent_id ? agentsById.get(comment.agent_id) : null;
    const name = comment.author === 'owner' ? ownerName : (agent?.name ?? 'Agent');
    const color = comment.author === 'owner' ? ownerAccent : (agent?.accent_color ?? ATLAS_PALETTE.slate);
    const isAgent = comment.author === 'agent';

    const updateComment = useUpdateComment(comment.issue_type, comment.issue_id);
    const deleteComment = useDeleteComment(comment.issue_type, comment.issue_id);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(comment.body);
    // Agent-authored comments are markdown; show a preview toggle while
    // editing so the owner can sanity-check formatting before saving. Owner
    // comments are plain text so the toggle is hidden for them.
    const [showPreview, setShowPreview] = useState(false);
    // P11 — delete-confirm dialog state. Lives inline because the rest of
    // the card flow (cancelEdit, saveEdit) is also colocated, and a comment
    // delete is a single async mutation — not enough complexity to warrant
    // pulling in `ConfirmDeleteModal` which is shaped for issue deletions
    // with redirect-on-success.
    const [confirmingDelete, setConfirmingDelete] = useState(false);

    const beginEdit = () => {
        setDraft(comment.body);
        setShowPreview(false);
        setEditing(true);
    };
    const cancelEdit = () => {
        setDraft(comment.body);
        setShowPreview(false);
        setEditing(false);
    };
    const saveEdit = async () => {
        const next = draft.trim();
        if (!next || next === comment.body) {
            cancelEdit();
            return;
        }
        await updateComment.mutateAsync({ id: comment.id, body: next });
        setEditing(false);
        setShowPreview(false);
    };
    const confirmDelete = async () => {
        await deleteComment.mutateAsync({ id: comment.id });
        setConfirmingDelete(false);
    };

    return (
        <Box
            sx={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 2,
                // Reveal the inline Edit button on hover only — keeps the
                // resting state clean on long threads.
                '&:hover .comment-edit-affordance': { opacity: 1 },
            }}
        >
            <Initial name={name} color={color} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box
                    sx={{
                        display: 'flex',
                        alignItems: 'baseline',
                        gap: 1.5,
                        mb: 0.5,
                        flexWrap: 'wrap',
                    }}
                >
                    <Typography sx={{ fontSize: 13, fontWeight: 600, color: ATLAS_PALETTE.slate }}>
                        {name}
                    </Typography>
                    <Tooltip
                        title={formatAbsolute(comment.created_at)}
                        placement="top"
                        arrow
                    >
                        <Typography
                            component="span"
                            sx={{
                                fontSize: 11,
                                color: ATLAS_PALETTE.slate40,
                                fontFamily: '"JetBrains Mono", monospace',
                                cursor: 'help',
                            }}
                        >
                            {relativeTime(comment.created_at)}
                        </Typography>
                    </Tooltip>
                    {comment.edited_at ? (
                        <Tooltip
                            title={`edited ${formatAbsolute(comment.edited_at)}`}
                            placement="top"
                            arrow
                        >
                            <Typography
                                component="span"
                                sx={{
                                    fontSize: 10,
                                    fontWeight: 600,
                                    color: ATLAS_PALETTE.slate60,
                                    letterSpacing: '0.06em',
                                    textTransform: 'uppercase',
                                    border: `1px solid ${ATLAS_PALETTE.slate12}`,
                                    borderRadius: '4px',
                                    px: 0.75,
                                    py: 0.125,
                                    cursor: 'default',
                                }}
                            >
                                edited
                            </Typography>
                        </Tooltip>
                    ) : null}
                    {!editing ? (
                        <Box
                            className="comment-edit-affordance"
                            sx={{
                                ml: 'auto',
                                opacity: 0,
                                transition: 'opacity 120ms ease',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 0.25,
                            }}
                        >
                            <IconButton
                                size="small"
                                onClick={beginEdit}
                                aria-label="Edit comment"
                                sx={{ color: ATLAS_PALETTE.slate60 }}
                            >
                                <Box
                                    component="span"
                                    className="material-symbols-rounded"
                                    sx={{ fontSize: 16 }}
                                >
                                    edit
                                </Box>
                            </IconButton>
                            <IconButton
                                size="small"
                                onClick={() => setConfirmingDelete(true)}
                                aria-label="Delete comment"
                                sx={{
                                    color: ATLAS_PALETTE.slate60,
                                    '&:hover': { color: ATLAS_PALETTE.error },
                                }}
                            >
                                <DeleteOutlineRounded sx={{ fontSize: 16 }} />
                            </IconButton>
                        </Box>
                    ) : null}
                </Box>
                {/* Read mode — render through MarkdownPreview so agent-authored
                    comments (PO Writer "## Need info" blocks etc.) come through
                    as headings/lists, while owner free-text passes through as a
                    paragraph. Edit mode swaps for an inline editor — plain
                    TextField for owner, markdown TextField + preview toggle for
                    agent comments. */}
                {!editing ? (
                    <Box sx={{ fontSize: 13, color: ATLAS_PALETTE.slate80 }}>
                        <MarkdownPreview source={comment.body} />
                    </Box>
                ) : (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                        {isAgent ? (
                            <Box
                                sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 1.5,
                                    fontSize: 11,
                                    color: ATLAS_PALETTE.slate60,
                                }}
                            >
                                <Box
                                    component="span"
                                    sx={{
                                        fontWeight: 600,
                                        letterSpacing: '0.06em',
                                        textTransform: 'uppercase',
                                    }}
                                >
                                    Markdown
                                </Box>
                                <Button
                                    size="small"
                                    onClick={() => setShowPreview((p) => !p)}
                                    sx={{
                                        textTransform: 'none',
                                        minWidth: 0,
                                        px: 1,
                                        height: 22,
                                        fontSize: 11,
                                        color: ATLAS_PALETTE.slate60,
                                    }}
                                >
                                    {showPreview ? 'Back to editor' : 'Preview'}
                                </Button>
                            </Box>
                        ) : null}
                        {showPreview && isAgent ? (
                            <Box
                                sx={{
                                    fontSize: 13,
                                    color: ATLAS_PALETTE.slate80,
                                    border: `1px solid ${ATLAS_PALETTE.slate10}`,
                                    borderRadius: '8px',
                                    p: 1.5,
                                    background: ATLAS_PALETTE.slate06,
                                }}
                            >
                                <MarkdownPreview source={draft} />
                            </Box>
                        ) : (
                            <TextField
                                multiline
                                minRows={isAgent ? 4 : 2}
                                autoFocus
                                fullWidth
                                value={draft}
                                onChange={(e) => setDraft(e.target.value)}
                                slotProps={{
                                    input: {
                                        sx: {
                                            fontSize: 13,
                                            lineHeight: 1.6,
                                            color: ATLAS_PALETTE.slate80,
                                            fontFamily: isAgent
                                                ? '"JetBrains Mono", monospace'
                                                : '"Inter", system-ui, sans-serif',
                                        },
                                    },
                                }}
                            />
                        )}
                        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
                            <Button
                                variant="outlined"
                                size="small"
                                onClick={cancelEdit}
                                disabled={updateComment.isPending}
                                sx={{ height: 28, textTransform: 'none', fontSize: 12 }}
                            >
                                Cancel
                            </Button>
                            <Button
                                variant="contained"
                                size="small"
                                onClick={() => void saveEdit()}
                                disabled={
                                    updateComment.isPending ||
                                    !draft.trim() ||
                                    draft.trim() === comment.body
                                }
                                sx={{ height: 28, textTransform: 'none', fontSize: 12 }}
                            >
                                {updateComment.isPending ? 'Saving…' : 'Save'}
                            </Button>
                        </Box>
                    </Box>
                )}
            </Box>
            <Dialog
                open={confirmingDelete}
                onClose={
                    deleteComment.isPending ? undefined : () => setConfirmingDelete(false)
                }
                maxWidth="xs"
                fullWidth
                PaperProps={{ sx: { borderRadius: '12px' } }}
            >
                <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>
                    Delete this comment?
                </DialogTitle>
                <DialogContent>
                    <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60 }}>
                        The comment will be hidden from the conversation thread. The
                        underlying audit row stays on disk; this can&apos;t be undone from
                        the UI.
                    </Typography>
                </DialogContent>
                <DialogActions sx={{ px: 3, pb: 3 }}>
                    <Button
                        onClick={() => setConfirmingDelete(false)}
                        disabled={deleteComment.isPending}
                        sx={{ textTransform: 'none' }}
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={() => void confirmDelete()}
                        disabled={deleteComment.isPending}
                        variant="contained"
                        color="error"
                        sx={{ textTransform: 'none', fontWeight: 600 }}
                    >
                        {deleteComment.isPending ? 'Deleting…' : 'Delete'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
}

function EventRow({
    event,
    agentsById,
    ownerName,
    ownerAccent,
}: {
    event: IIssueEvent;
    agentsById: Map<string, IAgent>;
    ownerName: string;
    ownerAccent: string;
}) {
    const actor = event.actor_agent_id ? agentsById.get(event.actor_agent_id) : null;
    const actorName = actor?.name ?? ownerName;
    const actorColor = actor?.accent_color ?? ownerAccent;

    let icon = <FiberManualRecordRounded sx={{ fontSize: 14, color: ATLAS_PALETTE.slate40 }} />;
    let body: React.ReactNode = null;

    if (event.event_type === 'created') {
        icon = <FiberManualRecordRounded sx={{ fontSize: 14, color: ATLAS_PALETTE.brandBlue }} />;
        body = (
            <>
                <strong>{actorName}</strong> created the item
            </>
        );
    } else if (event.event_type === 'status_changed') {
        icon = <SwapHorizRounded sx={{ fontSize: 16, color: ATLAS_PALETTE.slate60 }} />;
        const fromLabel = event.from_value ? STATUS_LABELS[event.from_value as keyof typeof STATUS_LABELS] ?? event.from_value : '—';
        const toLabel = event.to_value ? STATUS_LABELS[event.to_value as keyof typeof STATUS_LABELS] ?? event.to_value : '—';
        body = (
            <>
                <strong>{actorName}</strong> moved status from{' '}
                <Box component="span" sx={{ fontFamily: '"JetBrains Mono", monospace' }}>
                    {fromLabel}
                </Box>{' '}
                →{' '}
                <Box component="span" sx={{ fontFamily: '"JetBrains Mono", monospace' }}>
                    {toLabel}
                </Box>
                {event.detail === 'override' && (
                    <Box
                        component="span"
                        sx={{
                            ml: 1,
                            fontSize: 10,
                            fontWeight: 700,
                            color: ATLAS_PALETTE.orange,
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                        }}
                    >
                        override
                    </Box>
                )}
            </>
        );
    } else if (event.event_type === 'assigned') {
        icon = <PersonRounded sx={{ fontSize: 16, color: ATLAS_PALETTE.slate60 }} />;
        const fromAgent = event.from_value ? agentsById.get(event.from_value) : null;
        const toAgent = event.to_value ? agentsById.get(event.to_value) : null;
        const fromName = event.from_value ? (fromAgent?.name ?? 'unknown') : ownerName;
        const toName = event.to_value ? (toAgent?.name ?? 'unknown') : ownerName;
        body = (
            <>
                <strong>{actorName}</strong> reassigned from <strong>{fromName}</strong> →{' '}
                <strong>{toName}</strong>
            </>
        );
    } else if (event.event_type === 'field_updated') {
        icon = <EditNoteRounded sx={{ fontSize: 16, color: ATLAS_PALETTE.slate60 }} />;
        const label = humanFieldLabel(event.field);
        const before = truncateValue(event.from_value);
        const after = truncateValue(event.to_value);
        body = (
            <>
                <strong>{actorName}</strong> updated <strong>{label}</strong>
                {(before !== null || after !== null) && (
                    <Box
                        component="span"
                        sx={{
                            ml: 1,
                            fontSize: 12,
                            color: ATLAS_PALETTE.slate60,
                            fontFamily: '"JetBrains Mono", monospace',
                        }}
                    >
                        {before !== null && <span>{before}</span>}
                        {before !== null && after !== null && ' → '}
                        {after !== null && <span>{after}</span>}
                    </Box>
                )}
            </>
        );
    } else if (event.event_type === 'comment_added') {
        icon = <ChatBubbleOutlineRounded sx={{ fontSize: 16, color: ATLAS_PALETTE.slate60 }} />;
        body = (
            <>
                <strong>{actorName}</strong> added a comment
            </>
        );
    } else if (event.event_type === 'link_created') {
        icon = <LinkRounded sx={{ fontSize: 16, color: ATLAS_PALETTE.brandBlue }} />;
        // `detail` carries direction + relation like "depends_on → ATL-3" or
        // "depends_on ← ATL-2" so we can show what side of the link this is.
        const other = event.to_value ?? 'another item';
        body = (
            <>
                <strong>{actorName}</strong> linked{' '}
                <Box component="span" sx={{ fontFamily: '"JetBrains Mono", monospace' }}>
                    {other}
                </Box>
                {event.detail && (
                    <Box component="span" sx={{ ml: 1, fontSize: 11, color: ATLAS_PALETTE.slate60 }}>
                        ({event.detail})
                    </Box>
                )}
            </>
        );
    } else if (event.event_type === 'link_deleted') {
        icon = <LinkOffRounded sx={{ fontSize: 16, color: ATLAS_PALETTE.orange }} />;
        const other = event.to_value ?? 'another item';
        body = (
            <>
                <strong>{actorName}</strong> removed link to{' '}
                <Box component="span" sx={{ fontFamily: '"JetBrains Mono", monospace' }}>
                    {other}
                </Box>
                {event.detail && (
                    <Box component="span" sx={{ ml: 1, fontSize: 11, color: ATLAS_PALETTE.slate60 }}>
                        ({event.detail})
                    </Box>
                )}
            </>
        );
    } else if (event.event_type === 'rounds_reset') {
        // A04 — Owner-initiated reset of the per-CLI round counter. The
        // server writes `to_value` = current assignee id, `from_value` =
        // previous count. actor is null → renders as "Owner".
        icon = <RestartAltRounded sx={{ fontSize: 16, color: ATLAS_PALETTE.brandBlue }} />;
        const subjectAgent = event.to_value ? agentsById.get(event.to_value) : null;
        const subjectName = subjectAgent?.name ?? 'the assigned agent';
        const cap = subjectAgent?.max_rounds ?? null;
        const prev = event.from_value;
        body = (
            <>
                <strong>{actorName}</strong> reset rounds for <strong>{subjectName}</strong>
                {prev != null && (
                    <Box component="span" sx={{ ml: 1, fontSize: 11, color: ATLAS_PALETTE.slate60 }}>
                        (was {prev}
                        {cap != null ? ` / ${cap}` : ''})
                    </Box>
                )}
            </>
        );
    } else if (event.event_type === 'deleted') {
        icon = <DeleteOutlineRounded sx={{ fontSize: 16, color: ATLAS_PALETTE.error }} />;
        body = (
            <>
                <strong>{actorName}</strong> deleted this item
            </>
        );
    } else if (event.event_type === 'dispatch_blocked') {
        // B04 — pre-dispatch depends_on gate refused to spawn the agent.
        // Server writes `actor_agent_id` = the agent that was meant to run,
        // `detail` = comma-separated "ATL-12 (in_progress), ATL-15 (in_review)"
        // blocker list. from_value / to_value / field unused.
        icon = <BlockRounded sx={{ fontSize: 16, color: ATLAS_PALETTE.orange }} />;
        body = (
            <>
                Dispatch blocked for <strong>{actorName}</strong>
                {event.detail && (
                    <>
                        {' '}— waiting on{' '}
                        <Box component="span" sx={{ fontFamily: '"JetBrains Mono", monospace' }}>
                            {event.detail}
                        </Box>
                    </>
                )}
            </>
        );
    }

    return (
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
            <Box
                sx={{
                    width: 26,
                    height: 26,
                    borderRadius: '9999px',
                    background: actorColor + '22',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                }}
            >
                {icon}
            </Box>
            <Box sx={{ flex: 1, pt: 0.5 }}>
                <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate80, lineHeight: 1.6 }}>
                    {body}
                </Typography>
                <Tooltip
                    title={formatAbsolute(event.created_at)}
                    placement="top"
                    arrow
                >
                    <Typography
                        component="span"
                        sx={{
                            fontSize: 11,
                            color: ATLAS_PALETTE.slate40,
                            fontFamily: '"JetBrains Mono", monospace',
                            mt: 0.25,
                            display: 'inline-block',
                            cursor: 'help',
                        }}
                    >
                        {relativeTime(event.created_at)}
                    </Typography>
                </Tooltip>
            </Box>
        </Box>
    );
}

// ── Shared hooks ───────────────────────────────────────────────────────
// Both ConversationCard and ActivityLogCard need the same activity + agents
// data. When mounted on the same page they share React Query's cache, so
// the second mount is a no-network read — no duplicate fetch.
function useActivityData(
    issueType: IssueType,
    issueId: string,
    propActivity: IActivityItem[] | undefined,
    propAgents: IAgent[] | undefined,
) {
    const { data: fetchedActivity = [] } = useActivity(issueType, issueId, {
        enabled: !propActivity,
    });
    const { data: fetchedAgents = [] } = useAgents({ enabled: !propAgents });
    const items: IActivityItem[] = propActivity ?? fetchedActivity;
    const agents: IAgent[] = propAgents ?? fetchedAgents;
    const { data: settings } = useSettings();
    const agentsById = useMemo(() => new Map(agents.map((w) => [w.id, w])), [agents]);
    const ownerName = settings?.owner_name ?? 'Owner';
    const ownerAccent = settings?.accent_color ?? ATLAS_PALETTE.slate;
    return { items, agentsById, ownerName, ownerAccent };
}

const cardSx = {
    background: ATLAS_PALETTE.white,
    border: `1px solid ${ATLAS_PALETTE.slate10}`,
    borderRadius: '12px',
    p: 5,
} as const;

const headerSx = {
    fontSize: 11,
    fontWeight: 600,
    color: ATLAS_PALETTE.slate60,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    mb: 3,
} as const;

// ── ConversationCard ───────────────────────────────────────────────────
// Comments + compose box. Lives in the main content column on detail
// pages — it's the bi-directional surface where the Owner replies to
// agent comments and posts new context.
export function ConversationCard({
    issueType,
    issueId,
    activity: propActivity,
    agents: propAgents,
}: Props) {
    const { items, agentsById, ownerName, ownerAccent } = useActivityData(
        issueType,
        issueId,
        propActivity,
        propAgents,
    );
    const createComment = useCreateComment();
    const qc = useQueryClient();
    const [draft, setDraft] = useState('');

    const submit = async () => {
        const body = draft.trim();
        if (!body) return;
        await createComment.mutateAsync({
            author: 'owner',
            issue_type: issueType,
            issue_id: issueId,
            body,
        });
        setDraft('');
        await qc.invalidateQueries({ queryKey: ['activity', issueType, issueId] });
    };

    const comments = useMemo(
        () => items.filter((it): it is Extract<IActivityItem, { kind: 'comment' }> => it.kind === 'comment'),
        [items],
    );

    return (
        <Box sx={cardSx}>
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 1.5,
                    mb: 3,
                }}
            >
                <Typography sx={{ ...headerSx, mb: 0 }}>Conversation</Typography>
                <Typography
                    sx={{
                        fontSize: 11.5,
                        color: ATLAS_PALETTE.slate40,
                        fontFamily: '"JetBrains Mono", monospace',
                    }}
                >
                    · {comments.length}
                </Typography>
            </Box>

            {comments.length === 0 ? (
                <Typography
                    sx={{
                        fontSize: 13,
                        color: ATLAS_PALETTE.slate40,
                        fontStyle: 'italic',
                        mb: 3,
                    }}
                >
                    No comments yet — your replies and any agent notes will appear here.
                </Typography>
            ) : (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, mb: 4 }}>
                    {comments.map((it) => (
                        <CommentRow
                            key={`c-${it.data.id}`}
                            comment={it.data}
                            agentsById={agentsById}
                            ownerName={ownerName}
                            ownerAccent={ownerAccent}
                        />
                    ))}
                </Box>
            )}

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <TextField
                    multiline
                    minRows={2}
                    fullWidth
                    placeholder="Comment on this item…"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    slotProps={{
                        input: {
                            sx: {
                                fontSize: 13,
                                color: ATLAS_PALETTE.slate80,
                                fontFamily: '"Inter", system-ui, sans-serif',
                            },
                        },
                    }}
                />
                <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <Button
                        variant="contained"
                        onClick={() => void submit()}
                        disabled={createComment.isPending || !draft.trim()}
                        sx={{
                            height: 32,
                            textTransform: 'none',
                            fontSize: 12.5,
                        }}
                    >
                        Post
                    </Button>
                </Box>
            </Box>
        </Box>
    );
}

// ── ActivityLogCard ────────────────────────────────────────────────────
// Read-only system events: status changes, reassignments, field edits.
// Lives in the right rail under DetailsRailCard — audit content sits with
// the rest of the metadata while the conversation thread stays in the
// main column.
export function ActivityLogCard({
    issueType,
    issueId,
    activity: propActivity,
    agents: propAgents,
}: Props) {
    const { items, agentsById, ownerName, ownerAccent } = useActivityData(
        issueType,
        issueId,
        propActivity,
        propAgents,
    );

    const events = useMemo(
        () => items.filter((it): it is Extract<IActivityItem, { kind: 'event' }> => it.kind === 'event'),
        [items],
    );

    return (
        <Box sx={cardSx}>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, mb: 3 }}>
                <Typography sx={{ ...headerSx, mb: 0 }}>Activity log</Typography>
                <Typography
                    sx={{
                        fontSize: 11.5,
                        color: ATLAS_PALETTE.slate40,
                        fontFamily: '"JetBrains Mono", monospace',
                    }}
                >
                    · {events.length}
                </Typography>
            </Box>

            {events.length === 0 ? (
                <Typography
                    sx={{
                        fontSize: 13,
                        color: ATLAS_PALETTE.slate40,
                        fontStyle: 'italic',
                    }}
                >
                    Status changes, reassignments, and field edits will appear here.
                </Typography>
            ) : (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {events.map((it) => (
                        <EventRow
                            key={`e-${it.data.id}`}
                            event={it.data}
                            agentsById={agentsById}
                            ownerName={ownerName}
                            ownerAccent={ownerAccent}
                        />
                    ))}
                </Box>
            )}
        </Box>
    );
}

// ── ActivityCard (backward-compat wrapper) ─────────────────────────────
// Renders ConversationCard + ActivityLogCard stacked. Detail pages that
// have moved to the split layout call the two components directly; this
// wrapper exists so the older callsites + the existing test continue to
// work without churn.
export function ActivityCard(props: Props) {
    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <ConversationCard {...props} />
            <ActivityLogCard {...props} />
        </Box>
    );
}
