import http from 'node:http';
import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';
import { API, PROJECT_NAME, apiGet, chainGraph, createWorkflow } from '../helpers/api.js';

// Jira bridge v2 end to end against a fake Jira board: the per-project status
// mapping set in the UI decides what imports and where the issue moves; the
// "Comments from Jira" section (with a reply) and an attached screenshot show
// on the Task; a Done issue moved back to Selected in Jira reopens the same
// Task.

const KEY = `MAP-${Date.now()}`;
const AUTH = `Basic ${Buffer.from('owner@e2e.test:e2e-token').toString('base64')}`;
// A real 1×1 PNG, so the browser can decode the inline screenshot.
const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
);
const BOARD = ['Backlog', 'Selected for Development', 'Development in Progress', 'QA in Progress', 'Info Needed', 'In Review', 'Done'];

let status = 'Backlog';
let server: http.Server;
let site = '';
const posted: string[] = [];
const moves: string[] = [];

test.beforeAll(async () => {
    server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (c: Buffer) => (raw += c.toString()));
        req.on('end', () => {
            const url = new URL(req.url ?? '/', 'http://fake');
            const send = (code: number, body: unknown) => {
                res.writeHead(code, { 'content-type': 'application/json' });
                res.end(body === null ? undefined : JSON.stringify(body));
            };
            if (req.headers.authorization !== AUTH) return send(401, { errorMessages: ['bad credentials'] });
            if (url.pathname === '/secure/attachment/900/screenshot.png') {
                res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(PNG.length) });
                return res.end(PNG);
            }
            if (url.pathname === '/rest/api/2/myself') return send(200, { displayName: 'Fake Owner' });
            if (url.pathname === '/rest/api/2/search/jql') {
                return send(200, {
                    issues: [
                        {
                            id: '20001',
                            key: KEY,
                            fields: {
                                summary: 'Fix the login screen',
                                description: 'h2. Bug\nThe button overlaps: !screenshot.png|thumbnail!',
                                issuetype: { name: 'Bug', subtask: false },
                                status: { name: status },
                                priority: { name: 'High' },
                                labels: ['e2e-map'],
                                updated: '2026-10-01T10:00:00.000+0000',
                                attachment: [
                                    {
                                        id: '900',
                                        filename: 'screenshot.png',
                                        mimeType: 'image/png',
                                        size: PNG.length,
                                        content: `${site}/secure/attachment/900/screenshot.png`,
                                    },
                                ],
                                comment: {
                                    comments: [
                                        { id: '1', author: { displayName: 'Pat PO' }, body: 'Happens on Safari only?', created: '2026-10-01T11:00:00.000+0000' },
                                        { id: '2', parentId: '1', author: { displayName: 'Sam QA' }, body: 'Chrome too.', created: '2026-10-01T12:00:00.000+0000' },
                                    ],
                                    total: 2,
                                },
                            },
                        },
                    ],
                });
            }
            if (url.pathname === `/rest/api/2/issue/${KEY}` && req.method === 'GET') {
                return send(200, { key: KEY, fields: { status: { name: status } } });
            }
            if (url.pathname === `/rest/api/3/issue/${KEY}/comment` && req.method === 'POST') {
                posted.push(raw);
                return send(201, { id: `c${posted.length + 100}` });
            }
            if (url.pathname === `/rest/api/2/issue/${KEY}/transitions` && req.method === 'GET') {
                return send(200, {
                    transitions: BOARD.map((name, i) => ({ id: `t${i}`, to: { name, statusCategory: { key: name === 'Done' ? 'done' : 'indeterminate' } } })),
                });
            }
            if (url.pathname === `/rest/api/2/issue/${KEY}/transitions` && req.method === 'POST') {
                const id = (JSON.parse(raw) as { transition: { id: string } }).transition.id;
                status = BOARD[Number(id.slice(1))]!;
                moves.push(status);
                return send(204, null);
            }
            return send(404, { errorMessages: [`unexpected ${req.method} ${url.pathname}`] });
        });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    site = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

let projectId = '';
test.afterAll(async ({ request }) => {
    server.close();
    if (projectId) {
        for (const s of await apiGet<{ id: number }[]>(request, `/api/projects/${projectId}/jira-sources`)) {
            await request.delete(`${API}/api/projects/${projectId}/jira-sources/${s.id}`);
        }
        await request.patch(`${API}/api/projects/${projectId}`, { data: { jira_status_map: null } });
    }
    await request.put(`${API}/api/integrations/jira`, { data: { enabled: false, site_url: null, email: null } });
});

test('mapping drives import, queueing, Jira moves and reopen; comments and a screenshot show on the Task', async ({ page, request }) => {
    test.setTimeout(180_000);
    const sync = async () => {
        const r = await request.post(`${API}/api/integrations/jira/sync`);
        expect(r.status(), await r.text()).toBeLessThan(300);
    };
    const projects = await apiGet<{ id: string; name: string }[]>(request, '/api/projects');
    projectId = projects.find((p) => p.name === PROJECT_NAME)?.id ?? projects[0]!.id;
    const wf = await createWorkflow(request, `E2E mapping ${Date.now()}`, chainGraph({ type: 'agent', agent_id: 'agent-po-writer' }));
    await request.put(`${API}/api/integrations/jira`, {
        data: { site_url: site, email: 'owner@e2e.test', api_token: 'e2e-token', enabled: true },
    });
    const repos = await apiGet<{ id: string }[]>(request, `/api/projects/${projectId}/repos`);
    await request.post(`${API}/api/projects/${projectId}/jira-sources`, {
        data: { jql: 'labels = e2e-map', workflow_id: wf.id, repo_ids: [repos[0]!.id] },
    });

    // The mapping, through the UI.
    await goto(page, `/projects/${projectId}?tab=jira`);
    const fill = (label: string, v: string) => page.getByLabel(`Jira statuses for ${label}`).fill(v);
    await fill('Draft', 'Backlog');
    await fill('Ready', 'Selected for Development');
    await fill('In Progress', 'Development in Progress, QA in Progress');
    await fill('Waiting for Info', 'Info Needed');
    await fill('In Review', 'In Review');
    await fill('Done', 'Done');
    await page.getByRole('button', { name: 'Save mapping' }).click();
    await expect(page.getByText('Status mapping saved')).toBeVisible();

    // Backlog → imported as Draft, not queued.
    await sync();
    type T = { id: string; title: string; status: string };
    const find = async () => (await apiGet<T[]>(request, '/api/tasks')).find((t) => t.title.startsWith(`[${KEY}]`));
    const task = await find();
    expect(task?.status).toBe('draft');

    // The Task page: comments section with the reply, and the screenshot inline.
    await goto(page, `/tasks/${task!.id}`);
    await expect(page.getByText('Comments from Jira').first()).toBeVisible();
    await expect(page.getByText(/Sam QA/).first()).toBeVisible();
    await expect(page.getByText(/replied to/).first()).toBeVisible();
    const shot = page.locator('img[src^="/api/jira-attachments/"]').first();
    await expect(shot).toBeVisible();
    expect(await shot.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);

    // Moved to Selected in Jira → Ready (queued on the source's workflow).
    status = 'Selected for Development';
    await sync();
    expect((await find())?.status).toBe('ready');

    // The workflow works it (agent steps simulated); Jira follows to Done.
    const run = await request.post(`${API}/api/workflows/${wf.id}/runs`, { data: { item_id: task!.id } });
    expect(run.status()).toBeLessThan(300);
    await expect.poll(async () => (await find())?.status, { timeout: 60_000, intervals: [1_000] }).toBe('done');
    await sync();
    // The simulated run finishes between syncs, so Atlas reports where the Task
    // is now (Done) — each intermediate move is covered in jira-sync.test.ts.
    expect(moves.at(-1)).toBe('Done');
    expect(status).toBe('Done');

    // Reopened in Jira → the same Task comes back Ready, and Atlas says so.
    status = 'Selected for Development';
    await sync();
    const reopened = await find();
    expect(reopened?.id).toBe(task!.id);
    expect(reopened?.status).toBe('ready');
    expect(posted.at(-1)).toContain('reopened');
});

test('the mapping form refuses an incomplete or clashing mapping, and clears', async ({ page, request }) => {
    const projects = await apiGet<{ id: string; name: string }[]>(request, '/api/projects');
    const pid = projects.find((p) => p.name === PROJECT_NAME)?.id ?? projects[0]!.id;
    await request.patch(`${API}/api/projects/${pid}`, { data: { jira_status_map: null } });
    await goto(page, `/projects/${pid}?tab=jira`);
    await expect(page.getByText(/Not set: Jira's status is ignored/)).toBeVisible();

    await page.getByLabel('Jira statuses for Done').fill('Done');
    await page.getByRole('button', { name: 'Save mapping' }).click();
    await expect(page.getByText('Map at least one Jira status to Ready')).toBeVisible();

    await page.getByLabel('Jira statuses for Draft').fill('Backlog');
    await page.getByLabel('Jira statuses for Ready').fill('Selected, done');
    await page.getByRole('button', { name: 'Save mapping' }).click();
    await expect(page.getByText(/"Done" is already mapped to Ready/)).toBeVisible();
    expect((await apiGet<{ jira_status_map: unknown }>(request, `/api/projects/${pid}`)).jira_status_map).toBeNull();

    await page.getByLabel('Jira statuses for Ready').fill('Selected');
    await page.getByRole('button', { name: 'Save mapping' }).click();
    await expect(page.getByText('Status mapping saved')).toBeVisible();
    await page.getByRole('button', { name: 'Clear mapping' }).click();
    await expect(page.getByText('Status mapping cleared')).toBeVisible();
    await expect.poll(async () => (await apiGet<{ jira_status_map: unknown }>(request, `/api/projects/${pid}`)).jira_status_map).toBeNull();
});

test('the status mapping card fits a phone @mobile', async ({ page, request }) => {
    const projects = await apiGet<{ id: string; name: string }[]>(request, '/api/projects');
    const pid = projects.find((p) => p.name === PROJECT_NAME)?.id ?? projects[0]!.id;
    await goto(page, `/projects/${pid}?tab=jira`);
    await expect(page.getByText('Status mapping').first()).toBeVisible();
    await expect(page.getByLabel('Jira statuses for Waiting for Info')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
