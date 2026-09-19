import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';
import { API, apiGet, chainGraph, createWorkflow } from '../helpers/api.js';

// ADR 0017 — a project with two repos, a Task spanning both, one workflow run
// working them side by side. Adding a repo through the UI needs a GitHub remote,
// so the second repo is a local clone registered straight in the e2e DB (the
// same docker psql the global setup uses) and removed afterwards.

const PROJECT_ID = 'e2e-terminal-project';
const FIX_DIR = join(tmpdir(), 'atlas-e2e-fixtures');
const WEB_BARE = join(FIX_DIR, 'web.git');
const WEB_CLONE = join(FIX_DIR, 'web');
const REPO_ID = 'e2e-web-repo';

function psql(sql: string): void {
    execFileSync(
        'docker',
        ['exec', 'atlas-postgres', 'psql', '-U', 'atlas', '-d', 'atlas_e2e', '-c', sql],
        { stdio: 'pipe' }
    );
}

function makeRepo(): void {
    const git = (...args: string[]) => execFileSync('git', args, { stdio: 'pipe' });
    rmSync(WEB_BARE, { recursive: true, force: true });
    rmSync(WEB_CLONE, { recursive: true, force: true });
    mkdirSync(FIX_DIR, { recursive: true });
    git('init', '--bare', '-b', 'main', WEB_BARE);
    git('clone', WEB_BARE, WEB_CLONE);
    git('-C', WEB_CLONE, 'config', 'user.email', 'e2e@atlas.local');
    git('-C', WEB_CLONE, 'config', 'user.name', 'Atlas E2E Bot');
    writeFileSync(join(WEB_CLONE, 'README.md'), '# web\n');
    git('-C', WEB_CLONE, 'add', 'README.md');
    git('-C', WEB_CLONE, 'commit', '-m', 'init');
    git('-C', WEB_CLONE, 'push', '-u', 'origin', 'main');
}

test.describe('multi-repo Task (ADR 0017/0018)', () => {
    let taskId = '';
    let workflowId = '';

    test.beforeAll(() => {
        makeRepo();
        // ADR 0018 — the seed's own repo carries the project's id; this is
        // the project's second repo.
        psql(
            `INSERT INTO project_repos (id, project_id, name, git_url, git_path, position) ` +
                `VALUES ('${REPO_ID}', '${PROJECT_ID}', 'web', 'https://github.com/e2e/web', '${WEB_CLONE}', 1)`
        );
    });

    test.afterAll(async ({ request }) => {
        if (taskId) await request.delete(`${API}/api/tasks/${taskId}`);
        if (workflowId) await request.delete(`${API}/api/workflows/${workflowId}`);
        psql(`DELETE FROM project_repos WHERE id = '${REPO_ID}'`);
        rmSync(WEB_BARE, { recursive: true, force: true });
        rmSync(WEB_CLONE, { recursive: true, force: true });
    });

    test('a Task picks both repos and one run checks them out side by side', async ({
        page,
        request,
    }) => {
        test.setTimeout(120_000);

        // The project's Repos tab lists both repos, neither of them special.
        await goto(page, `/projects/${PROJECT_ID}?tab=repos`);
        await expect(page.getByText('project', { exact: true }).first()).toBeVisible();
        await expect(page.getByText('web', { exact: true }).first()).toBeVisible();
        await expect(page.getByText('Primary')).toHaveCount(0);

        // New Task: the picker is always there; the first repo comes preselected.
        await goto(page, '/tasks/new');
        await page.getByLabel('Title').fill('E2E change across api and web');
        await page.getByLabel('Description').fill('An endpoint and the client that calls it.');
        await page.getByLabel('Project').click();
        await page.getByRole('option', { name: 'E2E Terminal' }).click();
        await page.getByLabel('Repos').click();
        await page.getByRole('option', { name: /^web/ }).click();
        await page.keyboard.press('Escape');
        await page
            .getByRole('button', { name: /Submit/i })
            .first()
            .click();
        await page.waitForURL(/\/tasks\/ETM-\d+/);
        taskId = page.url().match(/\/tasks\/(ETM-\d+)/)?.[1] ?? '';

        const task = await apiGet<{ repo_ids: string[] }>(request, `/api/tasks/${taskId}`);
        expect(task.repo_ids).toEqual([PROJECT_ID, REPO_ID]);
        // The Task page's Repos row shows both.
        await expect(page.getByText('web', { exact: true }).first()).toBeVisible();

        // One workflow run over both repos (AI is off in e2e: steps pass).
        const wf = await createWorkflow(
            request,
            'E2E multi-repo',
            chainGraph({ type: 'agent', agent_id: 'agent-po-writer' })
        );
        workflowId = wf.id;
        const started = await request.post(`${API}/api/workflows/${wf.id}/runs`, {
            data: { item_id: taskId },
        });
        expect(started.status(), await started.text()).toBeLessThan(300);
        const { run_id: runId } = (await started.json()) as { run_id: string };
        await expect
            .poll(
                async () =>
                    (await apiGet<{ status: string }>(request, `/api/workflow-runs/${runId}`))
                        .status,
                {
                    timeout: 60_000,
                    intervals: [1_000],
                }
            )
            .toBe('completed');

        const run = await apiGet<{ worktree_path: string }>(request, `/api/workflow-runs/${runId}`);
        const ws = join(FIX_DIR, 'worktrees', PROJECT_ID, 'ws', `atlas__wf__${taskId}`);
        expect(run.worktree_path).toBe(ws);
        // No push in e2e ("keep local"), so both checkouts stay for inspection.
        expect(existsSync(join(ws, 'project', '.git'))).toBe(true);
        expect(existsSync(join(ws, 'web', '.git'))).toBe(true);
        expect(
            execFileSync('git', ['-C', join(ws, 'web'), 'branch', '--show-current'])
                .toString()
                .trim()
        ).toBe(`atlas/wf/${taskId}`);
    });
});
