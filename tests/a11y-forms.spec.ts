import { expect, test } from '@playwright/test';

test.describe('newsletter accessibility', () => {
  test('exposes the hosted newsletter through a named link', async ({ page }) => {
    await page.goto('/newsletter');

    await expect(page.getByRole('heading', { level: 1, name: 'Newsletter' })).toBeVisible();
    const newsletter = page.getByRole('link', { name: 'Read every issue' });
    await expect(newsletter).toBeVisible();
    await expect(newsletter).toHaveAttribute('href', 'https://mail.lasvegasfortransit.org/');
  });
});
