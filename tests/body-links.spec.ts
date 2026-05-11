import { expect, test } from '@playwright/test';

const LINKEDIN_URL = 'https://www.linkedin.com/company/lasvegasfortransit/';

test.describe('body content links', () => {
  test('renders LinkedIn in contact and footer social surfaces', async ({ page }) => {
    await page.goto('/contact');
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready);

    const contactLinkedIn = page.locator(`aside a[href="${LINKEDIN_URL}"]`).first();
    const footerLinkedIn = page.locator(`footer a[href="${LINKEDIN_URL}"]`).first();

    await expect(contactLinkedIn).toBeVisible();
    await contactLinkedIn.hover();
    await expect(contactLinkedIn).toHaveCSS('color', 'rgb(229, 71, 26)');

    await expect(footerLinkedIn).toBeVisible();
    await footerLinkedIn.hover();
    await expect(footerLinkedIn).toHaveCSS('color', 'rgb(229, 71, 26)');
  });

  test('gives body links visible hover feedback on light surfaces', async ({ page }) => {
    await page.goto('/about');
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready);

    const ledeLink = page.locator('.lede a[href="/go"]').first();

    await ledeLink.hover();
    await expect(ledeLink).toHaveCSS('color', 'rgb(229, 71, 26)');
  });

  test('gives direct contact email links visible hover feedback', async ({ page }) => {
    await page.goto('/contact');
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready);

    const emailLink = page.locator('a[href^="mailto:"]').first();

    await emailLink.hover();
    await expect(emailLink).toHaveCSS('color', 'rgb(229, 71, 26)');
  });

  test('uses an inline editorial treatment in prose and lede copy', async ({ page }) => {
    await page.goto('/about');
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready);

    const storyLink = page.locator('.prose-doc a[href="/vision"]').first();
    const ledeLink = page.locator('.lede a[href="/go"]').first();

    await expect(storyLink).toHaveCSS('text-decoration-line', 'underline');
    await expect(storyLink).toHaveCSS('font-weight', '600');

    await expect(ledeLink).toHaveCSS('text-decoration-line', 'underline');
    await expect(ledeLink).toHaveCSS('font-weight', '600');
  });

  test('keeps vision closeout links visibly linked at rest', async ({ page }) => {
    await page.goto('/vision');
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready);

    const closeoutLink = page.locator('.close-pointers a[href="/projects"]').first();

    await expect(closeoutLink).toHaveCSS('text-decoration-line', 'underline');
    await expect(closeoutLink).toHaveCSS('font-weight', '800');
  });
});
