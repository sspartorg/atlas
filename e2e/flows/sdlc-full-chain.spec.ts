import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// T9 — SDLC chain: epic (seeded ETM-1) → API-create story → assert browser
// view + breadcrumb. Cleanup in afterAll. The deeper status-transition leg
// is a follow-up because the in_progress chip varies by rail render timing.

const API = 'http://127.0.0.1:6001';

test.describe('SDLC chain', () => {
    let storyId = '';

    test.afterAll(async ({ request }) => {
        if (storyId) {
            await request.delete(`${API}/api/stories/${storyId}`);
        }
    });

    test('epic → API-create story → story detail breadcrumb visible', async ({ page, request }) => {
        const storyRes = await request.post(`${API}/api/stories`, {
            data: {
                epic_id: 'ETM-1',
                title: 'SDLC chain story',
                description: 'Created by sdlc-full-chain.spec.ts',
                labels: [],
            },
        });
        expect(storyRes.status()).toBe(201);
        const storyBody = await storyRes.json() as { id: string };
        storyId = storyBody.id;
        expect(storyId).toBeTruthy();

        // Browser-side: story detail breadcrumb surfaces the new id + the
        // default Draft chip in the details rail.
        await goto(page, `/issues/stories/${storyId}`);
        await expect(page.getByText(storyId).first()).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText('Draft').first()).toBeVisible();
    });
});
