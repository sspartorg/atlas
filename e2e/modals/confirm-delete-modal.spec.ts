import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// ConfirmDeleteModal is opened via IssueDeleteAction — a kebab-menu
// component embedded in EpicDetail, StoryDetail, BugDetail, SubTaskDetail,
// and SubBugDetail. The e2e seed inserts item ETM-1 (type: epic, project:
// e2e-terminal-project), so /epics/ETM-1 is always present and its kebab
// menu has a "Delete this epic…" entry that opens the modal.
//
// We never click "Delete epic" — that mutates data and breaks isolation.
// All specs dismiss via Cancel or Esc.

test.describe('ConfirmDeleteModal', () => {
    async function openDeleteModal(page: Parameters<typeof goto>[0]) {
        await goto(page, '/epics/ETM-1');
        // Wait for the epic title to confirm the detail page rendered.
        await expect(page.getByText('E2E linked epic')).toBeVisible();
        // The IssueDeleteAction renders a RowActionMenu button. Its aria-label
        // is "<Singular> actions" → "Epic actions".
        await page.getByRole('button', { name: /Epic actions/i }).click();
        // Click the delete menu item.
        await page.getByRole('menuitem', { name: /Delete this epic/i }).click();
    }

    test('open from epic detail — dialog visible with heading', async ({ page }) => {
        await openDeleteModal(page);
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        // FormHeading renders as <p>; text is "Delete this epic?"
        await expect(
            dialog.getByText('Delete this epic?', { exact: true })
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
        // Epic should still be on the page.
        await expect(page.getByText('E2E linked epic')).toBeVisible();
    });
});
