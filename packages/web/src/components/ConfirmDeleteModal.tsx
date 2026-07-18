import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { RowActionMenu } from './RowActionMenu.js';
import Dialog from '@mui/material/Dialog';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import CloseRounded from '@mui/icons-material/CloseRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded';
import { ATLAS_PALETTE } from '../theme/tokens.js';
import { FormHeading } from './FormHeading.js';

type DeletableEntityKind = 'epic' | 'story' | 'sub_task' | 'sub_bug' | 'bug' | 'scratch_pad';

interface DeletableEntityLabel {
    singular: string;
    lower: string;
    // Sentence fragment placed after `<Singular> <strong>{title}</strong>`.
    // Issue-tracker entities have nested sub-items + run history; scratch
    // tiles do not — the copy diverges here.
    describeImpact: string;
}

const NESTED_IMPACT = 'and every nested sub-item, comment, and run history will be removed permanently. This cannot be undone.';

const ENTITY_LABELS: Record<DeletableEntityKind, DeletableEntityLabel> = {
    epic: { singular: 'Epic', lower: 'epic', describeImpact: NESTED_IMPACT },
    story: { singular: 'Story', lower: 'story', describeImpact: NESTED_IMPACT },
    sub_task: { singular: 'Sub-task', lower: 'sub-task', describeImpact: NESTED_IMPACT },
    sub_bug: { singular: 'Sub-bug', lower: 'sub-bug', describeImpact: NESTED_IMPACT },
    bug: { singular: 'Bug', lower: 'bug', describeImpact: NESTED_IMPACT },
    scratch_pad: {
        singular: 'Scratch tile',
        lower: 'scratch tile',
        describeImpact: 'will be removed permanently. This cannot be undone.',
    },
};

interface Props {
    open: boolean;
    entityKind: DeletableEntityKind;
    /** Displayed inside the confirm prompt — e.g. the epic's title or short id. */
    entityTitle: string;
    /** Awaited on confirm. Throws to surface an error in the modal. */
    onConfirm: () => Promise<void>;
    onClose: () => void;
}

// Synchronous-delete confirm modal. Unlike `DeleteProjectModal` (which spawns
// a subprocess and tracks job progress over SSE), issue deletions resolve
// inside a single DB transaction — there's no progress bar, just an idle
// state, an in-flight state, and an error state on rare failure.
export function ConfirmDeleteModal({ open, entityKind, entityTitle, onConfirm, onClose }: Props) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const labels = ENTITY_LABELS[entityKind];

    // Reset transient state every time the dialog is re-opened so a stale
    // error message from a prior attempt doesn't leak across sessions.
    useEffect(() => {
        if (open) {
            setBusy(false);
            setError(null);
        }
    }, [open]);

    async function handleConfirm() {
        setBusy(true);
        setError(null);
        try {
            await onConfirm();
            // Caller is responsible for closing the modal on success (usually
            // by navigating away from the page); guard with isMounted check
            // not needed because Dialog unmounts gracefully on `open=false`.
            onClose();
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            setError(msg || 'Delete failed.');
            setBusy(false);
        }
    }

    return (
        <Dialog
            open={open}
            onClose={busy ? undefined : onClose}
            maxWidth="xs"
            fullWidth
            // Mobile parity with the broader app modal pattern (NewProjectModal,
            // ConfirmActionModal): stay a centered dialog with viewport margins
            // instead of going edge-to-edge — `fullScreen={isMobile}` made the
            // confirm prompt feel like a separate page on phones, breaking
            // visual continuity with the parent editor / list.
            PaperProps={{
                sx: {
                    borderRadius: '12px',
                    m: { xs: 2, sm: 4 },
                    maxHeight: { xs: 'calc(100% - 32px)', sm: 'calc(100% - 64px)' },
                },
            }}
        >
            <Box sx={{ p: 5 }}>
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 3, mb: 4 }}>
                    <Box
                        sx={{
                            width: 32,
                            height: 32,
                            borderRadius: '8px',
                            bgcolor: 'rgba(220,38,38,0.12)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                        }}
                    >
                        <DeleteOutlineRounded
                            sx={{ color: ATLAS_PALETTE.error, fontSize: 20 }}
                        />
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                        <FormHeading>Delete this {labels.lower}?</FormHeading>
                        <Typography
                            sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60, mt: 0.5 }}
                        >
                            {labels.singular} <strong>{entityTitle}</strong> {labels.describeImpact}
                        </Typography>
                    </Box>
                    <IconButton
                        size="small"
                        onClick={onClose}
                        disabled={busy}
                        aria-label="Close"
                    >
                        <CloseRounded fontSize="small" />
                    </IconButton>
                </Box>

                {error && (
                    <Alert severity="error" sx={{ mb: 3, fontSize: 13 }}>
                        {error}
                    </Alert>
                )}

                <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
                    <Button onClick={onClose} disabled={busy} sx={{ textTransform: 'none' }}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleConfirm}
                        disabled={busy}
                        variant="contained"
                        color="error"
                        startIcon={
                            busy ? (
                                <CircularProgress size={14} color="inherit" />
                            ) : (
                                <DeleteOutlineRounded />
                            )
                        }
                        sx={{ textTransform: 'none', fontWeight: 600 }}
                    >
                        {busy ? 'Deleting…' : `Delete ${labels.lower}`}
                    </Button>
                </Box>
            </Box>
        </Dialog>
    );
}

// ─────────────────────────────────────────────────────────────────────────
// IssueDeleteAction — kebab + ConfirmDeleteModal + post-delete navigation
// ─────────────────────────────────────────────────────────────────────────
// Drop into an `<IssueDetailShell actions={...} />` slot. The detail page
// stays free of state plumbing — it just supplies the entity metadata and
// the mutation callback that hits the API.

interface IssueDeleteActionProps {
    entityKind: DeletableEntityKind;
    entityTitle: string;
    /** Awaited on confirm. Should call the matching `api.<entity>.delete(id)`. */
    onDelete: () => Promise<void>;
    /** Where to navigate after a successful delete. Falls back to history -1. */
    redirectTo?: string;
    /** Optional Clone menu item. When supplied, the kebab menu renders
     *  **Clone item** above a divider, then Delete. The callback is
     *  expected to open the parent's clone flow (typically NewIssueModal
     *  pre-filled from the source). */
    onClone?: () => void;
}

export function IssueDeleteAction({
    entityKind,
    entityTitle,
    onDelete,
    redirectTo,
    onClone,
}: IssueDeleteActionProps) {
    const [open, setOpen] = useState(false);
    const navigate = useNavigate();
    const labels = ENTITY_LABELS[entityKind];

    const handleConfirm = useCallback(async () => {
        await onDelete();
        if (redirectTo) navigate(redirectTo);
        else navigate(-1);
    }, [onDelete, redirectTo, navigate]);

    return (
        <>
            <RowActionMenu
                ariaLabel={`${labels.singular} actions`}
                items={[
                    onClone
                        ? {
                              label: 'Clone item…',
                              icon: <ContentCopyRounded fontSize="small" />,
                              onClick: onClone,
                          }
                        : false,
                    {
                        label: `Delete this ${labels.lower}…`,
                        icon: <DeleteOutlineRounded fontSize="small" />,
                        onClick: () => setOpen(true),
                        danger: true,
                        // Visual separator below the Clone group when both
                        // are present (RowActionMenu's `dividerAbove` flag
                        // renders a Divider before the item).
                        dividerAbove: Boolean(onClone),
                    },
                ]}
            />
            {open && (
                <ConfirmDeleteModal
                    open={open}
                    entityKind={entityKind}
                    entityTitle={entityTitle}
                    onConfirm={handleConfirm}
                    onClose={() => setOpen(false)}
                />
            )}
        </>
    );
}
