import { useEffect, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import RadioGroup from '@mui/material/RadioGroup';
import Radio from '@mui/material/Radio';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormLabel from '@mui/material/FormLabel';
import Checkbox from '@mui/material/Checkbox';
import {
    SetReminderSchema,
    type SetReminderInput,
    type ReminderScheduleKind,
    type ReminderChannel,
    type IReminder,
} from '@atlas/shared';
import { useCreateReminder, useUpdateReminder } from '../../hooks/useReminders.js';
import { useToast } from '../../hooks/useToast.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';

interface Props {
    open: boolean;
    onClose: () => void;
    /** When set, the modal renders in edit mode and dispatches a PATCH instead
     *  of a POST on submit. */
    editing?: IReminder | null;
}

const WEEKDAYS: { value: number; label: string }[] = [
    { value: 1, label: 'Mon' },
    { value: 2, label: 'Tue' },
    { value: 3, label: 'Wed' },
    { value: 4, label: 'Thu' },
    { value: 5, label: 'Fri' },
    { value: 6, label: 'Sat' },
    { value: 7, label: 'Sun' },
];

export function NewReminderModal({ open, onClose, editing }: Props) {
    const toast = useToast();
    const createReminder = useCreateReminder();
    const updateReminder = useUpdateReminder();
    const isEdit = !!editing;
    const mutation = isEdit ? updateReminder : createReminder;

    const [label, setLabel] = useState('');
    const [body, setBody] = useState('');
    const [kind, setKind] = useState<ReminderScheduleKind>('once');
    const [once, setOnce] = useState(() => defaultOnceValue());
    const [daily, setDaily] = useState('09:00');
    const [weeklyTime, setWeeklyTime] = useState('09:00');
    const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
    const [cron, setCron] = useState('0 9 * * 1-5');
    const [channel, setChannel] = useState<ReminderChannel>('notification');
    const [error, setError] = useState<string | null>(null);

    function reset() {
        setLabel('');
        setBody('');
        setKind('once');
        setOnce(defaultOnceValue());
        setDaily('09:00');
        setWeeklyTime('09:00');
        setWeekdays([1, 2, 3, 4, 5]);
        setCron('0 9 * * 1-5');
        setChannel('notification');
        setError(null);
    }

    // When the modal opens in edit mode, hydrate the form from the row so the
    // user sees their existing values. Closing/re-opening with `editing=null`
    // re-runs the reset path via the create branch.
    useEffect(() => {
        if (!open) return;
        if (editing) {
            setLabel(editing.label);
            setBody(editing.body ?? '');
            setChannel(editing.channel);
            hydrateScheduleFromRow(editing, {
                setKind,
                setOnce,
                setDaily,
                setWeeklyTime,
                setWeekdays,
                setCron,
            });
            setError(null);
        } else {
            reset();
        }
    }, [open, editing]);

    function handleClose() {
        if (mutation.isPending) return;
        reset();
        onClose();
    }

    function toggleWeekday(d: number, checked: boolean) {
        setWeekdays((prev) => {
            const next = checked ? [...prev, d] : prev.filter((x) => x !== d);
            return next.sort((a, b) => a - b);
        });
    }

    function handleSubmit() {
        setError(null);
        const schedule = buildSchedule(kind, { once, daily, weeklyTime, weekdays, cron });
        if (!schedule) {
            setError('Schedule is incomplete or invalid.');
            return;
        }
        const candidate: SetReminderInput = {
            label: label.trim(),
            body: body.trim(),
            schedule,
            channel,
        };
        const parsed = SetReminderSchema.safeParse(candidate);
        if (!parsed.success) {
            setError(parsed.error.issues[0]?.message ?? 'Invalid reminder');
            return;
        }
        if (isEdit && editing) {
            updateReminder.mutate(
                { id: editing.id, patch: parsed.data },
                {
                    onSuccess: () => {
                        toast.show({ message: `Reminder "${candidate.label}" updated` });
                        reset();
                        onClose();
                    },
                    onError: (e: Error) => setError(e.message),
                },
            );
        } else {
            createReminder.mutate(parsed.data, {
                onSuccess: () => {
                    toast.show({ message: `Reminder "${candidate.label}" created` });
                    reset();
                    onClose();
                },
                onError: (e: Error) => setError(e.message),
            });
        }
    }

    return (
        <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
            <DialogTitle sx={{ fontSize: 18, fontWeight: 600 }}>
                {isEdit ? 'Edit reminder' : 'New reminder'}
            </DialogTitle>
            <DialogContent dividers>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <TextField
                        label="Label"
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                        required
                        size="small"
                        inputProps={{ maxLength: 200 }}
                        autoFocus
                    />
                    <TextField
                        label="Body (optional)"
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                        size="small"
                        multiline
                        minRows={1}
                        maxRows={6}
                        InputLabelProps={{ shrink: true }}
                    />

                    <Box>
                        <FormLabel sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60 }}>Schedule</FormLabel>
                        <RadioGroup
                            row
                            value={kind}
                            onChange={(_, v) => setKind(v as ReminderScheduleKind)}
                            sx={{ mt: 1 }}
                        >
                            <FormControlLabel value="once" control={<Radio size="small" />} label="Once" />
                            <FormControlLabel value="daily" control={<Radio size="small" />} label="Daily" />
                            <FormControlLabel value="weekly" control={<Radio size="small" />} label="Weekly" />
                            <FormControlLabel value="cron" control={<Radio size="small" />} label="Cron" />
                        </RadioGroup>

                        {kind === 'once' && (
                            <TextField
                                label="When"
                                type="datetime-local"
                                value={once}
                                onChange={(e) => setOnce(e.target.value)}
                                size="small"
                                InputLabelProps={{ shrink: true }}
                                sx={{ mt: 2, width: 280 }}
                            />
                        )}
                        {kind === 'daily' && (
                            <TextField
                                label="Time"
                                type="time"
                                value={daily}
                                onChange={(e) => setDaily(e.target.value)}
                                size="small"
                                InputLabelProps={{ shrink: true }}
                                sx={{ mt: 2, width: 160 }}
                            />
                        )}
                        {kind === 'weekly' && (
                            <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
                                <TextField
                                    label="Time"
                                    type="time"
                                    value={weeklyTime}
                                    onChange={(e) => setWeeklyTime(e.target.value)}
                                    size="small"
                                    InputLabelProps={{ shrink: true }}
                                    sx={{ width: 160 }}
                                />
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                                    {WEEKDAYS.map((w) => (
                                        <FormControlLabel
                                            key={w.value}
                                            control={
                                                <Checkbox
                                                    size="small"
                                                    checked={weekdays.includes(w.value)}
                                                    onChange={(e) => toggleWeekday(w.value, e.target.checked)}
                                                />
                                            }
                                            label={
                                                <Typography sx={{ fontSize: 13 }}>{w.label}</Typography>
                                            }
                                        />
                                    ))}
                                </Box>
                            </Box>
                        )}
                        {kind === 'cron' && (
                            <TextField
                                label="Cron expression"
                                value={cron}
                                onChange={(e) => setCron(e.target.value)}
                                size="small"
                                fullWidth
                                helperText="e.g. 0 9 * * 1-5 (Mon–Fri 9 AM)"
                                sx={{ mt: 2 }}
                            />
                        )}
                    </Box>

                    <Box>
                        <FormLabel sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60 }}>Channel</FormLabel>
                        <RadioGroup
                            row
                            value={channel}
                            onChange={(_, v) => setChannel(v as ReminderChannel)}
                            sx={{ mt: 1 }}
                        >
                            <FormControlLabel value="notification" control={<Radio size="small" />} label="In-app" />
                            <FormControlLabel value="external" control={<Radio size="small" />} label="External Notification" />
                            <FormControlLabel value="both" control={<Radio size="small" />} label="Both" />
                        </RadioGroup>
                    </Box>

                    {error && (
                        <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.error }}>{error}</Typography>
                    )}
                </Box>
            </DialogContent>
            <DialogActions>
                <Button onClick={handleClose} disabled={mutation.isPending} sx={{ textTransform: 'none' }}>
                    Cancel
                </Button>
                <Button
                    variant="contained"
                    onClick={handleSubmit}
                    disabled={mutation.isPending || label.trim() === ''}
                    sx={{ textTransform: 'none' }}
                >
                    {mutation.isPending
                        ? isEdit
                            ? 'Saving…'
                            : 'Creating…'
                        : isEdit
                          ? 'Save changes'
                          : 'Create reminder'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}

interface ScheduleFields {
    once: string;
    daily: string;
    weeklyTime: string;
    weekdays: number[];
    cron: string;
}

function buildSchedule(
    kind: ReminderScheduleKind,
    f: ScheduleFields,
): SetReminderInput['schedule'] | null {
    switch (kind) {
        case 'once': {
            if (!f.once) return null;
            const d = new Date(f.once);
            if (Number.isNaN(d.getTime())) return null;
            return { kind: 'once', at: d.toISOString() };
        }
        case 'daily':
            if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(f.daily)) return null;
            return { kind: 'daily', time_of_day: f.daily };
        case 'weekly':
            if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(f.weeklyTime)) return null;
            if (f.weekdays.length === 0) return null;
            return { kind: 'weekly', weekdays: f.weekdays, time_of_day: f.weeklyTime };
        case 'cron':
            if (f.cron.trim() === '') return null;
            return { kind: 'cron', expr: f.cron.trim() };
        default:
            return null;
    }
}

interface ScheduleSetters {
    setKind: (k: ReminderScheduleKind) => void;
    setOnce: (v: string) => void;
    setDaily: (v: string) => void;
    setWeeklyTime: (v: string) => void;
    setWeekdays: (v: number[]) => void;
    setCron: (v: string) => void;
}

// Reverse of `buildSchedule` — given a reminder row, populate the form
// fields so the edit modal renders the user's existing schedule.
function hydrateScheduleFromRow(r: IReminder, s: ScheduleSetters): void {
    s.setKind(r.schedule_kind);
    switch (r.schedule_kind) {
        case 'once': {
            // schedule_value is an ISO datetime; convert to the YYYY-MM-DDTHH:MM
            // local format that <input type="datetime-local"> expects.
            const d = new Date(r.schedule_value);
            if (!Number.isNaN(d.getTime())) {
                const pad = (n: number) => String(n).padStart(2, '0');
                s.setOnce(
                    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
                );
            }
            return;
        }
        case 'daily':
            s.setDaily(r.schedule_value);
            return;
        case 'weekly': {
            const [hhmm, csv] = r.schedule_value.split('|');
            s.setWeeklyTime(hhmm ?? '09:00');
            s.setWeekdays(
                (csv ?? '')
                    .split(',')
                    .map((n) => Number(n.trim()))
                    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 7),
            );
            return;
        }
        case 'cron':
            s.setCron(r.schedule_value);
            return;
    }
}

function defaultOnceValue(): string {
    // Native datetime-local expects YYYY-MM-DDTHH:MM in local time
    const d = new Date(Date.now() + 60 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
