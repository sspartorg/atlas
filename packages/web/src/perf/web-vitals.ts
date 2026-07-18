// Audit 2026-06-09 — Web Vitals reporter.
//
// Off by default. Opt-in via `VITE_ATLAS_PERF=1` at vite startup
// (`VITE_ATLAS_PERF=1 pnpm dev` or the e2e:perf script). When on,
// CLS / FCP / LCP / TTFB / INP land in console.info with a stable
// `atlas:web-vitals` tag the Playwright perf helper grep-filters.
//
// We do NOT POST to the API. The console-tag approach keeps the
// instrumentation framework-free + lets the same hook serve devtools
// inspection during manual testing.

import type { Metric } from 'web-vitals';

interface WebVitalsRecord {
    tag: 'atlas:web-vitals';
    name: Metric['name'];
    value: number;
    rating: Metric['rating'];
    delta: number;
    id: string;
    route: string;
}

function reportMetric(metric: Metric): void {
    const record: WebVitalsRecord = {
        tag: 'atlas:web-vitals',
        name: metric.name,
        value: metric.value,
        rating: metric.rating,
        delta: metric.delta,
        id: metric.id,
        route: window.location.pathname,
    };
    console.info(JSON.stringify(record));
}

export async function initWebVitalsReporter(): Promise<void> {
    if (import.meta.env['VITE_ATLAS_PERF'] !== '1') return;
    const { onCLS, onFCP, onINP, onLCP, onTTFB } = await import('web-vitals');
    onCLS(reportMetric);
    onFCP(reportMetric);
    onINP(reportMetric);
    onLCP(reportMetric);
    onTTFB(reportMetric);
}
