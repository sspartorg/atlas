import { useEffect } from 'react';
import { useNavigate, useParams, Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded';
import type { CliSessionStatus } from '@atlas/shared';
import { useCliSession } from '../hooks/useCliSessions.js';
import { useSetPageTitle } from '../components/shell/index.js';
import { useToast } from '../hooks/useToast.js';
import { TerminalXterm } from '../components/TerminalXterm.js';
import { TerminalSessionControls } from '../components/TerminalSessionControls.js';
import { ATLAS_PALETTE } from '../theme/tokens.js';
import { isTerminalStatus } from '../utils/cliSessionRouting.js';

const STATUS_COLOUR: Record<CliSessionStatus, 'success' | 'warning' | 'default' | 'error'> = {
    active: 'success',
    paused: 'warning',
    closed: 'default',
    errored: 'error',
};

export function TerminalSession() {
    useSetPageTitle('Terminal Session');
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const toast = useToast();

    const { data: session, isLoading, isError } = useCliSession(id);

    // Closed/errored sessions belong on the transcript-history view; the live
    // view has no useful state for them. Mirror TerminalHistory's redirect-
    // when-live guard so direct bookmarks / "Open in single view" links route
    // to the right surface regardless of how the user arrived. Narrowed to
    // session?.status so a TanStack refetch (which produces a new session
    // object on every poll) does not re-fire history.replace().
    useEffect(() => {
        if (id && session && isTerminalStatus(session.status)) {
            navigate(`/terminal/${id}/history`, { replace: true });
        }
    }, [id, session?.status, navigate]);

    if (!id) {
        return (
            <Box sx={{ px: { xs: 3, md: 8 }, py: 4 }}>
                <Alert severity="error">Missing session id.</Alert>
            </Box>
        );
    }

    if (isLoading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
                <CircularProgress />
            </Box>
        );
    }

    if (isError || !session) {
        return (
            <Box sx={{ px: { xs: 3, md: 8 }, py: 4 }}>
                <Alert severity="error">
                    Session not found or no longer accessible.{' '}
                    <RouterLink to="/terminal">Back to sessions.</RouterLink>
                </Alert>
            </Box>
        );
    }

    // Terminal-state sessions are redirected to /history by the effect above;
    // returning null here avoids a one-tick flicker where the closed-state
    // alerts would otherwise paint before the redirect fires.
    if (isTerminalStatus(session.status)) return null;

    const sessionLive = session.status === 'active';

    function copySessionId() {
        if (!session?.claude_session_id) return;
        try {
            void navigator.clipboard.writeText(session.claude_session_id);
            toast.show({ message: 'Session id copied' });
        } catch {
            toast.show({ message: 'Clipboard write blocked by browser' });
        }
    }

    return (
        <Box
            sx={{
                display: 'flex',
                flexDirection: 'column',
                height: 'calc(100vh - 64px)',
                px: { xs: 3, md: 8 },
                py: 4,
                gap: 2,
            }}
        >
            <Stack direction="row" spacing={1} alignItems="center">
                <Tooltip title="Back to sessions">
                    <IconButton onClick={() => navigate('/terminal')} size="small">
                        <ArrowBackRounded />
                    </IconButton>
                </Tooltip>
                <Typography variant="h4" sx={{ flex: 1, minWidth: 0 }} noWrap>
                    {session.title}
                </Typography>
                <Chip
                    size="small"
                    label={session.cli}
                    variant="outlined"
                    sx={{ textTransform: 'capitalize' }}
                    data-testid="session-cli-chip"
                />
                <Chip
                    size="small"
                    label={session.status}
                    color={STATUS_COLOUR[session.status]}
                    data-testid="session-status-chip"
                />
                {session.item_id ? (
                    <Chip
                        size="small"
                        variant="outlined"
                        label={session.item_id}
                        data-testid="session-item-chip"
                        sx={{ fontFamily: 'monospace' }}
                    />
                ) : null}
            </Stack>

            <Stack
                direction="row"
                spacing={3}
                alignItems="center"
                sx={{
                    px: 2,
                    py: 1.5,
                    borderRadius: 1,
                    background: ATLAS_PALETTE.surfaceRaised,
                    border: `1px solid ${ATLAS_PALETTE.slate12}`,
                    flexWrap: 'wrap',
                }}
            >
                <HeaderField label="Branch" value={session.worktree_branch ?? '—'} />
                <HeaderField label="Model" value={session.model} />
                {session.claude_session_id ? (
                    <HeaderField
                        label="Session id"
                        value={session.claude_session_id}
                        onCopy={copySessionId}
                        monospace
                    />
                ) : (
                    <HeaderField label="Session id" value="—" monospace />
                )}
                <Box sx={{ flex: 1 }} />
                {/* TerminalSessionControls owns the "Session stopped + branch
                 * pushed" toast; we used to fire it from this page too, which
                 * produced a duplicate toast on every Stop. */}
                <TerminalSessionControls session={session} />
            </Stack>

            <TerminalXterm sessionId={id} sessionLive={sessionLive} />
        </Box>
    );
}

function HeaderField({
    label,
    value,
    onCopy,
    monospace,
}: {
    label: string;
    value: string;
    onCopy?: () => void;
    monospace?: boolean;
}) {
    return (
        <Stack spacing={0} sx={{ minWidth: 0, maxWidth: 260 }}>
            <Typography variant="caption" color="text.secondary">
                {label}
            </Typography>
            <Stack direction="row" alignItems="center" spacing={0.5}>
                <Typography
                    variant="body2"
                    noWrap
                    sx={{
                        fontFamily: monospace ? 'Cascadia Code, Menlo, Consolas, monospace' : undefined,
                        fontWeight: 500,
                    }}
                >
                    {value}
                </Typography>
                {onCopy && (
                    <Tooltip title="Copy">
                        <IconButton size="small" onClick={onCopy}>
                            <ContentCopyRounded sx={{ fontSize: 14 }} />
                        </IconButton>
                    </Tooltip>
                )}
            </Stack>
        </Stack>
    );
}
