import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';
import { API, apiGet } from '../helpers/api.js';

// Settings → Model Registry: add, duplicate refused, note edited twice,
// rename locked, delete.

const NAME = `e2e-model-${Date.now()}:latest`;
type Model = { id: string; model_name: string; note: string | null };
const findModel = async (request: import('@playwright/test').APIRequestContext) =>
    (await apiGet<Model[]>(request, '/api/cli-models')).find((m) => m.model_name === NAME);

test.afterAll(async ({ request }) => {
    const m = await findModel(request);
    if (m) await request.delete(`${API}/api/cli-models/${m.id}`);
});

test('model registry: add, duplicate, edit twice, delete', async ({ page, request }) => {
    await goto(page, '/settings?tab=models', { allow: [/409 \(Conflict\)/] });
    // Ollama is the last CLI card, so its Add model is the last one.
    const addOllama = () => page.getByRole('button', { name: 'Add model' }).last();

    await addOllama().click();
    await page.getByRole('dialog').getByRole('textbox').first().fill(NAME);
    await page.getByRole('dialog').getByRole('textbox').nth(1).fill('note one');
    await page.getByRole('dialog').getByRole('button', { name: 'Add model' }).click();
    await expect.poll(async () => (await findModel(request))?.note).toBe('note one');

    await addOllama().click();
    await page.getByRole('dialog').getByRole('textbox').first().fill(NAME);
    await page.getByRole('dialog').getByRole('button', { name: 'Add model' }).click();
    await expect(page.getByText('Model already in registry for this CLI')).toBeVisible();
    await page.keyboard.press('Escape');

    for (const note of ['note two', 'note three']) {
        // The row, not the "Model added" toast that also names it.
        await page.locator('[role="button"]:not(button)').filter({ hasText: NAME }).click();
        await expect(page.getByRole('dialog').getByRole('textbox').first()).toBeDisabled();
        await page.getByRole('dialog').getByRole('textbox').nth(1).fill(note);
        await page.getByRole('dialog').getByRole('button', { name: /Save/ }).click();
        await expect.poll(async () => (await findModel(request))?.note).toBe(note);
    }

    await page.locator(`button[aria-label="Remove ${NAME}"]`).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete model' }).click();
    await expect(page.getByText('Model removed')).toBeVisible();
    await expect.poll(() => findModel(request)).toBeUndefined();
});

test('a model an agent still uses cannot be removed', async ({ page, request }) => {
    const agents = await apiGet<{ model: string | null }[]>(request, '/api/agents');
    const used = new Set(agents.map((a) => a.model).filter(Boolean));
    const target = (await apiGet<Model[]>(request, '/api/cli-models')).find((m) => used.has(m.model_name));
    test.skip(!target, 'no seeded agent uses a registry model');
    await goto(page, '/settings?tab=models', { allow: [/409 \(Conflict\)/] });
    await page.locator(`button[aria-label="Remove ${target!.model_name}"]`).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete model' }).click();
    await expect(page.getByText("Couldn't remove the model")).toBeVisible();
    expect((await apiGet<Model[]>(request, '/api/cli-models')).some((m) => m.id === target!.id)).toBe(true);
});

