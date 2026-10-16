import { useState } from 'react';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Divider from '@mui/material/Divider';
import SnoozeRounded from '@mui/icons-material/SnoozeRounded';
import { useSnoozeReminder } from '../../hooks/useReminders.js';
import { useSettings } from '../../hooks/useSettings.js';
import { useToast } from '../../hooks/useToast.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { snoozeOptions } from './snooze.js';

export function snoozedToast(nextFireAt: string, timeZone: string | null | undefined): string {
    const opts: Intl.DateTimeFormatOptions = { weekday: 'short', hour: 'numeric', minute: '2-digit' };
    try {
        return `Snoozed until ${new Date(nextFireAt).toLocaleString(undefined, { ...opts, ...(timeZone ? { timeZone } : {}) })}`;
    } catch {
        return `Snoozed until ${new Date(nextFireAt).toLocaleString(undefined, opts)}`;
    }
}

/**
 * The action on a reminder's in-app feed card: snooze it from where it fired.
 * The card itself stays non-clickable (a button inside a button is not
 * allowed), so the menu also carries the way to the Reminders page.
 */
export function ReminderSnoozeButton({
    reminderId,
    onSnoozed,
    onOpenReminders,
}: {
    reminderId: number;
    onSnoozed: () => void;
    onOpenReminders: () => void;
}) {
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const snooze = useSnoozeReminder();
    const toast = useToast();
    const tz = useSettings().data?.quiet_hours_timezone ?? null;

    function pick(minutes: number) {
        setAnchor(null);
        snooze.mutate(
            { id: reminderId, minutes },
            {
                onSuccess: (r) => {
                    toast.show({ message: snoozedToast(r.next_fire_at, tz) });
                    onSnoozed();
                },
                onError: (e: Error) => toast.show({ message: 'Could not snooze reminder', detail: e.message }),
            },
        );
    }

    return (
        <>
            <IconButton
                size="small"
                aria-label="Snooze reminder"
                aria-haspopup="menu"
                onClick={(e) => setAnchor(e.currentTarget)}
                disabled={snooze.isPending}
                sx={{ color: ATLAS_PALETTE.slate60, '&:hover': { color: ATLAS_PALETTE.slate } }}
            >
                <SnoozeRounded sx={{ fontSize: 20 }} />
            </IconButton>
            <Menu anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
                {snoozeOptions(tz).map((o) => (
                    <MenuItem key={o.label} onClick={() => pick(o.minutes)} sx={{ fontSize: 14 }}>
                        {o.label}
                    </MenuItem>
                ))}
                <Divider />
                <MenuItem
                    onClick={() => {
                        setAnchor(null);
                        onOpenReminders();
                    }}
                    sx={{ fontSize: 14 }}
                >
                    Open Reminders
                </MenuItem>
            </Menu>
        </>
    );
}
