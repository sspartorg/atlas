import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import SendRounded from '@mui/icons-material/SendRounded';
import RefreshRounded from '@mui/icons-material/RefreshRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import type { INotification, NotificationDeliveryStatus, ISettings } from '@atlas/shared';
import {
    useResendNotification,
    useCancelNotification,
} from '../../hooks/useNotifications.js';
import { useToast } from '../../hooks/useToast.js';
import { useIsMobile } from '../../hooks/useIsMobile.js';
import { api } from '../../api/api.js';
import { FilterPill } from '../../components/filterPrimitives.js';
import { HeroEmptyState } from '../../components/HeroEmptyState.js';
import { KindIcon } from '../../components/KindIcon.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { EventTypeIcon, getEventMeta } from './EventTypeIcon.js';
import { timeOfDay, relativeDay } from './timeFormat.js';

const MONO = '"JetBrains Mono", monospace';

type Filter = 'all' | NotificationDeliveryStatus;

interface Props {
    settings: ISettings | undefined;
    allRows: INotification[];
}

export function NotificationLogTabContent({ settings, allRows }: Props) {
    const isMobile = useIsMobile();
    const [filter, setFilter] = useState<Filter>('all');

    // Parent fetches the 200-row dataset once; we filter client-side here so
    // the per-filter server round-trip is gone.
    const externalRows = useMemo(
        () => allRows.filter((r) => r.external_status !== 'none'),
        [allRows]
    );
    const counts = useMemo(() => {
        const c = { all: externalRows.length, sent: 0, failed: 0, pending: 0 };
        for (const r of externalRows) {
            if (r.external_status === 'sent') c.sent++;
            else if (r.external_status === 'failed') c.failed++;
            else if (r.external_status === 'pending') c.pending++;
        }
        return c;
    }, [externalRows]);

    const visible = useMemo(
        () => (filter === 'all' ? externalRows : externalRows.filter((r) => r.external_status === filter)),
        [externalRows, filter]
    );

    if (externalRows.length === 0) {
        return <EmptyState settings={settings} />;
    }

    return (
        <Box>
            {/* Filter pills + endpoint identity */}
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 2,
                    mb: 3,
                }}
            >
                <Box sx={{ display: 'flex', gap: 1 }}>
                    <FilterPill
                        label="All"
                        count={counts.all}
                        selected={filter === 'all'}
                        onClick={() => setFilter('all')}
                    />
                    <FilterPill
                        label="Sent"
                        count={counts.sent}
                        selected={filter === 'sent'}
                        onClick={() => setFilter('sent')}
                    />
                    <FilterPill
                        label="Failed"
                        count={counts.failed}
                        selected={filter === 'failed'}
                        onClick={() => setFilter('failed')}
                    />
                    <FilterPill
                        label="Pending"
                        count={counts.pending}
                        selected={filter === 'pending'}
                        onClick={() => setFilter('pending')}
                    />
                </Box>
                {settings?.external_notification_endpoint_label && (
                    <Box
                        sx={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 1.5,
                            fontSize: 12,
                            color: ATLAS_PALETTE.slate60,
                        }}
                    >
                        <Box component="span" sx={{ fontWeight: 600 }}>
                            channel
                        </Box>
                        <Box component="span" sx={{ color: ATLAS_PALETTE.slate30 }}>
                            ·
                        </Box>
                        <Box
                            component="span"
                            sx={{ fontFamily: MONO, color: ATLAS_PALETTE.slate }}
                        >
                            {settings.external_notification_endpoint_label}
                        </Box>
                        <Box component="span" sx={{ color: ATLAS_PALETTE.slate30 }}>
                            ·
                        </Box>
                        <Box
                            sx={{
                                width: 6,
                                height: 6,
                                borderRadius: '50%',
                                bgcolor: ATLAS_PALETTE.success,
                            }}
                        />
                        <Box component="span" sx={{ fontSize: 11, color: ATLAS_PALETTE.success }}>
                            online
                        </Box>
                    </Box>
                )}
            </Box>

            {isMobile ? (
                <Box>
                    <Typography
                        sx={{
                            fontSize: 11,
                            fontWeight: 600,
                            letterSpacing: '0.08em',
                            textTransform: 'uppercase',
                            color: ATLAS_PALETTE.slate60,
                            mb: 2,
                        }}
                    >
                        Notification Outbox
                    </Typography>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {visible.length === 0 ? (
                            <Box
                                sx={{
                                    p: 6,
                                    textAlign: 'center',
                                    bgcolor: ATLAS_PALETTE.white,
                                    border: `1px solid ${ATLAS_PALETTE.slate10}`,
                                    borderRadius: '12px',
                                    color: ATLAS_PALETTE.slate40,
                                }}
                            >
                                <Typography sx={{ fontSize: 13 }}>
                                    No deliveries match this filter.
                                </Typography>
                            </Box>
                        ) : (
                            visible.map((row) => <NotificationLogCard key={row.id} row={row} />)
                        )}
                    </Box>
                </Box>
            ) : (
                <Box
                    sx={{
                        bgcolor: ATLAS_PALETTE.white,
                        border: `1px solid ${ATLAS_PALETTE.slate10}`,
                        borderRadius: '12px',
                        overflow: 'hidden',
                        // Single outer grid + subgrid rows so the auto columns
                        // (Timestamp, Event Type, Status, Action) share ONE
                        // track each across header + every body row. Without
                        // this, each row's `auto` was sized independently and
                        // columns visually drifted.
                        display: 'grid',
                        gridTemplateColumns: 'auto auto minmax(0, 1fr) auto auto',
                    }}
                >
                    <Box
                        sx={{
                            gridColumn: '1 / -1',
                            display: 'grid',
                            gridTemplateColumns: 'subgrid',
                            alignItems: 'center',
                            gap: 3,
                            px: 4,
                            py: 2.5,
                            bgcolor: ATLAS_PALETTE.slate08,
                            borderBottom: `1px solid ${ATLAS_PALETTE.slate10}`,
                        }}
                    >
                        {['Timestamp', 'Event Type', 'Item', 'Status', 'Action'].map((h) => (
                            <Typography
                                key={h}
                                sx={{
                                    fontSize: 10,
                                    fontWeight: 600,
                                    letterSpacing: '0.08em',
                                    textTransform: 'uppercase',
                                    color: ATLAS_PALETTE.slate60,
                                    textAlign:
                                        h === 'Status' || h === 'Action' ? 'center' : 'left',
                                }}
                            >
                                {h}
                            </Typography>
                        ))}
                    </Box>
                    {visible.map((row, i) => (
                        <NotificationLogRow key={row.id} row={row} isLast={i === visible.length - 1} />
                    ))}
                    {visible.length === 0 && (
                        <Box
                            sx={{
                                gridColumn: '1 / -1',
                                p: 6,
                                textAlign: 'center',
                                color: ATLAS_PALETTE.slate40,
                            }}
                        >
                            <Typography sx={{ fontSize: 13 }}>
                                No deliveries match this filter.
                            </Typography>
                        </Box>
                    )}
                </Box>
            )}
        </Box>
    );
}

function NotificationLogCard({ row }: { row: INotification }) {
    const meta = getEventMeta(row.event_type);
    const resend = useResendNotification();
    const cancel = useCancelNotification();
    const toast = useToast();

    function handleResend() {
        resend.mutate(row.id, {
            onSuccess: () => toast.show({ message: 'Resent external notification' }),
            onError: (err) =>
                toast.show({
                    message: 'Resend failed',
                    detail: err instanceof Error ? err.message : String(err),
                }),
        });
    }
    function handleCancel() {
        cancel.mutate(row.id, {
            onSuccess: () => toast.show({ message: 'Cancelled pending delivery' }),
        });
    }

    return (
        <Box
            sx={{
                bgcolor: row.external_status === 'pending' ? 'rgba(223,172,45,.06)' : ATLAS_PALETTE.white,
                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                borderRadius: '12px',
                p: 4,
                display: 'flex',
                flexDirection: 'column',
                gap: 1.5,
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
                <Box sx={{ flexShrink: 0 }}>
                    <EventTypeIcon eventType={row.event_type} size={32} />
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    {/* Title row: label + status pill inline */}
                    <Box
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1.5,
                            flexWrap: 'wrap',
                        }}
                    >
                        <Typography
                            sx={{ fontSize: 15, fontWeight: 700, color: ATLAS_PALETTE.slate }}
                        >
                            {meta.label}
                        </Typography>
                        <StatusChip status={row.external_status} />
                    </Box>
                    <Typography
                        sx={{
                            fontFamily: MONO,
                            fontSize: 12,
                            color: ATLAS_PALETTE.slate60,
                            mt: 0.5,
                        }}
                    >
                        {timeOfDay(row.created_at)} · {relativeDay(row.created_at)}
                        {row.issue_id && (
                            <>
                                {' · '}
                                <Box component="span" sx={{ color: ATLAS_PALETTE.brandBlue }}>
                                    {row.issue_id.slice(0, 12)}
                                </Box>
                            </>
                        )}
                    </Typography>
                </Box>
                {/* Action button takes the top-right slot where the status
                    pill used to sit. */}
                {(row.external_status === 'sent' ||
                    row.external_status === 'failed' ||
                    row.external_status === 'pending') && (
                    <Box sx={{ flexShrink: 0 }}>
                        {row.external_status === 'sent' && (
                            <IconButton
                                onClick={handleResend}
                                disabled={resend.isPending}
                                aria-label="Resend"
                                sx={{ color: ATLAS_PALETTE.slate60 }}
                            >
                                <RefreshRounded sx={{ fontSize: 20 }} />
                            </IconButton>
                        )}
                        {row.external_status === 'failed' && (
                            <IconButton
                                onClick={handleResend}
                                disabled={resend.isPending}
                                aria-label="Retry"
                                sx={{ color: ATLAS_PALETTE.brandBlue }}
                            >
                                <RefreshRounded sx={{ fontSize: 20 }} />
                            </IconButton>
                        )}
                        {row.external_status === 'pending' && (
                            <IconButton
                                onClick={handleCancel}
                                disabled={cancel.isPending}
                                aria-label="Cancel"
                                sx={{ color: ATLAS_PALETTE.slate60 }}
                            >
                                <CloseRounded sx={{ fontSize: 20 }} />
                            </IconButton>
                        )}
                    </Box>
                )}
            </Box>
            <Typography
                sx={{
                    fontSize: 14,
                    color: ATLAS_PALETTE.slate,
                    lineHeight: 1.55,
                    wordBreak: 'break-word',
                    overflowWrap: 'anywhere',
                }}
            >
                {row.message}
            </Typography>
            {row.external_status === 'failed' && row.failure_reason && (
                <Typography
                    sx={{
                        fontFamily: MONO,
                        fontSize: 11,
                        color: ATLAS_PALETTE.error,
                        wordBreak: 'break-word',
                        overflowWrap: 'anywhere',
                    }}
                >
                    ⚠ {row.failure_reason}
                </Typography>
            )}
        </Box>
    );
}

function NotificationLogRow({ row, isLast }: { row: INotification; isLast: boolean }) {
    const meta = getEventMeta(row.event_type);
    const resend = useResendNotification();
    const cancel = useCancelNotification();
    const toast = useToast();

    function handleResend() {
        resend.mutate(row.id, {
            onSuccess: () => toast.show({ message: 'Resent external notification' }),
            onError: (err) =>
                toast.show({
                    message: 'Resend failed',
                    detail: err instanceof Error ? err.message : String(err),
                }),
        });
    }
    function handleCancel() {
        cancel.mutate(row.id, {
            onSuccess: () => toast.show({ message: 'Cancelled pending delivery' }),
        });
    }

    return (
        <Box
            sx={{
                gridColumn: '1 / -1',
                display: 'grid',
                gridTemplateColumns: 'subgrid',
                alignItems: 'center',
                gap: 3,
                px: 4,
                py: 3,
                borderBottom: isLast ? 'none' : `1px solid ${ATLAS_PALETTE.slate06}`,
                '&:hover': { bgcolor: ATLAS_PALETTE.cloud },
                transition: 'background 120ms ease',
            }}
        >
            <Box>
                <Typography
                    sx={{
                        fontFamily: MONO,
                        fontSize: 12,
                        color: ATLAS_PALETTE.slate,
                        lineHeight: 1.2,
                    }}
                >
                    {timeOfDay(row.created_at)}
                </Typography>
                <Typography sx={{ fontSize: 10, color: ATLAS_PALETTE.slate60, mt: 0.25 }}>
                    {relativeDay(row.created_at)}
                </Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
                <EventTypeIcon eventType={row.event_type} size={28} />
                <Typography
                    sx={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: ATLAS_PALETTE.slate,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                    }}
                >
                    {meta.label}
                </Typography>
            </Box>
            <Box sx={{ minWidth: 0, overflow: 'hidden' }}>
                {/* Row 1: issue-type icon + short id */}
                {(row.issue_type || row.issue_id) && (
                    <Box
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1,
                            mb: 0.5,
                            minWidth: 0,
                        }}
                    >
                        {row.issue_type && <KindIcon kind={row.issue_type} size={14} />}
                        {row.issue_id && (
                            <Typography
                                sx={{
                                    fontFamily: MONO,
                                    fontSize: 11,
                                    color: ATLAS_PALETTE.brandBlue,
                                    fontWeight: 600,
                                    minWidth: 0,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                }}
                            >
                                {row.issue_id.slice(0, 12)}
                            </Typography>
                        )}
                    </Box>
                )}
                {/* Row 2: message preview */}
                <Typography
                    sx={{
                        fontSize: 12,
                        color: ATLAS_PALETTE.slate70,
                        lineHeight: 1.4,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                    }}
                >
                    {row.message}
                </Typography>
                {row.external_status === 'failed' && row.failure_reason && (
                    <Typography
                        sx={{
                            fontFamily: MONO,
                            fontSize: 11,
                            color: ATLAS_PALETTE.error,
                            mt: 0.5,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                        }}
                    >
                        ⚠ {row.failure_reason}
                    </Typography>
                )}
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                <StatusChip status={row.external_status} />
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                {row.external_status === 'sent' && (
                    <Tooltip title="Resend">
                        <span>
                            <IconButton
                                size="small"
                                onClick={handleResend}
                                disabled={resend.isPending}
                                aria-label="Resend"
                                sx={{ color: ATLAS_PALETTE.slate60 }}
                            >
                                <RefreshRounded sx={{ fontSize: 18 }} />
                            </IconButton>
                        </span>
                    </Tooltip>
                )}
                {row.external_status === 'failed' && (
                    <Tooltip title="Retry">
                        <span>
                            <IconButton
                                size="small"
                                onClick={handleResend}
                                disabled={resend.isPending}
                                aria-label="Retry"
                                sx={{ color: ATLAS_PALETTE.brandBlue }}
                            >
                                <RefreshRounded sx={{ fontSize: 18 }} />
                            </IconButton>
                        </span>
                    </Tooltip>
                )}
                {row.external_status === 'pending' && (
                    <Tooltip title="Cancel">
                        <span>
                            <IconButton
                                size="small"
                                onClick={handleCancel}
                                disabled={cancel.isPending}
                                aria-label="Cancel"
                                sx={{ color: ATLAS_PALETTE.slate60 }}
                            >
                                <CloseRounded sx={{ fontSize: 18 }} />
                            </IconButton>
                        </span>
                    </Tooltip>
                )}
            </Box>
        </Box>
    );
}

function StatusChip({ status }: { status: NotificationDeliveryStatus }) {
    const style = (() => {
        switch (status) {
            case 'sent':
                return { label: 'Sent', bg: 'rgba(49,171,70,.12)', fg: ATLAS_PALETTE.success };
            case 'failed':
                return { label: 'Failed', bg: 'rgba(220,38,38,.10)', fg: ATLAS_PALETTE.error };
            case 'pending':
                return { label: 'Pending', bg: 'rgba(223,172,45,.16)', fg: ATLAS_PALETTE.gold };
            default:
                return { label: '—', bg: ATLAS_PALETTE.slate08, fg: ATLAS_PALETTE.slate60 };
        }
    })();
    return (
        <Box
            sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 1,
                bgcolor: style.bg,
                color: style.fg,
                fontSize: 11,
                fontWeight: 600,
                px: 1.5,
                py: 0.5,
                borderRadius: '9999px',
            }}
        >
            <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: style.fg }} />
            {style.label}
        </Box>
    );
}

function EmptyState({ settings }: { settings: ISettings | undefined }) {
    const toast = useToast();
    const [testing, setTesting] = useState(false);
    const endpointLabel = settings?.external_notification_endpoint_label ?? null;
    const chatId = settings?.external_notification_chat_id ?? null;

    async function handleSendTest() {
        setTesting(true);
        try {
            const r = await api.settings.testExternalNotification();
            if (r.ok) toast.show({ message: 'Test message sent' });
            else
                toast.show(
                    r.error
                        ? { message: 'Test failed', detail: r.error }
                        : { message: 'Test failed' }
                );
        } finally {
            setTesting(false);
        }
    }

    return (
        <HeroEmptyState
            icon={<SendRounded sx={{ fontSize: 28, color: ATLAS_PALETTE.brandBlue }} />}
            title="External Channel Is Configured but Quiet"
            description="No messages have been sent yet. Agents will ping you here when something needs attention."
            primaryAction={
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                        {endpointLabel && (
                            <Typography
                                sx={{
                                    fontFamily: MONO,
                                    fontSize: 12,
                                    color: ATLAS_PALETTE.success,
                                }}
                            >
                                {endpointLabel}
                            </Typography>
                        )}
                        {chatId && (
                            <>
                                <Box component="span" sx={{ color: ATLAS_PALETTE.slate30 }}>
                                    ·
                                </Box>
                                <Typography
                                    sx={{
                                        fontFamily: MONO,
                                        fontSize: 12,
                                        color: ATLAS_PALETTE.slate60,
                                    }}
                                >
                                    chat_id {chatId}
                                </Typography>
                            </>
                        )}
                    </Box>
                    <Button
                        variant="contained"
                        color="success"
                        startIcon={<SendRounded sx={{ fontSize: 16 }} />}
                        onClick={() => void handleSendTest()}
                        disabled={testing || !endpointLabel || !chatId}
                        sx={{ textTransform: 'none', fontWeight: 600 }}
                    >
                        {testing ? 'Sending…' : 'Send a Test Message'}
                    </Button>
                </Box>
            }
        />
    );
}
