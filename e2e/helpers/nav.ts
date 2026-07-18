import type { Page } from '@playwright/test';

// Theme 13 — `goto(page, path)` wrapper that fails the test on
// console errors or failed network requests. Specs that exercise
// flaky-by-design paths (intentional 404s, etc.) can pass `allow`
// regexes to suppress matching errors.

export interface GotoOptions {
    /** Regexes that suppress console-error / network-failure matches. */
    allow?: RegExp[];
    /** Wait condition for navigation. Defaults to 'load' — Atlas's
     *  shell opens an SSE EventSource on every page, so `networkidle`
     *  literally never fires and any spec relying on the default would
     *  time out before its first assertion. Specs that need to wait for
     *  initial data fetches use `expect(...).toBeVisible()` polling,
     *  which is what they were doing in practice anyway. */
    waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
}

export async function goto(
    page: Page,
    path: string,
    opts: GotoOptions = {},
): Promise<void> {
    const consoleErrors: string[] = [];
    const networkFailures: string[] = [];
    const allow = opts.allow ?? [];

    const onConsole = (msg: { type(): string; text(): string }) => {
        if (msg.type() !== 'error') return;
        const text = msg.text();
        if (allow.some((r) => r.test(text))) return;
        consoleErrors.push(text);
    };
    const onPageError = (err: Error) => {
        if (allow.some((r) => r.test(err.message))) return;
        consoleErrors.push(`pageerror: ${err.message}`);
    };
    const onRequestFailed = (req: { url(): string; failure(): { errorText: string } | null }) => {
        const failure = req.failure();
        const summary = `${req.url()} ${failure?.errorText ?? ''}`;
        // /api/events is the SSE long-poll opened on every page mount.
        // When the page navigates away (or a second EventSource replaces
        // the first), the prior request aborts with net::ERR_ABORTED —
        // expected behaviour, not a failure worth surfacing. Same applies
        // to socket-disconnect aborts on the same path. Filter by default.
        if (/\/api\/events\b/.test(summary) && /ERR_ABORTED|net::ERR_/.test(summary)) {
            return;
        }
        // Google Fonts material-symbols-rounded woff2 requests sometimes
        // ERR_ABORTED on slow tests (the icon stylesheet kicks off the
        // font fetch, the page navigates away before the woff2 lands).
        // The font is purely decorative — abort is benign.
        if (/fonts\.gstatic\.com.*woff2?/.test(summary) && /ERR_ABORTED|net::ERR_/.test(summary)) {
            return;
        }
        if (allow.some((r) => r.test(summary))) return;
        networkFailures.push(summary);
    };

    page.on('console', onConsole);
    page.on('pageerror', onPageError);
    page.on('requestfailed', onRequestFailed);

    try {
        await page.goto(path, { waitUntil: opts.waitUntil ?? 'load' });
    } finally {
        page.off('console', onConsole);
        page.off('pageerror', onPageError);
        page.off('requestfailed', onRequestFailed);
    }

    if (consoleErrors.length > 0) {
        throw new Error(
            `[goto:${path}] console error(s):\n  ${consoleErrors.slice(0, 5).join('\n  ')}`,
        );
    }
    if (networkFailures.length > 0) {
        throw new Error(
            `[goto:${path}] network failure(s):\n  ${networkFailures.slice(0, 5).join('\n  ')}`,
        );
    }
}
