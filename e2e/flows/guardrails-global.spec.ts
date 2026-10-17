import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { goto } from '../helpers/nav.js';
import { API, apiGet } from '../helpers/api.js';
import { one, sql } from '../helpers/db.js';

// The global /guardrails page against the real API: a rule is added (category
// + severity picked), edited (moved to another category, severity changed),
// read back after a reload and by the API, and deleted after a confirm; the
// session counter and Save bar; scripts add / edit / delete; and every row,
// chip and card works from the keyboard. Rules start "E2E-GG", scripts
// "e2e-gg-"; both are removed afterwards and the save stamp is restored.

interface Rule {
    id: string;
    category: string;
    rule_text: string;
    detail: string | null;
    severity: string;
}
let publishedAt = '';

async function cleanup(request: APIRequestContext) {
    for (const [id] of sql(`SELECT id FROM guardrail_rules WHERE rule_text LIKE 'E2E-GG%'`)) await request.delete(`${API}/api/guardrails/${id}`);
    for (const [id] of sql(`SELECT id FROM guardrail_scripts WHERE id LIKE 'e2e-gg-%'`)) await request.delete(`${API}/api/guardrail-scripts/${id}`);
}
test.beforeAll(async ({ request }) => {
    await cleanup(request);
    publishedAt = one(`SELECT coalesce(guardrails_published_at::text, '') FROM settings WHERE id = 1`);
});
test.beforeEach(async ({ request }) => cleanup(request));
test.afterAll(async ({ request }) => {
    await cleanup(request);
    sql(`UPDATE settings SET guardrails_published_at = ${publishedAt ? `'${publishedAt}'` : 'NULL'} WHERE id = 1`);
});

const rules = async (request: APIRequestContext) => (await apiGet<{ rules: Rule[] }>(request, '/api/guardrails')).rules.filter((r) => r.rule_text.startsWith('E2E-GG'));
const toast = (page: Page, text: string) => page.getByText(text, { exact: true }).first();
/** The innermost box holding a category's label and its "Add rule to …" button: that category's card. */
const card = (page: Page, label: string) =>
    page.locator('div').filter({ has: page.getByText(label, { exact: true }) }).filter({ has: page.getByRole('button', { name: `Add rule to ${label}` }) }).last();

function watchErrors(page: Page): string[] {
    const errors: string[] = [];
    page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    return errors;
}

test('a rule is added with its category and severity, edited, survives a reload, and is deleted after a confirm', async ({ page, request }) => {
    const errors = watchErrors(page);
    await goto(page, '/guardrails');
    await expect(page.getByRole('heading', { level: 1, name: 'Guard-rails' })).toBeVisible();
    const total = (await apiGet<{ rules: Rule[] }>(request, '/api/guardrails')).rules.length;
    await expect(page.locator('main header')).toContainText(`5 categories · ${total} rules`);

    await page.getByRole('button', { name: 'Add rule to File System' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Add rule', { exact: true }).first()).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^File System/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog.getByRole('button', { name: /^BLOCK/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog.getByRole('button', { name: 'Add rule' })).toBeDisabled();
    await dialog.getByRole('textbox', { name: 'Rule' }).fill('E2E-GG never touch `/etc`');
    await dialog.getByLabel('Detail').fill('System files are off limits.');
    await dialog.getByRole('button', { name: /^Secrets & Credentials/ }).click();
    await dialog.getByRole('button', { name: /^WARN/ }).click();
    await expect(dialog.getByRole('button', { name: /^WARN/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog.getByRole('button', { name: /^BLOCK/ })).toHaveAttribute('aria-pressed', 'false');
    await dialog.getByRole('button', { name: 'Add rule' }).click();
    await expect(toast(page, 'Rule added')).toBeVisible();
    await expect(dialog).toHaveCount(0);
    expect(await rules(request)).toEqual([expect.objectContaining({ category: 'secrets_credentials', rule_text: 'E2E-GG never touch `/etc`', detail: 'System files are off limits.', severity: 'warn' })]);
    const row = page.getByRole('button', { name: /E2E-GG never touch/ });
    await expect(card(page, 'Secrets & Credentials').getByRole('button', { name: /E2E-GG never touch/ })).toBeVisible();
    await expect(row).toContainText('WARN');
    await expect(page.locator('main header')).toContainText(`${total + 1} rules · 1 dirty`);
    await expect(page.getByText('1 rule changed this session')).toBeVisible();

    // Edit: another category and severity.
    await row.click();
    await expect(dialog.getByText('Edit rule', { exact: true }).first()).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: 'Rule' })).toHaveValue('E2E-GG never touch `/etc`');
    await expect(dialog.getByRole('button', { name: /^Secrets & Credentials/ })).toHaveAttribute('aria-pressed', 'true');
    await dialog.getByRole('textbox', { name: 'Rule' }).fill('E2E-GG never touch system files');
    await dialog.getByRole('button', { name: /^Git & Branches/ }).click();
    await dialog.getByRole('button', { name: /^ASK OWNER/ }).click();
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(toast(page, 'Rule updated')).toBeVisible();
    await expect(page.getByText('2 rules changed this session')).toBeVisible();

    await page.reload();
    const edited = page.getByRole('button', { name: /E2E-GG never touch system files/ });
    await expect(card(page, 'Git & Branches').getByRole('button', { name: /E2E-GG never touch system files/ })).toBeVisible();
    await expect(card(page, 'Secrets & Credentials').getByRole('button', { name: /E2E-GG/ })).toHaveCount(0);
    expect((await rules(request))[0]).toMatchObject({ category: 'git_branches', severity: 'ask_owner', rule_text: 'E2E-GG never touch system files' });

    // Delete: Cancel keeps it; Delete removes it.
    await edited.click();
    await dialog.getByRole('button', { name: 'Delete rule' }).click();
    const confirm = page.getByRole('dialog').filter({ hasText: 'Delete this rule?' });
    await expect(confirm).toContainText("Removes this rule from Git & Branches. Agents won't see it on their next run.");
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    expect(await rules(request)).toHaveLength(1);
    await dialog.getByRole('button', { name: 'Delete rule' }).click();
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(toast(page, 'Rule deleted')).toBeVisible();
    await expect(page.getByRole('button', { name: /E2E-GG/ })).toHaveCount(0);
    expect(await rules(request)).toEqual([]);
    expect(errors).toEqual([]);
});

test('Save Guard-rails stamps the set and resets the counter; Discard only clears the counter', async ({ page, request }) => {
    await goto(page, '/guardrails');
    await expect(page.getByText('No unsaved changes')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Discard' })).toBeDisabled();
    await page.getByRole('button', { name: 'Add rule to Escalation & Scope' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: 'Rule' }).fill('E2E-GG ask before scope creep');
    await dialog.getByRole('button', { name: 'Add rule' }).click();
    await expect(page.getByText('1 rule changed this session')).toBeVisible();
    await page.getByRole('button', { name: 'Discard' }).click();
    await expect(page.getByText('No unsaved changes')).toBeVisible();
    // Discard never removes a saved rule.
    expect(await rules(request)).toHaveLength(1);

    await page.getByRole('button', { name: /E2E-GG ask before scope creep/ }).click();
    await dialog.getByLabel('Detail').fill('Ask the Owner first.');
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('1 rule changed this session')).toBeVisible();
    await page.getByRole('button', { name: 'Save Guard-rails' }).click();
    await expect(toast(page, 'Guard-rails saved')).toBeVisible();
    await expect(page.getByText('No unsaved changes')).toBeVisible();
    await expect(page.getByText(/Saved .* by Owner/)).toBeVisible();
    expect(one(`SELECT guardrails_published_at IS NOT NULL FROM settings WHERE id = 1`)).toBe('t');
});

test('a blank rule cannot be added; the API refuses a bad category or severity', async ({ page, request }) => {
    await goto(page, '/guardrails');
    await page.getByRole('button', { name: 'Add rule to File System' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: 'Rule' }).fill('   ');
    await expect(dialog.getByRole('button', { name: 'Add rule' })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    for (const data of [{ category: 'nope', rule_text: 'E2E-GG x', severity: 'warn' }, { category: 'file_system', rule_text: 'E2E-GG x', severity: 'loud' }, { category: 'file_system', rule_text: '', severity: 'warn' }]) {
        expect((await request.post(`${API}/api/guardrails`, { data })).status(), JSON.stringify(data)).toBe(400);
    }
    expect(await rules(request)).toEqual([]);
});

test('keyboard: rows, category chips and severity cards work with Tab, Enter and Space', async ({ page, request }) => {
    await request.post(`${API}/api/guardrails`, { data: { category: 'side_effects_network', rule_text: 'E2E-GG no outbound calls', detail: null, severity: 'block' } });
    await goto(page, '/guardrails');
    const row = page.getByRole('button', { name: /E2E-GG no outbound calls/ });
    await row.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(row).toBeFocused();
    await expect(row).toHaveCSS('outline-style', 'solid');
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('textbox', { name: 'Rule' })).toHaveValue('E2E-GG no outbound calls');
    const fs = dialog.getByRole('button', { name: /^File System/ });
    await fs.focus();
    await page.keyboard.press(' ');
    await expect(fs).toHaveAttribute('aria-pressed', 'true');
    const warn = dialog.getByRole('button', { name: /^WARN/ });
    await warn.focus();
    await page.keyboard.press('Enter');
    await expect(warn).toHaveAttribute('aria-pressed', 'true');
    await dialog.getByRole('button', { name: 'Save changes' }).focus();
    await page.keyboard.press('Enter');
    await expect(toast(page, 'Rule updated')).toBeVisible();
    expect((await rules(request))[0]).toMatchObject({ category: 'file_system', severity: 'warn' });
    // Escape closes the modal and focus returns to the row it came from.
    await page.getByRole('button', { name: /E2E-GG no outbound calls/ }).focus();
    await page.keyboard.press(' ');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: /E2E-GG no outbound calls/ })).toBeFocused();
});

test.describe('Scripts tab', () => {
    const scripts = async (request: APIRequestContext) =>
        (await apiGet<Array<{ id: string; name: string; description: string | null; body_sh: string }>>(request, '/api/guardrail-scripts')).filter((s) => s.id.startsWith('e2e-gg-'));

    test('a script is added, edited (slug locked) and deleted after a confirm; bad input is refused', async ({ page, request }) => {
        await goto(page, '/guardrails');
        await page.getByRole('tab', { name: /^Scripts/ }).click();
        await expect(page.getByText(/Shell scripts the reviewer runs as machine-verified evidence checks\. \d+ scripts? configured\./)).toBeVisible();
        await page.getByRole('button', { name: 'Add script', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Add script' });
        await dialog.getByLabel('Slug (id)').fill('E2E Bad Slug');
        await dialog.getByLabel('Name').fill('E2E lint');
        await dialog.getByLabel('.sh body (POSIX)').fill('exit 0');
        await expect(dialog.getByRole('button', { name: 'Add script' })).toBeDisabled();
        await dialog.getByLabel('.ps1 body (Windows PowerShell)').fill('exit 0');
        await dialog.getByRole('button', { name: 'Add script' }).click();
        await expect(dialog.getByText('Slug must be lowercase kebab-case (a-z, 0-9, hyphens); must start and end with a letter or digit.')).toBeVisible();
        await dialog.getByLabel('Slug (id)').fill('e2e-gg-lint');
        await dialog.getByLabel('Description (optional)').fill('Lints everything');
        await dialog.getByRole('button', { name: 'Add script' }).click();
        await expect(toast(page, 'Script added')).toBeVisible();
        await expect(page.getByText('check-e2e-gg-lint.sh')).toBeVisible();
        expect(await scripts(request)).toEqual([expect.objectContaining({ id: 'e2e-gg-lint', name: 'E2E lint', description: 'Lints everything', body_sh: 'exit 0' })]);

        // A second script with the same slug is refused.
        const dup = await request.post(`${API}/api/guardrail-scripts`, { data: { id: 'e2e-gg-lint', name: 'dup', body_sh: 'exit 0', body_ps1: 'exit 0' } });
        expect(dup.status()).toBe(409);

        await page.getByRole('button', { name: /E2E lint/ }).click();
        const edit = page.getByRole('dialog', { name: 'Edit script' });
        await expect(edit.getByLabel('Slug (id)')).toBeDisabled();
        await edit.getByLabel('Name').fill('E2E lint v2');
        await edit.getByLabel('.sh body (POSIX)').fill('echo ok\nexit 0');
        await edit.getByRole('button', { name: 'Save changes' }).click();
        await expect(toast(page, 'Script updated')).toBeVisible();
        await page.reload();
        await page.getByRole('tab', { name: /^Scripts/ }).click();
        await expect(page.getByRole('button', { name: /E2E lint v2/ })).toBeVisible();
        expect((await scripts(request))[0]).toMatchObject({ name: 'E2E lint v2', body_sh: 'echo ok\nexit 0' });

        await page.getByRole('button', { name: /E2E lint v2/ }).press('Enter');
        await edit.getByRole('button', { name: 'Delete' }).click();
        const confirm = page.getByRole('dialog', { name: 'Delete this script?' });
        await expect(confirm).toContainText('Removes "E2E lint v2". Agents no longer get it from the next run.');
        await confirm.getByRole('button', { name: 'Delete' }).click();
        await expect(toast(page, 'Script deleted')).toBeVisible();
        await expect(page.getByText('check-e2e-gg-lint.sh')).toHaveCount(0);
        expect(await scripts(request)).toEqual([]);
    });
});
