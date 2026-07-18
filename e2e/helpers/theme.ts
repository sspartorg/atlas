import type { Page } from '@playwright/test';

// Phase C — dark-mode parity helper.
//
// Sets the localStorage key the React app reads on boot AND flips the
// `data-theme` attribute directly so the FOUC-prevention script's prior
// paint doesn't fight the post-set state. Call BEFORE the test navigates.

export type ThemeMode = 'light' | 'dark';

export async function setThemeMode(page: Page, mode: ThemeMode): Promise<void> {
    await page.addInitScript((m) => {
        try {
            localStorage.setItem('atlas.themeMode', m);
        } catch {
            // localStorage may be unavailable in some test contexts; the
            // initial-script `data-theme` flip below covers the visual.
        }
        // F-003 — addInitScript runs after document is created but
        // potentially before the HTML parser reaches the `<html>` tag,
        // so `document.documentElement` is null in Chromium's earliest
        // window. The live app's FOUC-prevention script in index.html
        // runs INSIDE `<head>` (documentElement already exists), so it
        // doesn't hit this case — only Playwright's init-script does.
        // Guard with a fallback: try now, retry on DOMContentLoaded if
        // still null. This silences the per-route
        // `pageerror: Cannot read properties of null (reading 'setAttribute')`
        // that surfaced on every forensic.ndjson record.
        const apply = () => {
            const root = document.documentElement;
            if (root) root.setAttribute('data-theme', m);
        };
        if (document.documentElement) {
            apply();
        } else {
            document.addEventListener('DOMContentLoaded', apply, { once: true });
        }
    }, mode);
}
