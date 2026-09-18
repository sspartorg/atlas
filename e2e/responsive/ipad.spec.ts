import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';
import { API, chainGraph, createWorkflow } from '../helpers/api.js';

// Runs under the `ipad-chrome` Playwright project (834×1194, hasTouch, isMobile:false).
// Every test title contains `@ipad` so the project's grep filter picks them up.
//
// NOTE: 834 px falls below MUI's `md` breakpoint (900 px), so `useIsMobile()`
// returns true at this viewport. The shell renders BottomNav + MoreSheet instead
// of the permanent inline Sidenav. Tests reflect this actual layout — the
// MoreSheet drawer IS the nav surface accessible to iPad-portrait users.

test.describe('iPad responsive @ipad', () => {
    test('BottomNav renders 4 labels at iPad portrait @ipad', async ({ page }) => {
        await goto(page, '/');
        for (const label of ['Home', 'Tasks', 'Queue', 'More']) {
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

    test('tapping Tasks navigates to /tasks @ipad', async ({ page }) => {
        await goto(page, '/');
        await page.getByText('Tasks', { exact: true }).first().click();
        await expect(page).toHaveURL(/\/tasks/);
    });

    // The workflow pages (ADR 0015): lists, the Workflow Marketplace and the
    // vertical canvas must fit the narrow screen without a sideways scroll.
    test('queue, workflows and the workflow marketplace fit the screen @ipad', async ({ page, request }) => {
        const wf = await createWorkflow(request, `E2E narrow ${Date.now()}`, chainGraph({ type: 'agent', agent_id: 'agent-po-writer' }));
        try {
            for (const path of ['/queue', '/workflows', '/agents/marketplace?tab=workflows', `/workflows/${wf.id}`]) {
                await goto(page, path);
                await expect(page.getByRole('heading').first()).toBeVisible();
                const fits = await page.evaluate(
                    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
                );
                expect(fits, `${path} scrolls sideways`).toBe(true);
            }
        } finally {
            await request.delete(`${API}/api/workflows/${wf.id}`);
        }
    });
});
