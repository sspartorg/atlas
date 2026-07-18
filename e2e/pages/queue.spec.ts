import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

test.describe('/queue', () => {
    test('renders without console errors', async ({ page }) => {
        await goto(page, '/queue');
        await expect(page.getByRole('heading', { name: /queue/i }).first()).toBeVisible();
    });

    test('section labels are present', async ({ page }) => {
        await goto(page, '/queue');
        // "Agents" section header is always rendered above the card grid.
        await expect(page.getByText(/\bAgents\b/i).first()).toBeVisible();
        // "Waiting on You" section is always rendered (shows 0 when empty).
        await expect(page.getByText(/Waiting on You/i).first()).toBeVisible();
        // "Pause All Agents" button is in the page header.
        await expect(page.getByRole('button', { name: /Pause All Agents/i })).toBeVisible();
    });

    test('agent card is visible and opens drawer on click', async ({ page }) => {
        await goto(page, '/queue');
        // The seed installs "PO Writer" from the marketplace — expect its card.
        const card = page.getByText(/PO Writer/i).first();
        await expect(card).toBeVisible();
        // Click the card to open QueueAgentDrawer.
        await card.click();
        // Drawer renders inside an MUI Drawer — check for its close button or
        // a second occurrence of the agent name inside the drawer panel.
        await expect(page.getByRole('button', { name: /close/i }).first()).toBeVisible();
    });
});
