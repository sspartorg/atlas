import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import CircularProgress from '@mui/material/CircularProgress';
import Tooltip from '@mui/material/Tooltip';
import AddRounded from '@mui/icons-material/AddRounded';
import FolderOpenRounded from '@mui/icons-material/FolderOpenRounded';
import KeyRounded from '@mui/icons-material/KeyRounded';
import type { ICliSession, CliSessionStatus } from '@atlas/shared';
import { cliIcon } from '../utils/cliIcons.js';
import { useCliSessions } from '../hooks/useCliSessions.js';
import { useCredentials } from '../hooks/useCredentials.js';
import { useSetPageTitle } from '../components/shell/index.js';
import { useToast } from '../hooks/useToast.js';
import { ATLAS_PALETTE } from '../theme/tokens.js';
import { StartStandaloneSessionDialog } from '../components/StartStandaloneSessionDialog.js';
import { sessionDetailUrl } from '../utils/cliSessionRouting.js';
import { formatCostUsd } from '../utils/formatCost.js';

// Standalone terminals — PTYs the Owner opened directly on a folder, with no
// project, no worktree and no Atlas scaffolding. Deliberately its own page
// rather than a filter on /terminal: none of that page's axes (project,
// branch, item) exist here, and the two are independent channels.

const MONO_FONT = '"JetBrains Mono", monospace';

const STATUS_COLOUR: Record<CliSessionStatus, 'success' | 'warning' | 'default' | 'error'> = {
    active: 'success',
    paused: 'warning',
    closed: 'default',
    errored: 'error',
};

function relativeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(diff) || diff < 0) return '';
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
}

export function TerminalStandalone() {
    useSetPageTitle('Standalone terminals');
    const navigate = useNavigate();
    const toast = useToast();
    const { data: sessions = [], isLoading } = useCliSessions({ standalone: true });
    const { data: credentials = [] } = useCredentials();
    const [dialogOpen, setDialogOpen] = useState(false);

    const credentialLabelById = useMemo(() => {
        const m = new Map<string, string>();
        credentials.forEach((c) => m.set(c.id, c.label));
        return m;
    }, [credentials]);

    const counts = useMemo(() => {
        let active = 0;
        let paused = 0;
        let spend = 0;
        sessions.forEach((s) => {
            if (s.status === 'active') active += 1;
            if (s.status === 'paused') paused += 1;
            spend += s.total_cost_usd ?? 0;
        });
        return { active, paused, spend };
    }, [sessions]);

    return (
        <Box sx={{ px: { xs: 3, md: 8 }, py: 4 }}>
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'flex-end',
                    justifyContent: 'space-between',
                    gap: 4,
                    flexWrap: 'wrap',
                }}
            >
                <Box>
                    <Typography
                        variant="h1"
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1.5,
                            fontSize: '2.25rem',
                            fontWeight: 700,
                            lineHeight: 1.2,
                            letterSpacing: '-0.01em',
                            color: ATLAS_PALETTE.slate,
                        }}
                    >
                        <FolderOpenRounded sx={{ fontSize: 36, color: ATLAS_PALETTE.green }} />
                        Standalone
                    </Typography>
                    <Typography
                        sx={{
                            fontFamily: MONO_FONT,
                            fontSize: '0.8125rem',
                            color: ATLAS_PALETTE.slate60,
                            mt: 2,
                        }}
                    >
                        {sessions.length} sessions · {counts.active} active · {counts.paused} paused
                        · {formatCostUsd(counts.spend)} spent
                    </Typography>
                </Box>
                <Button
                    variant="contained"
                    startIcon={<AddRounded />}
                    onClick={() => setDialogOpen(true)}
                    sx={{
                        textTransform: 'none',
                        fontWeight: 600,
                        background: ATLAS_PALETTE.green,
                        '&:hover': { background: ATLAS_PALETTE.greenDark },
                    }}
                >
                    Open folder
                </Button>
            </Box>

            <Box sx={{ mt: 6 }}>
                {isLoading ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
                        <CircularProgress />
                    </Box>
                ) : sessions.length === 0 ? (
                    <EmptyState onStart={() => setDialogOpen(true)} />
                ) : (
                    <Box
                        sx={{
                            display: 'grid',
                            gridTemplateColumns: {
                                xs: '1fr',
                                sm: '1fr 1fr',
                                lg: 'repeat(3, 1fr)',
                            },
                            gap: 6,
                        }}
                    >
                        {sessions.map((s) => (
                            <StandaloneSessionCard
                                key={s.id}
                                session={s}
                                credentialLabel={
                                    s.credential_id
                                        ? credentialLabelById.get(s.credential_id) ?? s.credential_id
                                        : null
                                }
                                onOpen={() => navigate(sessionDetailUrl(s))}
                            />
                        ))}
                    </Box>
                )}
            </Box>

            <StartStandaloneSessionDialog
                open={dialogOpen}
                onClose={() => setDialogOpen(false)}
                onCreated={(created) => {
                    setDialogOpen(false);
                    toast.show({ message: `Terminal "${created.title}" opened` });
                    navigate(`/terminal/${created.id}`);
                }}
            />
        </Box>
    );
}

function EmptyState({ onStart }: { onStart: () => void }) {
    return (
        <Card
            sx={{
                p: 6,
                textAlign: 'center',
                background: ATLAS_PALETTE.surfaceRaised,
                border: `1px dashed ${ATLAS_PALETTE.slate12}`,
            }}
        >
            <FolderOpenRounded sx={{ fontSize: 56, color: ATLAS_PALETTE.green, mb: 2 }} />
            <Typography variant="h6">No standalone terminals yet</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 3 }}>
                Open one to run a CLI in any folder on this machine, under the git credentials you
                choose.
            </Typography>
            <Button
                variant="contained"
                startIcon={<AddRounded />}
                onClick={onStart}
                sx={{
                    textTransform: 'none',
                    background: ATLAS_PALETTE.green,
                    '&:hover': { background: ATLAS_PALETTE.greenDark },
                }}
            >
                Open folder
            </Button>
        </Card>
    );
}

interface StandaloneSessionCardProps {
    session: ICliSession;
    credentialLabel: string | null;
    onOpen: () => void;
}

function StandaloneSessionCard({
    session,
    credentialLabel,
    onOpen,
}: StandaloneSessionCardProps) {
    const CliIcon = cliIcon(session.cli);
    const folder = session.worktree_path ?? '';
    return (
        <Card
            sx={{
                height: 200,
                display: 'flex',
                transition: 'transform 150ms ease, box-shadow 150ms ease',
                '&:hover': { transform: 'translateY(-2px)' },
            }}
        >
            <CardActionArea onClick={onOpen} sx={{ height: '100%', alignItems: 'stretch' }}>
                <CardContent
                    sx={{
                        height: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 1.5,
                    }}
                >
                    <Stack direction="row" alignItems="center" spacing={1.5} sx={{ minWidth: 0 }}>
                        <Box
                            sx={{
                                width: 28,
                                height: 28,
                                borderRadius: '6px',
                                background: `${ATLAS_PALETTE.green}1A`,
                                color: ATLAS_PALETTE.green,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                            }}
                        >
                            <CliIcon sx={{ fontSize: 18 }} />
                        </Box>
                        <Typography variant="h6" noWrap sx={{ flex: 1, minWidth: 0 }}>
                            {session.title}
                        </Typography>
                    </Stack>

                    <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
                        <Chip
                            size="small"
                            label={session.status}
                            color={STATUS_COLOUR[session.status]}
                            sx={{ textTransform: 'capitalize' }}
                        />
                        <Chip
                            size="small"
                            label={session.cli}
                            variant="outlined"
                            sx={{ textTransform: 'capitalize' }}
                        />
                        <Chip
                            size="small"
                            variant="outlined"
                            icon={<KeyRounded sx={{ fontSize: 14 }} />}
                            label={credentialLabel ?? 'machine git config'}
                        />
                    </Stack>

                    <Box sx={{ mt: 'auto', minWidth: 0 }}>
                        {/* The folder is the identity of a standalone session, and
                            the meaningful end of a long path is the tail — so the
                            ellipsis goes on the left, not MUI's default right. */}
                        <Tooltip title={folder}>
                            <Typography
                                variant="body2"
                                color="text.secondary"
                                noWrap
                                sx={{
                                    fontFamily: MONO_FONT,
                                    fontSize: 12,
                                    direction: 'rtl',
                                    textAlign: 'left',
                                }}
                            >
                                {folder}
                            </Typography>
                        </Tooltip>
                        <Typography
                            variant="body2"
                            color="text.secondary"
                            noWrap
                            sx={{ fontSize: 12, mt: 0.5 }}
                        >
                            {session.model}
                            {session.total_cost_usd != null
                                ? ` · ${formatCostUsd(session.total_cost_usd)}`
                                : ''}
                        </Typography>
                        <Typography
                            variant="body2"
                            color="text.secondary"
                            noWrap
                            sx={{ fontSize: 11, mt: 0.5, color: ATLAS_PALETTE.slate40 }}
                        >
                            last active {relativeAgo(session.last_active_at)}
                        </Typography>
                    </Box>
                </CardContent>
            </CardActionArea>
        </Card>
    );
}
