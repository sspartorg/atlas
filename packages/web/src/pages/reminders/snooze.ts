// Snooze choices shared by the Reminders row menu and the feed's reminder card.
// "Tomorrow 9:00" is 9:00 in the Owner's zone (settings.quiet_hours_timezone,
// the same zone the server schedules daily/weekly reminders in), not the
// browser's, so a phone abroad still snoozes to the Owner's morning.

export interface SnoozeOption {
    label: string;
    minutes: number;
}

function zoneOffsetMs(at: number, timeZone: string): number {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
    }).formatToParts(new Date(at));
    const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second')) - Math.floor(at / 1000) * 1000;
}

/** The next day's `hour`:00 in `timeZone` (browser zone when unset or unknown). */
export function tomorrowAt(hour: number, timeZone: string | null | undefined, now: Date = new Date()): Date {
    let zone = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    try {
        zoneOffsetMs(now.getTime(), zone);
    } catch {
        zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    }
    const today = now.getTime() + zoneOffsetMs(now.getTime(), zone);
    const d = new Date(today);
    const wall = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, hour, 0, 0);
    // Wall time → instant; the second pass settles a DST change overnight.
    const first = wall - zoneOffsetMs(wall, zone);
    return new Date(wall - zoneOffsetMs(first, zone));
}

export function snoozeOptions(timeZone: string | null | undefined, now: Date = new Date()): SnoozeOption[] {
    const morning = Math.max(1, Math.ceil((tomorrowAt(9, timeZone, now).getTime() - now.getTime()) / 60_000));
    return [
        { label: 'Snooze 10 minutes', minutes: 10 },
        { label: 'Snooze 1 hour', minutes: 60 },
        { label: 'Snooze until tomorrow 9:00', minutes: morning },
    ];
}
