import { useEffect, useMemo, useState } from 'react';
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
import AddRounded from '@mui/icons-material/AddRounded';
import TerminalRounded from '@mui/icons-material/TerminalRounded';
import { cliIcon } from '../utils/cliIcons.js';
import DashboardCustomizeRounded from '@mui/icons-material/DashboardCustomizeRounded';
import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';
import type { ICliSession, CliSessionStatus } from '@atlas/shared';
import { useCliSessions } from '../hooks/useCliSessions.js';
import { useProjects } from '../hooks/useProjects.js';
import { useSetPageTitle } from '../components/shell/index.js';
import { useToast } from '../hooks/useToast.js';
import { ATLAS_PALETTE } from '../theme/tokens.js';
import { StartSessionDialog } from '../components/StartSessionDialog.js';
import {
    TerminalFilters,
    type StatusFilterKey,
    type CliFilterKey,
} from '../components/TerminalFilters.js';
import { sessionDetailUrl } from '../utils/cliSessionRouting.js';

const MONO_FONT = '"JetBrains Mono", monospace';

const STATUS_COLOUR: Record<CliSessionStatus, 'success' | 'warning' | 'default' | 'error'> = {
    active: 'success',
    paused: 'warning',
    closed: 'default',
    errored: 'error',
};

const FILTERS_STORAGE_KEY = 'atlas.terminal-filters.v1';

interface PersistedFilters {
    status: StatusFilterKey;
    cli: CliFilterKey;
    projectId: string | 'all';
    search: string;
}

const DEFAULT_FILTERS: PersistedFilters = {
    status: 'all',
    cli: 'all',
    projectId: 'all',
    search: '',
};

function loadFilters(): PersistedFilters {
    try {
        const raw = window.localStorage.getItem(FILTERS_STORAGE_KEY);
        if (!raw) return DEFAULT_FILTERS;
        const parsed = JSON.parse(raw) as Partial<PersistedFilters>;
        return { ...DEFAULT_FILTERS, ...parsed };
    } catch {
        return DEFAULT_FILTERS;
    }
}

function relativeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(diff) || diff < 0) return '';
    const sec = Math.floor(diff / 1_000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const d = Math.floor(hr / 24);
    return `${d}d ago`;
}

export function Terminal() {
    useSetPageTitle('Terminal');
    const navigate = useNavigate();
    const toast = useToast();
    const { data: sessions = [], isLoading } = useCliSessions();
    const { data: projects = [] } = useProjects();
    const [dialogOpen, setDialogOpen] = useState(false);

    const [filters, setFilters] = useState<PersistedFilters>(() => loadFilters());
    useEffect(() => {
        try {
            window.localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(filters));
        } catch {
            // localStorage may throw in private mode — non-fatal.
        }
    }, [filters]);

    const projectNameById = useMemo(() => {
        const m = new Map<string, string>();
        projects.forEach((p) => m.set(p.id, p.name));
        return m;
    }, [projects]);

    const filtered = useMemo(() => {
        const needle = filters.search.trim().toLowerCase();
        return sessions.filter((s) => {
            if (filters.status !== 'all' && s.status !== filters.status) return false;
            if (filters.cli !== 'all' && s.cli !== filters.cli) return false;
            if (filters.projectId !== 'all' && s.project_id !== filters.projectId) return false;
            if (needle) {
                const haystack = [s.title, s.worktree_branch ?? '', s.id, s.item_id ?? '']
                    .join(' ')
                    .toLowerCase();
                if (!haystack.includes(needle)) return false;
            }
            return true;
        });
    }, [sessions, filters]);

    const counts = useMemo<Record<StatusFilterKey, number>>(() => {
        const c = { all: sessions.length, active: 0, paused: 0, closed: 0, errored: 0 };
        sessions.forEach((s) => {
            c[s.status] += 1;
        });
        return c;
    }, [sessions]);

    return (
        <Box sx={{ px: { xs: 3, md: 8 }, py: 4 }}>
            {/* Header — Projects-style h1 + monospace subtitle. */}
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
                        <TerminalRounded sx={{ fontSize: 36, color: ATLAS_PALETTE.green }} />
                        Terminal
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
                    </Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Tooltip title="Open multi-pane workspace">
                        <IconButton
                            onClick={() => navigate('/terminal/layout')}
                            sx={{
                                border: `1px solid ${ATLAS_PALETTE.slate12}`,
                                borderRadius: '8px',
                                p: 1,
                            }}
                        >
                            <DashboardCustomizeRounded sx={{ fontSize: 20 }} />
                        </IconButton>
                    </Tooltip>
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
                        Start Session
                    </Button>
                </Box>
            </Box>

            {/* Filter row */}
            <Box sx={{ mt: 5 }}>
                <TerminalFilters
                    status={filters.status}
                    cli={filters.cli}
                    projectId={filters.projectId}
                    search={filters.search}
                    counts={counts}
                    projects={projects}
                    onStatusChange={(status) => setFilters((f) => ({ ...f, status }))}
                    onCliChange={(cli) => setFilters((f) => ({ ...f, cli }))}
                    onProjectChange={(projectId) => setFilters((f) => ({ ...f, projectId }))}
                    onSearchChange={(search) => setFilters((f) => ({ ...f, search }))}
                />
            </Box>

            {/* Card grid */}
            <Box sx={{ mt: 6 }}>
                {isLoading ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
                        <CircularProgress />
                    </Box>
                ) : sessions.length === 0 ? (
                    <EmptyState onStart={() => setDialogOpen(true)} />
                ) : filtered.length === 0 ? (
                    <Box
                        sx={{
                            py: 16,
                            textAlign: 'center',
                            color: ATLAS_PALETTE.slate40,
                        }}
                    >
                        No sessions match these filters.
                    </Box>
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
                        {filtered.map((s) => (
                            <SessionCard
                                key={s.id}
                                session={s}
                                projectName={projectNameById.get(s.project_id) ?? s.project_id}
                                onOpen={() => navigate(sessionDetailUrl(s))}
                            />
                        ))}
                    </Box>
                )}
            </Box>

            <StartSessionDialog
                open={dialogOpen}
                onClose={() => setDialogOpen(false)}
                onCreated={(created) => {
                    setDialogOpen(false);
                    toast.show({ message: `Session "${created.title}" started` });
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
            <TerminalRounded sx={{ fontSize: 56, color: ATLAS_PALETTE.green, mb: 2 }} />
            <Typography variant="h6">No sessions yet</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 3 }}>
                Start one to spin up a Claude Code or GitHub Copilot REPL in a fresh worktree.
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
                Start Session
            </Button>
        </Card>
    );
}

interface SessionCardProps {
    session: ICliSession;
    projectName: string;
    onOpen: () => void;
}

function SessionCard({ session, projectName, onOpen }: SessionCardProps) {
    const CliIcon = cliIcon(session.cli);
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
                    {/* Row 1 — CLI icon + title */}
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

                    {/* Row 2 — status + cli + item chips */}
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
                        {session.item_id ? (
                            <Chip
                                size="small"
                                variant="outlined"
                                label={session.item_id}
                                sx={{ fontFamily: MONO_FONT }}
                            />
                        ) : null}
                    </Stack>

                    {/* Row 3 — project + branch */}
                    <Box sx={{ mt: 'auto', minWidth: 0 }}>
                        <Typography
                            variant="body2"
                            color="text.secondary"
                            noWrap
                            sx={{ fontFamily: MONO_FONT, fontSize: 12 }}
                        >
                            {projectName}
                        </Typography>
                        <Typography
                            variant="body2"
                            color="text.secondary"
                            noWrap
                            sx={{ fontSize: 12, mt: 0.5 }}
                        >
                            {session.worktree_branch ?? 'no branch'} · {session.model}
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
