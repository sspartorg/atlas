import { useEffect, useRef, useState } from 'react';
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
import { useSettings } from '../../hooks/useSettings.js';
import { fromZonedInput, resolveZone, toZonedInput } from './snooze.js';
import { useToast } from '../../hooks/useToast.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';

interface Props {
    open: boolean;
    onClose: () => void;
    /** When set, the modal renders in edit mode and dispatches a PATCH instead
     *  of a POST on submit. */
    editing?: IReminder | null;
}

const LABEL_MAX = 200;

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
    // Every schedule kind is in the Owner's zone: the server runs daily /
    // weekly / cron there, so "Once at 09:00" means 09:00 there too.
    const zone = resolveZone(useSettings().data?.quiet_hours_timezone);

    const labelRef = useRef<HTMLInputElement | null>(null);
    const [label, setLabel] = useState('');
    const [body, setBody] = useState('');
    const [kind, setKind] = useState<ReminderScheduleKind>('once');
    const [once, setOnce] = useState(() => defaultOnceValue(zone));
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
        setOnce(defaultOnceValue(zone));
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
            hydrateScheduleFromRow(editing, zone, {
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
        const built = buildSchedule(kind, { once, daily, weeklyTime, weekdays, cron }, zone);
        if ('error' in built) {
            setError(built.error);
            return;
        }
        const schedule = built.schedule;
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
                }
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
        <Dialog
            open={open}
            onClose={handleClose}
            fullWidth
            maxWidth="sm"
            // The dialog's focus trap takes focus to its paper after `autoFocus`
            // ran, so a keyboard user landed nowhere; put it on Label once open.
            slotProps={{ transition: { onEntered: () => labelRef.current?.focus() } }}
        >
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
                        inputRef={labelRef}
                        inputProps={{ maxLength: LABEL_MAX }}
                        helperText={`${label.length}/${LABEL_MAX}`}
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
                        <FormLabel sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60 }}>
                            Schedule
                        </FormLabel>
                        <RadioGroup
                            row
                            value={kind}
                            onChange={(_, v) => setKind(v as ReminderScheduleKind)}
                            sx={{ mt: 1 }}
                        >
                            <FormControlLabel
                                value="once"
                                control={<Radio size="small" />}
                                label="Once"
                            />
                            <FormControlLabel
                                value="daily"
                                control={<Radio size="small" />}
                                label="Daily"
                            />
                            <FormControlLabel
                                value="weekly"
                                control={<Radio size="small" />}
                                label="Weekly"
                            />
                            <FormControlLabel
                                value="cron"
                                control={<Radio size="small" />}
                                label="Cron"
                            />
                        </RadioGroup>

                        {kind === 'once' && (
                            <TextField
                                label="When"
                                type="datetime-local"
                                value={once}
                                onChange={(e) => setOnce(e.target.value)}
                                size="small"
                                InputLabelProps={{ shrink: true }}
                                helperText={`In ${zone}`}
                                sx={{ mt: 2, width: 280, maxWidth: '100%' }}
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
                                                    onChange={(e) =>
                                                        toggleWeekday(w.value, e.target.checked)
                                                    }
                                                />
                                            }
                                            label={
                                                <Typography sx={{ fontSize: 13 }}>
                                                    {w.label}
                                                </Typography>
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
                        <FormLabel sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60 }}>
                            Channel
                        </FormLabel>
                        <RadioGroup
                            row
                            value={channel}
                            onChange={(_, v) => setChannel(v as ReminderChannel)}
                            sx={{ mt: 1 }}
                        >
                            <FormControlLabel
                                value="notification"
                                control={<Radio size="small" />}
                                label="In-app"
                            />
                            <FormControlLabel
                                value="external"
                                control={<Radio size="small" />}
                                label="External Notification"
                            />
                            <FormControlLabel
                                value="both"
                                control={<Radio size="small" />}
                                label="Both"
                            />
                        </RadioGroup>
                    </Box>

                    {error && (
                        <Typography role="alert" sx={{ fontSize: 13, color: ATLAS_PALETTE.error }}>
                            {error}
                        </Typography>
                    )}
                </Box>
            </DialogContent>
            <DialogActions>
                <Button
                    onClick={handleClose}
                    disabled={mutation.isPending}
                    sx={{ textTransform: 'none' }}
                >
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

type Built = { schedule: SetReminderInput['schedule'] } | { error: string };

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function buildSchedule(kind: ReminderScheduleKind, f: ScheduleFields, zone: string, now: Date = new Date()): Built {
    switch (kind) {
        case 'once': {
            const at = fromZonedInput(f.once, zone);
            if (!at || Number.isNaN(at.getTime())) return { error: 'Pick a date and time.' };
            if (at.getTime() <= now.getTime()) return { error: 'Pick a time in the future.' };
            return { schedule: { kind: 'once', at: at.toISOString() } };
        }
        case 'daily':
            if (!HHMM.test(f.daily)) return { error: 'Pick a time.' };
            return { schedule: { kind: 'daily', time_of_day: f.daily } };
        case 'weekly':
            if (!HHMM.test(f.weeklyTime)) return { error: 'Pick a time.' };
            if (f.weekdays.length === 0) return { error: 'Pick at least one weekday.' };
            return { schedule: { kind: 'weekly', weekdays: f.weekdays, time_of_day: f.weeklyTime } };
        case 'cron':
            if (f.cron.trim() === '') return { error: 'Enter a cron expression.' };
            return { schedule: { kind: 'cron', expr: f.cron.trim() } };
        /* v8 ignore next 2 */
        default:
            return { error: 'Pick a schedule.' };
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
function hydrateScheduleFromRow(r: IReminder, zone: string, s: ScheduleSetters): void {
    s.setKind(r.schedule_kind);
    switch (r.schedule_kind) {
        case 'once': {
            // schedule_value is an ISO instant; the input shows its wall clock in the Owner zone.
            const d = new Date(r.schedule_value);
            if (!Number.isNaN(d.getTime())) s.setOnce(toZonedInput(d, zone));
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
                    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 7)
            );
            return;
        }
        case 'cron':
            s.setCron(r.schedule_value);
            return;
    }
}

function defaultOnceValue(zone: string): string {
    return toZonedInput(new Date(Date.now() + 60 * 60 * 1000), zone);
}
