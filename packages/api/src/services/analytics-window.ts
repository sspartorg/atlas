import { sql } from 'kysely';
import type { AnalyticsWindow, IAnalyticsPeriod, IAnalyticsTrend } from '@atlas/shared';
import { db } from '../db/kysely-client.js';
import { iso } from './agent-scorecard.js';

// Allow `Area/Location` style IANA names plus UTC. Anything else falls back to UTC.
const TZ_RE = /^[A-Za-z_+\-/]{1,64}$/;

export function normalizeTz(raw: unknown): string {
    if (typeof raw !== 'string' || !TZ_RE.test(raw)) return 'UTC';
    // A well-formed but unknown zone would otherwise reach Postgres as a 500.
    try {
        new Intl.DateTimeFormat('en-GB', { timeZone: raw });
        return raw;
    } catch {
        return 'UTC';
    }
}

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

/**
 * Agent-test runs (`items.is_test`) are left out of spend, as they are of
 * every other Analytics number — and of the Dashboard's month spend, so the
 * two still agree. Their cost is on the agent's Tests tab. A run with no item
 * (a standalone agent run) is real spend and stays in.
 */
export function notTestRun(itemIdColumn: string) {
    return sql<boolean>`NOT EXISTS (SELECT 1 FROM items ti WHERE ti.id = ${sql.ref(itemIdColumn)} AND ti.is_test)`;
}

/** Zero-filled bucket keys (`YYYY-MM-DD`, Monday for weeks) across a window, in the viewer's tz. */
export async function windowBuckets(period: IAnalyticsPeriod): Promise<string[]> {
    const { tz, start, end, bucket: unit } = period;
    const r = await sql<{ bucket: string }>`
        SELECT to_char(d, 'YYYY-MM-DD') AS bucket
          FROM generate_series(
                   date_trunc(${unit}, ${start}::timestamptz AT TIME ZONE ${tz}),
                   ${end}::timestamptz AT TIME ZONE ${tz},
                   ('1 ' || ${unit})::interval) d
    `.execute(db);
    return r.rows.map((x) => x.bucket);
}

/** The bucket a timestamp falls in, in `tz`: the key Postgres `date_trunc(unit, at AT TIME ZONE tz)` gives. */
export function bucketKey(at: string | Date, tz: string, unit: 'day' | 'week'): string {
    const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
        new Date(at),
    );
    if (unit === 'day') return ymd;
    const [y, m, d] = ymd.split('-').map(Number);
    const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
    dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
    return dt.toISOString().slice(0, 10);
}

type BucketFacts = Record<string, Array<{ bucket: string }>>;

/** Every fact list cut down to one bucket, so a metric reads per bucket with the same code. */
function sliceFacts<F extends BucketFacts>(facts: F, bucket: string): F {
    return Object.fromEntries(Object.entries(facts).map(([k, rows]) => [k, rows.filter((r) => r.bucket === bucket)])) as F;
}

/**
 * A metric over this window, the previous one, and each bucket of this one,
 * from one function, so a tile, its delta and its sparkline cannot disagree.
 */
export function trendOf<F extends BucketFacts>(
    cur: F,
    prev: F,
    buckets: string[],
    metric: (f: F) => number | null,
): IAnalyticsTrend {
    return { cur: metric(cur), prev: metric(prev), series: buckets.map((b) => metric(sliceFacts(cur, b))) };
}

export const ratio = (n: number, d: number): number | null => (d === 0 ? null : n / d);
