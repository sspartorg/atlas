import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
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
import AddRounded from '@mui/icons-material/AddRounded';
import CancelRounded from '@mui/icons-material/CancelRounded';
import EditRounded from '@mui/icons-material/EditRounded';
import AlarmRounded from '@mui/icons-material/AlarmRounded';
import NotificationsRounded from '@mui/icons-material/NotificationsRounded';
import SendRounded from '@mui/icons-material/SendRounded';
import type { IReminder, ReminderChannel, ReminderStatus } from '@atlas/shared';
import { useReminders, useCancelReminder } from '../hooks/useReminders.js';
import { useToast } from '../hooks/useToast.js';
import { useSetPageTitle } from '../components/shell/index.js';
import { HeroEmptyState } from '../components/HeroEmptyState.js';
import { RefreshButton } from '../components/index.js';
import { ATLAS_PALETTE } from '../theme/tokens.js';
import { NewReminderModal } from './reminders/NewReminderModal.js';

const ACTIVE_STATES: ReminderStatus[] = ['active', 'paused'];
const HISTORY_STATES: ReminderStatus[] = ['cancelled', 'completed'];

const WEEKDAY_LABEL = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function Reminders() {
    useSetPageTitle('Reminders');
    const toast = useToast();
    const [showHistory, setShowHistory] = useState(false);
    const [newOpen, setNewOpen] = useState(false);
    const [editing, setEditing] = useState<IReminder | null>(null);
    const [pendingCancel, setPendingCancel] = useState<IReminder | null>(null);

    const { data: all = [], isLoading, isFetching, refetch } = useReminders();
    const cancelReminder = useCancelReminder();

    const { active, history } = useMemo(() => {
        const a: IReminder[] = [];
        const h: IReminder[] = [];
        for (const r of all) {
            if (ACTIVE_STATES.includes(r.status)) a.push(r);
            else if (HISTORY_STATES.includes(r.status)) h.push(r);
        }
        return { active: a, history: h };
    }, [all]);

    function requestCancel(r: IReminder) {
        setPendingCancel(r);
    }

    function requestEdit(r: IReminder) {
        setEditing(r);
    }

    function closeCancelDialog() {
        if (cancelReminder.isPending) return;
        setPendingCancel(null);
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

    return (
        <Box sx={{ px: { xs: 3, md: 8 }, py: 4 }}>
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'flex-end',
                    justifyContent: 'space-between',
                    mb: 5,
                    gap: 4,
                    flexWrap: 'wrap',
                }}
            >
                <Typography
                    variant="h1"
                    sx={{
                        fontSize: '2.25rem',
                        fontWeight: 700,
                        lineHeight: 1.2,
                        letterSpacing: '-0.01em',
                        color: ATLAS_PALETTE.slate,
                    }}
                >
                    Reminders
                </Typography>
                <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                    <RefreshButton
                        onRefresh={() => void refetch()}
                        isFetching={isFetching}
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
                        sx={{ textTransform: 'none', fontWeight: 500 }}
                    >
                        New reminder
                    </Button>
                </Box>
            </Box>

            <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60, mb: 4 }}>
                Reminders fire as in-app notifications and (optionally) external notifications.
                They run on the same per-minute scheduler as agents.
            </Typography>

            {!isLoading && active.length === 0 ? (
                <HeroEmptyState
                    icon={<AlarmRounded sx={{ fontSize: 30, color: ATLAS_PALETTE.slate60 }} />}
                    title="No active reminders"
                    description="Use New reminder to add one yourself, or ask Claude to set one for you."
                />
            ) : (
                <ReminderList
                    rows={active}
                    onCancel={requestCancel}
                    onEdit={requestEdit}
                    muted={false}
                />
            )}

            {showHistory && history.length > 0 && (
                <Box sx={{ mt: 8 }}>
                    <Typography
                        sx={{
                            fontSize: 12,
                            fontWeight: 600,
                            letterSpacing: '0.06em',
                            textTransform: 'uppercase',
                            color: ATLAS_PALETTE.slate60,
                            mb: 3,
                        }}
                    >
                        History
                    </Typography>
                    <ReminderList rows={history} onCancel={requestCancel} onEdit={requestEdit} muted />
                </Box>
            )}

            <NewReminderModal open={newOpen} onClose={() => setNewOpen(false)} />
            <NewReminderModal
                open={editing !== null}
                onClose={() => setEditing(null)}
                editing={editing}
            />

            <Dialog open={pendingCancel !== null} onClose={closeCancelDialog} maxWidth="xs" fullWidth>
                <DialogTitle sx={{ fontSize: 18, fontWeight: 600 }}>Cancel reminder?</DialogTitle>
                <DialogContent>
                    <DialogContentText sx={{ fontSize: 14 }}>
                        Cancel{' '}
                        <Box component="span" sx={{ fontWeight: 600, color: ATLAS_PALETTE.slate }}>
                            {pendingCancel?.label}
                        </Box>
                        ? It will stop firing and move to history. You can&apos;t restore it — set a
                        new reminder if you need it again.
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button
                        onClick={closeCancelDialog}
                        disabled={cancelReminder.isPending}
                        sx={{ textTransform: 'none' }}
                    >
                        Keep
                    </Button>
                    <Button
                        variant="contained"
                        color="error"
                        onClick={confirmCancel}
                        disabled={cancelReminder.isPending}
                        sx={{ textTransform: 'none' }}
                    >
                        {cancelReminder.isPending ? 'Cancelling…' : 'Cancel reminder'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
}

interface ReminderListProps {
    rows: IReminder[];
    onCancel: (r: IReminder) => void;
    onEdit: (r: IReminder) => void;
    muted: boolean;
}

function ReminderList({ rows, onCancel, onEdit, muted }: ReminderListProps) {
    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {rows.map((r) => (
                <ReminderRow
                    key={r.id}
                    reminder={r}
                    onCancel={onCancel}
                    onEdit={onEdit}
                    muted={muted}
                />
            ))}
        </Box>
    );
}

interface ReminderRowProps {
    reminder: IReminder;
    onCancel: (r: IReminder) => void;
    onEdit: (r: IReminder) => void;
    muted: boolean;
}

function ReminderRow({ reminder, onCancel, onEdit, muted }: ReminderRowProps) {
    const isEditable = !muted && ACTIVE_STATES.includes(reminder.status);
    const canCancel = isEditable;
    return (
        <Box
            sx={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1.2fr) auto minmax(0, 1fr) auto auto',
                alignItems: 'center',
                gap: 3,
                px: 3,
                py: 2.5,
                borderRadius: '12px',
                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                background: muted ? ATLAS_PALETTE.cloud : ATLAS_PALETTE.white,
                opacity: muted ? 0.65 : 1,
            }}
        >
            <Box sx={{ minWidth: 0 }}>
                <Typography
                    sx={{
                        fontSize: 14,
                        fontWeight: 600,
                        color: ATLAS_PALETTE.slate,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                    }}
                >
                    {reminder.label}
                </Typography>
                {reminder.body && (
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
                )}
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
                <Chip
                    label={reminder.schedule_kind}
                    size="small"
                    sx={{
                        height: 20,
                        fontSize: 11,
                        fontWeight: 500,
                        textTransform: 'capitalize',
                        background: ATLAS_PALETTE.cloud,
                        color: ATLAS_PALETTE.slate60,
                    }}
                />
                <Typography
                    sx={{
                        fontSize: 13,
                        color: ATLAS_PALETTE.slate,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                    }}
                >
                    {formatSchedule(reminder)}
                </Typography>
            </Box>

            <ChannelChip channel={reminder.channel} />

            <Tooltip
                title={new Date(reminder.next_fire_at).toLocaleString()}
                arrow
                placement="top"
            >
                <Typography
                    sx={{
                        fontSize: 13,
                        color: ATLAS_PALETTE.slate60,
                        fontVariantNumeric: 'tabular-nums',
                    }}
                >
                    {relativeFromNow(reminder.next_fire_at)}
                </Typography>
            </Tooltip>

            <StatusChip status={reminder.status} />

            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.5 }}>
                {isEditable ? (
                    <Tooltip title="Edit reminder" arrow>
                        <IconButton
                            size="small"
                            onClick={() => onEdit(reminder)}
                            sx={{ color: ATLAS_PALETTE.slate60, '&:hover': { color: ATLAS_PALETTE.slate } }}
                        >
                            <EditRounded sx={{ fontSize: 18 }} />
                        </IconButton>
                    </Tooltip>
                ) : (
                    <Box sx={{ width: 30 }} />
                )}
                {canCancel ? (
                    <Tooltip title="Cancel reminder" arrow>
                        <IconButton
                            size="small"
                            onClick={() => onCancel(reminder)}
                            sx={{ color: ATLAS_PALETTE.slate60, '&:hover': { color: ATLAS_PALETTE.error } }}
                        >
                            <CancelRounded sx={{ fontSize: 18 }} />
                        </IconButton>
                    </Tooltip>
                ) : (
                    <Box sx={{ width: 30 }} />
                )}
            </Box>
        </Box>
    );
}

function ChannelChip({ channel }: { channel: ReminderChannel }) {
    const label =
        channel === 'both'
            ? 'In-app + External Notification'
            : channel === 'external'
              ? 'External Notification'
              : 'In-app';
    return (
        <Tooltip title={label} arrow>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: ATLAS_PALETTE.slate60 }}>
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

const STATUS_COLOR: Record<ReminderStatus, { bg: string; fg: string }> = {
    active: { bg: '#E6F6EA', fg: '#1E7A3A' },
    paused: { bg: '#FFF4D6', fg: '#8A6A0A' },
    cancelled: { bg: '#F0E1E0', fg: '#8A2E27' },
    completed: { bg: '#E5ECF5', fg: '#385783' },
};

function StatusChip({ status }: { status: ReminderStatus }) {
    const colors = STATUS_COLOR[status];
    return (
        <Chip
            label={status}
            size="small"
            sx={{
                height: 22,
                fontSize: 11,
                fontWeight: 600,
                textTransform: 'capitalize',
                background: colors.bg,
                color: colors.fg,
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
    const absMin = Math.abs(Math.floor(diff / 60_000));
    if (absMin < 1) return diff < 0 ? 'past due' : 'in <1m';
    if (absMin < 60) return diff < 0 ? `${absMin}m ago` : `in ${absMin}m`;
    const absH = Math.floor(absMin / 60);
    if (absH < 24) return diff < 0 ? `${absH}h ago` : `in ${absH}h`;
    const absD = Math.floor(absH / 24);
    if (absD < 7) return diff < 0 ? `${absD}d ago` : `in ${absD}d`;
    return d.toLocaleDateString();
}
