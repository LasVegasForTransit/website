import { expect, test } from '@playwright/test';
import { preparePageForA11y } from './a11y-helpers';

test.describe('form accessibility', () => {
  test('newsletter signup exposes a labelled email field and live status', async ({ page }) => {
    await page.goto('/newsletter');
    await preparePageForA11y(page);

    const form = page.locator('form[data-newsletter-form]').first();
    await expect(form.getByLabel('Email address')).toBeVisible();
    await expect(form.locator('input[name="email"]')).toHaveAttribute('required', '');

    const status = page.locator('[data-form-status]').first();
    await expect(status).toHaveAttribute('role', 'status');
    await expect(status).toHaveAttribute('aria-live', 'polite');
    await expect(form.getByRole('button', { name: 'Subscribe' })).toBeVisible();
  });
});
