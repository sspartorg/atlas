import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

test('team config: branch and interval validate, and Sync is refused while off', async ({ page, request }) => {
    await request.put(`${API}/api/team-config`, { data: { role: 'subscriber', repo_url: 'https://github.com/acme/team.git', branch: 'main', interval_minutes: 60 } });
    await goto(page, '/settings?tab=team', { allow: [/400 \(Bad Request\)/, /409/] });
    type Tc = { branch: string; interval_minutes: number };
    const tc = () => apiGet<Tc>(request, '/api/team-config');

    const branch = page.locator('input[value="main"]').first();
    const id = await branch.getAttribute('id');
    const field = page.locator(`[id="${id}"]`);
    await field.fill('bad branch!');
    await field.blur();
    await expect(page.getByText('Could not save')).toBeVisible();
    await expect(field).toHaveValue('main');
    await field.fill('');
    await field.blur();
    await expect(field).toHaveValue('main');
    for (const b of ['qa/sync-1', 'qa/sync-2']) {
        await field.fill(b);
        await field.blur();
        await expect.poll(async () => (await tc()).branch).toBe(b);
    }

    const interval = page.locator('input[type="number"]').first();
    await interval.fill('4');
    await interval.blur();
    await expect(interval).toHaveValue('60');
    await interval.fill('10');
    await interval.blur();
    await expect.poll(async () => (await tc()).interval_minutes).toBe(10);

    await request.put(`${API}/api/team-config`, { data: { role: 'off' } });
    expect((await request.post(`${API}/api/team-config/sync`)).status()).toBe(409);
    await request.put(`${API}/api/team-config`, { data: { role: 'off', repo_url: null, branch: 'main', interval_minutes: 60 } });
});

test('Sync now: publish to a repo, publish again (no change), pull as a subscriber, empty branch', async ({ page, request }) => {
    test.setTimeout(120_000);
    const remote = mkdtempSync(join(tmpdir(), 'e2e-team-remote-'));
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
    const cred = (await (await request.post(`${API}/api/credentials`, { data: { label: 'e2e-team-sync', kind: 'pat', token: 'ghp_e2eFAKEtoken0000000007' } })).json()) as { id: string };
    await request.patch(`${API}/api/projects/${PROJECT_ID}`, { data: { team_managed: true } });
    await request.put(`${API}/api/team-config`, { data: { role: 'publisher', repo_url: `file://${remote}`, credential_id: cred.id, branch: 'main' } });
    try {
        await goto(page, '/settings?tab=team');
        const sync = page.getByRole('button', { name: 'Sync now' });

        await sync.click();
        await expect(page.getByText('Team config synced')).toBeVisible();
        await expect(page.getByText(/Last sync .* · Published [0-9a-f]{7}/)).toBeVisible();
        const files = execFileSync('git', ['--git-dir', remote, 'ls-tree', '-r', '--name-only', 'main'], { encoding: 'utf8' });
        expect(files).toMatch(/^projects\//m);
        expect(files).toMatch(/^agents\//m);

        await sync.click();
        await expect(page.getByText(/Last sync .* · Up to date/)).toBeVisible();

        await page.getByRole('combobox', { name: 'Team config role' }).click();
        await page.getByRole('option', { name: 'Subscriber' }).click();
        await expect.poll(async () => (await apiGet<{ role: string }>(request, '/api/team-config')).role).toBe('subscriber');
        await sync.click();
        // The seeded repo has no remote URL but is already on disk here, so the
        // pull imports cleanly — and the project stays team-managed, not "left".
        await expect(page.getByText(/Last sync .* · Agent "PO Writer" is now team-managed/)).toBeVisible();
        await expect(page.getByText(/left the team config/)).toHaveCount(0);
        expect((await apiGet<{ last_sync_ok: boolean | null }>(request, '/api/team-config')).last_sync_ok).toBe(true);
        expect((await apiGet<{ team_managed: boolean }>(request, `/api/projects/${PROJECT_ID}`)).team_managed).toBe(true);

        await request.put(`${API}/api/team-config`, { data: { branch: 'nothing-here' } });
        await page.reload();
        await page.getByRole('button', { name: 'Sync now' }).click();
        await expect(page.getByText(/has nothing yet; waiting for the publisher/)).toBeVisible();
    } finally {
        await request.put(`${API}/api/team-config`, { data: { role: 'off', repo_url: null, credential_id: null, branch: 'main' } });
        await request.patch(`${API}/api/projects/${PROJECT_ID}`, { data: { team_managed: false } });
        await request.delete(`${API}/api/credentials/${cred.id}`);
        rmSync(remote, { recursive: true, force: true });
    }
});

