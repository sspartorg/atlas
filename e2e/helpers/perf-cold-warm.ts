import type { Page, BrowserContext } from '@playwright/test';
import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { PerfRecord } from './perf.js';
import { gotoWithPerf } from './perf.js';

// W7 chunk 1 — cold/warm navigation helpers.
//
// Cold navigation: clears cookies + browser caches before navigating so
// every asset and API response is fetched from scratch (models the first
// visit in a fresh browser / after logout).
//
// Warm navigation: visits the page once to populate React Query's
// in-memory cache + the browser HTTP cache, then navigates away and
// back.  This models the typical intra-session navigation pattern where
// the user has already visited the page at least once.
//
// TTI approximation: the Navigation Timing `load_ms` is used as the
// TTI proxy because the real TTI (time until the main thread is idle
// and all above-the-fold content is interactive) is not directly
// observable from Playwright without a Lighthouse run.  `load_ms` is
// the conservative upper bound — it fires after all sub-resources have
// been loaded, which in a SPA correlates strongly with the initial
// React-render + API fan-out completing.

export interface ColdWarmRecord {
    path: string;
    variant: 'cold' | 'warm';
    perf: PerfRecord;
    tti_proxy_ms: number;
}

const COLD_WARM_LOG = 'e2e-logs/cold-warm-baseline.ndjson';

function appendColdWarmRecord(record: ColdWarmRecord): void {
    const file = process.env['ATLAS_COLD_WARM_LOG'] ?? COLD_WARM_LOG;
    if (!existsSync(dirname(file))) mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(record)}\n`);
}

async function clearCaches(page: Page, context: BrowserContext): Promise<void> {
    // Clear cookies via the context API.
    await context.clearCookies();
    // Clear the browser HTTP cache + application caches via CDP.
    // Playwright exposes `page.evaluate` so we can reach window.caches.
    await page.evaluate(async () => {
        if (typeof caches !== 'undefined') {
            const keys = await caches.keys();
            await Promise.all(keys.map((k) => caches.delete(k)));
        }
        // Clear sessionStorage and localStorage to remove any cached
        // React Query persistence (if a persister is wired up) and any
        // route-level stored state.
        try {
            sessionStorage.clear();
        } catch {
            // cross-origin frames may throw; ignore
        }
        try {
            localStorage.clear();
        } catch {
            // same
        }
    }).catch(() => {
        // page may not be at an origin yet (blank page); safe to ignore.
    });
}

export async function gotoWithPerfCold(
    page: Page,
    context: BrowserContext,
    path: string,
): Promise<ColdWarmRecord> {
    await clearCaches(page, context);
    // Navigate to a blank page first so cache-clearing applies before
    // the target page's request lifecycle begins.
    await page.goto('about:blank').catch(() => {});
    await clearCaches(page, context);
    const perf = await gotoWithPerf(page, path);
    const record: ColdWarmRecord = {
        path,
        variant: 'cold',
        perf,
        tti_proxy_ms: perf.nav_timing.load_ms,
    };
    appendColdWarmRecord(record);
    return record;
}

export async function gotoWithPerfWarm(
    page: Page,
    context: BrowserContext,
    path: string,
): Promise<ColdWarmRecord> {
    // First visit — populates React Query in-memory cache + browser HTTP cache.
    await gotoWithPerf(page, path);
    // Navigate away briefly to force a full re-render on second visit.
    await page.goto('about:blank').catch(() => {});
    // Second visit — warm.
    const perf = await gotoWithPerf(page, path);
    const record: ColdWarmRecord = {
        path,
        variant: 'warm',
        perf,
        tti_proxy_ms: perf.nav_timing.load_ms,
    };
    appendColdWarmRecord(record);
    return record;
}
