import { Suspense, useEffect, useMemo, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import FormControlLabel from '@mui/material/FormControlLabel';
import Skeleton from '@mui/material/Skeleton';
import TextField from '@mui/material/TextField';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import StopRounded from '@mui/icons-material/StopRounded';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import type { CliSessionDiffScopeName, CliSessionStopResponse } from '@atlas/shared';
import {
    useCliSessionDiff,
    usePreflightStopCliSession,
    useStopCliSession,
} from '../hooks/useCliSessions.js';
import { useToast } from '../hooks/useToast.js';
import { ATLAS_PALETTE, TYPOGRAPHY } from '../theme/tokens.js';
import { lazyNamed } from '../utils/lazyNamed.js';
import {
    loadDiffPrefs,
    saveDiffPrefs,
    type DiffPrefs,
    type DiffViewMode,
} from './diff/diffViewPrefs.js';

// 2026-06-22 - Terminal v1 finalize modal.
// 2026-08-04 - Grew a full diff review + an opt-out for the automatic PR.
//
// Flow:
//   Open  -> preflightStop (branch + stageable paths) AND the diff summary,
//            in parallel -> review the two scopes -> pick what to stage.
//   Stop  -> stop({files_to_stage, commit_message, open_pull_request}) ->
//            server commits + pushes + optionally opens a PR + tears the
//            worktree down -> onClosed(result).
//
// The push is NOT optional: the server deletes the worktree right after
// close, so unpushed work would be lost. Only the PR is.
//
// This file stays a dialog shell. All diff rendering lives behind the lazy
// boundary below — the initial-chunk budget has ~0.3 KB of slack, and
// StopSessionModal is statically imported by TerminalSessionControls, which
// both terminal routes pull in eagerly.
const StopSessionReviewPanel = lazyNamed(
    () => import('./StopSessionReviewPanel.js'),
    'StopSessionReviewPanel',
);

export interface StopSessionResult {
    pushed: boolean;
    committed: boolean;
    prUrl: string | null;
}

interface Props {
    open: boolean;
    sessionId: string;
    onClose: () => void;
    onClosed: (result: StopSessionResult) => void;
}

export function StopSessionModal({ open, sessionId, onClose, onClosed }: Props) {
    const toast = useToast();
    const theme = useTheme();
    const isNarrow = useMediaQuery(theme.breakpoints.down('md'));
    const preflight = usePreflightStopCliSession();
    const stop = useStopCliSession();
    const diff = useCliSessionDiff(sessionId, open);

    const [selected, setSelected] = useState<Record<string, boolean>>({});
    const [commitMessage, setCommitMessage] = useState('Terminal session changes');
    const [scope, setScope] = useState<CliSessionDiffScopeName>('uncommitted');
    const [prefs, setPrefs] = useState<DiffPrefs>(() => loadDiffPrefs());

    useEffect(() => {
        saveDiffPrefs(prefs);
    }, [prefs]);

    // Run preflight when the modal opens. It stays the source of truth for
    // WHICH paths are stageable (`files_to_stage` must be `git add`-able), so
    // the diff summary never drives the checkbox set.
    useEffect(() => {
        if (!open) return;
        preflight.mutate(sessionId, {
            onSuccess: (resp) => {
                // Default-select every unstaged path so the user only has to
                // uncheck things they want to leave behind.
                const next: Record<string, boolean> = {};
                for (const f of resp.unstaged) next[f.path] = true;
                setSelected(next);
            },
            onError: (err: Error) => {
                toast.show({ message: 'Could not inspect worktree', detail: err.message });
            },
        });
    }, [open, sessionId]);

    const unstaged = preflight.data?.unstaged ?? [];
    const branch = preflight.data?.current_branch ?? '';
    const ahead = preflight.data?.ahead_of_remote ?? 0;
    const anySelected = useMemo(() => Object.values(selected).some(Boolean), [selected]);

    // Mirrors the server gate: it only opens a PR when the push shipped
    // something (or the branch was already up to date with commits on it).
    const prPossible = ahead > 0 || anySelected;
    const openPr = prefs.openPr && prPossible;

    function setPref<K extends keyof DiffPrefs>(key: K, value: DiffPrefs[K]): void {
        setPrefs((p) => ({ ...p, [key]: value }));
    }

    function toggleAll(check: boolean) {
        const next: Record<string, boolean> = {};
        for (const f of unstaged) next[f.path] = check;
        setSelected(next);
    }

    function handleClose() {
        // The Cancel button that calls handleClose is `disabled={stop.isPending}`,
        // and browsers/jsdom block click events on natively-disabled buttons,
        // so this guard is unreachable via a real/jsdom click.
        /* v8 ignore next */
        if (stop.isPending) return;
        setSelected({});
        setCommitMessage('Terminal session changes');
        setScope('uncommitted');
        onClose();
    }

    function handleConfirm() {
        const files = unstaged.filter((f) => selected[f.path]).map((f) => f.path);
        const input: {
            files_to_stage: string[];
            commit_message?: string;
            open_pull_request: boolean;
        } = { files_to_stage: files, open_pull_request: openPr };
        if (files.length > 0) input.commit_message = commitMessage;
        stop.mutate(
            { id: sessionId, input },
            {
                onSuccess: (result: CliSessionStopResponse) => {
                    setSelected({});
                    setCommitMessage('Terminal session changes');
                    setScope('uncommitted');
                    onClosed({
                        pushed: result.pushed,
                        committed: result.committed,
                        prUrl: result.finalize_pr_url,
                    });
                },
                onError: (err: Error) => {
                    toast.show({ message: 'Could not finalize session', detail: err.message });
                },
            },
        );
    }

    const isLoading = preflight.isPending;
    const totalFiles =
        (diff.data?.uncommitted.total_files ?? 0) + (diff.data?.committed.total_files ?? 0);

    return (
        <Dialog
            open={open}
            onClose={handleClose}
            fullWidth
            maxWidth={false}
            fullScreen={isNarrow}
            slotProps={{
                paper: {
                    sx: {
                        width: '96vw',
                        maxWidth: 1500,
                        height: '90vh',
                        maxHeight: '90vh',
                        display: 'flex',
                        flexDirection: 'column',
                    },
                },
            }}
        >
            <DialogTitle
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 2,
                    pb: 1,
                }}
            >
                {/* `component="span"`: MuiDialogTitle already renders the
                    heading element, so a nested h3 is invalid HTML and React
                    warns about it. We only want the h3 type scale here. */}
                <Typography variant="h3" component="span">
                    Stop session — review &amp; finalize
                </Typography>
                <Stack direction="row" spacing={1} alignItems="center">
                    {branch && (
                        <Chip
                            size="small"
                            variant="outlined"
                            label={branch}
                            sx={{ fontFamily: TYPOGRAPHY.fontFamilyMono }}
                        />
                    )}
                    {ahead > 0 && (
                        <Typography variant="caption" sx={{ color: ATLAS_PALETTE.slate60 }}>
                            {ahead} commit{ahead === 1 ? '' : 's'} ahead of origin
                        </Typography>
                    )}
                </Stack>
            </DialogTitle>

            <DialogContent
                dividers
                sx={{ p: 0, display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}
            >
                {isLoading ? (
                    <Stack direction="row" alignItems="center" spacing={1} sx={{ p: 4 }}>
                        <CircularProgress size={18} />
                        <Typography variant="body2">Inspecting worktree…</Typography>
                    </Stack>
                ) : unstaged.length === 0 && totalFiles === 0 && !diff.isPending ? (
                    <Box sx={{ p: 3, width: '100%' }}>
                        <Alert severity="info">
                            No changes to review. The current branch HEAD will be pushed as-is and
                            the local worktree removed.
                        </Alert>
                    </Box>
                ) : (
                    <Suspense
                        fallback={<Skeleton variant="rectangular" sx={{ flex: 1, m: 2 }} />}
                    >
                        <StopSessionReviewPanel
                            sessionId={sessionId}
                            summary={diff.data}
                            isLoading={diff.isPending}
                            error={(diff.error as Error | null) ?? null}
                            scope={scope}
                            onScopeChange={setScope}
                            selected={selected}
                            onToggle={(path, next) =>
                                setSelected((prev) => ({ ...prev, [path]: next }))
                            }
                            onToggleAll={toggleAll}
                            viewMode={prefs.viewMode}
                            onViewModeChange={(v: DiffViewMode) => setPref('viewMode', v)}
                            wrap={prefs.wrap}
                            onWrapChange={(w) => setPref('wrap', w)}
                        />
                    </Suspense>
                )}
            </DialogContent>

            <DialogActions
                sx={{ flexDirection: 'column', alignItems: 'stretch', gap: 1.5, px: 3, py: 2 }}
            >
                {unstaged.length > 0 && (
                    <TextField
                        label="Commit message"
                        value={commitMessage}
                        onChange={(e) => setCommitMessage(e.target.value)}
                        required={anySelected}
                        multiline
                        minRows={1}
                        maxRows={3}
                        fullWidth
                        size="small"
                    />
                )}
                <Stack
                    direction="row"
                    alignItems="center"
                    justifyContent="space-between"
                    flexWrap="wrap"
                    gap={1}
                >
                    {/* Deliberately NOT wrapped in a Tooltip. MUI pushes the
                        tooltip title onto the child as `aria-label`, which
                        overrides the checkbox's real name and marks the input
                        aria-hidden — the control disappears from the
                        accessibility tree. The reason it's disabled goes in
                        the caption below instead, where it's always visible
                        rather than hover-only. */}
                    <FormControlLabel
                        control={
                            <Checkbox
                                size="small"
                                checked={openPr}
                                disabled={!prPossible}
                                onChange={(e) => setPref('openPr', e.target.checked)}
                            />
                        }
                        label={
                            <Typography variant="body2">
                                Open a pull request for this branch
                            </Typography>
                        }
                    />
                    <Stack direction="row" spacing={1}>
                        <Button onClick={handleClose} disabled={stop.isPending} sx={{ textTransform: 'none' }}>
                            Cancel
                        </Button>
                        <Button
                            variant="contained"
                            color="error"
                            onClick={handleConfirm}
                            sx={{ textTransform: 'none' }}
                            disabled={
                                stop.isPending ||
                                isLoading ||
                                (unstaged.length > 0 && anySelected && commitMessage.trim().length === 0)
                            }
                            startIcon={
                                stop.isPending ? <CircularProgress size={16} /> : <StopRounded />
                            }
                        >
                            {stop.isPending
                                ? 'Stopping…'
                                : openPr
                                  ? 'Stop & open PR'
                                  : 'Stop session'}
                        </Button>
                    </Stack>
                </Stack>
                <Typography variant="caption" sx={{ color: ATLAS_PALETTE.slate60 }}>
                    {prPossible
                        ? 'The branch is always pushed — the worktree is deleted on close. Unchecking only skips opening a pull request.'
                        : 'Nothing to push, so there is no pull request to open.'}
                </Typography>
            </DialogActions>
        </Dialog>
    );
}
