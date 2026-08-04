import { useState, type ReactElement } from 'react';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import PauseRounded from '@mui/icons-material/PauseRounded';
import PlayArrowRounded from '@mui/icons-material/PlayArrowRounded';
import StopRounded from '@mui/icons-material/StopRounded';
import type { ICliSession } from '@atlas/shared';
import { usePauseCliSession, useResumeCliSession } from '../hooks/useCliSessions.js';
import { useToast } from '../hooks/useToast.js';
import { StopSessionModal, type StopSessionResult } from './StopSessionModal.js';

// The old copy said "Session stopped + branch pushed" unconditionally, which
// was already wrong when nothing got pushed — and is now also wrong when the
// Owner opts out of the PR. Report what actually happened.
function stopToast(r: StopSessionResult): { message: string; detail?: string } {
    if (r.prUrl) return { message: 'Session stopped + PR opened', detail: r.prUrl };
    if (r.pushed) return { message: 'Session stopped + branch pushed' };
    return { message: 'Session stopped' };
}

interface TerminalSessionControlsProps {
    session: ICliSession;
    /** Render the controls as MenuItems for an outer Menu (multi-pane kebab). Default: Button row. */
    compact?: boolean | undefined;
    /** Optional close-menu hook fired when a MenuItem is clicked, in compact mode. */
    onMenuItemClick?: (() => void) | undefined;
    onStopped?: (() => void) | undefined;
    /**
     * When provided, the parent owns the StopSessionModal — the Stop control
     * fires this callback instead of opening an in-component modal. Required
     * in compact mode, because the kebab Menu unmounts its children when it
     * closes (taking an in-component modal with it mid-preflight). The parent
     * mounts the modal at its own scope via {@link useTerminalStopModal}.
     */
    onStopRequest?: (() => void) | undefined;
}

/**
 * Companion hook that owns a `StopSessionModal` outside any Menu/Popover that
 * might unmount mid-action. Use this in compact contexts (PaneChrome) where
 * the controls render inside an MUI Menu.
 */
export function useTerminalStopModal(
    session: ICliSession,
    onStopped?: () => void,
): { stopRequest: () => void; stopModalElement: ReactElement } {
    const [open, setOpen] = useState(false);
    const toast = useToast();
    const stopModalElement = (
        <StopSessionModal
            open={open}
            sessionId={session.id}
            onClose={() => setOpen(false)}
            onClosed={(result) => {
                setOpen(false);
                toast.show(stopToast(result));
                onStopped?.();
            }}
        />
    );
    return { stopRequest: () => setOpen(true), stopModalElement };
}

export function TerminalSessionControls({
    session,
    compact,
    onMenuItemClick,
    onStopped,
    onStopRequest,
}: TerminalSessionControlsProps) {
    const toast = useToast();
    const pause = usePauseCliSession();
    const resume = useResumeCliSession();
    // Internal modal only when the parent hasn't taken over (the non-compact /
    // single-page case). In compact mode the parent supplies onStopRequest so
    // the StopSessionModal lives outside any closing Menu.
    const [internalStopOpen, setInternalStopOpen] = useState(false);
    const ownsModal = !onStopRequest;

    function handlePause() {
        onMenuItemClick?.();
        pause.mutate(session.id, {
            onSuccess: () => toast.show({ message: 'Session paused' }),
            onError: (err: Error) =>
                toast.show({ message: 'Could not pause', detail: err.message }),
        });
    }

    function handleResume() {
        onMenuItemClick?.();
        resume.mutate(session.id, {
            onSuccess: () => toast.show({ message: 'Session resumed' }),
            onError: (err: Error) =>
                toast.show({ message: 'Could not resume', detail: err.message }),
        });
    }

    function handleStop() {
        onMenuItemClick?.();
        if (onStopRequest) {
            onStopRequest();
        } else {
            setInternalStopOpen(true);
        }
    }

    const canPause = session.status === 'active';
    const canResume = session.status === 'paused';
    const canStop = session.status === 'active' || session.status === 'paused';

    const internalModal = ownsModal ? (
        <StopSessionModal
            open={internalStopOpen}
            sessionId={session.id}
            onClose={() => setInternalStopOpen(false)}
            onClosed={(result) => {
                setInternalStopOpen(false);
                toast.show(stopToast(result));
                onStopped?.();
            }}
        />
    ) : null;

    if (compact) {
        return (
            <>
                {canPause && (
                    <MenuItem onClick={handlePause} disabled={pause.isPending}>
                        <ListItemIcon>
                            <PauseRounded fontSize="small" />
                        </ListItemIcon>
                        <ListItemText>{pause.isPending ? 'Pausing…' : 'Pause'}</ListItemText>
                    </MenuItem>
                )}
                {canResume && (
                    <MenuItem onClick={handleResume} disabled={resume.isPending}>
                        <ListItemIcon>
                            <PlayArrowRounded fontSize="small" />
                        </ListItemIcon>
                        <ListItemText>{resume.isPending ? 'Resuming…' : 'Resume'}</ListItemText>
                    </MenuItem>
                )}
                {canStop && (
                    <MenuItem onClick={handleStop}>
                        <ListItemIcon>
                            <StopRounded fontSize="small" color="error" />
                        </ListItemIcon>
                        <ListItemText>Stop</ListItemText>
                    </MenuItem>
                )}
                {internalModal}
            </>
        );
    }

    return (
        <>
            <Stack direction="row" spacing={1}>
                {canPause && (
                    <Button
                        variant="outlined"
                        size="small"
                        startIcon={<PauseRounded />}
                        disabled={pause.isPending}
                        onClick={handlePause}
                    >
                        {pause.isPending ? 'Pausing…' : 'Pause'}
                    </Button>
                )}
                {canResume && (
                    <Button
                        variant="contained"
                        size="small"
                        startIcon={<PlayArrowRounded />}
                        disabled={resume.isPending}
                        onClick={handleResume}
                    >
                        {resume.isPending ? 'Resuming…' : 'Resume'}
                    </Button>
                )}
                {canStop && (
                    <Button
                        variant="outlined"
                        color="error"
                        size="small"
                        startIcon={<StopRounded />}
                        onClick={handleStop}
                    >
                        Stop
                    </Button>
                )}
            </Stack>
            {internalModal}
        </>
    );
}
