import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// ConfirmDeleteModal is opened via IssueDeleteAction — a kebab-menu
// component embedded in TaskDetail and SubTaskDetail. The e2e seed inserts
// Task ETM-1 (project: e2e-terminal-project), so /tasks/ETM-1 is always
// present and its kebab menu has a "Delete this task…" entry that opens
// the modal.
//
// We never click "Delete task" — that mutates data and breaks isolation.
// All specs dismiss via Cancel or Esc.

test.describe('ConfirmDeleteModal', () => {
    async function openDeleteModal(page: Parameters<typeof goto>[0]) {
        await goto(page, '/tasks/ETM-1');
        // Wait for the Task title to confirm the detail page rendered.
        await expect(page.getByText('E2E linked task')).toBeVisible();
        // The IssueDeleteAction renders a RowActionMenu button. Its aria-label
        // is "<Singular> actions" → "Task actions".
        await page.getByRole('button', { name: /Task actions/i }).click();
        // Click the delete menu item.
        await page.getByRole('menuitem', { name: /Delete this task/i }).click();
    }

    test('open from Task detail — dialog visible with heading', async ({ page }) => {
        await openDeleteModal(page);
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        // FormHeading renders as <p>; text is "Delete this task?"
        await expect(
            dialog.getByText('Delete this task?', { exact: true })
        ).toBeVisible();
    });

    test('impact copy and Cancel button visible', async ({ page }) => {
        await openDeleteModal(page);
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        // The body mentions the entity title and the nested-impact phrase.
        await expect(dialog.getByText(/cannot be undone/i)).toBeVisible();
        await expect(dialog.getByRole('button', { name: /Cancel/i })).toBeVisible();
    });

    test('Cancel button closes the modal without deleting', async ({ page }) => {
        await openDeleteModal(page);
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await dialog.getByRole('button', { name: /Cancel/i }).click();
        await expect(dialog).not.toBeVisible();
        // Task should still be on the page.
        await expect(page.getByText('E2E linked task')).toBeVisible();
    });
});
