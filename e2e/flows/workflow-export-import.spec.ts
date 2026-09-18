import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';
import { API, PROJECT_NAME, apiGet, chainGraph, createWorkflow } from '../helpers/api.js';

// Builder Export → Workflows Import round trip. The e2e seed has one project,
// so the bundle goes back into it and the name clash takes " (imported)".

test.describe('Workflow export → import', () => {
    const name = `E2E export ${Date.now()}`;
    const workflowIds: string[] = [];

    test.afterAll(async ({ request }) => {
        for (const id of workflowIds) await request.delete(`${API}/api/workflows/${id}`);
    });

    test('a builder export imports as a new workflow', async ({ page, request }, testInfo) => {
        const wf = await createWorkflow(request, name, chainGraph({ type: 'agent', agent_id: 'agent-po-writer' }));
        workflowIds.push(wf.id);
        const agent = await apiGet<{ cli: string; model: string; effort: string }>(request, '/api/agents/agent-po-writer');

        await goto(page, `/workflows/${wf.id}`);
        await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
        // Agent nodes carry cli · model · effort.
        await expect(page.locator('.react-flow__node').getByText(`${agent.cli} · ${agent.model} · ${agent.effort}`)).toBeVisible();

        const downloading = page.waitForEvent('download');
        await page.getByRole('link', { name: /Export/ }).click();
        const download = await downloading;
        expect(download.suggestedFilename()).toMatch(/\.zip$/);
        const zipPath = testInfo.outputPath(download.suggestedFilename());
        await download.saveAs(zipPath);

        await goto(page, '/workflows');
        // The name carries the `upload` icon ligature.
        await page.getByRole('button', { name: /Import$/ }).click();
        const dialog = page.getByRole('dialog', { name: 'Import workflow' });
        const submit = dialog.getByRole('button', { name: 'Import', exact: true });
        await expect(submit).toBeDisabled();
        await dialog.getByRole('combobox', { name: 'Project' }).click();
        await page.getByRole('option', { name: PROJECT_NAME }).click();
        await dialog.getByTestId('workflow-zip-input').setInputFiles(zipPath);
        await expect(dialog.getByText(download.suggestedFilename())).toBeVisible();
        await submit.click();

        await expect(dialog).toBeHidden();
        await expect(page).toHaveURL(/\/workflows\/[^/?]+$/);
        const importedId = new URL(page.url()).pathname.split('/').pop() ?? '';
        expect(importedId).not.toBe(wf.id);
        workflowIds.unshift(importedId);
        await expect(page.getByRole('heading', { name: `${name} (imported)`, exact: true })).toBeVisible();
        await expect(page.locator('.react-flow__node')).toHaveCount(3);

        const imported = await apiGet<{ graph: { nodes: Array<{ agent_id?: string }> } }>(
            request,
            `/api/workflows/${importedId}`,
        );
        expect(imported.graph.nodes.map((n) => n.agent_id).filter(Boolean)).toEqual(['agent-po-writer']);
    });
});
