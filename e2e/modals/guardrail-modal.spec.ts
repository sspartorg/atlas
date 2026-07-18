import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

test.describe('GuardrailModal', () => {
    test('Add rule button opens GuardrailModal dialog', async ({ page }) => {
        await goto(page, '/guardrails');
        await page.getByRole('button', { name: /add rule to file system/i }).first().click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        // The form heading text varies between "Add rule" / "Edit rule" and
        // is FormHeading-rendered (not a heading role); the dialog presence
        // + the Rule label suffice as the "modal opens" assertion.
        await expect(dialog.getByLabel(/^Rule/)).toBeVisible();
    });

    test('modal renders Rule field, Detail field, and Severity selectors', async ({ page }) => {
        await goto(page, '/guardrails');
        await page.getByRole('button', { name: /add rule to file system/i }).first().click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        // Required Rule text field
        await expect(dialog.getByLabel(/^Rule/)).toBeVisible();
        // Optional Detail textarea
        await expect(dialog.getByLabel('Detail')).toBeVisible();
        // Severity section label
        await expect(dialog.getByText('Severity')).toBeVisible();
    });

    test('Esc closes GuardrailModal', async ({ page }) => {
        await goto(page, '/guardrails');
        await page.getByRole('button', { name: /add rule to file system/i }).first().click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(dialog).not.toBeVisible();
    });
});
