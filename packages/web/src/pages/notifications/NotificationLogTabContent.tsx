import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import SendRounded from '@mui/icons-material/SendRounded';
import RefreshRounded from '@mui/icons-material/RefreshRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import type { INotification, NotificationDeliveryStatus, ISettings } from '@atlas/shared';
import { useResendNotification, useCancelNotification } from '../../hooks/useNotifications.js';
import { useToast } from '../../hooks/useToast.js';
import { useIsMobile } from '../../hooks/useIsMobile.js';
import { api } from '../../api/api.js';
import { isExternalChannelConnected } from '../../hooks/useSettings.js';
import { FilterPill } from '../../components/filterPrimitives.js';
import { HeroEmptyState } from '../../components/HeroEmptyState.js';
import { KindIcon } from '../../components/KindIcon.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { EventTypeIcon, getEventMeta } from './EventTypeIcon.js';
import { NotificationCard, PillRow } from './NotificationCard.js';
import { timeOfDay, relativeDay } from './timeFormat.js';

const MONO = '"JetBrains Mono", monospace';

type Filter = 'all' | NotificationDeliveryStatus | 'skipped';

interface Props {
    settings: ISettings | undefined;
    allRows: INotification[];
}

export function NotificationLogTabContent({ settings, allRows }: Props) {
    const isMobile = useIsMobile();
    const [filter, setFilter] = useState<Filter>('all');

    // Parent fetches the 200-row dataset once; we filter client-side here so
    // the per-filter server round-trip is gone. A `none` row with a reason was
    // skipped at the flush (its event was turned off while held) — it stays in
    // the log so the hold doesn't just vanish.
    const externalRows = useMemo(
        () => allRows.filter((r) => r.external_status !== 'none' || isSkipped(r)),
        [allRows]
    );
    const counts = useMemo(() => {
        const c = { all: externalRows.length, sent: 0, failed: 0, pending: 0, skipped: 0 };
        for (const r of externalRows) {
            if (r.external_status === 'sent') c.sent++;
            else if (r.external_status === 'failed') c.failed++;
            else if (r.external_status === 'pending') c.pending++;
            else if (isSkipped(r)) c.skipped++;
        }
        return c;
    }, [externalRows]);

    const visible = useMemo(
        () =>
            filter === 'all'
                ? externalRows
                : filter === 'skipped'
                  ? externalRows.filter(isSkipped)
                  : externalRows.filter((r) => r.external_status === filter),
        [externalRows, filter]
    );

    // A held row goes out on the first minute tick after the window closes.
    const heldUntil = settings?.quiet_hours_to ?? null;

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
                    minWidth: 0,
                    '& > :first-of-type': { maxWidth: '100%' },
                }}
            >
                <PillRow label="Filter deliveries">
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
                    {/* Skipped and cancelled sends: without this pill "All" summed to more than the rest. */}
                    <FilterPill
                        label="Skipped"
                        count={counts.skipped}
                        selected={filter === 'skipped'}
                        onClick={() => setFilter('skipped')}
                    />
                </PillRow>
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
                        <Box component="span" sx={{ fontFamily: MONO, color: ATLAS_PALETTE.slate }}>
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
                            visible.map((row) => (
                                <NotificationLogCard key={row.id} row={row} heldUntil={heldUntil} />
                            ))
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
                                    textAlign: h === 'Status' || h === 'Action' ? 'center' : 'left',
                                }}
                            >
                                {h}
                            </Typography>
                        ))}
                    </Box>
                    {visible.map((row, i) => (
                        <NotificationLogRow
                            key={row.id}
                            row={row}
                            heldUntil={heldUntil}
                            isLast={i === visible.length - 1}
                        />
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

function useRowActions(row: INotification) {
    const resend = useResendNotification();
    const cancel = useCancelNotification();
    const toast = useToast();
    return {
        resendPending: resend.isPending,
        cancelPending: cancel.isPending,
        resend: () =>
            resend.mutate(row.id, {
                onSuccess: () => toast.show({ message: 'Resent external notification' }),
                onError: (err) =>
                    toast.show({
                        message: 'Resend failed',
                        detail: err instanceof Error ? err.message : String(err),
                    }),
            }),
        cancel: () =>
            cancel.mutate(row.id, {
                onSuccess: () => toast.show({ message: 'Cancelled pending delivery' }),
                onError: (err) => toast.show({ message: 'Cancel failed', detail: err.message }),
            }),
    };
}

/** Sent → Resend, Failed → Retry, Skipped → Send now, Pending (held or in flight) → Cancel. */
function RowAction({ row, size }: { row: INotification; size: 'small' | 'medium' }) {
    const a = useRowActions(row);
    const spec =
        row.external_status === 'sent'
            ? {
                  label: 'Resend',
                  icon: <RefreshRounded />,
                  onClick: a.resend,
                  busy: a.resendPending,
                  color: ATLAS_PALETTE.slate60,
              }
            : row.external_status === 'failed'
              ? {
                    label: 'Retry',
                    icon: <RefreshRounded />,
                    onClick: a.resend,
                    busy: a.resendPending,
                    color: ATLAS_PALETTE.brandBlue,
                }
              : row.external_status === 'pending'
                ? {
                      label: 'Cancel',
                      icon: <CloseRounded />,
                      onClick: a.cancel,
                      busy: a.cancelPending,
                      color: ATLAS_PALETTE.slate60,
                  }
                : isSkipped(row)
                  ? {
                        label: 'Send now',
                        icon: <SendRounded />,
                        onClick: a.resend,
                        busy: a.resendPending,
                        color: ATLAS_PALETTE.slate60,
                    }
                  : null;
    if (!spec) return null;
    return (
        <Tooltip title={spec.label}>
            <span>
                <IconButton
                    size={size}
                    onClick={spec.onClick}
                    disabled={spec.busy}
                    aria-label={spec.label}
                    sx={{ color: spec.color, '& svg': { fontSize: size === 'small' ? 18 : 20 } }}
                >
                    {spec.icon}
                </IconButton>
            </span>
        </Tooltip>
    );
}

const isHeld = (row: INotification) =>
    row.external_status === 'pending' && row.external_deferred_at !== null;
const isSkipped = (row: INotification) => row.external_status === 'none' && row.failure_reason !== null;
// The API's CANCELLED_BY_OWNER reason ("Cancelled by you"): a skipped row the Owner stopped.
const isCancelled = (row: INotification) => isSkipped(row) && (row.failure_reason ?? '').startsWith('Cancelled');
/** The reason line under the message: why it failed, or why it was skipped. */
const reasonOf = (row: INotification) =>
    row.external_status === 'failed' || isSkipped(row) ? row.failure_reason : null;

function NotificationLogCard({ row, heldUntil }: { row: INotification; heldUntil: string | null }) {
    const meta = getEventMeta(row.event_type);
    const held = isHeld(row);
    return (
        <NotificationCard
            icon={<EventTypeIcon eventType={row.event_type} size={32} />}
            title={meta.label}
            chip={<StatusChip status={row.external_status} held={held} skipped={isSkipped(row)} cancelled={isCancelled(row)} />}
            message={row.message}
            meta={
                <>
                    {row.issue_id && (
                        <Box component="span" sx={{ color: ATLAS_PALETTE.brandBlue }}>
                            {row.issue_id.slice(0, 12)}
                            {' · '}
                        </Box>
                    )}
                    {timeOfDay(row.created_at)} · {relativeDay(row.created_at)}
                    {held && heldUntil && ` · sends ${heldUntil}`}
                </>
            }
            alert={reasonOf(row)}
            alertMuted={isSkipped(row)}
            action={<RowAction row={row} size="medium" />}
            tone={held ? 'held' : 'default'}
        />
    );
}

function NotificationLogRow({
    row,
    isLast,
    heldUntil,
}: {
    row: INotification;
    isLast: boolean;
    heldUntil: string | null;
}) {
    const meta = getEventMeta(row.event_type);
    const held = isHeld(row);

    return (
        <Box
            data-testid="notification-log-row"
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
                {reasonOf(row) && (
                    <Typography
                        sx={{
                            fontFamily: MONO,
                            fontSize: 11,
                            color: isSkipped(row) ? ATLAS_PALETTE.slate60 : ATLAS_PALETTE.error,
                            mt: 0.5,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                        }}
                    >
                        {isSkipped(row) ? '' : '⚠ '}
                        {row.failure_reason}
                    </Typography>
                )}
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
                <StatusChip status={row.external_status} held={held} skipped={isSkipped(row)} cancelled={isCancelled(row)} />
                {held && heldUntil && (
                    <Typography
                        sx={{ fontFamily: MONO, fontSize: 10, color: ATLAS_PALETTE.slate60 }}
                    >
                        sends {heldUntil}
                    </Typography>
                )}
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                <RowAction row={row} size="small" />
            </Box>
        </Box>
    );
}

function StatusChip({
    status,
    held = false,
    skipped = false,
    cancelled = false,
}: {
    status: NotificationDeliveryStatus;
    held?: boolean;
    skipped?: boolean;
    cancelled?: boolean;
}) {
    const style = held
        ? { label: 'Held · quiet hours', bg: ATLAS_PALETTE.warnSoft, fg: ATLAS_PALETTE.warnFg }
        : skipped
          ? { label: cancelled ? 'Cancelled' : 'Skipped', bg: ATLAS_PALETTE.slate08, fg: ATLAS_PALETTE.slate60 }
          : status === 'sent'
          ? { label: 'Sent', bg: ATLAS_PALETTE.successSoft, fg: ATLAS_PALETTE.successFg }
          : status === 'failed'
            ? { label: 'Failed', bg: ATLAS_PALETTE.dangerSoft, fg: ATLAS_PALETTE.dangerFg }
            : status === 'pending'
              ? { label: 'Pending', bg: ATLAS_PALETTE.warnSoft, fg: ATLAS_PALETTE.warnFg }
              : { label: '—', bg: ATLAS_PALETTE.slate08, fg: ATLAS_PALETTE.slate60 };
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
                lineHeight: 1.6,
                px: 1.5,
                borderRadius: '9999px',
                whiteSpace: 'nowrap',
            }}
        >
            {held ? (
                <Box
                    component="span"
                    className="material-symbols-rounded"
                    aria-hidden="true"
                    sx={{ fontSize: 13 }}
                >
                    schedule
                </Box>
            ) : (
                <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: style.fg }} />
            )}
            {style.label}
        </Box>
    );
}

function EmptyState({ settings }: { settings: ISettings | undefined }) {
    const toast = useToast();
    const queryClient = useQueryClient();
    const [testing, setTesting] = useState(false);
    const endpointLabel = settings?.external_notification_endpoint_label ?? null;
    const chatId = settings?.external_notification_chat_id ?? null;
    const connected = isExternalChannelConnected(settings);

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
        } catch (err) {
            toast.show({ message: 'Test failed', detail: err instanceof Error ? err.message : String(err) });
        } finally {
            // The test result moves the connection pill and endpoint label.
            void queryClient.invalidateQueries({ queryKey: ['settings'] });
            setTesting(false);
        }
    }

    return (
        <HeroEmptyState
            icon={<SendRounded sx={{ fontSize: 28, color: ATLAS_PALETTE.brandBlue }} />}
            title={
                connected ? 'External Channel Is Configured but Quiet' : 'No External Channel Yet'
            }
            description={
                connected
                    ? 'No messages have been sent yet. Agents will ping you here when something needs attention.'
                    : 'Connect a channel (link above) and agents will ping you there when something needs attention.'
            }
            primaryAction={
                <Box
                    sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}
                >
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
                        disabled={testing || !connected}
                        sx={{ textTransform: 'none', fontWeight: 600 }}
                    >
                        {testing ? 'Sending…' : 'Send a Test Message'}
                    </Button>
                </Box>
            }
        />
    );
}
