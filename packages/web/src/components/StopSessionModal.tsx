import { useEffect, useMemo, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import TextField from '@mui/material/TextField';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import StopRounded from '@mui/icons-material/StopRounded';
import type { CliSessionUnstagedFile } from '@atlas/shared';
import {
    usePreflightStopCliSession,
    useStopCliSession,
} from '../hooks/useCliSessions.js';
import { useToast } from '../hooks/useToast.js';

// 2026-06-22 - Terminal v1 finalize modal.
//
// Flow:
//   Open  -> preflightStop -> render the unstaged-files checklist (all
//            checked by default) + commit-message field.
//   Stage -> stop({files_to_stage, commit_message}) -> server commits +
//            pushes + tears the worktree down -> onClosed.
//   No unstaged files? -> skip the picker, just confirm Stop -> push
//            current HEAD + teardown.

interface Props {
    open: boolean;
    sessionId: string;
    onClose: () => void;
    onClosed: () => void;
}

function describeCode(code: string): string {
    // `git status --porcelain` codes -- two chars: index status, worktree status.
    const idx = code[0] ?? ' ';
    const tree = code[1] ?? ' ';
    if (idx === '?' && tree === '?') return 'untracked';
    if (idx === ' ' && tree === 'M') return 'modified';
    if (tree === 'D') return 'deleted';
    if (idx === 'A') return 'added';
    if (idx === 'R') return 'renamed';
    if (idx === 'M') return 'staged';
    return code.trim() || 'changed';
}

export function StopSessionModal({ open, sessionId, onClose, onClosed }: Props) {
    const toast = useToast();
    const preflight = usePreflightStopCliSession();
    const stop = useStopCliSession();
    const [selected, setSelected] = useState<Record<string, boolean>>({});
    const [commitMessage, setCommitMessage] = useState('Terminal session changes');

    // Run preflight when the modal opens.
    useEffect(() => {
        if (!open) return;
        preflight.mutate(sessionId, {
            onSuccess: (resp) => {
                // Default-select every unstaged path so the user only has to
                // uncheck things they want to discard.
                const next: Record<string, boolean> = {};
                for (const f of resp.unstaged) next[f.path] = true;
                setSelected(next);
            },
            onError: (err: Error) => {
                toast.show({ message: 'Could not inspect worktree', detail: err.message });
            },
        });
    }, [open, sessionId]);

    const unstaged: CliSessionUnstagedFile[] = preflight.data?.unstaged ?? [];
    const branch = preflight.data?.current_branch ?? '';
    const ahead = preflight.data?.ahead_of_remote ?? 0;
    const anySelected = useMemo(
        () => Object.values(selected).some(Boolean),
        [selected],
    );

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
        onClose();
    }

    function handleConfirm() {
        const files = unstaged.filter((f) => selected[f.path]).map((f) => f.path);
        const input: { files_to_stage: string[]; commit_message?: string } = {
            files_to_stage: files,
        };
        if (files.length > 0) input.commit_message = commitMessage;
        stop.mutate(
            { id: sessionId, input },
            {
                onSuccess: () => {
                    setSelected({});
                    setCommitMessage('Terminal session changes');
                    onClosed();
                },
                onError: (err: Error) => {
                    toast.show({ message: 'Could not finalize session', detail: err.message });
                },
            },
        );
    }

    const isLoading = preflight.isPending;
    const allChecked = unstaged.length > 0 && unstaged.every((f) => selected[f.path]);

    return (
        <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
            <DialogTitle>Stop session — finalize worktree</DialogTitle>
            <DialogContent>
                {isLoading ? (
                    <Stack direction="row" alignItems="center" spacing={1} sx={{ py: 4 }}>
                        <CircularProgress size={18} />
                        <Typography variant="body2">Inspecting worktree…</Typography>
                    </Stack>
                ) : (
                    <Stack spacing={2} sx={{ mt: 1 }}>
                        <Alert severity="info">
                            Branch <strong>{branch || '?'}</strong>
                            {ahead > 0 && ` is ${ahead} commit${ahead === 1 ? '' : 's'} ahead of origin`}
                            {ahead === 0 && unstaged.length === 0 && ' has nothing to push'}
                            . Atlas will push the branch and remove the local worktree once you confirm.
                        </Alert>

                        {unstaged.length > 0 && (
                            <>
                                <Stack direction="row" alignItems="center" justifyContent="space-between">
                                    <Typography variant="subtitle2">
                                        {unstaged.length} unstaged file
                                        {unstaged.length === 1 ? '' : 's'} in the worktree
                                    </Typography>
                                    <Button
                                        size="small"
                                        onClick={() => toggleAll(!allChecked)}
                                    >
                                        {allChecked ? 'Uncheck all' : 'Check all'}
                                    </Button>
                                </Stack>
                                <Stack
                                    spacing={0.5}
                                    sx={{
                                        maxHeight: 260,
                                        overflowY: 'auto',
                                        border: '1px solid rgba(255,255,255,0.08)',
                                        borderRadius: 1,
                                        p: 1,
                                    }}
                                >
                                    {unstaged.map((f) => (
                                        <FormControlLabel
                                            key={f.path}
                                            control={
                                                <Checkbox
                                                    size="small"
                                                    checked={Boolean(selected[f.path])}
                                                    onChange={(e) =>
                                                        setSelected((prev) => ({
                                                            ...prev,
                                                            [f.path]: e.target.checked,
                                                        }))
                                                    }
                                                />
                                            }
                                            label={
                                                <Stack direction="row" spacing={1} alignItems="center">
                                                    <Typography
                                                        variant="body2"
                                                        sx={{
                                                            fontFamily:
                                                                'Cascadia Code, Menlo, Consolas, monospace',
                                                        }}
                                                    >
                                                        {f.path}
                                                    </Typography>
                                                    <Typography
                                                        variant="caption"
                                                        color="text.secondary"
                                                    >
                                                        {describeCode(f.code)}
                                                    </Typography>
                                                </Stack>
                                            }
                                        />
                                    ))}
                                </Stack>
                                <TextField
                                    label="Commit message"
                                    value={commitMessage}
                                    onChange={(e) => setCommitMessage(e.target.value)}
                                    required={anySelected}
                                    multiline
                                    minRows={2}
                                    maxRows={4}
                                    fullWidth
                                />
                            </>
                        )}

                        {unstaged.length === 0 && (
                            <Typography variant="body2" color="text.secondary">
                                No unstaged changes. The current branch HEAD will be pushed
                                as-is and the local worktree removed.
                            </Typography>
                        )}
                    </Stack>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={handleClose} disabled={stop.isPending}>
                    Cancel
                </Button>
                <Button
                    variant="contained"
                    color="error"
                    onClick={handleConfirm}
                    disabled={
                        stop.isPending ||
                        isLoading ||
                        (unstaged.length > 0 && anySelected && commitMessage.trim().length === 0)
                    }
                    startIcon={stop.isPending ? <CircularProgress size={16} /> : <StopRounded />}
                >
                    {stop.isPending ? 'Stopping…' : 'Stop session'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
