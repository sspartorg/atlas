import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';
import { API, chainGraph, createWorkflow } from '../helpers/api.js';

// Runs under the `mobile-chrome` Playwright project (390×844, hasTouch).
// Every test title contains `@mobile` so the project's grep filter picks them up.

test.describe('mobile responsive @mobile', () => {
    test('BottomNav renders 4 labels @mobile', async ({ page }) => {
        await goto(page, '/');
        // The BottomNav (`<Box component="nav">`) renders 4 BottomNavigationActions.
        // MUI's BottomNavigationAction renders as <button> but the label-as-text
        // pattern matches the existing unit test pattern (BottomNav.test.tsx).
        for (const label of ['Home', 'Tasks', 'Queue', 'More']) {
            await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
        }
    });

    test('tapping Tasks navigates to /tasks @mobile', async ({ page }) => {
        await goto(page, '/');
        await page.getByText('Tasks', { exact: true }).first().click();
        await expect(page).toHaveURL(/\/tasks/);
    });

    test('tapping Queue navigates to /queue @mobile', async ({ page }) => {
        await goto(page, '/');
        await page.getByText('Queue', { exact: true }).first().click();
        await expect(page).toHaveURL(/\/queue/);
    });

    test('More tab opens MoreSheet @mobile', async ({ page }) => {
        await goto(page, '/');
        await page.getByText('More', { exact: true }).first().click();
        // MoreSheet is an MUI Drawer rendered with role="presentation".
        await expect(page.getByRole('presentation').first()).toBeVisible();
    });

    // The workflow pages (ADR 0015): lists, the Workflow Marketplace and the
    // vertical canvas must fit the narrow screen without a sideways scroll.
    test('queue, workflows and the workflow marketplace fit the screen @mobile', async ({ page, request }) => {
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
