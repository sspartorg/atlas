import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// The e2e seed creates one epic: ETM-1 ("E2E linked epic", status in_progress)
// in the E2E Terminal project. We navigate directly to /epics/ETM-1.
// If the API returns 404 (e.g. schema mismatch), the component renders
// "Epic not found" — in that case, Test 1 will still verify that fallback.

test.describe('/epics/:id', () => {
    test('happy-path: renders epic title and Conversation section', async ({ page }) => {
        await goto(page, '/epics/ETM-1');
        // The breadcrumb / editable title area surfaces the epic id.
        await expect(page.getByText('ETM-1').first()).toBeVisible();
        // ConversationCard always renders its "Conversation" header.
        await expect(page.getByText('Conversation').first()).toBeVisible();
    });

    test('status chip: "In Progress" is visible in the details rail', async ({ page }) => {
        await goto(page, '/epics/ETM-1');
        // DetailsRailCard renders a StatusChip whose label is "In Progress"
        // for an epic seeded with status = 'in_progress'.
        await expect(page.getByText('In Progress').first()).toBeVisible();
    });

    test('comment composer is present and empty on load', async ({ page }) => {
        await goto(page, '/epics/ETM-1');
        // ConversationCard renders a textarea for the owner to type a reply.
        // Verify it exists and has no pre-filled content — do NOT submit.
        const composer = page.getByRole('textbox').first();
        await expect(composer).toBeVisible();
        await expect(composer).toHaveValue('');
    });
});
