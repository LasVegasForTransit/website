import { expect, test } from '../../scripts/deploy/access-browser';

test('keeps program attendance links readable on paper', async ({ page }) => {
  await page.emulateMedia({ media: 'print' });
  await page.goto('/programs');
  await page.waitForLoadState('networkidle');
  const action = page.locator('.program-feature-event-action');
  await expect(action).toBeVisible();
  const paper = await action.evaluate((link) => ({
    background: getComputedStyle(link).backgroundColor,
    destination: link.querySelector('[data-print-link]')?.textContent,
    href: link.getAttribute('href'),
  }));
  expect(paper.background).toBe('rgba(0, 0, 0, 0)');
  expect(paper.destination).toContain(paper.href?.replace(/\/$/, ''));
  await expect(page.locator('.program-feature-onward').first()).toBeHidden();
});
