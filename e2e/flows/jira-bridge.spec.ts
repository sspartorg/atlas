import http from 'node:http';
import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';
import { API, PROJECT_NAME, apiGet, chainGraph, createWorkflow } from '../helpers/api.js';

// Jira bridge end to end (ADR 0016): the Owner configures Jira in Settings,
// Sync now imports an issue from a fake Jira (a real HTTP server the e2e API
// calls), the source queues the Task on a workflow, the run finishes (AI is
// off in e2e: agent steps are simulated passes), and the next sync posts the
// final comment and moves the Jira issue to Done.

interface JiraCall {
    method: string;
    path: string;
    body: unknown;
}

// The Jira key the fake instance serves, unique per attempt. `jira_issues`
// has `jira_key` as its PRIMARY KEY and a deleted Task is never re-imported,
// so a fixed key imports exactly once per e2e database: on a retry the sync
// reported "0 imported" and the run failed on a stale assertion rather than
// the original fault.
let issueKey = 'FAKE-1';

const ISSUE = {
    id: '10001',
    fields: {
        summary: 'Add a --version flag',
        description: 'h2. Goal\nPrint the version and exit.',
        issuetype: { name: 'Story', subtask: false },
        status: { name: 'Selected for Development' },
        priority: { name: 'High' },
        labels: ['e2e-jira'],
        updated: '2026-09-18T10:00:00.000+0000',
        comment: {
            comments: [
                {
                    id: '1',
                    author: { displayName: 'Pat PO' },
                    body: 'Keep the output to one line.',
                    created: '2026-09-18T11:00:00.000+0000',
                },
            ],
            total: 1,
        },
    },
};

let calls: JiraCall[] = [];
let server: http.Server;
let siteUrl = '';

test.beforeAll(async () => {
    server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (c: Buffer) => (raw += c.toString()));
        req.on('end', () => {
            const url = new URL(req.url ?? '/', 'http://fake');
            calls.push({
                method: req.method ?? 'GET',
                path: url.pathname,
                body: raw ? JSON.parse(raw) : null,
            });
            const send = (status: number, body: unknown) => {
                res.writeHead(status, { 'content-type': 'application/json' });
                res.end(body === null ? undefined : JSON.stringify(body));
            };
            if (
                req.headers.authorization !==
                `Basic ${Buffer.from('owner@e2e.test:e2e-token').toString('base64')}`
            ) {
                return send(401, { errorMessages: ['bad credentials'] });
            }
            if (url.pathname === '/rest/api/2/myself')
                return send(200, { displayName: 'Fake Owner' });
            if (url.pathname === '/rest/api/2/search/jql')
                return send(200, { issues: [{ ...ISSUE, key: issueKey }] });
            if (url.pathname === `/rest/api/3/issue/${issueKey}/comment` && req.method === 'POST') {
                return send(201, { id: `c${calls.length}` });
            }
            if (url.pathname === `/rest/api/2/issue/${issueKey}/transitions` && req.method === 'GET') {
                return send(200, {
                    transitions: [{ id: '31', to: { statusCategory: { key: 'done' } } }],
                });
            }
            if (url.pathname === `/rest/api/2/issue/${issueKey}/transitions` && req.method === 'POST')
                return send(204, null);
            return send(404, { errorMessages: [`unexpected ${req.method} ${url.pathname}`] });
        });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    siteUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

test.afterAll(async ({ request }) => {
    server.close();
    // Leave the singleton config clean for other specs. Sources live on the
    // project now (migration 010), so they are deleted through their own route.
    const projects = await apiGet<{ id: string }[]>(request, '/api/projects');
    for (const p of projects) {
        const sources = await apiGet<{ id: number }[]>(
            request,
            `/api/projects/${p.id}/jira-sources`
        );
        for (const s of sources) {
            await request.delete(`${API}/api/projects/${p.id}/jira-sources/${s.id}`);
        }
    }
    await request.put(`${API}/api/integrations/jira`, {
        data: { enabled: false, site_url: null, email: null },
    });
});

test.describe('Jira bridge', () => {
    test('configure → import → workflow run → Done syncs back to Jira', async ({
        page,
        request,
    }) => {
        test.setTimeout(120_000);
        calls = [];
        // Unique per attempt, the way every other spec names its fixtures
        // (`E2E queue workflow ${Date.now()}` and friends). With a fixed name
        // this test could not survive a retry: the previous attempt's workflow
        // is still in the e2e DB, so the retry created a second one with the
        // same name and the picker below matched both —
        // `strict mode violation: ... resolved to 2 elements`. That turned
        // every flake into a hard red and buried the original failure under a
        // different error.
        issueKey = `FAKE-${Date.now()}`;
        const workflowName = `E2E Jira delivery ${Date.now()}`;
        const wf = await createWorkflow(
            request,
            workflowName,
            chainGraph({ type: 'agent', agent_id: 'agent-po-writer' })
        );

        await goto(page, '/settings?tab=jira');
        await expect(page.getByRole('tab', { name: 'Jira' })).toHaveAttribute(
            'aria-selected',
            'true'
        );

        // Connection: a wrong token first, then the right one.
        await page.getByPlaceholder('https://your-site.atlassian.net').fill(siteUrl);
        await page.getByPlaceholder('you@example.com').fill('owner@e2e.test');
        await page.getByLabel('Jira API token').fill('wrong-token');
        await page.getByLabel('Jira API token').blur();
        await expect(page.getByText('API token saved')).toBeVisible();
        await page.getByRole('button', { name: 'Test connection' }).click();
        await expect(page.getByText('Jira connection failed')).toBeVisible();

        await page.getByLabel('Jira API token').fill('e2e-token');
        await page.getByLabel('Jira API token').blur();
        await expect(page.getByLabel('Jira API token')).toHaveValue('');
        await expect(page.getByPlaceholder('Stored. Type to replace.')).toBeVisible();
        await page.getByRole('button', { name: 'Test connection' }).click();
        await expect(page.getByText('Connected to Jira as Fake Owner')).toBeVisible();

        // G-014 — a manual sync writes comments to real Jira issues, so it
        // honours the Import switch exactly like the poller does. This spec
        // used to rely on Sync now running from a switched-off bridge, which
        // is the bug that let a disabled integration post one comment to a
        // live board and then go silent for good.
        await expect(page.getByRole('button', { name: 'Sync now' })).toBeDisabled();
        // click(), not check(): the switch reflects server config, so its checked
        // state only settles after the PUT round-trips and the query updates.
        await page.getByLabel('Jira sync enabled').click();
        await expect(page.getByText('Jira sync on')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Sync now' })).toBeEnabled();

        // The token never comes back from the API.
        const cfgRes = await request.get(`${API}/api/integrations/jira`);
        expect(await cfgRes.text()).not.toContain('e2e-token');

        // The source — one query + workflow + repos combo — lives on the
        // project, not in Settings (migration 010).
        const projects = await apiGet<{ id: string; name: string }[]>(request, '/api/projects');
        const projectId = projects.find((p) => p.name === PROJECT_NAME)?.id ?? projects[0]!.id;
        await goto(page, `/projects/${projectId}?tab=jira`);
        await page.getByRole('button', { name: 'Add source' }).click();
        await page.getByLabel('JQL').fill('project = FAKE');
        await page.getByLabel('Workflow').click();
        await page.getByRole('option', { name: workflowName }).click();
        await page.getByRole('button', { name: 'Save' }).click();
        await expect(page.getByText('Source added')).toBeVisible();

        await page.getByRole('button', { name: 'Sync now' }).click();
        await expect(page.getByText(/Jira sync: 1 imported/)).toBeVisible();

        const tasks = await apiGet<
            Array<{ id: string; title: string; status: string; workflow_id: string | null }>
        >(request, '/api/tasks');
        const task = tasks.find((t) => t.title === `[${issueKey}] Add a --version flag`);
        expect(task, 'imported Task').toBeTruthy();
        if (!task) return;
        expect(task.workflow_id).toBe(wf.id);
        expect(task.status).toBe('ready');
        const pickedUp = calls.find((c) => c.method === 'POST' && c.path.endsWith('/comment'));
        expect(JSON.stringify(pickedUp?.body)).toContain(
            `queued on the ${workflowName} workflow`
        );

        // The Task page carries the whole issue and links back to Jira.
        await goto(page, `/tasks/${task.id}`);
        await expect(page.getByText('Print the version and exit.').first()).toBeVisible();
        await expect(page.getByText('Keep the output to one line.').first()).toBeVisible();
        const jiraLink = page.getByRole('link', {
            name: new RegExp(`${issueKey} Add a --version flag`),
        });
        await expect(jiraLink).toHaveAttribute('href', `${siteUrl}/browse/${issueKey}`);

        // The workflow works the Task; no PR in e2e, so the run ends it Done.
        const run = await request.post(`${API}/api/workflows/${wf.id}/runs`, {
            data: { item_id: task.id },
        });
        expect(run.status()).toBeLessThan(300);
        await expect
            .poll(
                async () =>
                    (await apiGet<{ status: string }>(request, `/api/tasks/${task.id}`)).status,
                { timeout: 60_000, intervals: [1_000] }
            )
            .toBe('done');

        // The next sync reports Done to Jira and closes the issue.
        calls = [];
        await goto(page, '/settings?tab=jira');
        await page.getByRole('button', { name: 'Sync now' }).click();
        await expect(page.getByText(/Jira sync:/)).toBeVisible();
        const final = calls.filter((c) => c.method === 'POST' && c.path.endsWith('/comment'));
        expect(final).toHaveLength(1);
        expect(JSON.stringify(final[0]?.body)).toContain(`"text":"Atlas ${task.id}"`);
        expect(JSON.stringify(final[0]?.body)).toContain(': done.');
        expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/transitions'))).toBe(
            true
        );

        // Idempotent: another sync neither re-imports nor re-closes.
        calls = [];
        await page.getByRole('button', { name: 'Sync now' }).click();
        await expect(page.getByText(/Jira sync: 0 imported, 0 comment\(s\) posted/)).toBeVisible();
        expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    });

    test('rejects a non-URL site and keeps the saved one', async ({ page }) => {
        await goto(page, '/settings?tab=jira', {
            allow: [/400 \(Bad Request\)/, /integrations\/jira/],
        });
        const site = page.getByPlaceholder('https://your-site.atlassian.net');
        await site.fill('not a url');
        await site.blur();
        await expect(page.getByText('Could not save')).toBeVisible();
    });

    test('Jira tab fits a phone screen @mobile', async ({ page }) => {
        await goto(page, '/settings?tab=jira');
        await expect(page.getByText('Jira connection')).toBeVisible();
        const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - window.innerWidth
        );
        expect(overflow).toBeLessThanOrEqual(0);
    });
});
