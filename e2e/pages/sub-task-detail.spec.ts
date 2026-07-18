import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// No sub-task or parent story exists in the e2e seed. We create both in
// beforeAll via Playwright's Node-side `request` fixture (page.evaluate
// runs in the browser context which is at about:blank in beforeAll, so
// relative-URL fetches fail). ATLAS_MCP_TOKEN is unset in e2e so the
// write gate is fully open.

const API = 'http://127.0.0.1:6001';

test.describe('/issues/sub-tasks/:id', () => {
    let storyId = '';
    let subTaskId = '';

    test.beforeAll(async ({ request }) => {
        const storyRes = await request.post(`${API}/api/stories`, {
            data: {
                epic_id: 'ETM-1',
                title: 'E2E sub-task parent story',
                description: 'Parent for sub-task-detail.spec.ts',
                labels: [],
            },
        });
        expect(storyRes.status()).toBe(201);
        const story = await storyRes.json() as { id: string };
        storyId = story.id;

        const subTaskRes = await request.post(
            `${API}/api/stories/${storyId}/sub-tasks`,
            { data: { title: 'E2E sub-task fixture', labels: [] } },
        );
        expect(subTaskRes.status()).toBe(201);
        const subTask = await subTaskRes.json() as { id: string };
        subTaskId = subTask.id;
    });

    test.afterAll(async ({ request }) => {
        if (subTaskId) {
            await request.delete(`${API}/api/sub-tasks/${subTaskId}`);
        }
        if (storyId) {
            await request.delete(`${API}/api/stories/${storyId}`);
        }
    });

    test('renders without console errors; breadcrumb/title visible', async ({ page }) => {
        await goto(page, `/issues/sub-tasks/${subTaskId}`);
        await expect(page.getByText(subTaskId).first()).toBeVisible();
    });

    test('"Parent story" label visible in details rail', async ({ page }) => {
        await goto(page, `/issues/sub-tasks/${subTaskId}`);
        // DetailsRailCard renders the "Parent story" link row that points
        // back to the seeded story. Label text is the most stable anchor;
        // the link target text is the story's short id (not its title).
        await expect(page.getByText('Parent story').first()).toBeVisible();
    });
});
