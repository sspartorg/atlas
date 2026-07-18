import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// Theme 13 — canonical pattern flow. Walks the sidenav top-level
// routes without triggering any backend mutations. Catches missing
// page components / broken navigation early.
//
// W5 fix: The Sidenav renders <Box onClick> items (not <a role="link">)
// so getByRole('link') never matches. We added data-testid="nav-item-<key>"
// to each nav item in Sidenav.tsx and locate by that instead.

test('sidenav: walk every workspace destination', async ({ page }) => {
    await goto(page, '/');

    const destinations: Array<{ key: string; urlFragment: RegExp; heading: RegExp }> = [
        { key: 'projects', urlFragment: /\/projects$/, heading: /Projects/i },
        { key: 'epics', urlFragment: /\/epics$/, heading: /Epics/i },
        { key: 'issues', urlFragment: /\/issues$/, heading: /Issues/i },
        { key: 'queue', urlFragment: /\/queue$/, heading: /Queue/i },
        { key: 'search', urlFragment: /\/search$/, heading: /Search/i },
        { key: 'agents', urlFragment: /\/agents$/, heading: /Agents/i },
        { key: 'notifications', urlFragment: /\/notifications$/, heading: /Notifications/i },
        { key: 'guardrails', urlFragment: /\/guardrails$/, heading: /Guard-?rails/i },
        { key: 'settings', urlFragment: /\/settings$/, heading: /Settings/i },
    ];

    for (const { key, urlFragment, heading } of destinations) {
        const navItem = page.getByTestId(`nav-item-${key}`);
        await navItem.click();
        await expect(page).toHaveURL(urlFragment);
        await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible();
    }
});
