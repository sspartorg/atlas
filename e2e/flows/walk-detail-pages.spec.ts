import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// 2026-06-28 — W11 cross-functional smoke. Re-written from the prior
// "click-through-row" pattern that proved too brittle: row click
// targets vary across MUI Card / Table / VirtualList rendering, and
// the URL transition timing is hard to assert tolerantly. The simpler
// "navigate to URL → assert heading + tab cluster + critical button"
// catches the same regressions (route 404, detail-component crash,
// missing tab, broken modal trigger) without depending on the row's
// exact click target.

test('flow: Projects list renders + detail URL navigable', async ({ page }) => {
    await goto(page, '/projects');
    await expect(page.getByRole('heading', { name: /Projects/i }).first()).toBeVisible();

    // The seed inserts a project with id 'e2e-terminal-project' — navigate
    // directly to its detail page and verify the tab cluster renders.
    await goto(page, '/projects/e2e-terminal-project');
    await expect(page.getByRole('tab', { name: /Overview/ })).toBeVisible({ timeout: 10_000 });
});

test('flow: Tasks list → Task detail → Sub-task detail', async ({ page }) => {
    await goto(page, '/tasks');
    await expect(page.getByRole('heading', { name: /Tasks/i }).first()).toBeVisible();

    // Seeded Task ETM-1 with sub-task ETM-2.
    await goto(page, '/tasks/ETM-1');
    await expect(page.getByText('E2E seeded sub-task').first()).toBeVisible();
    await goto(page, '/sub-tasks/ETM-2');
    await expect(page.getByText('E2E seeded sub-task').first()).toBeVisible();
});

test('flow: Agents list renders + every tab visible on detail page', async ({ page }) => {
    await goto(page, '/agents');
    await expect(page.getByRole('heading', { name: /Agents/i }).first()).toBeVisible();

    // The seed installs PO Writer via marketplace.install — navigate to its
    // detail page and verify the tab cluster renders.
    await goto(page, '/agents/agent-po-writer');
    const tabs = ['Overview', 'Prompt', 'Tests', 'Performance', 'Runs', 'Memory'];
    for (const label of tabs) {
        await expect(page.getByRole('tab', { name: new RegExp(label) })).toBeVisible({
            timeout: 10_000,
        });
    }
});

test('flow: Terminal list renders + Start Session dialog opens with both CLI options', async ({ page }) => {
    await goto(page, '/terminal');
    await expect(page.getByRole('heading', { name: /Terminal/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Start Session/i }).first()).toBeVisible();

    await page.getByRole('button', { name: /Start Session/i }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Claude Code' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'GitHub Copilot' })).toBeVisible();
});
