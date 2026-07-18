// W4 — in-memory per-route timing registry.
//
// The Fastify onResponse hook in `server.ts` (`installPerfHook`) calls
// `recordTiming(routeTemplate, method, statusCode, durationMs)` for
// every request. We keep a bounded ring buffer per route+method so we
// can serve p50 / p95 / p99 stats from `GET /api/_perf/routes` without
// pulling logs.
//
// Route templates (e.g. `/api/epics/:id`) are used as the aggregation
// key, not the concrete URL — the Fastify router surfaces this on
// `req.routeOptions.url` at onResponse time. When it isn't available
// (404, static assets), we fall back to `<UNKNOWN>` so the registry
// stays finite even under adversarial URLs.
//
// Bounded, dev-friendly:
//   - Fixed 500-sample window per (route, method). O(1) insert, O(n log n)
//     percentile compute (n≤500) — cheap even with 10k unique routes.
//   - Total distinct-key cap of 2000 prevents unbounded growth under
//     dynamic routes; oldest key evicted when the cap is hit.
//   - `reset()` clears the registry (used in tests and to zero stats
//     between measurement passes).

const SAMPLE_WINDOW = 500;
const MAX_KEYS = 2000;

interface RouteStat {
    method: string;
    routeTemplate: string;
    samples: number[]; // rolling window of last SAMPLE_WINDOW durations (ms)
    count: number; // lifetime count since boot (not truncated)
    slowCount: number; // lifetime count of samples >= slow threshold (250ms default)
    lastStatus: number;
    lastSeenAt: number; // epoch ms
}

const registry = new Map<string, RouteStat>();

function keyOf(method: string, routeTemplate: string): string {
    return `${method} ${routeTemplate}`;
}

export function recordTiming(
    method: string,
    routeTemplate: string,
    statusCode: number,
    durationMs: number,
    slowThresholdMs = 250,
): void {
    const key = keyOf(method, routeTemplate || '<UNKNOWN>');
    let stat = registry.get(key);
    if (!stat) {
        // Cap eviction: drop the least-recently-seen route.
        if (registry.size >= MAX_KEYS) {
            let oldestKey: string | null = null;
            let oldestSeen = Infinity;
            for (const [k, s] of registry.entries()) {
                if (s.lastSeenAt < oldestSeen) {
                    oldestSeen = s.lastSeenAt;
                    oldestKey = k;
                }
            }
            // The loop always finds a finite lastSeenAt < Infinity on its
            // first iteration when registry.size >= MAX_KEYS (there's always
            // at least one entry), so oldestKey is never null here.
            /* v8 ignore next */
            if (oldestKey !== null) registry.delete(oldestKey);
        }
        stat = {
            method,
            routeTemplate: routeTemplate || '<UNKNOWN>',
            samples: [],
            count: 0,
            slowCount: 0,
            lastStatus: statusCode,
            lastSeenAt: Date.now(),
        };
        registry.set(key, stat);
    }
    stat.samples.push(durationMs);
    if (stat.samples.length > SAMPLE_WINDOW) {
        stat.samples.shift();
    }
    stat.count += 1;
    if (durationMs >= slowThresholdMs) stat.slowCount += 1;
    stat.lastStatus = statusCode;
    stat.lastSeenAt = Date.now();
}

function percentile(sortedAsc: number[], p: number): number {
    // percentile() is only ever called from readStats() after a `stat.samples
    // .length === 0` guard, so sortedAsc is never empty in practice.
    /* v8 ignore next */
    if (sortedAsc.length === 0) return 0;
    const rank = Math.ceil((p / 100) * sortedAsc.length);
    const idx = Math.max(0, Math.min(sortedAsc.length - 1, rank - 1));
    return sortedAsc[idx] as number;
}

export interface RouteStatSnapshot {
    method: string;
    route: string;
    count: number;
    slow_count: number;
    p50_ms: number;
    p95_ms: number;
    p99_ms: number;
    max_ms: number;
    last_status: number;
    last_seen_at: string; // ISO
}

export function readStats(): RouteStatSnapshot[] {
    const out: RouteStatSnapshot[] = [];
    for (const stat of registry.values()) {
        // Every stat in the registry was created by recordTiming(), which
        // always pushes a sample before returning — samples.length is never
        // 0 for a registered stat in practice.
        /* v8 ignore next */
        if (stat.samples.length === 0) continue;
        const sorted = [...stat.samples].sort((a, b) => a - b);
        out.push({
            method: stat.method,
            route: stat.routeTemplate,
            count: stat.count,
            slow_count: stat.slowCount,
            p50_ms: round2(percentile(sorted, 50)),
            p95_ms: round2(percentile(sorted, 95)),
            p99_ms: round2(percentile(sorted, 99)),
            max_ms: round2(sorted[sorted.length - 1] as number),
            last_status: stat.lastStatus,
            last_seen_at: new Date(stat.lastSeenAt).toISOString(),
        });
    }
    // Slowest first — the noisy ones are what an operator wants to see.
    out.sort((a, b) => b.p95_ms - a.p95_ms);
    return out;
}

function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

export function reset(): void {
    registry.clear();
}

// Exported for tests only.
export function _registrySize(): number {
    return registry.size;
}
