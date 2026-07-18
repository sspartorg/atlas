import { useEffect } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import HistoryRounded from '@mui/icons-material/HistoryRounded';
import type { CliSessionStatus } from '@atlas/shared';
import { useCliSession, useCliSessionTranscript } from '../hooks/useCliSessions.js';
import { useSetPageTitle } from '../components/shell/index.js';
import { RunEventViewer } from '../components/RunEventViewer.js';
import { AiUsagePanel } from '../components/AiUsagePanel.js';
import { ATLAS_PALETTE } from '../theme/tokens.js';

const STATUS_COLOUR: Record<CliSessionStatus, 'success' | 'warning' | 'default' | 'error'> = {
    active: 'success',
    paused: 'warning',
    closed: 'default',
    errored: 'error',
};

const MONO = '"JetBrains Mono", Cascadia Code, Menlo, Consolas, monospace';

export function TerminalHistory() {
    useSetPageTitle('Terminal History');
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();

    const { data: session, isLoading: sessionLoading, isError: sessionError } = useCliSession(id);
    const isTerminalState = session?.status === 'closed' || session?.status === 'errored';
    const transcriptQuery = useCliSessionTranscript(id, session?.status);

    // History pages only make sense for closed/errored sessions. If the user
    // deep-links to a live session's history (or pastes an old URL after the
    // session resumed), shunt them back to the live view. Deps narrowed to
    // session?.status so a TanStack refetch (which produces a fresh session
    // object reference on every poll) does not re-fire navigate(replace) and
    // hammer history.replaceState.
    useEffect(() => {
        if (id && session && (session.status === 'active' || session.status === 'paused')) {
            navigate(`/terminal/${id}`, { replace: true });
        }
    }, [id, session?.status, navigate]);

    if (!id) {
        return (
            <Box sx={{ px: { xs: 3, md: 8 }, py: 4 }}>
                <Alert severity="error">Missing session id.</Alert>
            </Box>
        );
    }

    if (sessionLoading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
                <CircularProgress />
            </Box>
        );
    }

    if (sessionError || !session) {
        return (
            <Box sx={{ px: { xs: 3, md: 8 }, py: 4 }}>
                <Alert severity="error">
                    Session not found.{' '}
                    <RouterLink to="/terminal">Back to sessions.</RouterLink>
                </Alert>
            </Box>
        );
    }

    if (!isTerminalState) {
        // Effect above is already redirecting; render nothing while it fires.
        return null;
    }

    return (
        <Box
            sx={{
                px: { xs: 3, md: 8 },
                py: 4,
                display: 'flex',
                flexDirection: 'column',
                gap: 3,
                minHeight: 'calc(100vh - 64px)',
            }}
        >
            <Stack direction="row" spacing={1} alignItems="center">
                <Tooltip title="Back to sessions">
                    <IconButton onClick={() => navigate('/terminal')} size="small">
                        <ArrowBackRounded />
                    </IconButton>
                </Tooltip>
                <HistoryRounded sx={{ fontSize: 24, color: ATLAS_PALETTE.slate60 }} />
                <Typography variant="h4" sx={{ flex: 1, minWidth: 0 }} noWrap>
                    {session.title}
                </Typography>
                <Chip
                    size="small"
                    label={session.cli}
                    variant="outlined"
                    sx={{ textTransform: 'capitalize' }}
                />
                <Chip
                    size="small"
                    label={session.status}
                    color={STATUS_COLOUR[session.status]}
                />
            </Stack>

            <Box
                sx={{
                    px: 2,
                    py: 1.5,
                    borderRadius: 1,
                    background: ATLAS_PALETTE.surfaceRaised,
                    border: `1px solid ${ATLAS_PALETTE.slate12}`,
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 4,
                }}
            >
                <MetaField label="Branch" value={session.worktree_branch ?? '—'} />
                <MetaField label="Model" value={session.model} />
                <MetaField label="Closed at" value={session.closed_at ?? '—'} mono />
                {transcriptQuery.data?.ingested_at ? (
                    <MetaField
                        label="Transcript captured"
                        value={transcriptQuery.data.ingested_at}
                        mono
                    />
                ) : null}
            </Box>

            {session.finalize_pr_url && /^https:\/\//i.test(session.finalize_pr_url) ? (
                <Alert severity="success">
                    Session closed. PR:{' '}
                    <a
                        href={session.finalize_pr_url}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        {session.finalize_pr_url}
                    </a>
                </Alert>
            ) : session.finalize_pr_url ? (
                <Alert severity="warning">
                    Session closed. PR link rejected (must be https): {session.finalize_pr_url}
                </Alert>
            ) : null}

            {transcriptQuery.isLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
                    <CircularProgress />
                </Box>
            ) : transcriptQuery.isError ? (
                <Alert severity="error">
                    Could not load transcript:{' '}
                    {(transcriptQuery.error as Error)?.message ?? 'unknown error'}
                </Alert>
            ) : !transcriptQuery.data?.jsonl_content ? (
                <Alert severity="info">
                    Transcript unavailable — the CLI may have removed its on-disk copy, or
                    the session ended before any output was written. The session row is
                    still preserved.
                </Alert>
            ) : (
                // Reuses the same master-detail viewer the agent-run detail
                // page uses. Source maps the CLI to the viewer's per-format
                // preview extractor: claude PTY-mode session JSONL vs
                // copilot's events.jsonl. Selection resets when the session
                // id changes.
                <RunEventViewer
                    content={transcriptQuery.data.jsonl_content}
                    source={
                        transcriptQuery.data.source === 'copilot'
                            ? 'copilot'
                            : 'claude-pty'
                    }
                    resetKey={id}
                />
            )}

            {/* Token + USD cost card. Mirrors the AgentRunDetail panel —
                both pages render the same component. Populated at session
                close by parsing per-event usage from the ingested PTY
                JSONL (see api `pty-transcript-usage.ts`). Hidden when
                `total_cost_usd` is null — copilot sessions and any
                pre-fix claude sessions where ingest didn't populate cost. */}
            <AiUsagePanel
                total_cost_usd={session.total_cost_usd}
                input_tokens={session.input_tokens}
                output_tokens={session.output_tokens}
                cache_creation_tokens={session.cache_creation_tokens}
                cache_read_tokens={session.cache_read_tokens}
            />
        </Box>
    );
}

function MetaField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
    return (
        <Stack spacing={0}>
            <Typography variant="caption" color="text.secondary">
                {label}
            </Typography>
            <Typography
                variant="body2"
                sx={{ fontFamily: mono ? MONO : undefined, fontWeight: 500 }}
            >
                {value}
            </Typography>
        </Stack>
    );
}
