import { describe, it, expect } from 'vitest';
import { materializeCron } from './cron-materializer.js';

describe('materializeCron', () => {
    it('hourly → 0 * * * *', () => {
        expect(
            materializeCron({
                preset: 'hourly',
                time_of_day: '06:00',
                weekday: null,
                cron_expression: '',
            })
        ).toEqual({ cron_expression: '0 * * * *' });
    });

    it('every_4h → 0 */4 * * *', () => {
        expect(
            materializeCron({
                preset: 'every_4h',
                time_of_day: '06:00',
                weekday: null,
                cron_expression: '',
            })
        ).toEqual({ cron_expression: '0 */4 * * *' });
    });

    it('daily at 06:00 → 0 6 * * *', () => {
        expect(
            materializeCron({
                preset: 'daily',
                time_of_day: '06:00',
                weekday: null,
                cron_expression: '',
            })
        ).toEqual({ cron_expression: '0 6 * * *' });
    });

    it('daily at 13:30 → 30 13 * * *', () => {
        expect(
            materializeCron({
                preset: 'daily',
                time_of_day: '13:30',
                weekday: null,
                cron_expression: '',
            })
        ).toEqual({ cron_expression: '30 13 * * *' });
    });

    it('weekly Monday at 09:15 → 15 9 * * 1', () => {
        expect(
            materializeCron({
                preset: 'weekly',
                time_of_day: '09:15',
                weekday: 1,
                cron_expression: '',
            })
        ).toEqual({ cron_expression: '15 9 * * 1' });
    });

    it('weekly with missing weekday → throws', () => {
        expect(() =>
            materializeCron({
                preset: 'weekly',
                time_of_day: '09:15',
                weekday: null,
                cron_expression: '',
            })
        ).toThrow(/weekday/);
    });

    it('custom passes through verbatim', () => {
        expect(
            materializeCron({
                preset: 'custom',
                time_of_day: '',
                weekday: null,
                cron_expression: '*/5 * * * *',
            })
        ).toEqual({ cron_expression: '*/5 * * * *' });
    });

    it('custom with invalid cron throws', () => {
        expect(() =>
            materializeCron({
                preset: 'custom',
                time_of_day: '',
                weekday: null,
                cron_expression: 'not a cron',
            })
        ).toThrow(/cron/);
    });

    it('daily with invalid time_of_day throws', () => {
        expect(() =>
            materializeCron({
                preset: 'daily',
                time_of_day: '24:00',
                weekday: null,
                cron_expression: '',
            })
        ).toThrow(/time_of_day/);
    });

    // CRON-EXTRA — weekly with valid weekday but invalid time_of_day
    // (lines 27-29 of cron-materializer.ts: the TIME_RE.exec null branch
    // inside the weekly case, which is separate from the weekday=null branch).
    it('weekly with invalid time_of_day throws (lines 27-29)', () => {
        expect(() =>
            materializeCron({
                preset: 'weekly',
                time_of_day: '99:99',
                weekday: 2,
                cron_expression: '',
            })
        ).toThrow(/time_of_day/);
    });
});
