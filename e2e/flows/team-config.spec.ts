import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';
import { API, apiGet, chainGraph, createWorkflow } from '../helpers/api.js';

// Team config sync, the UI half: Settings → Team config saves the connection
// and refuses a bad one, the publisher's "Include in team config" switch
// persists, and a subscriber sees the overwrite warning on team-managed
// projects and workflows. No credential is ever set here, so neither Sync now
// nor the minute tick reaches a real git host (the push/pull itself is covered
// by packages/api/src/services/team-config.test.ts against a local repo).

const PROJECT_ID = 'e2e-terminal-project';

test.afterAll(async ({ request }) => {
    await request.put(`${API}/api/team-config`, { data: { role: 'off', repo_url: null, credential_id: null, branch: 'main' } });
    await request.patch(`${API}/api/projects/${PROJECT_ID}`, { data: { team_managed: false } });
});

test.describe('Team config', () => {
    test('connect as a publisher and include a project', async ({ page, request }) => {
        await goto(page, '/settings?tab=team', { allow: [/400 \(Bad Request\)/] });
        await expect(page.getByRole('tab', { name: 'Team config' })).toHaveAttribute('aria-selected', 'true');

        await page.getByRole('combobox', { name: 'Team config role' }).click();
        await page.getByRole('option', { name: 'Publisher' }).click();
        await expect(page.getByText(/pushed within a minute of a change/)).toBeVisible();

        const url = page.getByPlaceholder('https://github.com/your-org/atlas-team-config.git');
        await url.fill('http://github.com/acme/team.git');
        await url.blur();
        await expect(page.getByText('Use an https:// git URL')).toBeVisible();

        await url.fill('https://github.com/acme/team.git');
        await url.blur();
        await expect.poll(async () => (await apiGet<{ repo_url: string | null }>(request, '/api/team-config')).repo_url).toBe(
            'https://github.com/acme/team.git'
        );
        // No credential yet, so there is nothing to sync with.
        await expect(page.getByRole('button', { name: 'Sync now' })).toBeDisabled();

        await goto(page, `/projects/${PROJECT_ID}`);
        const include = page.getByRole('switch', { name: /Include in team config/ });
        await expect(include).not.toBeChecked();
        await include.click();
        await expect(page.getByText('Included in team config')).toBeVisible();
        await expect.poll(async () => (await apiGet<{ team_managed: boolean }>(request, `/api/projects/${PROJECT_ID}`)).team_managed).toBe(true);

        await page.reload();
        await expect(page.getByRole('switch', { name: /Include in team config/ })).toBeChecked();
    });

    test('a subscriber is warned on team-managed items only', async ({ page, request }) => {
        await request.put(`${API}/api/team-config`, { data: { role: 'subscriber', repo_url: 'https://github.com/acme/team.git' } });
        await request.patch(`${API}/api/projects/${PROJECT_ID}`, { data: { team_managed: true } });
        const wf = await createWorkflow(request, `E2E team workflow ${Date.now()}`, chainGraph({ type: 'agent', agent_id: 'agent-po-writer' }));

        await goto(page, `/projects/${PROJECT_ID}`);
        await expect(page.getByText(/This project is managed by my team config/)).toBeVisible();
        await expect(page.getByRole('switch', { name: /Include in team config/ })).toHaveCount(0);

        // A workflow the Owner made themselves is not team-managed: no warning.
        await goto(page, `/workflows/${wf.id}`);
        await expect(page.getByRole('heading', { name: wf.name })).toBeVisible();
        await expect(page.getByText(/managed by my team config/)).toHaveCount(0);
    });
});
