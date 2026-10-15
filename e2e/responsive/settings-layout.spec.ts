import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// Every Settings tab and the credentials page at phone and iPad width: no
// sideways scroll, the main heading visible, and add actions where they belong.

const pages: [string, RegExp][] = [
    ['/settings', /Owner Profile/],
    ['/settings?tab=environment', /Environment/],
    ['/settings?tab=secrets', /secret/i],
    ['/settings?tab=models', /Claude CLI/],
    ['/settings?tab=notifications', /External Notification Channel/],
    ['/settings?tab=jira', /Jira connection/],
    ['/settings?tab=team', /Team config repo/],
    ['/settings?tab=help', /About Atlas/],
    ['/settings/credentials', /Git credentials/],
];

for (const tag of ['@mobile', '@ipad']) {
    test.describe(`settings layout ${tag}`, () => {
        for (const [path, heading] of pages) {
            test(`${path} fits ${tag}`, async ({ page }) => {
                await goto(page, path);
                await expect(page.getByText(heading).first()).toBeVisible();
                const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
                expect(overflow).toBeLessThanOrEqual(0);
            });
        }
    });
}

test('New reminder is a floating button on phones @mobile', async ({ page }) => {
    await goto(page, '/reminders');
    const fab = page.locator('.MuiFab-root');
    await expect(fab).toHaveAccessibleName('New reminder');
    await fab.click();
    await expect(page.getByRole('dialog').first()).toBeVisible();
});
