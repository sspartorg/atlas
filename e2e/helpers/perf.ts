import type { Page, Request, Response } from '@playwright/test';
import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

// Audit 2026-06-09 — Playwright perf helper.
//
// `gotoWithPerf(page, path)` wraps a navigation, captures:
//   - per-request: method, url, status, duration, resourceType
//   - per-page Web Vitals from console.info(JSON.stringify({tag:'atlas:web-vitals',...}))
//   - Navigation Timing API: TTFB, DOMContentLoaded, load
//   - request counts + total bytes
// and writes one ndjson record per navigation to e2e-logs/perf-baseline.ndjson.

interface NetworkRecord {
    url: string;
    method: string;
    status: number;
    duration_ms: number;
    resourceType: string;
    fromCache: boolean;
    bytes: number;
}

interface WebVitalsRecord {
    name: 'CLS' | 'FCP' | 'LCP' | 'TTFB' | 'INP';
    value: number;
    rating: 'good' | 'needs-improvement' | 'poor';
    delta: number;
    id: string;
    route: string;
}

interface NavTimingRecord {
    ttfb_ms: number;
    domContentLoaded_ms: number;
    load_ms: number;
}

export interface PerfRecord {
    captured_at: string;
    path: string;
    title: string;
    nav_timing: NavTimingRecord;
    web_vitals: WebVitalsRecord[];
    requests: NetworkRecord[];
    request_count: number;
    api_request_count: number;
    total_bytes: number;
}

const PERF_LOG = 'e2e-logs/perf-baseline.ndjson';

function appendPerfRecord(record: PerfRecord): void {
    const file = process.env['ATLAS_PERF_LOG'] ?? PERF_LOG;
    if (!existsSync(dirname(file))) mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(record)}\n`);
}

export async function gotoWithPerf(page: Page, path: string): Promise<PerfRecord> {
    const requests: NetworkRecord[] = [];
    const webVitals: WebVitalsRecord[] = [];

    const inFlight = new Map<Request, number>();
    const onRequest = (req: Request) => {
        inFlight.set(req, Date.now());
    };
    const onResponse = async (res: Response) => {
        const req = res.request();
        const start = inFlight.get(req) ?? Date.now();
        let bytes = 0;
        try {
            const body = await res.body();
            bytes = body.length;
        } catch {
            // body() throws when the response is still streaming, on
            // redirect-only responses, or when the network ended mid-flight.
            // Recording 0 bytes is fine — the request count and timing
            // are still useful and most pages have only a handful of
            // such cases.
        }
        requests.push({
            url: res.url(),
            method: req.method(),
            status: res.status(),
            duration_ms: Date.now() - start,
            resourceType: req.resourceType(),
            fromCache: res.fromServiceWorker(),
            bytes,
        });
        inFlight.delete(req);
    };
    const onConsole = (msg: { type(): string; text(): string }) => {
        if (msg.type() !== 'info' && msg.type() !== 'log') return;
        const text = msg.text();
        if (!text.includes('atlas:web-vitals')) return;
        try {
            const parsed = JSON.parse(text) as { tag?: string } & WebVitalsRecord;
            if (parsed.tag === 'atlas:web-vitals') webVitals.push(parsed);
        } catch {
            // Ignore — console message wasn't a clean JSON line; the
            // page may have logged debug noise around the same time.
        }
    };

    page.on('request', onRequest);
    page.on('response', onResponse);
    page.on('console', onConsole);

    try {
        // `waitUntil: 'load'` resolves on the window `load` event, not
        // network-idle. The SSE long-poll (`/api/events`) keeps a
        // persistent connection open from React mount onward, so
        // `networkidle` would never fire and the test would time out.
        await page.goto(path, { waitUntil: 'load' });
        // Soft-wait for the initial API fan-out + LCP/INP observers
        // to flush. 2000 ms is enough on the local stack to capture
        // the mount-time fetches that follow `load` (most pages do
        // 4-8 GETs in this window) without padding wall-clock too much.
        // We do NOT fail if the page is still busy after 2 s —
        // perf-baseline is best-effort observation, not a gate.
        await page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {
            // SSE keeps the connection open; networkidle is expected
            // to time out. The 2 s wall-clock already covered the
            // initial fetches we need.
        });
    } finally {
        page.off('request', onRequest);
        page.off('response', onResponse);
        page.off('console', onConsole);
    }

    const navTiming = await page.evaluate((): NavTimingRecord => {
        const nav = performance.getEntriesByType('navigation')[0] as
            | PerformanceNavigationTiming
            | undefined;
        if (!nav) {
            return { ttfb_ms: 0, domContentLoaded_ms: 0, load_ms: 0 };
        }
        return {
            ttfb_ms: Math.round(nav.responseStart - nav.requestStart),
            domContentLoaded_ms: Math.round(
                nav.domContentLoadedEventEnd - nav.startTime,
            ),
            load_ms: Math.round(nav.loadEventEnd - nav.startTime),
        };
    });

    const title = await page.title();
    const totalBytes = requests.reduce((sum, r) => sum + r.bytes, 0);
    const apiRequestCount = requests.filter((r) => r.url.includes('/api/')).length;

    const record: PerfRecord = {
        captured_at: new Date().toISOString(),
        path,
        title,
        nav_timing: navTiming,
        web_vitals: webVitals,
        requests,
        request_count: requests.length,
        api_request_count: apiRequestCount,
        total_bytes: totalBytes,
    };

    appendPerfRecord(record);
    return record;
}
