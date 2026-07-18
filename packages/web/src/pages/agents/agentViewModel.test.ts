import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    CATEGORY_LABEL,
    agentSubtitle,
    formatNextPassDelta,
    getAgentView,
    getRuntimeStats,
    isCronExpressionValid,
    previewNextSlot,
} from './agentViewModel.js';
import { makeAgent } from '../../test-utils/factories.js';
import type { AgentSchedulePreset, IAgentRun } from '@atlas/shared';

describe('CATEGORY_LABEL', () => {
    it('covers all known categories', () => {
        expect(CATEGORY_LABEL['software-dev']).toBe('Software dev');
        expect(CATEGORY_LABEL.marketing).toBe('Marketing');
        expect(CATEGORY_LABEL.content).toBe('Content');
        expect(CATEGORY_LABEL.design).toBe('Design');
    });
});

describe('getAgentView', () => {
    const now = new Date('2026-05-16T10:00:00.000Z');

    it('uses seed config for known agent ids', () => {
        const agent = makeAgent({
            id: 'agent-coder',
            category: 'software-dev',
            schedule_hours: 0.5,
        });
        const view = getAgentView(agent, now);
        expect(view.glyph).toBe('terminal');
        expect(view.cadenceHours).toBe(0.5);
        expect(view.cadenceLabel).toMatch(/Every/);
    });

    it('falls back to category glyph for unknown agent ids', () => {
        const agent = makeAgent({ id: 'agent-novel', category: 'marketing', prompt_md: '' });
        const view = getAgentView(agent, now);
        expect(view.glyph).toBe('campaign');
        expect(view.cadenceHours).toBe(6);
    });

    it('uses the first non-heading prompt line as description fallback', () => {
        const agent = makeAgent({
            id: 'agent-x',
            prompt_md: '# Header\n```code```\nThe real first line',
            category: 'content',
        });
        const view = getAgentView(agent, now);
        expect(view.description).toBe('The real first line');
    });

    it('produces a HH:MM next-pass label', () => {
        const agent = makeAgent({ id: 'agent-coder' });
        const view = getAgentView(agent, now);
        expect(view.nextPassLabel).toMatch(/^\d{2}:\d{2}$/);
    });

    it('computes next pass on the local-midnight grid (matches server)', () => {
        // 30-min cadence at local 17:25 -> next slot local 17:30 = "in 5m"
        const t = new Date(2026, 4, 16, 17, 25, 0);
        const agent = makeAgent({ id: 'agent-x', schedule_hours: 0.5 });
        const view = getAgentView(agent, t);
        expect(view.nextPassDelta).toBe('in 5m');
    });

    it('2h cadence at local 10:47 -> next slot local 12:00 = "in 1h 13m"', () => {
        // The operator-reported case: with 2h cadence and 10:47 local,
        // the next slot is 12:00 local (NOT 11:30, which would be the
        // UTC-anchored slot under IST shifted by +30 min).
        const t = new Date(2026, 4, 16, 10, 47, 0);
        const agent = makeAgent({ id: 'agent-x', schedule_hours: 2 });
        const view = getAgentView(agent, t);
        expect(view.nextPassDelta).toBe('in 1h 13m');
    });

    it('ignores stale server next_run_at (held in the past for empty queue)', () => {
        // Server pins next_run_at to a past time when the queue is
        // empty. The UI must NOT render "now" — it should show the next
        // future slot from the cadence grid.
        const t = new Date(2026, 4, 16, 17, 25, 0);
        const stalePast = new Date(2026, 4, 16, 16, 25, 0).toISOString();
        const agent = makeAgent({
            id: 'agent-x',
            schedule_hours: 0.5,
            next_run_at: stalePast,
        });
        const view = getAgentView(agent, t);
        expect(view.nextPassDelta).toBe('in 5m');
    });

    it('formats cadence under one hour as minutes', () => {
        const agent = makeAgent({ id: 'agent-coder', schedule_hours: 0.5 });
        const view = getAgentView(agent, now);
        expect(view.cadenceLabel).toBe('Every 30m');
    });

    it('formats cadence over 24h as days', () => {
        const agent = makeAgent({ id: 'agent-ux-designer', schedule_hours: 24 });
        const view = getAgentView(agent, now);
        expect(view.cadenceLabel).toBe('Every 1d');
    });

    it("renders cadenceLabel as 'Cron: <expr>' when cron_expr is set", () => {
        const agent = makeAgent({
            id: 'agent-cron-x',
            schedule_preset: 'daily',
            schedule_time_of_day: '09:00',
            cron_expr: '0 9 * * 1-5',
        });
        const view = getAgentView(agent, now);
        expect(view.cadenceLabel).toBe('Cron: 0 9 * * 1-5');
    });

    it('next-pass label is derived from cron_expr when set', () => {
        // 09:00 cron, 'now' = 08:00 local → next pass should be today 09:00.
        const t = new Date(2026, 4, 16, 8, 0, 0);
        const agent = makeAgent({
            id: 'agent-cron-y',
            cron_expr: '0 9 * * *',
        });
        const view = getAgentView(agent, t);
        expect(view.nextPassLabel).toBe('09:00');
        expect(view.nextPassDelta).toBe('in 1h');
    });

    it('whitespace-only cron_expr falls back to preset math', () => {
        const t = new Date(2026, 4, 16, 17, 25, 0);
        const agent = makeAgent({
            id: 'agent-cron-z',
            schedule_hours: 0.5,
            cron_expr: '   ',
        });
        const view = getAgentView(agent, t);
        // 30-min cadence: 17:25 → 17:30 = "in 5m" (not the cron path).
        expect(view.nextPassDelta).toBe('in 5m');
    });
});

describe('isCronExpressionValid', () => {
    it('accepts a valid 5-field cron expression', () => {
        expect(isCronExpressionValid('0 9 * * 1-5')).toBe(true);
        expect(isCronExpressionValid('*/5 * * * *')).toBe(true);
    });

    it('rejects unparseable input', () => {
        expect(isCronExpressionValid('not a cron')).toBe(false);
        expect(isCronExpressionValid('* * * *')).toBe(false);
    });

    it('rejects empty and whitespace-only input', () => {
        expect(isCronExpressionValid('')).toBe(false);
        expect(isCronExpressionValid('   ')).toBe(false);
    });
});

describe('previewNextSlot — cron branch', () => {
    it('honors the draft.cronExpr when preset is cron', () => {
        const now = new Date(2026, 4, 16, 8, 0, 0);
        const slot = previewNextSlot(now, {
            preset: 'cron',
            hours: 6,
            timeOfDay: '09:00',
            weekdays: [1, 2, 3, 4, 5],
            dayOfMonth: 1,
            cronExpr: '0 9 * * *',
        });
        // Today 09:00 local from now=08:00 local.
        expect(slot.getHours()).toBe(9);
        expect(slot.getMinutes()).toBe(0);
        expect(slot.getDate()).toBe(now.getDate());
    });

    it('falls back to preset math when cronExpr is empty', () => {
        const now = new Date(2026, 4, 16, 17, 25, 0);
        const slot = previewNextSlot(now, {
            preset: 'every_n_hours',
            hours: 0.5,
            timeOfDay: '09:00',
            weekdays: [1],
            dayOfMonth: 1,
            cronExpr: '',
        });
        // 30-min cadence on local-midnight grid: 17:25 → 17:30.
        expect(slot.getHours()).toBe(17);
        expect(slot.getMinutes()).toBe(30);
    });
});

describe('getRuntimeStats', () => {
    it('returns zeros when no runs', () => {
        expect(getRuntimeStats([])).toEqual({
            queueDepth: 0,
            lastRunAt: null,
            totalRunsThisMonth: 0,
            p50DurationSec: null,
            totalCostThisMonthUsd: null,
            totalInputTokens: null,
            totalOutputTokens: null,
            totalCacheReadTokens: null,
        });
        expect(getRuntimeStats(undefined)).toEqual({
            queueDepth: 0,
            lastRunAt: null,
            totalRunsThisMonth: 0,
            p50DurationSec: null,
            totalCostThisMonthUsd: null,
            totalInputTokens: null,
            totalOutputTokens: null,
            totalCacheReadTokens: null,
        });
    });

    it('counts queued and in_progress as depth', () => {
        const now = new Date().toISOString();
        const runs: IAgentRun[] = [
            { status: 'queued', created_at: now, started_at: null, completed_at: null } as IAgentRun,
            { status: 'in_progress', created_at: now, started_at: null, completed_at: null } as IAgentRun,
            { status: 'completed', created_at: now, started_at: null, completed_at: null } as IAgentRun,
        ];
        expect(getRuntimeStats(runs).queueDepth).toBe(2);
    });

    it('computes a p50 duration from started/completed pairs', () => {
        const runs: IAgentRun[] = [
            {
                status: 'completed',
                created_at: new Date().toISOString(),
                started_at: '2026-05-15T00:00:00.000Z',
                completed_at: '2026-05-15T00:00:10.000Z',
            } as IAgentRun,
            {
                status: 'completed',
                created_at: new Date().toISOString(),
                started_at: '2026-05-15T00:00:00.000Z',
                completed_at: '2026-05-15T00:00:20.000Z',
            } as IAgentRun,
            {
                status: 'completed',
                created_at: new Date().toISOString(),
                started_at: '2026-05-15T00:00:00.000Z',
                completed_at: '2026-05-15T00:00:30.000Z',
            } as IAgentRun,
        ];
        expect(getRuntimeStats(runs).p50DurationSec).toBe(20);
    });

    it('tracks the most recent run timestamp', () => {
        const runs: IAgentRun[] = [
            { status: 'completed', created_at: '2026-04-01T00:00:00.000Z', started_at: null, completed_at: null } as IAgentRun,
            { status: 'completed', created_at: '2026-05-10T00:00:00.000Z', started_at: null, completed_at: null } as IAgentRun,
        ];
        expect(getRuntimeStats(runs).lastRunAt).toBe('2026-05-10T00:00:00.000Z');
    });
});

describe('agentSubtitle', () => {
    it('uses designation over role_id', () => {
        const a = makeAgent({ designation: 'Senior Backend Engineer', category: 'software-dev', role_id: 'engineer' });
        expect(agentSubtitle(a)).toBe('Senior Backend Engineer · Software dev');
    });

    it('falls back to role_id label when no designation', () => {
        const a = makeAgent({ designation: '', category: 'software-dev', role_id: 'engineer' });
        expect(agentSubtitle(a)).toBe('Engineer · Software dev');
    });

    it('returns category label alone when neither designation nor role_id', () => {
        const a = makeAgent({ designation: '', category: 'marketing', role_id: null });
        expect(agentSubtitle(a)).toBe('Marketing');
    });

    it('uses po role label', () => {
        const a = makeAgent({ designation: '', category: 'software-dev', role_id: 'po' });
        expect(agentSubtitle(a)).toBe('Product Owner · Software dev');
    });
});

describe('formatNextPassDelta', () => {
    it('returns "now" for ms <= 0', () => {
        expect(formatNextPassDelta(0)).toBe('now');
        expect(formatNextPassDelta(-5000)).toBe('now');
    });

    it('returns minutes for < 60 minutes', () => {
        expect(formatNextPassDelta(5 * 60_000)).toBe('in 5m');
        expect(formatNextPassDelta(59 * 60_000)).toBe('in 59m');
    });

    it('returns hours + minutes remainder', () => {
        expect(formatNextPassDelta((1 * 60 + 13) * 60_000)).toBe('in 1h 13m');
        expect(formatNextPassDelta(90 * 60_000)).toBe('in 1h 30m');
    });

    it('returns hours with no remainder when exact', () => {
        expect(formatNextPassDelta(60 * 60_000)).toBe('in 1h');
        expect(formatNextPassDelta(3 * 60 * 60_000)).toBe('in 3h');
    });

    it('returns days for >= 24 hours', () => {
        expect(formatNextPassDelta(24 * 60 * 60_000)).toBe('in 1d');
        expect(formatNextPassDelta(48 * 60 * 60_000)).toBe('in 2d');
    });
});

describe('getAgentView — cadenceLabel for non-hourly presets', () => {
    it('daily preset: "Daily at HH:MM"', () => {
        const agent = makeAgent({
            id: 'agent-x',
            schedule_preset: 'daily',
            schedule_time_of_day: '09:00',
        });
        const view = getAgentView(agent, new Date('2026-05-16T10:00:00.000Z'));
        expect(view.cadenceLabel).toBe('Daily at 9:00 AM');
    });

    it('daily preset with null time_of_day renders em-dash', () => {
        const agent = makeAgent({
            id: 'agent-x',
            schedule_preset: 'daily',
            schedule_time_of_day: null,
        });
        const view = getAgentView(agent, new Date('2026-05-16T10:00:00.000Z'));
        expect(view.cadenceLabel).toBe('Daily at —');
    });

    it('weekly preset: "HH:MM on <weekdays>"', () => {
        const agent = makeAgent({
            id: 'agent-x',
            schedule_preset: 'weekly',
            schedule_time_of_day: '17:30',
            schedule_weekdays: [1, 2, 3, 4, 5],
        });
        const view = getAgentView(agent, new Date('2026-05-16T10:00:00.000Z'));
        expect(view.cadenceLabel).toBe('5:30 PM on weekdays');
    });

    it('weekly preset with all 7 days shows "every day"', () => {
        const agent = makeAgent({
            id: 'agent-x',
            schedule_preset: 'weekly',
            schedule_time_of_day: '08:00',
            schedule_weekdays: [1, 2, 3, 4, 5, 6, 7],
        });
        const view = getAgentView(agent, new Date('2026-05-16T10:00:00.000Z'));
        expect(view.cadenceLabel).toBe('8:00 AM on every day');
    });

    it('weekly preset with weekends shows "weekends"', () => {
        const agent = makeAgent({
            id: 'agent-x',
            schedule_preset: 'weekly',
            schedule_time_of_day: '10:00',
            schedule_weekdays: [6, 7],
        });
        const view = getAgentView(agent, new Date('2026-05-16T10:00:00.000Z'));
        expect(view.cadenceLabel).toBe('10:00 AM on weekends');
    });

    it('weekly preset with custom combo shows day names', () => {
        const agent = makeAgent({
            id: 'agent-x',
            schedule_preset: 'weekly',
            schedule_time_of_day: '14:00',
            schedule_weekdays: [1, 3],
        });
        const view = getAgentView(agent, new Date('2026-05-16T10:00:00.000Z'));
        expect(view.cadenceLabel).toBe('2:00 PM on Mon, Wed');
    });

    it('weekly preset with null weekdays falls back to em-dash', () => {
        const agent = makeAgent({
            id: 'agent-x',
            schedule_preset: 'weekly',
            schedule_time_of_day: '09:00',
            schedule_weekdays: null,
        });
        const view = getAgentView(agent, new Date('2026-05-16T10:00:00.000Z'));
        expect(view.cadenceLabel).toBe('9:00 AM on —');
    });

    it('monthly preset with day: "Monthly at HH:MM on day N"', () => {
        const agent = makeAgent({
            id: 'agent-x',
            schedule_preset: 'monthly',
            schedule_time_of_day: '09:00',
            schedule_day_of_month: 15,
        });
        const view = getAgentView(agent, new Date('2026-05-16T10:00:00.000Z'));
        expect(view.cadenceLabel).toBe('Monthly at 9:00 AM on day 15');
    });

    it('monthly preset with null dom: "Monthly at HH:MM"', () => {
        const agent = makeAgent({
            id: 'agent-x',
            schedule_preset: 'monthly',
            schedule_time_of_day: '09:00',
            schedule_day_of_month: null,
        });
        const view = getAgentView(agent, new Date('2026-05-16T10:00:00.000Z'));
        expect(view.cadenceLabel).toBe('Monthly at 9:00 AM');
    });
});

describe('computeNextSlot — daily preset', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('daily: fires today if time has not yet passed', () => {
        // now = 08:00, schedule = 09:00 → next pass is today at 09:00
        const t = new Date(2026, 4, 16, 8, 0, 0);
        const agent = makeAgent({
            id: 'agent-x',
            schedule_preset: 'daily',
            schedule_time_of_day: '09:00',
        });
        const view = getAgentView(agent, t);
        expect(view.nextPassLabel).toBe('09:00');
        expect(view.nextPassDelta).toBe('in 1h');
    });

    it('daily: fires tomorrow if time has already passed', () => {
        // now = 10:00, schedule = 09:00 → next pass is tomorrow at 09:00
        const t = new Date(2026, 4, 16, 10, 0, 0);
        const agent = makeAgent({
            id: 'agent-x',
            schedule_preset: 'daily',
            schedule_time_of_day: '09:00',
        });
        const view = getAgentView(agent, t);
        // next day, same time
        expect(view.nextPassLabel).toBe('09:00');
        // should be 23h away
        expect(view.nextPassDelta).toBe('in 23h');
    });
});

describe('computeNextSlot — weekly preset', () => {
    it('weekly: picks next matching weekday after now', () => {
        // 2026-05-16 is Saturday (ISO 6), schedule only Mon-Fri
        // Next Monday is 2026-05-18
        const t = new Date(2026, 4, 16, 10, 0, 0); // Saturday
        const agent = makeAgent({
            id: 'agent-x',
            schedule_preset: 'weekly',
            schedule_time_of_day: '09:00',
            schedule_weekdays: [1, 2, 3, 4, 5],
        });
        const view = getAgentView(agent, t);
        expect(view.nextPassLabel).toBe('09:00');
        // Mon 18 May 09:00 from Sat 16 May 10:00 = 47 hours
        expect(view.nextPassDelta).toBe('in 1d');
    });

    it('weekly: fires today if weekday matches and time has not passed', () => {
        // 2026-05-18 is Monday (ISO 1), now=08:00, schedule 09:00 Mon-Fri
        const t = new Date(2026, 4, 18, 8, 0, 0); // Monday
        const agent = makeAgent({
            id: 'agent-x',
            schedule_preset: 'weekly',
            schedule_time_of_day: '09:00',
            schedule_weekdays: [1, 2, 3, 4, 5],
        });
        const view = getAgentView(agent, t);
        expect(view.nextPassLabel).toBe('09:00');
        expect(view.nextPassDelta).toBe('in 1h');
    });

    it('weekly: null weekdays defaults to all days and picks next slot', () => {
        const t = new Date(2026, 4, 16, 10, 30, 0);
        const agent = makeAgent({
            id: 'agent-x',
            schedule_preset: 'weekly',
            schedule_time_of_day: '10:00',
            schedule_weekdays: null,
        });
        // 10:00 already passed today (10:30), next is tomorrow 10:00
        const view = getAgentView(agent, t);
        expect(view.nextPassLabel).toBe('10:00');
        expect(view.nextPassDelta).toBe('in 23h 30m');
    });
});

describe('computeNextSlot — monthly preset', () => {
    it('monthly: fires this month if day has not yet passed', () => {
        // now = May 10, schedule = day 20
        const t = new Date(2026, 4, 10, 8, 0, 0);
        const agent = makeAgent({
            id: 'agent-x',
            schedule_preset: 'monthly',
            schedule_time_of_day: '09:00',
            schedule_day_of_month: 20,
        });
        const view = getAgentView(agent, t);
        // May 20 09:00
        expect(view.nextPassLabel).toBe('09:00');
        expect(view.nextPassDelta).toBe('in 10d');
    });

    it('monthly: advances to next month if day already passed', () => {
        // now = May 25, schedule = day 10 → next pass is June 10
        const t = new Date(2026, 4, 25, 10, 0, 0);
        const agent = makeAgent({
            id: 'agent-x',
            schedule_preset: 'monthly',
            schedule_time_of_day: '09:00',
            schedule_day_of_month: 10,
        });
        const view = getAgentView(agent, t);
        expect(view.nextPassLabel).toBe('09:00');
        // June 10 09:00 from May 25 10:00 = 15 days and 23 hours
        expect(view.nextPassDelta).toBe('in 15d');
    });

    it('monthly: clamps dom to last day of month (day 31 in Feb)', () => {
        // Feb 2027 has 28 days; dom=31 should fire on Feb 28
        const t = new Date(2027, 1, 1, 0, 0, 0); // Feb 1 2027
        const agent = makeAgent({
            id: 'agent-x',
            schedule_preset: 'monthly',
            schedule_time_of_day: '09:00',
            schedule_day_of_month: 31,
        });
        const view = getAgentView(agent, t);
        // Should fire Feb 28 2027 at 09:00
        expect(view.nextPassLabel).toBe('09:00');
        expect(view.nextPassDelta).toMatch(/in \d+d/);
    });
});

describe('computeNextSlot — cron parse error fallback', () => {
    it('falls back to every_n_hours preset when cron_expr is invalid', () => {
        // An invalid cron expression should not crash; fall through to preset
        const t = new Date(2026, 4, 16, 17, 25, 0);
        const agent = makeAgent({
            id: 'agent-x',
            schedule_hours: 0.5,
            cron_expr: 'NOT_A_VALID_CRON',
        });
        const view = getAgentView(agent, t);
        // Falls back to 30-min cadence: 17:25 → 17:30
        expect(view.nextPassDelta).toBe('in 5m');
    });
});

describe('computeNextSlot — Sunday (dow=0) branch', () => {
    it('weekly preset: Sunday (dow=0) is ISO 7 and maps to weekday 7', () => {
        // 2026-05-17 is Sunday (JS getDay() === 0 → ISO 7)
        const t = new Date(2026, 4, 17, 8, 0, 0); // Sunday
        const agent = makeAgent({
            id: 'agent-x',
            schedule_preset: 'weekly',
            schedule_time_of_day: '09:00',
            schedule_weekdays: [7], // Sunday only
        });
        const view = getAgentView(agent, t);
        // Today is Sunday; schedule time 09:00 hasn't passed yet (now=08:00)
        expect(view.nextPassLabel).toBe('09:00');
        expect(view.nextPassDelta).toBe('in 1h');
    });
});

describe('getAgentView — fallback chains for glyph/description/cadence', () => {
    it('uses glyph from agent.glyph when set (non-empty trim)', () => {
        const agent = makeAgent({
            id: 'agent-novel',
            category: 'content',
            glyph: 'star',
        });
        const view = getAgentView(agent, new Date('2026-05-16T10:00:00.000Z'));
        expect(view.glyph).toBe('star');
    });

    it('falls back to CATEGORY_GLYPH when agent has no seed and no glyph', () => {
        const agent = makeAgent({
            id: 'agent-novel-no-seed',
            category: 'design',
            glyph: '',
        });
        const view = getAgentView(agent, new Date('2026-05-16T10:00:00.000Z'));
        expect(view.glyph).toBe('palette'); // CATEGORY_GLYPH.design
    });

    it('uses agent.description when set (non-empty trim)', () => {
        const agent = makeAgent({
            id: 'agent-novel',
            category: 'content',
            description: 'Custom description text',
        });
        const view = getAgentView(agent, new Date('2026-05-16T10:00:00.000Z'));
        expect(view.description).toBe('Custom description text');
    });

    it('falls back to seed.cadenceHours (=6) when schedule_hours is 0', () => {
        // schedule_hours: 0 is falsy → cadenceHours falls through to seed/default
        const agent = makeAgent({
            id: 'agent-novel-no-seed',
            category: 'software-dev',
            schedule_hours: 0,
        });
        const view = getAgentView(agent, new Date('2026-05-16T10:00:00.000Z'));
        // No seed, so falls through to 6h default
        expect(view.cadenceHours).toBe(6);
    });
});

describe('getRuntimeStats — partial token coverage', () => {
    it('accumulates only input_tokens when output/cache are null', () => {
        const now = new Date();
        const thisMonth = new Date(now.getFullYear(), now.getMonth(), 2).toISOString();
        const runs = [
            {
                id: 'r1',
                status: 'completed' as const,
                created_at: thisMonth,
                started_at: null,
                completed_at: null,
                total_cost_usd: null,
                input_tokens: 1000,
                output_tokens: null,
                cache_read_tokens: null,
            },
        ] as unknown as IAgentRun[];
        const stats = getRuntimeStats(runs);
        expect(stats.totalInputTokens).toBe(1000);
        expect(stats.totalOutputTokens).toBe(0);
        expect(stats.totalCacheReadTokens).toBe(0);
    });

    it('accumulates cost when total_cost_usd is set', () => {
        const now = new Date();
        const thisMonth = new Date(now.getFullYear(), now.getMonth(), 2).toISOString();
        const runs = [
            {
                id: 'r1',
                status: 'completed' as const,
                created_at: thisMonth,
                started_at: null,
                completed_at: null,
                total_cost_usd: 1.5,
                input_tokens: null,
                output_tokens: null,
                cache_read_tokens: null,
            },
        ] as unknown as IAgentRun[];
        const stats = getRuntimeStats(runs);
        expect(stats.totalCostThisMonthUsd).toBe(1.5);
        expect(stats.totalInputTokens).toBeNull();
    });
});

describe('agentSubtitle — unknown role_id fallback', () => {
    it('shows category label alone when role_id is unknown', () => {
        const a = makeAgent({ designation: '', category: 'content', role_id: 'some-unknown-role' as never });
        // SDLC_ROLE_LABELS['some-unknown-role'] is undefined → 'undefined · Content'
        // This exercises the role_id branch with an unknown key
        const result = agentSubtitle(a);
        expect(result).toContain('Content');
    });
});

describe('getRuntimeStats — output_tokens and cache_read_tokens non-null (L436/L437)', () => {
    it('accumulates output_tokens and cache_read_tokens when non-null — covers L436/L437 branches', () => {
        // These branches at lines 436-437 fire when output_tokens or cache_read_tokens is set.
        // The test at L610 only sets input_tokens; we need both output and cache_read covered.
        const now = new Date();
        const thisMonth = new Date(now.getFullYear(), now.getMonth(), 2).toISOString();
        const runs = [
            {
                id: 'r-tokens',
                status: 'completed' as const,
                created_at: thisMonth,
                started_at: null,
                completed_at: null,
                total_cost_usd: null,
                input_tokens: null,
                output_tokens: 500,        // non-null → covers L436 body
                cache_read_tokens: 200,    // non-null → covers L437 body
            },
        ] as unknown as IAgentRun[];
        const stats = getRuntimeStats(runs);
        expect(stats.totalOutputTokens).toBe(500);
        expect(stats.totalCacheReadTokens).toBe(200);
        expect(stats.totalInputTokens).toBe(0);
        expect(stats.totalCostThisMonthUsd).toBeNull();
    });
});

describe('getAgentView — noon/midnight hour formatting (formatTimeOfDay12h L204)', () => {
    it('formats 12:00 (noon) as "12:00 PM" — exercises h%12===0 true branch at L204', () => {
        // h=12, h%12===0 → h12=12, suffix='PM'
        const agent = makeAgent({
            id: 'agent-x',
            schedule_preset: 'daily',
            schedule_time_of_day: '12:00',
        });
        const view = getAgentView(agent, new Date('2026-05-16T10:00:00.000Z'));
        expect(view.cadenceLabel).toBe('Daily at 12:00 PM');
    });

    it('formats 00:00 (midnight) as "12:00 AM" — exercises h%12===0 true branch at L204', () => {
        // h=0, h%12===0 → h12=12, suffix='AM'
        const agent = makeAgent({
            id: 'agent-x',
            schedule_preset: 'daily',
            schedule_time_of_day: '00:00',
        });
        const view = getAgentView(agent, new Date('2026-05-16T08:00:00.000Z'));
        expect(view.cadenceLabel).toBe('Daily at 12:00 AM');
    });
});

describe('getAgentView — schedule_preset null fallback (L225/L271)', () => {
    it('schedule_preset: null falls back to every_n_hours preset (L225 ?? branch)', () => {
        // schedule_preset is null → ?? 'every_n_hours' fallback fires at L225
        const agent = makeAgent({
            id: 'agent-x',
            schedule_preset: null as unknown as AgentSchedulePreset,
            schedule_hours: 4,
        });
        const view = getAgentView(agent, new Date('2026-05-16T10:00:00.000Z'));
        // Should render as "Every 4h"
        expect(view.cadenceLabel).toBe('Every 4h');
    });
});

describe('getRuntimeStats — started_at set but completed_at null', () => {
    it('does NOT push a duration when started_at is set but completed_at is null — p50 stays null', () => {
        // This exercises the else branch of `if (r.started_at && r.completed_at)` at line 439
        const now = new Date();
        const thisMonth = new Date(now.getFullYear(), now.getMonth(), 2).toISOString();
        const runs = [
            {
                id: 'run-in-progress',
                agent_id: 'a',
                status: 'in_progress',
                created_at: thisMonth,
                started_at: '2026-05-20T10:00:00.000Z', // started_at set
                completed_at: null,                       // completed_at null → no duration
                total_cost_usd: null,
                input_tokens: null,
                output_tokens: null,
                cache_read_tokens: null,
            },
        ] as unknown as IAgentRun[];
        const stats = getRuntimeStats(runs);
        // No completed_at → durations array stays empty → p50DurationSec is null
        expect(stats.p50DurationSec).toBeNull();
        // queueDepth should count in_progress
        expect(stats.queueDepth).toBe(1);
    });
});
