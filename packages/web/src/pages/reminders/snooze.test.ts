import { describe, expect, it } from 'vitest';
import { snoozeOptions, tomorrowAt } from './snooze.js';

describe('tomorrowAt', () => {
    it('is 9:00 tomorrow in the Owner zone, not the browser zone', () => {
        // 23:00Z on the 16th is already 04:30 on the 17th in Kolkata → 9:00 on the 18th IST.
        const now = new Date('2026-10-16T23:00:00Z');
        expect(tomorrowAt(9, 'Asia/Kolkata', now).toISOString()).toBe('2026-10-18T03:30:00.000Z');
        expect(tomorrowAt(9, 'UTC', now).toISOString()).toBe('2026-10-17T09:00:00.000Z');
    });

    it('lands on 9:00 local across a DST change overnight', () => {
        // Sat 2026-10-31 evening in New York; DST ends Sun → 9:00 EST = 14:00Z.
        expect(tomorrowAt(9, 'America/New_York', new Date('2026-11-01T01:00:00Z')).toISOString()).toBe(
            '2026-11-01T14:00:00.000Z',
        );
    });

    it('falls back to the browser zone for an unknown or missing zone', () => {
        const now = new Date('2026-10-16T10:00:00Z');
        const browser = tomorrowAt(9, null, now).toISOString();
        expect(tomorrowAt(9, 'Not/AZone', now).toISOString()).toBe(browser);
    });
});

describe('snoozeOptions', () => {
    it('offers 10 minutes, 1 hour and tomorrow 9:00 in minutes from now', () => {
        const now = new Date('2026-10-16T10:00:00Z');
        expect(snoozeOptions('UTC', now)).toEqual([
            { label: 'Snooze 10 minutes', minutes: 10 },
            { label: 'Snooze 1 hour', minutes: 60 },
            { label: 'Snooze until tomorrow 9:00', minutes: 23 * 60 },
        ]);
    });
});

describe('snoozedToast', () => {
    it('names the new fire time in the Owner zone, and survives a bad zone', async () => {
        const { snoozedToast } = await import('./ReminderSnoozeButton.js');
        expect(snoozedToast('2026-10-16T03:30:00Z', 'Asia/Kolkata')).toMatch(/^Snoozed until .*9:00/);
        expect(snoozedToast('2026-10-16T03:30:00Z', 'Not/AZone')).toMatch(/^Snoozed until /);
        expect(snoozedToast('2026-10-16T03:30:00Z', null)).toMatch(/^Snoozed until /);
    });
});
