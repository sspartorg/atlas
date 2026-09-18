import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// The e2e seed creates project with id "e2e-terminal-project" (prefix ETM).
// All tests are read-only — no mutations.

const PROJECT_URL = '/projects/e2e-terminal-project';

// Tabs whose label is static — use a fixed string for getByRole matching.
// Tasks includes a dynamic count suffix so it uses a regex marker.
const TABS = [
    {
        slug: 'overview',
        // MUI Tab accessible name = icon-text + label; match by label substring.
        labelPattern: /Overview/,
        // OverviewTab renders KPI tiles (Open tasks, Tasks in flight, AI Cost).
        panelMarker: /open tasks|tasks in flight|overview/i,
    },
    {
        slug: 'tasks',
        labelPattern: /Tasks/,
        // TasksTabContent shows "Showing N tasks in this project"
        panelMarker: /tasks in this project/i,
    },
    {
        slug: 'guardrails',
        // Label is "Guard-rails" in the source.
        labelPattern: /Guard.rails/,
        // ProjectGuardrailsBody shows either rules or "No guard-rails yet".
        panelMarker: /guard.rails|no guard-rails/i,
    },
    {
        slug: 'setup',
        labelPattern: /Setup/,
        // SetupTab renders Bash / POSIX shell and Windows PowerShell editors.
        panelMarker: /Bash \/ POSIX shell|Windows PowerShell/i,
    },
    {
        slug: 'history',
        labelPattern: /History/,
        // HistoryTabContent renders a list or "No runs yet" empty state.
        panelMarker: /agent run|no runs|history/i,
    },
] as const;

test.describe('/projects/:id tabs', () => {
    test('overview tab is selected on default load', async ({ page }) => {
        await goto(page, PROJECT_URL);
        // Verify the project loaded (not the "not found" state).
        await expect(page.getByText(/e2e terminal|ETM/i).first()).toBeVisible();
        const overviewTab = page.getByRole('tab').filter({ hasText: /Overview/ }).first();
        await expect(overviewTab).toHaveAttribute('aria-selected', 'true');
    });

    test('deep-link to ?tab=history selects History on first paint', async ({ page }) => {
        await goto(page, `${PROJECT_URL}?tab=history`);

        const historyTab = page.getByRole('tab').filter({ hasText: /History/ }).first();
        await expect(historyTab).toHaveAttribute('aria-selected', 'true');

        // The Tasks tab must NOT be selected.
        const tasksTab = page.getByRole('tab').filter({ hasText: /Tasks/ }).first();
        await expect(tasksTab).toHaveAttribute('aria-selected', 'false');
    });

    test('switching tabs does not duplicate GET /api/projects/:id', async ({ page }) => {
        let projectFetchCount = 0;
        page.on('request', (req) => {
            if (
                req.method() === 'GET' &&
                /\/api\/projects\/e2e-terminal-project$/.test(req.url())
            ) {
                projectFetchCount++;
            }
        });

        await goto(page, PROJECT_URL);
        const baseline = projectFetchCount;

        // Switch to tasks, then back to overview — should not re-fetch the project.
        await page.getByRole('tab').filter({ hasText: /Tasks/ }).first().click();
        await page.getByRole('tab').filter({ hasText: /Overview/ }).first().click();

        // Allow at most 1 additional fetch (React StrictMode double-invoke in dev).
        expect(projectFetchCount - baseline).toBeLessThanOrEqual(1);
    });
});
