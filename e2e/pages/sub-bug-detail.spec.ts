import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// No sub-bug exists in the e2e seed. We create a story under the seeded
// ETM-1 epic, then a sub-bug under that story, and clean up in afterAll.
// Sub-bugs are parented to stories (not bugs); the create endpoint is
// POST /api/stories/:storyId/sub-bugs. DELETE /api/sub-bugs/:id + DELETE
// /api/stories/:id are used to clean up. ATLAS_MCP_TOKEN is unset in
// e2e so the write gate is fully open.

const API = 'http://127.0.0.1:6001';

test.describe('/issues/sub-bugs/:id', () => {
    let storyId = '';
    let subBugId = '';

    test.beforeAll(async ({ request }) => {
        const storyRes = await request.post(`${API}/api/stories`, {
            data: {
                epic_id: 'ETM-1',
                title: 'E2E sub-bug-detail spec parent story',
                labels: [],
            },
        });
        expect(storyRes.status()).toBe(201);
        const story = await storyRes.json() as { id: string };
        storyId = story.id;

        const subBugRes = await request.post(`${API}/api/stories/${storyId}/sub-bugs`, {
            data: { title: 'E2E sub-bug-detail spec sub-bug' },
        });
        expect(subBugRes.status()).toBe(201);
        const subBug = await subBugRes.json() as { id: string };
        subBugId = subBug.id;
    });

    test.afterAll(async ({ request }) => {
        if (subBugId) {
            await request.delete(`${API}/api/sub-bugs/${subBugId}`);
        }
        if (storyId) {
            await request.delete(`${API}/api/stories/${storyId}`);
        }
    });

    test('renders without console errors; sub-bug id visible in breadcrumb', async ({ page }) => {
        await goto(page, `/issues/sub-bugs/${subBugId}`);
        // makeShortId returns the raw id; it appears in the breadcrumb and
        // editable title area rendered by IssueDetailShell.
        await expect(page.getByText(subBugId).first()).toBeVisible();
    });

    test('parent story link is visible in breadcrumb or details rail', async ({ page }) => {
        await goto(page, `/issues/sub-bugs/${subBugId}`);
        // IssueDetailShell breadcrumb includes the parent story's short id
        // (the story id itself, per makeShortId). DetailsRailCard also
        // surfaces it as a "Parent story" link in the right rail.
        await expect(page.getByText(storyId).first()).toBeVisible();
    });

    test('status chip defaults to Draft in the details rail', async ({ page }) => {
        await goto(page, `/issues/sub-bugs/${subBugId}`);
        // DetailsRailCard renders a StatusChip; new sub-bugs default to draft.
        await expect(page.getByText('Draft').first()).toBeVisible();
    });
});
