import { expect, test } from '@playwright/test';

test.describe('footer colophon', () => {
  test('indexes colophon while keeping QR out of the sitemap', async ({ page, request }) => {
    await page.goto('/colophon');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);

    await page.goto('/qr');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex,nofollow',
    );

    const sitemap = await request.get('/sitemap-0.xml');
    expect(sitemap.ok()).toBe(true);
    const body = await sitemap.text();
    expect(body).toContain('<loc>https://lasvegasfortransit.org/colophon/</loc>');
    expect(body).not.toContain('<loc>https://lasvegasfortransit.org/qr/</loc>');
    expect(body).not.toContain('<loc>https://lasvegasfortransit.org/vision/</loc>');
  });

  test('keeps the footer usable on wide-short and landscape viewports', async ({ page }) => {
    async function inspectFooter(width: number, height: number) {
      await page.setViewportSize({ width, height });
      await page.goto('/about');
      await page.waitForLoadState('networkidle');
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => {
        document
          .querySelectorAll('.reveal, .reveal-stat, .reveal-quote')
          .forEach((el) => el.classList.add('is-visible'));
        const footer = document.querySelector('footer') as HTMLElement | null;
        window.scrollTo({ top: footer?.offsetTop ?? 0, left: 0, behavior: 'instant' });
      });
      await page.waitForFunction(
        () => Math.abs(document.querySelector('footer')!.getBoundingClientRect().top) < 1,
      );

      return page.evaluate(() => {
        const box = (selector: string) => {
          const el = document.querySelector(selector);
          if (!el) throw new Error(`Missing footer element: ${selector}`);
          const rect = el.getBoundingClientRect();
          return {
            top: rect.top,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
          };
        };

        return {
          viewportHeight: window.innerHeight,
          grid: box('footer .footer-primary'),
          wordmark: box('footer [data-footer-wordmark]'),
          organization: box('footer [data-footer-nav="organization"]'),
          getInvolved: box('footer [data-footer-nav="get-involved"]'),
          mission: box('footer .footer-mission'),
          missionText: box('footer .footer-mission p'),
          meta: box('footer .footer-meta'),
        };
      });
    }

    const wideShort = await inspectFooter(1220, 735);

    expect(wideShort.meta.bottom).toBeLessThanOrEqual(wideShort.viewportHeight + 1);
    expect(wideShort.organization.width).toBeLessThan(260);
    expect(wideShort.getInvolved.width).toBeLessThan(260);
    expect(wideShort.organization.width).toBeGreaterThanOrEqual(176);
    expect(wideShort.getInvolved.width).toBeGreaterThanOrEqual(176);
    expect(wideShort.mission.bottom - wideShort.missionText.bottom).toBeLessThanOrEqual(64);

    const landscape = await inspectFooter(844, 390);

    for (const region of [
      landscape.grid,
      landscape.wordmark,
      landscape.organization,
      landscape.getInvolved,
      landscape.mission,
    ]) {
      expect(region.top).toBeGreaterThanOrEqual(8);
      expect(region.bottom).toBeLessThanOrEqual(landscape.meta.top);
    }

    expect(landscape.missionText.height).toBeGreaterThan(0);
  });

  test('uses a compact footer utility row with attribution moved to colophon', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/about');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('footer')).not.toContainText('Website made with love');
    await expect(page.locator('footer a[href="/colophon"]', { hasText: 'Colophon' })).toBeVisible();

    const utilityLinks = page.locator('footer nav[aria-label="Site utilities"] a');
    await expect(utilityLinks).toHaveCount(4);

    const meta = page.locator('footer .footer-meta');
    const utilityNav = page.locator('footer nav[aria-label="Site utilities"]');

    const [metaBox, navBox] = await Promise.all([meta.boundingBox(), utilityNav.boundingBox()]);
    expect(metaBox).not.toBeNull();
    expect(navBox).not.toBeNull();
    expect(metaBox!.height).toBeLessThanOrEqual(48);
    expect(navBox!.x).toBeGreaterThanOrEqual(metaBox!.x);
    expect(navBox!.x + navBox!.width).toBeLessThanOrEqual(metaBox!.x + metaBox!.width);
  });

  test('keeps the colophon on the standard type scale without overline labels', async ({
    page,
  }) => {
    await page.goto('/colophon');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('main .eyebrow')).toHaveCount(0);
    await expect(page.locator('h1')).toHaveText('Colophon');
    await expect(page.locator('h1')).toHaveClass(/text-display-md/);
    await expect(page.locator('main .lede')).toHaveText(
      'How this website is produced and maintained',
    );
  });
});
