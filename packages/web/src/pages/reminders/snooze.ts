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

/** `timeZone` if the browser knows it, else the browser's own zone. */
export function resolveZone(timeZone: string | null | undefined): string {
    const browser = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!timeZone) return browser;
    try {
        zoneOffsetMs(Date.now(), timeZone);
        return timeZone;
    } catch {
        return browser;
    }
}

/** The instant a wall-clock time (given as UTC fields in `wall`) names in `zone`. */
export function zonedWallToDate(wall: number, zone: string): Date {
    // Wall time → instant; the second pass settles a DST change.
    const first = wall - zoneOffsetMs(wall, zone);
    return new Date(wall - zoneOffsetMs(first, zone));
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DDTHH:MM`, the wall clock of `at` in `zone` — what `<input type="datetime-local">` takes. */
export function toZonedInput(at: Date, zone: string): string {
    const d = new Date(at.getTime() + zoneOffsetMs(at.getTime(), zone));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** The instant a datetime-local value names in `zone`, or null when it doesn't parse. */
export function fromZonedInput(value: string, zone: string): Date | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
    if (!m) return null;
    const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
    return zonedWallToDate(Date.UTC(y, mo - 1, d, h, mi, 0), zone);
}

/** The next day's `hour`:00 in `timeZone` (browser zone when unset or unknown). */
export function tomorrowAt(hour: number, timeZone: string | null | undefined, now: Date = new Date()): Date {
    const zone = resolveZone(timeZone);
    const d = new Date(now.getTime() + zoneOffsetMs(now.getTime(), zone));
    return zonedWallToDate(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, hour, 0, 0), zone);
}

export function snoozeOptions(timeZone: string | null | undefined, now: Date = new Date()): SnoozeOption[] {
    const morning = Math.max(1, Math.ceil((tomorrowAt(9, timeZone, now).getTime() - now.getTime()) / 60_000));
    return [
        { label: 'Snooze 10 minutes', minutes: 10 },
        { label: 'Snooze 1 hour', minutes: 60 },
        { label: 'Snooze until tomorrow 9:00', minutes: morning },
    ];
}
