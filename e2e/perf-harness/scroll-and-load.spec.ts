import { test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { ROUTES, type PerfRoute } from './routes.js';

// Load + scroll + interaction cost of the heavy routes, on the large seed.
// Run through `playwright.perf.config.ts` against `scripts/perf-stack.sh up`.
// Writes e2e-logs/perf/<PERF_LABEL>.json; `scripts/perf-compare.mjs` diffs two.
//
// What each number means:
//   api_requests / api_kb   every /api/ response in the first settle (SSE excluded)
//   settle_ms               navigation start → 1s with no /api/ traffic
//   long_task_ms            main-thread time in tasks >50ms up to settle
//   scroll_p95_ms           95th-percentile frame time while scrolling the
//                           shell's scroller to the bottom, 150px per frame
//   scroll_janky_pct        share of those frames over 16.7ms (one 60Hz frame)
//   scroll_long_task_ms     main-thread time in tasks >50ms during the scroll
//   mid_scroll_text         text elements visible halfway down; 0 = blank list
//   (all of it under PERF_CPU_THROTTLE, default 4x CPU slowdown)
//   dom_nodes               element count after settling
//   interaction_ms          longest Event Timing entry for the route's one
//                           interaction (typing in a form), an INP stand-in

const PERF_ENABLED = process.env['PERF'] === '1';
const LABEL = process.env['PERF_LABEL'] ?? 'run';
// A dev Mac hides jank a mid-range laptop shows; 4x is Lighthouse's mobile setting.
const CPU_THROTTLE = Number(process.env['PERF_CPU_THROTTLE'] ?? '4');

interface RouteResult {
    name: string;
    path: string;
    api_requests: number;
    api_kb: number;
    settle_ms: number;
    long_task_ms: number;
    dom_nodes: number;
    scroll_frames: number;
    scroll_p95_ms: number;
    scroll_janky_pct: number;
    scroll_long_task_ms: number;
    mid_scroll_text: number;
    interaction_ms: number | null;
}

async function measure(page: Page, route: PerfRoute): Promise<RouteResult> {
    let apiBytes = 0;
    let apiCount = 0;
    let lastApi = Date.now();
    page.on('response', (res) => {
        const url = res.url();
        if (!url.includes('/api/') || url.includes('/api/events')) return;
        lastApi = Date.now();
        apiCount += 1;
        res.body().then(
            (b) => (apiBytes += b.length),
            () => undefined,
        );
    });

    await page.addInitScript((storage) => {
        for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v);
        const w = window as unknown as { __lt: number[]; __ev: number[] };
        w.__lt = [];
        w.__ev = [];
        new PerformanceObserver((list) => {
            for (const e of list.getEntries()) w.__lt.push(e.duration);
        }).observe({ type: 'longtask', buffered: true });
        new PerformanceObserver((list) => {
            for (const e of list.getEntries()) w.__ev.push(e.duration);
        }).observe({ type: 'event', buffered: true, durationThreshold: 16 } as PerformanceObserverInit);
    }, route.storage ?? {});

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });

    const start = Date.now();
    await page.goto(route.path, { waitUntil: 'load' });
    // Settled = 1s without /api/ traffic, capped at 30s.
    while (Date.now() - lastApi < 1000 && Date.now() - start < 30_000) await page.waitForTimeout(100);
    const settle = lastApi - start;

    if (route.prepare) {
        await route.prepare(page);
        await page.waitForTimeout(1500);
    }

    const before = await page.evaluate(() => {
        const w = window as unknown as { __lt: number[] };
        return { lt: w.__lt.reduce((a, b) => a + b, 0), n: w.__lt.length, dom: document.querySelectorAll('*').length };
    });

    // The shell scrolls an inner Box, not the window: pick the tallest
    // scrollable element, which is what a user's wheel actually moves.
    const scroll = await page.evaluate(async () => {
        const candidates = [...document.querySelectorAll<HTMLElement>('*')].filter((e) => {
            const s = getComputedStyle(e);
            return /(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 50;
        });
        candidates.sort((a, b) => b.scrollHeight - a.scrollHeight);
        const el = candidates[0] ?? document.scrollingElement;
        if (!el) return { frames: [] as number[], midText: -1 };
        // Leaf elements with text inside the visible part of the scroller:
        // 0 at mid-scroll means the list scrolled into blank space.
        const visibleText = () => {
            const box = el.getBoundingClientRect();
            let n = 0;
            for (const e of el.querySelectorAll<HTMLElement>('*')) {
                if (e.children.length || !e.textContent?.trim()) continue;
                const r = e.getBoundingClientRect();
                if (r.height && r.bottom > box.top && r.top < box.bottom) n += 1;
            }
            return n;
        };
        el.scrollTop = el.scrollHeight / 2;
        await new Promise((r) => setTimeout(r, 400));
        const midText = visibleText();
        el.scrollTop = 0;
        const frames: number[] = [];
        let prev = performance.now();
        for (let i = 0; i < 800; i++) {
            await new Promise<void>((r) => requestAnimationFrame(() => r()));
            const now = performance.now();
            frames.push(now - prev);
            prev = now;
            if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2) break;
            el.scrollTop += 150;
        }
        return { frames: frames.slice(1), midText };
    });
    const after = await page.evaluate(() => {
        const w = window as unknown as { __lt: number[] };
        return { lt: w.__lt.reduce((a, b) => a + b, 0) };
    });

    let interaction: number | null = null;
    if (route.name.startsWith('agent-tests')) {
        const newTest = page.getByRole('button', { name: /new test/i }).first();
        if (await newTest.count()) {
            await newTest.click();
            const name = page.getByLabel(/name/i).first();
            if (await name.count()) {
                await page.evaluate(() => ((window as unknown as { __ev: number[] }).__ev = []));
                await name.pressSequentially('Implements the parser change end to end', { delay: 20 });
                await page.waitForTimeout(300);
                interaction = await page.evaluate(() =>
                    Math.max(0, ...(window as unknown as { __ev: number[] }).__ev),
                );
            }
        }
    }

    const frames = [...scroll.frames].sort((a, b) => a - b);
    const p95 = frames[Math.min(frames.length - 1, Math.floor(frames.length * 0.95))] ?? 0;
    return {
        name: route.name,
        path: route.path,
        api_requests: apiCount,
        api_kb: Math.round(apiBytes / 1024),
        settle_ms: Math.max(0, settle),
        long_task_ms: Math.round(before.lt),
        dom_nodes: before.dom,
        scroll_frames: frames.length,
        scroll_p95_ms: Math.round(p95 * 10) / 10,
        scroll_janky_pct: frames.length ? Math.round((frames.filter((f) => f > 16.7).length / frames.length) * 1000) / 10 : 0,
        scroll_long_task_ms: Math.round(after.lt - before.lt),
        mid_scroll_text: scroll.midText,
        interaction_ms: interaction === null ? null : Math.round(interaction),
    };
}

test.describe('perf: load, scroll, interaction', () => {
    test.skip(!PERF_ENABLED, 'PERF=1 not set');
    const results: RouteResult[] = [];

    for (const route of ROUTES) {
        test(route.name, async ({ page }) => {
            results.push(await measure(page, route));
        });
    }

    test.afterAll(() => {
        mkdirSync('e2e-logs/perf', { recursive: true });
        writeFileSync(`e2e-logs/perf/${LABEL}.json`, JSON.stringify({ label: LABEL, results }, null, 2));
    });
});

