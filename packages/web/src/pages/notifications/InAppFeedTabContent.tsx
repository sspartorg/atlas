import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import WarningAmberRounded from '@mui/icons-material/WarningAmberRounded';
import { useNavigate } from 'react-router-dom';
import { notificationLinkUrl, type INotification, type NotificationKind } from '@atlas/shared';
import { useMarkNotificationRead } from '../../hooks/useNotifications.js';
import { useNow } from '../../hooks/useNow.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { FilterPill } from '../../components/filterPrimitives.js';
import { EventTypeIcon, getEventMeta } from './EventTypeIcon.js';
import { NotificationCard, PillRow } from './NotificationCard.js';
import { relativeShort } from './timeFormat.js';
import { ReminderSnoozeButton } from '../reminders/ReminderSnoozeButton.js';
import type { AgentSummary } from '../../api/types.js';

type Filter = 'all' | NotificationKind;

const TYPE_LABEL: Record<string, string> = {
    task: 'task',
    sub_task: 'sub-task',
};

interface Props {
    allRows: INotification[];
    agents: AgentSummary[];
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
        // Same chain as the web-push click (`notificationLinkUrl`, @atlas/shared).
        navigate(notificationLinkUrl(row) ?? '/notifications');
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

            <Box sx={{ mb: 3 }}>
                <PillRow label="Filter notifications">
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
                </PillRow>
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
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {filtered.map((row) => (
                        <FeedItem
                            key={row.id}
                            row={row}
                            agent={row.agent_id ? agentById.get(row.agent_id) : undefined}
                            onOpen={() => openNotification(row)}
                            onSnoozed={() => {
                                if (!row.read_at) markRead.mutate(row.id);
                            }}
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
    onOpen,
    onSnoozed,
}: {
    row: INotification;
    agent: AgentSummary | undefined;
    onOpen: () => void;
    onSnoozed: () => void;
}) {
    const unread = !row.read_at;
    const snoozable = row.event_type === 'reminder' && typeof row.reminder_id === 'number';
    const meta = getEventMeta(row.event_type);
    const agentName = row.agent_id ? (agent?.name ?? 'Unknown agent') : null;
    const typeText = row.issue_type ? (TYPE_LABEL[row.issue_type] ?? row.issue_type) : null;
    const shortId = row.issue_id ? row.issue_id.slice(0, 12) : null;
    return (
        <NotificationCard
            icon={<EventTypeIcon eventType={row.event_type} size={32} />}
            title={meta.label}
            chip={row.kind === 'needs_you' ? <NeedsYouChip /> : undefined}
            message={row.message}
            meta={
                <>
                    {shortId && (
                        <Box component="span" sx={{ color: ATLAS_PALETTE.brandBlue }}>
                            {shortId}
                            {' · '}
                        </Box>
                    )}
                    {typeText && `${typeText} · `}
                    {agentName && (
                        <Box
                            component="span"
                            sx={{ color: agent?.accent_color ?? ATLAS_PALETTE.slate70 }}
                        >
                            {agentName}
                            {' · '}
                        </Box>
                    )}
                    {relativeShort(row.created_at)}
                </>
            }
            action={
                snoozable ? (
                    <ReminderSnoozeButton
                        reminderId={row.reminder_id as number}
                        onSnoozed={onSnoozed}
                        onOpenReminders={onOpen}
                    />
                ) : (
                    <Box
                        component="span"
                        className="material-symbols-rounded"
                        aria-hidden="true"
                        sx={{ fontSize: 20, color: ATLAS_PALETTE.slate40, mt: 1 }}
                    >
                        chevron_right
                    </Box>
                )
            }
            tone={unread ? 'unread' : 'default'}
            // A reminder card holds the snooze button, so the card itself is not a button.
            {...(snoozable ? {} : { onOpen })}
            aria-label={`${unread ? 'Unread: ' : ''}${meta.label}: ${row.message}`}
        />
    );
}

function NeedsYouChip() {
    return (
        <Box
            component="span"
            sx={{
                fontSize: 11,
                fontWeight: 600,
                lineHeight: 1.6,
                px: 1.5,
                borderRadius: '9999px',
                bgcolor: ATLAS_PALETTE.warnSoft,
                color: ATLAS_PALETTE.warnFg,
                whiteSpace: 'nowrap',
            }}
        >
            Needs you
        </Box>
    );
}
