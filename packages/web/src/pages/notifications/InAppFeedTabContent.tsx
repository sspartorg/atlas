import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import Tooltip from '@mui/material/Tooltip';
import WarningAmberRounded from '@mui/icons-material/WarningAmberRounded';
import { useNavigate } from 'react-router-dom';
import type { INotification, IAgent, NotificationKind } from '@atlas/shared';
import { useMarkNotificationRead } from '../../hooks/useNotifications.js';
import { useNow } from '../../hooks/useNow.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { FilterPill } from '../../components/filterPrimitives.js';
import { InitialAvatar } from '../../components/InitialAvatar.js';
import { relativeShort } from './timeFormat.js';

const MONO = '"JetBrains Mono", monospace';
type Filter = 'all' | NotificationKind;

const TYPE_LABEL: Record<string, string> = {
    epic: 'epic',
    story: 'story',
    bug: 'bug',
    sub_task: 'sub-task',
    sub_bug: 'sub-bug',
};

interface Props {
    allRows: INotification[];
    agents: IAgent[];
}

export function InAppFeedTabContent({ allRows, agents }: Props) {
    const navigate = useNavigate();
    const [filter, setFilter] = useState<Filter>('all');
    // Tick every minute so the relative time on each row ages forward.
    useNow();
    const agentById = useMemo(() => new Map(agents.map((w) => [w.id, w])), [agents]);
    const markRead = useMarkNotificationRead();

    const counts = useMemo(() => {
        const c = { all: allRows.length, needs_you: 0, update: 0, system: 0 };
        for (const r of allRows) c[r.kind] = (c[r.kind] ?? 0) + 1;
        return c;
    }, [allRows]);

    const filtered = useMemo(
        () => (filter === 'all' ? allRows : allRows.filter((r) => r.kind === filter)),
        [allRows, filter]
    );

    const needsYouCount = counts.needs_you;

    function openNotification(row: INotification) {
        if (!row.read_at) markRead.mutate(row.id);
        // Explicit deep link takes precedence — Terminal sessions and any
        // future non-item-shaped surface set this. Falls through to the
        // legacy item-based routing otherwise.
        if (row.link_url) {
            navigate(row.link_url);
            return;
        }
        const id = row.issue_id;
        if (id && row.issue_type === 'epic') {
            navigate(`/epics/${id}`);
        } else if (id && row.issue_type === 'story') {
            navigate(`/issues/stories/${id}`);
        } else if (id && row.issue_type === 'bug') {
            navigate(`/issues/bugs/${id}`);
        } else if (id && row.issue_type === 'sub_task') {
            navigate(`/issues/sub-tasks/${id}`);
        } else if (id && row.issue_type === 'sub_bug') {
            navigate(`/issues/sub-bugs/${id}`);
        } else if (row.project_id) {
            navigate(`/projects/${row.project_id}`);
        } else if (row.event_type === 'reminder') {
            navigate('/reminders');
        } else {
            navigate('/issues');
        }
    }

    return (
        <Box>
            {needsYouCount > 0 && (
                <Alert
                    icon={<WarningAmberRounded sx={{ color: ATLAS_PALETTE.warning }} />}
                    sx={{
                        mb: 3,
                        bgcolor: ATLAS_PALETTE.warnSoft,
                        border: `1px solid ${ATLAS_PALETTE.warning}`,
                        color: ATLAS_PALETTE.warnFg,
                        '& .MuiAlert-message': { fontSize: 13 },
                    }}
                >
                    <strong>
                        {needsYouCount === 1
                            ? '1 item needs you.'
                            : `${needsYouCount} items need you.`}
                    </strong>{' '}
                    Tap any row below to open it.
                </Alert>
            )}

            <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
                <FilterPill
                    label="All"
                    count={counts.all}
                    selected={filter === 'all'}
                    onClick={() => setFilter('all')}
                />
                <FilterPill
                    label="Needs You"
                    count={counts.needs_you}
                    selected={filter === 'needs_you'}
                    onClick={() => setFilter('needs_you')}
                />
                <FilterPill
                    label="Updates"
                    count={counts.update}
                    selected={filter === 'update'}
                    onClick={() => setFilter('update')}
                />
                <FilterPill
                    label="System"
                    count={counts.system}
                    selected={filter === 'system'}
                    onClick={() => setFilter('system')}
                />
            </Box>

            {filtered.length === 0 ? (
                <Box
                    sx={{
                        p: 8,
                        textAlign: 'center',
                        color: ATLAS_PALETTE.slate40,
                        bgcolor: ATLAS_PALETTE.white,
                        border: `1px solid ${ATLAS_PALETTE.slate10}`,
                        borderRadius: '12px',
                    }}
                >
                    <Typography sx={{ fontSize: 13 }}>Nothing here yet.</Typography>
                </Box>
            ) : (
                <Box
                    sx={{
                        bgcolor: ATLAS_PALETTE.white,
                        border: `1px solid ${ATLAS_PALETTE.slate10}`,
                        borderRadius: '12px',
                        overflow: 'hidden',
                    }}
                >
                    {filtered.map((row, i) => (
                        <FeedItem
                            key={row.id}
                            row={row}
                            agent={row.agent_id ? agentById.get(row.agent_id) : undefined}
                            isLast={i === filtered.length - 1}
                            onOpen={() => openNotification(row)}
                        />
                    ))}
                </Box>
            )}
        </Box>
    );
}

function FeedItem({
    row,
    agent,
    isLast,
    onOpen,
}: {
    row: INotification;
    agent: IAgent | undefined;
    isLast: boolean;
    onOpen: () => void;
}) {
    const unread = !row.read_at;
    const agentName = agent?.name ?? 'Atlas';
    const typeText = row.issue_type ? (TYPE_LABEL[row.issue_type] ?? row.issue_type) : null;
    const shortId = row.issue_id ? row.issue_id.slice(0, 12) : null;
    const time = relativeShort(row.created_at);
    const metaParts = [shortId, typeText, agentName, time].filter(Boolean) as string[];

    return (
        <Box
            role="button"
            onClick={onOpen}
            sx={{
                display: 'flex',
                gap: 2,
                alignItems: 'center',
                px: { xs: 3, md: 4 },
                py: 3,
                borderBottom: isLast ? 'none' : `1px solid ${ATLAS_PALETTE.slate06}`,
                bgcolor: unread ? 'rgba(0,122,201,.035)' : 'transparent',
                '&:hover': { bgcolor: unread ? 'rgba(0,122,201,.07)' : ATLAS_PALETTE.cloud },
                transition: 'background 120ms ease',
                cursor: 'pointer',
            }}
        >
            <Tooltip title={agentName} placement="top">
                <Box sx={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                    {agent ? (
                        <InitialAvatar
                            name={agent.name}
                            color={agent.accent_color}
                            size={32}
                            fontSize={13}
                        />
                    ) : (
                        <Box
                            sx={{
                                width: 32,
                                height: 32,
                                borderRadius: '8px',
                                bgcolor: ATLAS_PALETTE.slate08,
                                color: ATLAS_PALETTE.slate70,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 13,
                                fontWeight: 700,
                            }}
                        >
                            P
                        </Box>
                    )}
                </Box>
            </Tooltip>
            <Box sx={{ flex: 1, minWidth: 0 }}>
                {/* Row 1: full-width title with ellipsis */}
                <Typography
                    sx={{
                        fontSize: 14,
                        fontWeight: 500,
                        color: ATLAS_PALETTE.slate,
                        lineHeight: 1.4,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                    }}
                >
                    {row.message}
                </Typography>
                {/* Row 2: id · type · agent · time — dot-separated */}
                {metaParts.length > 0 && (
                    <Typography
                        sx={{
                            mt: 0.5,
                            fontSize: 11,
                            color: ATLAS_PALETTE.slate60,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                        }}
                    >
                        {shortId && (
                            <Box
                                component="span"
                                sx={{ fontFamily: MONO, color: ATLAS_PALETTE.brandBlue }}
                            >
                                {shortId}
                            </Box>
                        )}
                        {shortId && typeText && ' · '}
                        {typeText}
                        {(shortId || typeText) && agentName && ' · '}
                        <Box
                            component="span"
                            sx={{
                                color: agent?.accent_color ?? ATLAS_PALETTE.slate70,
                                fontWeight: 600,
                            }}
                        >
                            {agentName}
                        </Box>
                        {' · '}
                        <Box component="span" sx={{ fontFamily: MONO }}>
                            {time}
                        </Box>
                    </Typography>
                )}
            </Box>
        </Box>
    );
}
