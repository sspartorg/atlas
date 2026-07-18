import { Cron } from 'croner';
import type { SchedulePreset } from '@atlas/shared';

interface Input {
    preset: SchedulePreset;
    time_of_day: string;
    weekday: number | null;
    cron_expression: string;
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function materializeCron(input: Input): { cron_expression: string } {
    switch (input.preset) {
        case 'hourly':
            return { cron_expression: '0 * * * *' };
        case 'every_4h':
            return { cron_expression: '0 */4 * * *' };
        case 'daily': {
            const m = TIME_RE.exec(input.time_of_day);
            if (!m)
                throw new Error(`Invalid time_of_day "${input.time_of_day}" (need HH:MM 24-hour)`);
            return { cron_expression: `${Number(m[2])} ${Number(m[1])} * * *` };
        }
        case 'weekly': {
            if (input.weekday === null) throw new Error('weekly preset requires weekday');
            const m = TIME_RE.exec(input.time_of_day);
            if (!m)
                throw new Error(`Invalid time_of_day "${input.time_of_day}" (need HH:MM 24-hour)`);
            return { cron_expression: `${Number(m[2])} ${Number(m[1])} * * ${input.weekday}` };
        }
        case 'custom': {
            const expr = input.cron_expression.trim();
            try {
                // croner throws on invalid expressions
                new Cron(expr, { paused: true });
            } catch (e) {
                throw new Error(
                    `Invalid cron expression: ${e instanceof Error ? e.message : String(e)}`
                );
            }
            return { cron_expression: expr };
        }
    }
}
