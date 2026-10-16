import { sql } from 'kysely';
import type { AnalyticsWindow, IAnalyticsPeriod } from '@atlas/shared';
import { db } from '../db/kysely-client.js';
import { iso } from './agent-scorecard.js';

const DAYS: Record<Exclude<AnalyticsWindow, 'month'>, number> = { '7d': 7, '30d': 30, '90d': 90 };

/**
 * Resolve `?window=` into absolute bounds, computed in Postgres in the
 * viewer's tz so every bucket and boundary is the viewer's wall clock (the
 * month-boundary rule in `.agents/pages/30-analytics.md`).
 *
 * - `month`: this calendar month so far. Previous = the same number of days
 *   into last month (Postgres clamps Mar 31 to Feb 28), so a delta compares like
 *   with like instead of 16 days against a whole month.
 * - `Nd`: today plus the N-1 local days before it. Previous = the N days before.
 *
 * `now` is a parameter so tests can pin the clock.
 */
export async function resolveWindow(
    tz: string,
    window: AnalyticsWindow,
    now: Date = new Date(),
): Promise<IAnalyticsPeriod> {
    const n = now.toISOString();
    const days = window === 'month' ? 0 : DAYS[window];
    const res = await sql<{ start: unknown; prev_start: unknown; prev_end: unknown }>`
        WITH l AS (SELECT (${n}::timestamptz AT TIME ZONE ${tz}) AS ln),
        b AS (
            SELECT ln,
                   CASE WHEN ${window} = 'month' THEN date_trunc('month', ln)
                        ELSE date_trunc('day', ln) - make_interval(days => ${days} - 1) END AS ls
              FROM l
        )
        SELECT ls AT TIME ZONE ${tz} AS start,
               CASE WHEN ${window} = 'month' THEN (ls - interval '1 month') AT TIME ZONE ${tz}
                    ELSE (ls - make_interval(days => ${days})) AT TIME ZONE ${tz} END AS prev_start,
               CASE WHEN ${window} = 'month' THEN (ln - interval '1 month') AT TIME ZONE ${tz}
                    ELSE ls AT TIME ZONE ${tz} END AS prev_end
          FROM b
    `.execute(db);
    const row = res.rows[0];
    return {
        window,
        tz,
        bucket: window === '90d' ? 'week' : 'day',
        start: iso(row?.start) ?? n,
        end: n,
        previous_start: iso(row?.prev_start) ?? n,
        previous_end: iso(row?.prev_end) ?? n,
    };
}
