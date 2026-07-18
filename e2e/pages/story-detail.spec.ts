import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// No story exists in the e2e seed. We create one in beforeAll via POST
// /api/stories (epic_id=ETM-1) and delete it in afterAll via DELETE
// /api/stories/:id. ATLAS_MCP_TOKEN is unset in e2e so the write gate
// is fully open and Playwright's request fixture hits the API directly.

const API = 'http://127.0.0.1:6001';

test.describe('/issues/stories/:id', () => {
    let storyId = '';

    test.beforeAll(async ({ request }) => {
        const res = await request.post(`${API}/api/stories`, {
            data: {
                epic_id: 'ETM-1',
                title: 'E2E story detail test story',
                description: 'Created by story-detail.spec.ts',
                labels: [],
            },
        });
        expect(res.status()).toBe(201);
        const body = await res.json() as { id: string };
        storyId = body.id;
    });

    test.afterAll(async ({ request }) => {
        if (storyId) {
            await request.delete(`${API}/api/stories/${storyId}`);
        }
    });

    test('renders without console errors and breadcrumb id is visible', async ({ page }) => {
        await goto(page, `/issues/stories/${storyId}`);
        await expect(page.getByText(storyId).first()).toBeVisible();
    });

    test('status chip and comment composer are visible', async ({ page }) => {
        await goto(page, `/issues/stories/${storyId}`);
        // DetailsRailCard renders the default status chip (Draft for new stories).
        await expect(page.getByText('Draft').first()).toBeVisible();
        // ConversationCard renders an empty reply textbox.
        const composer = page.getByRole('textbox').first();
        await expect(composer).toBeVisible();
        await expect(composer).toHaveValue('');
    });
});
