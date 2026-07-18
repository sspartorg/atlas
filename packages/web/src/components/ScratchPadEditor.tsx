import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CloseRounded from '@mui/icons-material/CloseRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import type { IScratchPad } from '@atlas/shared';
import { ATLAS_PALETTE } from '../theme/tokens.js';
import { useUpdateScratchPad, useDeleteScratchPad } from '../hooks/useScratchPad.js';
import { ConfirmDeleteModal } from './ConfirmDeleteModal.js';

// Plain Google-Keep-style modal editor for a single Scratch Pad tile.
//   • Edits live in local state, NOT in the React Query cache, so typing
//     stays fluid even with hundreds of tiles in the grid.
//   • A debounced autosave fires 5 seconds after the last keystroke so we
//     don't churn the API + bump updated_at on every keypress.
//   • Closing flushes pending changes synchronously via a final PATCH so
//     the tile re-appears in the grid with the latest content.
//   • Empty-title-on-close auto-fills from the first 3 words of the body
//     (or "Untitled" if both blank) — the server enforces the same rule.
//   • Delete shows ConfirmDeleteModal, matching every other deletable in
//     the app (epics, stories, projects, agents, credentials).

interface ScratchPadEditorProps {
    open: boolean;
    onClose: () => void;
    tile: IScratchPad | null;
}

const AUTOSAVE_INTERVAL_MS = 5_000;
const SAVED_LABEL_TICK_MS = 1_000;

/**
 * Compute the title to persist when the user closes / autosaves with a
 * blank title field. Exported so the inferred behaviour can be
 * unit-tested without spinning up the full editor.
 */
export function inferTitle(title: string, body: string): string {
    if (title.trim()) return title;
    const words = body.trim().split(/\s+/).filter(Boolean).slice(0, 3).join(' ');
    return words || 'Untitled';
}

function formatSavedAgo(savedAt: number | null, now: number): string {
    if (savedAt === null) return 'Not saved yet';
    const seconds = Math.max(0, Math.floor((now - savedAt) / 1000));
    if (seconds < 5) return 'Saved just now';
    if (seconds < 60) return `Saved · ${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `Saved · ${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `Saved · ${hours}h ago`;
}

export function ScratchPadEditor({ open, onClose, tile }: ScratchPadEditorProps) {
    const updateTile = useUpdateScratchPad();
    const deleteTile = useDeleteScratchPad();

    // Local-first edit state so the textarea stays controlled without
    // round-tripping through React Query on every keypress.
    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [savedAt, setSavedAt] = useState<number | null>(null);
    const [now, setNow] = useState<number>(Date.now());

    // Track the last value we successfully saved so the autosave + close
    // flush can both diff against it without re-firing PATCH on no-op
    // changes (which would otherwise bump updated_at every 5s purely from
    // the modal being open).
    const savedRef = useRef<{ title: string; body: string }>({ title: '', body: '' });

    // Reset local state whenever the modal is (re-)opened with a tile.
    useEffect(() => {
        if (open && tile) {
            setTitle(tile.title);
            setBody(tile.body_md);
            savedRef.current = { title: tile.title, body: tile.body_md };
            setShowDeleteModal(false);
            setSavedAt(null);
        }
    }, [open, tile]);

    // 5-second autosave tick. The effect re-arms after every change, so a
    // burst of typing collapses into a single PATCH 5s after the user
    // pauses. We don't `await` the mutation — fire-and-forget is fine
    // because the next tick (or the close-flush) catches any in-flight
    // failure.
    useEffect(() => {
        if (!open || !tile) return;
        const handle = window.setTimeout(() => {
            const last = savedRef.current;
            const inferred = inferTitle(title, body);
            if (inferred === last.title && body === last.body) return;
            savedRef.current = { title: inferred, body };
            updateTile.mutate({ id: tile.id, patch: { title: inferred, body_md: body } });
            setSavedAt(Date.now());
        }, AUTOSAVE_INTERVAL_MS);
        return () => window.clearTimeout(handle);
        // updateTile is a stable hook return; intentionally omitted from
        // deps so the timer doesn't reset on every mutation status change.
        // (Project doesn't load eslint-plugin-react-hooks, so there's no
        // exhaustive-deps rule to silence.)
    }, [title, body, open, tile?.id]);

    // Re-tick the "Saved · 12s ago" label once per second so the relative
    // time stays honest while the modal is open. Cheap (a single setState
    // per second) and stops as soon as the dialog closes.
    useEffect(() => {
        if (!open) return;
        const interval = window.setInterval(() => setNow(Date.now()), SAVED_LABEL_TICK_MS);
        return () => window.clearInterval(interval);
    }, [open]);

    function flushAndClose() {
        if (tile) {
            const last = savedRef.current;
            const inferred = inferTitle(title, body);
            if (inferred !== last.title || body !== last.body) {
                savedRef.current = { title: inferred, body };
                updateTile.mutate({ id: tile.id, patch: { title: inferred, body_md: body } });
            }
        }
        onClose();
    }

    async function handleConfirmDelete() {
        /* v8 ignore next -- unreachable via the UI: the ConfirmDeleteModal that owns onConfirm={handleConfirmDelete} is only rendered when `tile` is truthy (see `{tile && <ConfirmDeleteModal .../>}` below), and the delete IconButton that opens it is disabled when `tile` is null. */
        if (!tile) return;
        await deleteTile.mutateAsync(tile.id);
        onClose();
    }

    const savedLabel = updateTile.isPending ? 'Saving...' : formatSavedAgo(savedAt, now);

    return (
        <>
        <Dialog
            open={open}
            onClose={flushAndClose}
            maxWidth="md"
            fullWidth
            PaperProps={{
                sx: {
                    minHeight: '70vh',
                    maxHeight: '90vh',
                    display: 'flex',
                    flexDirection: 'column',
                    borderRadius: '12px',
                },
            }}
        >
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    px: 3,
                    pt: 2.5,
                    pb: 1.5,
                }}
            >
                <TextField
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Title (auto from first 3 words if blank)"
                    variant="standard"
                    fullWidth
                    InputProps={{
                        disableUnderline: true,
                        sx: {
                            fontSize: '1.25rem',
                            fontWeight: 600,
                            color: ATLAS_PALETTE.slate,
                            '& input::placeholder': {
                                color: ATLAS_PALETTE.slate40,
                                opacity: 1,
                                fontWeight: 500,
                            },
                        },
                    }}
                />
                <Tooltip title="Delete tile" arrow>
                    <span>
                        <IconButton
                            size="small"
                            aria-label="Delete tile"
                            onClick={() => setShowDeleteModal(true)}
                            disabled={!tile}
                            sx={{
                                color: ATLAS_PALETTE.slate60,
                                '&:hover': { color: ATLAS_PALETTE.error },
                            }}
                        >
                            <DeleteOutlineRounded sx={{ fontSize: 20 }} />
                        </IconButton>
                    </span>
                </Tooltip>
                <Tooltip title="Close" arrow>
                    <IconButton
                        size="small"
                        aria-label="Close"
                        onClick={flushAndClose}
                        sx={{ color: ATLAS_PALETTE.slate60 }}
                    >
                        <CloseRounded sx={{ fontSize: 20 }} />
                    </IconButton>
                </Tooltip>
            </Box>

            <Box
                sx={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    px: 3,
                    pb: 2,
                    minHeight: 0,
                }}
            >
                <Box
                    component="textarea"
                    value={body}
                    onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setBody(e.target.value)}
                    spellCheck
                    placeholder="Take a note..."
                    sx={{
                        flex: 1,
                        width: '100%',
                        minHeight: '60vh',
                        maxHeight: '80vh',
                        border: 'none',
                        outline: 'none',
                        resize: 'none',
                        py: 2,
                        px: 0,
                        fontFamily: 'inherit',
                        fontSize: 15,
                        lineHeight: 1.6,
                        color: ATLAS_PALETTE.slate,
                        background: 'transparent',
                        '&::placeholder': { color: ATLAS_PALETTE.slate40 },
                    }}
                />
            </Box>

            <Box
                sx={{
                    px: 3,
                    py: 1.5,
                    display: 'flex',
                    justifyContent: 'flex-end',
                    borderTop: `1px solid ${ATLAS_PALETTE.slate06}`,
                }}
            >
                <Typography sx={{ fontSize: 11, color: ATLAS_PALETTE.slate60 }}>
                    {savedLabel}
                </Typography>
            </Box>
        </Dialog>
        {tile && (
            <ConfirmDeleteModal
                open={showDeleteModal}
                entityKind="scratch_pad"
                entityTitle={inferTitle(title, body)}
                onConfirm={handleConfirmDelete}
                onClose={() => setShowDeleteModal(false)}
            />
        )}
        </>
    );
}
