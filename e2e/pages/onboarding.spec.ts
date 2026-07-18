import { test, expect } from '@playwright/test';

// /onboarding e2e isolation tests.
//
// The e2e seed sets settings.onboarding_complete=1 so the App.tsx
// route guard redirects /onboarding → / for every test that doesn't
// want to see the onboarding UI. These three tests use the narrow
// test-only endpoint POST /api/settings/test/clear-onboarding to
// flip that flag back to 0 before navigating, and restore it via
// POST /api/settings/onboard in afterEach.
//
// ATLAS_MCP_TOKEN is unset in the e2e environment, so both endpoints
// are fully open. The `request` fixture is Node-side; relative URLs
// work because the e2e API is bound to http://127.0.0.1:6001.

const API = 'http://127.0.0.1:6001';

test.describe('/onboarding', () => {
    test.afterEach(async ({ request }) => {
        // Restore onboarding_complete so the route guard works normally
        // for subsequent specs that navigate to seeded pages.
        await request.post(`${API}/api/settings/onboard`, {
            data: { owner_name: 'Owner', workspace_path: '/workspace' },
        });
    });

    test('Step 1: welcome heading, step indicator, and Next button are visible', async ({
        page,
        request,
    }) => {
        await request.post(`${API}/api/settings/test/clear-onboarding`);

        await page.goto('/onboarding', { waitUntil: 'load' });

        await expect(page.getByText('Welcome to Atlas.')).toBeVisible();
        await expect(page.getByText('Step 1 of 2')).toBeVisible();
        await expect(page.getByRole('button', { name: /next/i })).toBeVisible();
    });

    test('Step 2: filling display name and pressing Next shows Step 2 of 2', async ({
        page,
        request,
    }) => {
        await request.post(`${API}/api/settings/test/clear-onboarding`);

        await page.goto('/onboarding', { waitUntil: 'load' });

        await page.getByLabel(/display name/i).fill('E2E Tester');
        await page.getByRole('button', { name: /next/i }).click();

        await expect(page.getByText('Step 2 of 2')).toBeVisible();
    });

    test('Step 2: Finish Setup button is visible after advancing from Step 1', async ({
        page,
        request,
    }) => {
        await request.post(`${API}/api/settings/test/clear-onboarding`);

        await page.goto('/onboarding', { waitUntil: 'load' });

        await page.getByLabel(/display name/i).fill('E2E Tester');
        await page.getByRole('button', { name: /next/i }).click();

        await expect(page.getByRole('button', { name: /finish setup/i })).toBeVisible();
        // Do NOT click — clicking would call POST /api/settings/onboard
        // which navigates away after a 5 s success view; afterEach will
        // restore the flag cleanly instead.
    });
});
