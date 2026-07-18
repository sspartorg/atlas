import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// Runs under the `ipad-chrome` Playwright project (834×1194, hasTouch, isMobile:false).
// Every test title contains `@ipad` so the project's grep filter picks them up.
//
// NOTE: 834 px falls below MUI's `md` breakpoint (900 px), so `useIsMobile()`
// returns true at this viewport. The shell renders BottomNav + MoreSheet instead
// of the permanent inline Sidenav. Tests reflect this actual layout — the
// MoreSheet drawer IS the nav surface accessible to iPad-portrait users.

test.describe('iPad responsive @ipad', () => {
    test('BottomNav renders 5 labels at iPad portrait @ipad', async ({ page }) => {
        await goto(page, '/');
        for (const label of ['Home', 'Epics', 'Issues', 'Queue', 'More']) {
            await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
        }
    });

    test('projects page renders without horizontal scroll @ipad', async ({ page }) => {
        await goto(page, '/projects');
        // No horizontal overflow on the page.
        const noHorizOverflow = await page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        );
        expect(noHorizOverflow).toBe(true);
    });

    test('project detail page fits within the viewport without overflow @ipad', async ({ page }) => {
        await goto(page, '/projects/e2e-terminal-project');
        const noHorizOverflow = await page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        );
        expect(noHorizOverflow).toBe(true);
    });

    test('tapping Epics navigates to /epics @ipad', async ({ page }) => {
        await goto(page, '/');
        await page.getByText('Epics', { exact: true }).first().click();
        await expect(page).toHaveURL(/\/epics/);
    });
});
