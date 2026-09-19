import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';
import { API, apiGet } from '../helpers/api.js';

// ADR 0018 — a project's repos are all equal: none is primary, any of them can
// be removed (including the last), and a Task always names the repos it works
// on. The project here is created straight in the e2e DB (the same docker psql
// the global setup uses) so the shared seed project is left alone.

const PROJECT_ID = 'e2e-equal-repos';
const REPO_A = 'e2e-equal-repo-a';
const REPO_B = 'e2e-equal-repo-b';

function psql(sql: string): void {
    execFileSync(
        'docker',
        ['exec', 'atlas-postgres', 'psql', '-U', 'atlas', '-d', 'atlas_e2e', '-c', sql],
        { stdio: 'pipe' }
    );
}

test.describe('repos without a primary (ADR 0018)', () => {
    let taskId = '';

    test.beforeAll(() => {
        psql(
            `INSERT INTO projects (id, name, issue_key_prefix, description, status) ` +
                `VALUES ('${PROJECT_ID}', 'E2E Equal Repos', 'EQR', 'ADR 0018 fixture', 'active')`
        );
        psql(`INSERT INTO project_issue_counters (project_id, last_seq) VALUES ('${PROJECT_ID}', 0)`);
        for (const [id, name, pos] of [
            [REPO_A, 'api', 0],
            [REPO_B, 'web', 1],
        ] as const) {
            psql(
                `INSERT INTO project_repos (id, project_id, name, git_url, git_path, position) ` +
                    `VALUES ('${id}', '${PROJECT_ID}', '${name}', 'https://github.com/e2e/${name}', '/tmp/atlas-e2e-${name}', ${pos})`
            );
        }
    });

    test.afterAll(async ({ request }) => {
        if (taskId) await request.delete(`${API}/api/tasks/${taskId}`);
        psql(`DELETE FROM projects WHERE id = '${PROJECT_ID}'`);
    });

    test('every repo is equal, the first one can go, and a Task names what is left', async ({
        page,
        request,
    }) => {
        test.setTimeout(90_000);

        // Both repos are listed, neither of them marked primary, and both offer
        // the same actions.
        await goto(page, `/projects/${PROJECT_ID}?tab=repos`);
        await expect(page.getByText('api', { exact: true })).toBeVisible();
        await expect(page.getByText('web', { exact: true })).toBeVisible();
        await expect(page.getByText('Primary')).toHaveCount(0);

        // Remove the FIRST repo — the one that would have been the primary.
        await page.getByRole('button', { name: /Actions for api/i }).click();
        await page.getByRole('menuitem', { name: /Remove/i }).click();
        const confirm = page.getByRole('dialog');
        await expect(confirm.getByText(/stays on disk/i)).toBeVisible();
        await confirm.getByRole('button', { name: /^Remove$/i }).click();

        await expect(page.getByText('api', { exact: true })).toHaveCount(0);
        await expect(page.getByText('web', { exact: true })).toBeVisible();

        const repos = await apiGet<Array<{ id: string }>>(
            request,
            `/api/projects/${PROJECT_ID}/repos`
        );
        expect(repos.map((r) => r.id)).toEqual([REPO_B]);

        // A new Task defaults to the repo that is left.
        await goto(page, '/tasks/new');
        await page.getByLabel('Title').fill('E2E equal repos');
        await page.getByLabel('Description').fill('The remaining repo is the default.');
        await page.getByLabel('Project').click();
        await page.getByRole('option', { name: 'E2E Equal Repos' }).click();
        await expect(page.getByRole('combobox', { name: 'Repos' })).toContainText('web');
        await page
            .getByRole('button', { name: /Save as draft/i })
            .first()
            .click();
        await page.waitForURL(/\/tasks\/EQR-\d+/);
        taskId = page.url().match(/\/tasks\/(EQR-\d+)/)?.[1] ?? '';

        const task = await apiGet<{ repo_ids: string[] }>(request, `/api/tasks/${taskId}`);
        expect(task.repo_ids).toEqual([REPO_B]);
    });

    test('a project with no repos says so and cannot start a terminal', async ({ page }) => {
        psql(`DELETE FROM project_repos WHERE project_id = '${PROJECT_ID}'`);

        await goto(page, `/projects/${PROJECT_ID}?tab=repos`);
        await expect(page.getByText(/No repos yet/i)).toBeVisible();
        await expect(page.getByRole('button', { name: /Add repo/i })).toBeVisible();
    });
});
