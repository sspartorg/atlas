import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// Strategy A: unknown session id → the page renders the graceful
// "Session not found" fallback. No state mutation required.
const UNKNOWN_ID = '00000000-0000-0000-0000-000000000000';

test.describe('/terminal/:id/history', () => {
    test('route renders without console errors and shows session-not-found fallback', async ({
        page,
    }) => {
        const errors: string[] = [];
        page.on('console', (msg) => {
            if (msg.type() === 'error') errors.push(msg.text());
        });

        await goto(page, `/terminal/${UNKNOWN_ID}/history`);

        // The API 404s → sessionError is true → Alert "Session not found."
        await expect(page.getByText('Session not found.')).toBeVisible({ timeout: 15_000 });

        // Filter out benign network-error noise from the intentional 404.
        const fatal = errors.filter(
            (e) => !e.includes('404') && !e.includes('Failed to fetch'),
        );
        expect(fatal, `Unexpected console errors: ${fatal.join('\n')}`).toHaveLength(0);
    });

    test('session-not-found state shows a back-to-/terminal link', async ({ page }) => {
        await goto(page, `/terminal/${UNKNOWN_ID}/history`);

        await expect(page.getByText('Session not found.')).toBeVisible({ timeout: 15_000 });

        // The Alert body contains "Back to sessions." as a RouterLink to /terminal.
        const backLink = page.getByRole('link', { name: 'Back to sessions.' });
        await expect(backLink).toBeVisible();
        await expect(backLink).toHaveAttribute('href', '/terminal');
    });
});
