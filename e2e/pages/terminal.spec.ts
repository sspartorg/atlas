import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// 2026-06-22 — Terminal v1 Playwright spec. Drives the Start → Pause →
// Resume → Stop lifecycle against the hermetic stack the e2e harness
// wires up:
//
//   * `e2e/fixtures/run-seed.ts` inserts a `projects` row called
//     "E2E Terminal" pointing at a local bare-repo clone so worktree
//     provisioning + the Stop push step both succeed without network
//     or real credentials.
//   * `e2e/global-setup.ts` exports `ATLAS_CLAUDE_BINARY` so the
//     cli-session-host spawns `e2e/fixtures/fake-claude(.cmd|.js)`
//     instead of the real `claude`.

test.describe('/terminal', () => {
    test('renders without console errors', async ({ page }) => {
        await goto(page, '/terminal');
        await expect(page.getByRole('heading', { name: /Terminal/i }).first()).toBeVisible();
        await expect(page.getByRole('button', { name: /Start Session/i }).first()).toBeVisible();
    });

    test('Start Session dialog shows the form fields', async ({ page }) => {
        await goto(page, '/terminal');
        await page.getByRole('button', { name: /Start Session/i }).first().click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await expect(dialog.getByLabel('Project')).toBeVisible();
        await expect(dialog.getByLabel(/^Title/i)).toBeVisible();
        await expect(dialog.getByLabel(/^Branch name/i)).toBeVisible();
        await expect(dialog.getByLabel('Model')).toBeVisible();
        await expect(dialog.getByLabel(/^Initial prompt/i)).toBeVisible();
        await expect(dialog.getByLabel(/^Item/i)).toBeVisible();
        // Start is disabled until a project is picked.
        await expect(dialog.getByRole('button', { name: /^Start session$/ })).toBeDisabled();
    });

    test('linking a session to an item surfaces the item chip in the detail header', async ({ page }) => {
        test.setTimeout(120_000);

        await goto(page, '/terminal');
        await page.getByRole('button', { name: /Start Session/i }).first().click();

        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await dialog.getByLabel('Project').click();
        await page.getByRole('option', { name: 'E2E Terminal' }).click();

        // Item picker is enabled only after a project is chosen; type the
        // seeded id to filter the list, then pick the option.
        const itemField = dialog.getByLabel(/^Item/i);
        await itemField.click();
        await itemField.fill('ETM-1');
        await page.getByRole('option', { name: /ETM-1 — E2E linked epic/ }).click();

        await dialog.getByRole('button', { name: /^Start session$/ }).click();
        await expect(page).toHaveURL(/\/terminal\/[a-f0-9-]+$/, { timeout: 30_000 });

        // Detail-page header carries the linked item's id. We stay on
        // /terminal/<id> — back-navigation aborts in-flight WS+xterm
        // requests which the `goto` helper treats as failures.
        const itemChip = page.getByTestId('session-item-chip');
        await expect(itemChip).toHaveText('ETM-1', { timeout: 30_000 });
    });

    test('start → pause → resume → stop lifecycle', async ({ page }) => {
        // The lifecycle does real worktree provisioning, PTY spawn, and a
        // git push back to the bare-repo fixture. Bump the per-test
        // timeout above the global 60s default.
        test.setTimeout(180_000);

        await goto(page, '/terminal');
        await page.getByRole('button', { name: /Start Session/i }).first().click();

        const startDialog = page.getByRole('dialog');
        await expect(startDialog).toBeVisible();

        // MUI Select renders as a combobox; click opens the listbox, then
        // we pick the seeded fixture project by name.
        await startDialog.getByLabel('Project').click();
        await page.getByRole('option', { name: 'E2E Terminal' }).click();

        await startDialog.getByRole('button', { name: /^Start session$/ }).click();

        // Route navigates to /terminal/:id once the POST returns.
        await expect(page).toHaveURL(/\/terminal\/[a-f0-9-]+$/, { timeout: 30_000 });

        // Status chip lives in the detail-page header. The testid keeps
        // us from matching list-card chips that briefly remain mounted
        // during the route transition.
        const statusChip = page.getByTestId('session-status-chip');
        await expect(statusChip).toHaveText(/^active$/i, { timeout: 30_000 });

        // fake-claude writes "[fake-claude] new session <uuid>" + "ready"
        // to stdout. xterm.js renders that into `.xterm` once the WS
        // attaches.
        const xterm = page.locator('.xterm').first();
        await expect(xterm).toContainText('[fake-claude]', { timeout: 30_000 });

        // PAUSE — chip flips to `paused`, xterm overlay reads
        // "Session is not active".
        await page.getByRole('button', { name: /^Pause$/ }).click();
        await expect(statusChip).toHaveText(/^paused$/i, { timeout: 30_000 });
        await expect(page.getByText(/Session is not active/i)).toBeVisible();

        // RESUME — chip flips back to `active`, fake-claude's resume
        // branch writes "[fake-claude] resuming session <uuid>".
        await page.getByRole('button', { name: /^Resume$/ }).click();
        await expect(statusChip).toHaveText(/^active$/i, { timeout: 30_000 });
        await expect(xterm).toContainText(/resuming session/i, { timeout: 30_000 });

        // STOP — open the modal. `ensureWorktreeGitignore` writes +
        // stages a `.gitignore` on the freshly-provisioned worktree, so
        // preflight returns one porcelain entry (`A  .gitignore`). The
        // commit-message field is pre-filled with "Terminal session
        // changes" so clicking confirm ships the commit, pushes the
        // branch to the bare-repo fixture, and tears the worktree down.
        await page.getByRole('button', { name: /^Stop$/ }).click();
        const stopDialog = page.getByRole('dialog');
        await expect(stopDialog).toBeVisible();
        // Opt out of the PR. The fixture remote is a bare repo with no GitHub
        // behind it, so `gh pr create` has nothing to talk to — unchecking
        // keeps this assertion about commit + push + teardown, and exercises
        // the bypass at the same time. It also pins the button label, which
        // otherwise reads "Stop & open PR" whenever something is staged.
        const prBox = stopDialog.getByRole('checkbox', { name: /open a pull request/i });
        await expect(prBox).toBeVisible({ timeout: 30_000 });
        if (await prBox.isEnabled()) await prBox.uncheck();
        const confirm = stopDialog.getByRole('button', { name: /^Stop session$/ });
        await expect(confirm).toBeEnabled({ timeout: 30_000 });
        await confirm.click();

        // When the stop API returns, the session row flips to `closed` and the
        // frontend receives the SSE event. TerminalSession.tsx then calls
        // navigate(`/terminal/${id}/history`, { replace: true }) — the live
        // view returns null for closed sessions so the status chip leaves the
        // DOM before we could ever see it read "closed". Wait for the URL
        // redirect to /history instead: that IS the observable "session is
        // closed" signal. 120s gives the git commit + push to the bare-repo
        // fixture time to finish before the API responds with the new status.
        await expect(page).toHaveURL(/\/terminal\/[a-f0-9-]+\/history$/, { timeout: 120_000 });
    });

    test('GitHub Copilot CLI session creates without 500 (Windows PTY-spawn regression)', async ({ page }) => {
        // 2026-06-25 — regression spec for the Windows copilot PTY bug
        // surfaced by the live MCP walkthrough.
        // Real-world failure mode (now fixed by spawnSpecForWindows in
        // services/cli-session-host.ts):
        //   POST /api/cli/sessions with cli=copilot returned 500
        //   "PTY spawn failed: Cannot create process, error code: 2"
        // because the modern npm@7+ copilot.cmd wrapper uses a shell-trick
        // (`endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & ...`)
        // that node-pty's ConPTY layer CreateProcessW can't execute. The
        // fix wraps bare-name spawns through `cmd.exe /c <name>`.
        //
        // In the e2e stack ATLAS_COPILOT_BINARY points at
        // e2e/fixtures/fake-copilot.{js,cmd} — an ABSOLUTE path — so the
        // wrap is intentionally bypassed (fake fixtures invoke directly).
        // The contract this spec asserts is: regardless of which spawn
        // path runs, the route returns 201 and the session shows up.
        test.setTimeout(90_000);

        await goto(page, '/terminal');
        await page.getByRole('button', { name: /Start Session/i }).first().click();

        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();

        await dialog.getByRole('button', { name: 'GitHub Copilot' }).click();
        await dialog.getByLabel('Project').click();
        await page.getByRole('option', { name: 'E2E Terminal' }).click();

        const branch = `atlas/terminal/copilot-e2e-${Date.now().toString(36)}`;
        await dialog.getByLabel(/^Branch name/i).fill(branch);

        const createResponse = page.waitForResponse(
            (r) => r.url().endsWith('/api/cli/sessions') && r.request().method() === 'POST',
            { timeout: 60_000 },
        );
        await dialog.getByRole('button', { name: /^Start session$/ }).click();
        const res = await createResponse;
        expect(res.status(), `POST /api/cli/sessions copilot expected 201 (was ${res.status()})`).toBe(201);
        const body = await res.json();
        expect(body.cli).toBe('copilot');
        expect(body.status).toBe('active');

        // Detail page should land on the new session ID.
        await expect(page).toHaveURL(new RegExp(`/terminal/${body.id}$`), { timeout: 10_000 });
    });

    test('GitHub Copilot toggle persists when re-opening Start Session dialog', async ({ page }) => {
        // Lightweight UI assertion that the radio-style CLI toggle works
        // and the model selector swaps to copilot defaults on toggle.
        await goto(page, '/terminal');
        await page.getByRole('button', { name: /Start Session/i }).first().click();

        const dialog = page.getByRole('dialog');
        await expect(dialog.getByRole('button', { name: 'Claude Code', pressed: true })).toBeVisible();

        await dialog.getByRole('button', { name: 'GitHub Copilot' }).click();
        await expect(dialog.getByRole('button', { name: 'GitHub Copilot', pressed: true })).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'Claude Code', pressed: false })).toBeVisible();

        await dialog.getByRole('button', { name: 'Claude Code' }).click();
        await expect(dialog.getByRole('button', { name: 'Claude Code', pressed: true })).toBeVisible();
    });
});
