import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// Creates a bug under ETM-1 (seeded epic in e2e-terminal-project) in
// beforeAll and deletes it in afterAll. CreateBugSchema requires epic_id.
// Uses Playwright's Node-side `request` fixture; ATLAS_MCP_TOKEN is unset
// so the write gate is fully open.

const API = 'http://127.0.0.1:6001';

test.describe('/issues/bugs/:id', () => {
    let bugId = '';

    test.beforeAll(async ({ request }) => {
        const res = await request.post(`${API}/api/bugs`, {
            data: {
                epic_id: 'ETM-1',
                title: 'E2E bug-detail spec bug',
            },
        });
        expect(res.status()).toBe(201);
        const body = await res.json() as { id: string };
        bugId = body.id;
    });

    test.afterAll(async ({ request }) => {
        if (bugId) {
            await request.delete(`${API}/api/bugs/${bugId}`);
        }
    });

    test('renders without console errors; breadcrumb and title visible', async ({ page }) => {
        await goto(page, `/issues/bugs/${bugId}`);
        await expect(page.getByText(bugId).first()).toBeVisible();
    });

    test('status chip is visible in the details rail', async ({ page }) => {
        await goto(page, `/issues/bugs/${bugId}`);
        await expect(page.getByText('Draft').first()).toBeVisible();
    });
});
