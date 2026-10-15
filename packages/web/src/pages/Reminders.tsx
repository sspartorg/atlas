import { useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import Divider from '@mui/material/Divider';
import Skeleton from '@mui/material/Skeleton';
import AddRounded from '@mui/icons-material/AddRounded';
import CancelRounded from '@mui/icons-material/CancelRounded';
import EditRounded from '@mui/icons-material/EditRounded';
import AlarmRounded from '@mui/icons-material/AlarmRounded';
import NotificationsRounded from '@mui/icons-material/NotificationsRounded';
import SendRounded from '@mui/icons-material/SendRounded';
import MoreVertRounded from '@mui/icons-material/MoreVertRounded';
import PauseRounded from '@mui/icons-material/PauseRounded';
import PlayArrowRounded from '@mui/icons-material/PlayArrowRounded';
import SnoozeRounded from '@mui/icons-material/SnoozeRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import type { IReminder, IReminderFire, ReminderChannel, ReminderStatus } from '@atlas/shared';
import {
    useReminders,
    useReminderHistory,
    useReminderFires,
    useCancelReminder,
    useDeleteReminder,
    useSetReminderPaused,
    useSnoozeReminder,
} from '../hooks/useReminders.js';
import { useSettings } from '../hooks/useSettings.js';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { useToast } from '../hooks/useToast.js';
import { PageFab, useSetPageTitle } from '../components/shell/index.js';
import { HeroEmptyState } from '../components/HeroEmptyState.js';
import { RefreshButton } from '../components/index.js';
import { ATLAS_PALETTE, STATUS_PALETTE } from '../theme/tokens.js';
import { NewReminderModal } from './reminders/NewReminderModal.js';
import { snoozeOptions } from './reminders/snooze.js';
import { snoozedToast } from './reminders/ReminderSnoozeButton.js';
import { PageHeader } from '../components/PageHeader.js';

const MONO = '"JetBrains Mono", monospace';
const WEEKDAY_LABEL = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface RowActions {
    onEdit: (r: IReminder) => void;
    onCancel: (r: IReminder) => void;
    onDelete: (r: IReminder) => void;
    onPause: (r: IReminder, paused: boolean) => void;
    onSnooze: (r: IReminder, minutes: number) => void;
    timeZone: string | null;
}

export function Reminders() {
    useSetPageTitle('Reminders');
    const toast = useToast();
    const [showHistory, setShowHistory] = useState(false);
    const [newOpen, setNewOpen] = useState(false);
    const [editing, setEditing] = useState<IReminder | null>(null);
    const [pendingCancel, setPendingCancel] = useState<IReminder | null>(null);
    const [pendingDelete, setPendingDelete] = useState<IReminder | null>(null);

    const { data: active = [], isLoading, isFetching, refetch } = useReminders();
    const historyQuery = useReminderHistory(showHistory);
    const history = historyQuery.data?.pages.flat() ?? [];
    const timeZone = useSettings().data?.quiet_hours_timezone ?? null;
    const cancelReminder = useCancelReminder();
    const deleteReminder = useDeleteReminder();
    const setPaused = useSetReminderPaused();
    const snooze = useSnoozeReminder();

    function refreshAll() {
        void refetch();
        if (showHistory) void historyQuery.refetch();
    }

    function closeCancelDialog() {
        if (cancelReminder.isPending) return;
        setPendingCancel(null);
    }

    function closeDeleteDialog() {
        if (deleteReminder.isPending) return;
        setPendingDelete(null);
    }

    function confirmCancel() {
        if (!pendingCancel) return;
        const r = pendingCancel;
        cancelReminder.mutate(r.id, {
            onSuccess: () => {
                toast.show({ message: `Reminder "${r.label}" cancelled` });
                setPendingCancel(null);
            },
            onError: (e: Error) => {
                toast.show({ message: 'Could not cancel reminder', detail: e.message });
                setPendingCancel(null);
            },
        });
    }

    function confirmDelete() {
        if (!pendingDelete) return;
        const r = pendingDelete;
        deleteReminder.mutate(r.id, {
            onSuccess: () => {
                toast.show({ message: `Reminder "${r.label}" deleted` });
                setPendingDelete(null);
            },
            onError: (e: Error) => {
                toast.show({ message: 'Could not delete reminder', detail: e.message });
                setPendingDelete(null);
            },
        });
    }

    const actions: RowActions = {
        onEdit: setEditing,
        onCancel: setPendingCancel,
        onDelete: setPendingDelete,
        onPause: (r, paused) =>
            setPaused.mutate(
                { id: r.id, paused },
                {
                    onSuccess: () =>
                        toast.show({ message: `Reminder "${r.label}" ${paused ? 'paused' : 'resumed'}` }),
                    onError: (e: Error) =>
                        toast.show({
                            message: `Could not ${paused ? 'pause' : 'resume'} reminder`,
                            detail: e.message,
                        }),
                },
            ),
        onSnooze: (r, minutes) =>
            snooze.mutate(
                { id: r.id, minutes },
                {
                    onSuccess: (next) => toast.show({ message: snoozedToast(next.next_fire_at, timeZone) }),
                    onError: (e: Error) => toast.show({ message: 'Could not snooze reminder', detail: e.message }),
                },
            ),
        timeZone,
    };

    return (
        <Box sx={{ px: { xs: 3, md: 8 }, py: 4 }}>
            <PageHeader
                icon="alarm"
                title="Reminders"
                subtitle={
                    <>
                        Reminders fire as in-app notifications and (optionally) external
                        notifications, on the same per-minute scheduler as agents. Daily and
                        weekly times are in{' '}
                        <Box component="span" sx={{ fontFamily: MONO }}>
                            {timeZone ?? 'server time'}
                        </Box>
                        .
                    </>
                }
                actions={
                    <>
                        <RefreshButton
                            onRefresh={refreshAll}
                            isFetching={isFetching || historyQuery.isFetching}
                            tooltipLabel="Refresh reminders"
                        />
                        <FormControlLabel
                            control={
                                <Switch
                                    size="small"
                                    checked={showHistory}
                                    onChange={(e) => setShowHistory(e.target.checked)}
                                />
                            }
                            label={
                                <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60 }}>
                                    Show history
                                </Typography>
                            }
                        />
                        <Button
                            variant="contained"
                            startIcon={<AddRounded sx={{ fontSize: 16 }} />}
                            onClick={() => setNewOpen(true)}
                            // Mobile gets the FAB below; Refresh + Show history stay.
                            sx={{
                                textTransform: 'none',
                                fontWeight: 500,
                                display: { xs: 'none', md: 'inline-flex' },
                            }}
                        >
                            New reminder
                        </Button>
                    </>
                }
            />

            {!isLoading && active.length === 0 ? (
                <HeroEmptyState
                    icon={<AlarmRounded sx={{ fontSize: 30, color: ATLAS_PALETTE.slate60 }} />}
                    title="No active reminders"
                    description="Use New reminder to add one yourself, or ask Claude to set one for you."
                />
            ) : (
                <ReminderList rows={active} actions={actions} />
            )}

            {showHistory && (history.length > 0 || historyQuery.isLoading) && (
                <Box component="section" aria-labelledby="reminders-history" sx={{ mt: 8 }}>
                    <Typography
                        id="reminders-history"
                        component="h2"
                        sx={{ fontSize: 15, fontWeight: 600, color: ATLAS_PALETTE.slate, mb: 3 }}
                    >
                        History
                    </Typography>
                    {historyQuery.isLoading ? (
                        <Skeleton variant="rounded" height={72} />
                    ) : (
                        <ReminderList rows={history} actions={actions} />
                    )}
                    {historyQuery.hasNextPage && (
                        <Button
                            onClick={() => void historyQuery.fetchNextPage()}
                            disabled={historyQuery.isFetchingNextPage}
                            sx={{ mt: 3, textTransform: 'none' }}
                        >
                            {historyQuery.isFetchingNextPage ? 'Loading…' : 'Show more history'}
                        </Button>
                    )}
                </Box>
            )}

            {newOpen && <NewReminderModal open onClose={() => setNewOpen(false)} />}
            <PageFab onClick={() => setNewOpen(true)} label="New reminder" />
            {editing !== null && (
                <NewReminderModal open onClose={() => setEditing(null)} editing={editing} />
            )}

            <ConfirmDialog
                open={pendingCancel !== null}
                onClose={closeCancelDialog}
                title="Cancel reminder?"
                label={pendingCancel?.label}
                body="It will stop firing and move to history. You can't restore it — set a new reminder if you need it again."
                confirm={cancelReminder.isPending ? 'Cancelling…' : 'Cancel reminder'}
                pending={cancelReminder.isPending}
                onConfirm={confirmCancel}
            />
            <ConfirmDialog
                open={pendingDelete !== null}
                onClose={closeDeleteDialog}
                title="Delete reminder?"
                label={pendingDelete?.label}
                body="It will be removed from history for good. Notifications it already sent stay in your feed."
                confirm={deleteReminder.isPending ? 'Deleting…' : 'Delete reminder'}
                pending={deleteReminder.isPending}
                onConfirm={confirmDelete}
            />
        </Box>
    );
}

function ConfirmDialog({
    open,
    onClose,
    title,
    label,
    body,
    confirm,
    pending,
    onConfirm,
}: {
    open: boolean;
    onClose: () => void;
    title: string;
    label: string | undefined;
    body: string;
    confirm: string;
    pending: boolean;
    onConfirm: () => void;
}) {
    return (
        <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
            <DialogTitle sx={{ fontSize: 18, fontWeight: 600 }}>{title}</DialogTitle>
            <DialogContent>
                <DialogContentText sx={{ fontSize: 14 }}>
                    <Box component="span" sx={{ fontWeight: 600, color: ATLAS_PALETTE.slate }}>
                        {label}
                    </Box>
                    {' — '}
                    {body}
                </DialogContentText>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={pending} sx={{ textTransform: 'none' }}>
                    Keep
                </Button>
                <Button
                    variant="contained"
                    color="error"
                    onClick={onConfirm}
                    disabled={pending}
                    sx={{ textTransform: 'none' }}
                >
                    {confirm}
                </Button>
            </DialogActions>
        </Dialog>
    );
}

function ReminderList({ rows, actions }: { rows: IReminder[]; actions: RowActions }) {
    return (
        <Box component="ul" sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, m: 0, p: 0, listStyle: 'none' }}>
            {rows.map((r) => (
                <ReminderRow key={r.id} reminder={r} actions={actions} />
            ))}
        </Box>
    );
}

const isHistory = (s: ReminderStatus) => s === 'cancelled' || s === 'completed';

/**
 * Desktop: one grid line. Below md: a three-line card — label + status,
 * schedule + channel, time line — with the ⋮ menu pinned bottom-right. A
 * history row (cancelled / completed) sits on the muted surface and expands
 * to its fire log; the ⋮ menu is a sibling of the expand button, never inside it.
 */
function ReminderRow({ reminder, actions }: { reminder: IReminder; actions: RowActions }) {
    const mobile = useIsMobile();
    const [open, setOpen] = useState(false);
    const history = isHistory(reminder.status);
    const logId = `reminder-${reminder.id}-fires`;

    const label = (
        <Typography
            sx={{
                fontSize: 14,
                fontWeight: 600,
                lineHeight: 1.4,
                color: ATLAS_PALETTE.slate,
                display: '-webkit-box',
                WebkitLineClamp: mobile ? 2 : 1,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                overflowWrap: 'anywhere',
            }}
        >
            {reminder.label}
        </Typography>
    );
    const body = reminder.body ? (
        <Typography
            sx={{
                fontSize: 12,
                color: ATLAS_PALETTE.slate60,
                mt: 0.5,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
            }}
        >
            {reminder.body}
        </Typography>
    ) : null;
    const schedule = (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
            <Chip
                label={reminder.schedule_kind}
                size="small"
                sx={{
                    height: 20,
                    fontSize: 11,
                    fontWeight: 500,
                    textTransform: 'capitalize',
                    flexShrink: 0,
                    background: ATLAS_PALETTE.slate06,
                    color: ATLAS_PALETTE.slate70,
                }}
            />
            <Typography
                sx={{
                    fontSize: 13,
                    color: ATLAS_PALETTE.slate,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                }}
            >
                {formatSchedule(reminder)}
            </Typography>
        </Box>
    );
    const time = <TimeLine reminder={reminder} />;
    const status = <StatusChip status={reminder.status} />;
    const expandIcon = history ? (
        <ExpandMoreRounded
            aria-hidden
            sx={{
                fontSize: 18,
                color: ATLAS_PALETTE.slate60,
                transform: open ? 'rotate(180deg)' : 'none',
                transition: 'transform 150ms ease',
                flexShrink: 0,
            }}
        />
    ) : null;

    const content = mobile ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, width: '100%', minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>{label}</Box>
                {status}
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>{schedule}</Box>
                <ChannelIcons channel={reminder.channel} />
            </Box>
            {/* Room on the right for the ⋮ button pinned over this line. */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 28, pr: 6 }}>
                {time}
                {expandIcon}
            </Box>
        </Box>
    ) : (
        <Box
            sx={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1.2fr) 40px minmax(0, 1fr) 96px',
                alignItems: 'center',
                columnGap: 3,
                width: '100%',
                // The ⋮ button is pinned in this padding.
                pr: 7,
            }}
        >
            <Box sx={{ minWidth: 0 }}>
                {label}
                {body}
            </Box>
            {schedule}
            <ChannelIcons channel={reminder.channel} />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                {time}
                {expandIcon}
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>{status}</Box>
        </Box>
    );

    const pad = { px: 3, py: mobile ? 3 : 2.5 };
    return (
        <Box
            component="li"
            data-testid="reminder-row"
            sx={{
                borderRadius: '12px',
                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                // History sinks into the page (the page surface, full opacity) so it recedes
                // in both themes while its text keeps full contrast.
                background: history ? ATLAS_PALETTE.pageBg : ATLAS_PALETTE.white,
                minWidth: 0,
            }}
        >
            {/* The ⋮ button is pinned to the row itself, never over the fire log below it. */}
            <Box sx={{ position: 'relative' }}>
                {history ? (
                    <ButtonBase
                        onClick={() => setOpen((o) => !o)}
                        aria-expanded={open}
                        aria-controls={logId}
                        aria-label={`${reminder.label} — ${open ? 'hide fire log' : 'show fire log'}`}
                        sx={{
                            ...pad,
                            width: '100%',
                            textAlign: 'left',
                            justifyContent: 'flex-start',
                            borderRadius: '12px',
                            '&.Mui-focusVisible': {
                                outline: `2px solid ${ATLAS_PALETTE.brandBlue}`,
                                outlineOffset: 2,
                            },
                        }}
                    >
                        {content}
                    </ButtonBase>
                ) : (
                    <Box sx={{ ...pad, display: 'flex' }}>{content}</Box>
                )}
                <Box
                    sx={{
                        position: 'absolute',
                        right: 8,
                        ...(mobile ? { bottom: 10 } : { top: '50%', transform: 'translateY(-50%)' }),
                    }}
                >
                    <RowMenu reminder={reminder} actions={actions} />
                </Box>
            </Box>
            {history && open && <FireLog id={logId} reminderId={reminder.id} />}
        </Box>
    );
}

function RowMenu({ reminder, actions }: { reminder: IReminder; actions: RowActions }) {
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const s = reminder.status;
    const live = s === 'active' || s === 'paused';
    // A completed reminder is a finished one-shot: snooze revives it.
    const canSnooze = live || s === 'completed';
    const run = (fn: () => void) => () => {
        setAnchor(null);
        fn();
    };
    const items = [
        live && (
            <MenuItem key="edit" onClick={run(() => actions.onEdit(reminder))}>
                <ListItemIcon>
                    <EditRounded fontSize="small" />
                </ListItemIcon>
                Edit
            </MenuItem>
        ),
        s === 'active' && (
            <MenuItem key="pause" onClick={run(() => actions.onPause(reminder, true))}>
                <ListItemIcon>
                    <PauseRounded fontSize="small" />
                </ListItemIcon>
                Pause
            </MenuItem>
        ),
        s === 'paused' && (
            <MenuItem key="resume" onClick={run(() => actions.onPause(reminder, false))}>
                <ListItemIcon>
                    <PlayArrowRounded fontSize="small" />
                </ListItemIcon>
                Resume
            </MenuItem>
        ),
        ...(canSnooze
            ? snoozeOptions(actions.timeZone).map((o) => (
                  <MenuItem key={o.label} onClick={run(() => actions.onSnooze(reminder, o.minutes))}>
                      <ListItemIcon>
                          <SnoozeRounded fontSize="small" />
                      </ListItemIcon>
                      {o.label}
                  </MenuItem>
              ))
            : []),
        live && <Divider key="div" />,
        live && (
            <MenuItem key="cancel-reminder" onClick={run(() => actions.onCancel(reminder))} sx={{ color: ATLAS_PALETTE.error }}>
                <ListItemIcon sx={{ color: 'inherit' }}>
                    <CancelRounded fontSize="small" />
                </ListItemIcon>
                Cancel reminder
            </MenuItem>
        ),
        !live && (
            <MenuItem key="delete" onClick={run(() => actions.onDelete(reminder))} sx={{ color: ATLAS_PALETTE.error }}>
                <ListItemIcon sx={{ color: 'inherit' }}>
                    <DeleteOutlineRounded fontSize="small" />
                </ListItemIcon>
                Delete
            </MenuItem>
        ),
    ].filter(Boolean);
    return (
        <>
            <IconButton
                size="small"
                aria-label={`Actions for ${reminder.label}`}
                aria-haspopup="menu"
                onClick={(e) => setAnchor(e.currentTarget)}
                sx={{ color: ATLAS_PALETTE.slate60, '&:hover': { color: ATLAS_PALETTE.slate } }}
            >
                <MoreVertRounded sx={{ fontSize: 20 }} />
            </IconButton>
            <Menu
                anchorEl={anchor}
                open={anchor !== null}
                onClose={() => setAnchor(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                slotProps={{ list: { dense: true } }}
            >
                {items}
            </Menu>
        </>
    );
}

/** What the Owner needs to know about when: next fire for live rows, when it ended for history. */
function TimeLine({ reminder }: { reminder: IReminder }) {
    const { status, next_fire_at, last_fired_at, updated_at, fire_count } = reminder;
    let text: string;
    let at: string;
    if (status === 'active') {
        text = `Next ${relativeFromNow(next_fire_at)}`;
        at = next_fire_at;
    } else if (status === 'paused') {
        text = last_fired_at ? `Paused · last fired ${relativeFromNow(last_fired_at)}` : 'Paused · never fired';
        at = last_fired_at ?? updated_at;
    } else {
        text = `${status === 'completed' ? 'Completed' : 'Cancelled'} ${relativeFromNow(updated_at)}`;
        if (fire_count > 0) text += ` · fired ${fire_count}×`;
        else if (last_fired_at) text += ` · last fired ${relativeFromNow(last_fired_at)}`;
        at = updated_at;
    }
    return (
        <Tooltip title={new Date(at).toLocaleString()} arrow placement="top">
            <Typography
                component="span"
                sx={{
                    fontSize: 12,
                    fontFamily: MONO,
                    color: ATLAS_PALETTE.slate70,
                    fontVariantNumeric: 'tabular-nums',
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                }}
            >
                {text}
            </Typography>
        </Tooltip>
    );
}

const DELIVERY_TEXT: Record<IReminderFire['external_status'], string> = {
    none: 'off',
    pending: 'held / sending',
    sent: 'sent',
    failed: 'failed',
};

function FireLog({ id, reminderId }: { id: string; reminderId: number }) {
    const { data, isLoading, isError } = useReminderFires(reminderId, true);
    return (
        <Box
            id={id}
            sx={{ borderTop: `1px solid ${ATLAS_PALETTE.slate10}`, px: 3, py: 2.5 }}
        >
            {isLoading ? (
                <Skeleton variant="text" width="60%" />
            ) : isError ? (
                <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.error }}>Could not load the fire log.</Typography>
            ) : !data || data.length === 0 ? (
                <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate70 }}>
                    No fires logged. Fires before the log existed aren&apos;t listed.
                </Typography>
            ) : (
                <Box component="ol" aria-label="Fire log" sx={{ m: 0, p: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {data.map((f) => (
                        <Box
                            component="li"
                            key={f.notification_id}
                            sx={{
                                display: 'flex',
                                flexWrap: 'wrap',
                                columnGap: 3,
                                rowGap: 0.5,
                                fontFamily: MONO,
                                fontSize: 12,
                                color: ATLAS_PALETTE.slate70,
                            }}
                        >
                            <Box component="span" sx={{ color: ATLAS_PALETTE.slate }}>
                                {new Date(f.fired_at).toLocaleString()}
                            </Box>
                            <Box component="span">push {DELIVERY_TEXT[f.push_status]}</Box>
                            <Box
                                component="span"
                                sx={{ color: f.external_status === 'failed' ? ATLAS_PALETTE.error : 'inherit' }}
                            >
                                external {DELIVERY_TEXT[f.external_status]}
                                {f.external_status === 'failed' && f.failure_reason ? ` · ${f.failure_reason}` : ''}
                            </Box>
                        </Box>
                    ))}
                </Box>
            )}
        </Box>
    );
}

function ChannelIcons({ channel }: { channel: ReminderChannel }) {
    const label =
        channel === 'both'
            ? 'In-app + External Notification'
            : channel === 'external'
              ? 'External Notification'
              : 'In-app';
    return (
        <Tooltip title={label} arrow>
            <Box
                role="img"
                aria-label={label}
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5,
                    flexShrink: 0,
                    color: ATLAS_PALETTE.slate60,
                }}
            >
                {(channel === 'notification' || channel === 'both') && (
                    <NotificationsRounded sx={{ fontSize: 16 }} />
                )}
                {(channel === 'external' || channel === 'both') && (
                    <SendRounded sx={{ fontSize: 16 }} />
                )}
            </Box>
        </Tooltip>
    );
}

// Reminder statuses borrow the item-status dot tokens: live = done (green),
// paused = waiting (amber), completed = ready (blue), cancelled = draft (grey).
// Only the dot carries the hue: the pastel chip fills/foregrounds don't reach
// AA at 11px and don't flip for dark mode, so the text sits on a neutral fill.
const STATUS_TOKEN: Record<ReminderStatus, keyof typeof STATUS_PALETTE> = {
    active: 'done',
    paused: 'waiting_for_info',
    completed: 'ready',
    cancelled: 'draft',
};

function StatusChip({ status }: { status: ReminderStatus }) {
    const dot = STATUS_PALETTE[STATUS_TOKEN[status]]?.dot;
    return (
        <Chip
            label={status}
            size="small"
            icon={
                <Box
                    component="span"
                    aria-hidden
                    sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: dot, flexShrink: 0 }}
                />
            }
            sx={{
                height: 22,
                fontSize: 11,
                fontWeight: 600,
                textTransform: 'capitalize',
                flexShrink: 0,
                background: ATLAS_PALETTE.slate06,
                color: ATLAS_PALETTE.slate,
                '& .MuiChip-icon': { ml: 1, mr: -0.25 },
            }}
        />
    );
}

export function formatSchedule(r: Pick<IReminder, 'schedule_kind' | 'schedule_value'>): string {
    switch (r.schedule_kind) {
        case 'once': {
            const d = new Date(r.schedule_value);
            if (Number.isNaN(d.getTime())) return r.schedule_value;
            return `Once on ${d.toLocaleString()}`;
        }
        case 'daily':
            return `Daily at ${r.schedule_value}`;
        case 'weekly': {
            const [hhmm, csv] = r.schedule_value.split('|');
            if (!hhmm || !csv) return r.schedule_value;
            const days = csv
                .split(',')
                .map((s) => Number(s.trim()))
                .filter((n) => Number.isFinite(n) && n >= 1 && n <= 7)
                .map((n) => WEEKDAY_LABEL[n])
                .join(', ');
            return `Weekly ${days} at ${hhmm}`;
        }
        case 'cron':
            return `cron: ${r.schedule_value}`;
        default:
            return r.schedule_value;
    }
}

function relativeFromNow(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const diff = d.getTime() - Date.now();
    const absMin = Math.abs(Math.trunc(diff / 60_000));
    if (absMin < 1) return diff < 0 ? 'just now' : 'in <1m';
    if (absMin < 60) return diff < 0 ? `${absMin}m ago` : `in ${absMin}m`;
    const absH = Math.floor(absMin / 60);
    if (absH < 24) return diff < 0 ? `${absH}h ago` : `in ${absH}h`;
    const absD = Math.floor(absH / 24);
    if (absD < 7) return diff < 0 ? `${absD}d ago` : `in ${absD}d`;
    return `on ${d.toLocaleDateString()}`;
}
