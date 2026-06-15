import { expect, test, type Page } from '@playwright/test';

const LINKEDIN_URL = 'https://www.linkedin.com/company/lasvegasfortransit/';
const SITE_URL = 'https://lasvegasfortransit.org';
const MEMBERSHIP_FORM_URL = 'https://forms.gle/mcLd4EQrGwRPA3bv7';

async function firstVirtualEventPath(page: Page): Promise<string> {
  await page.goto('/events');
  await page.waitForLoadState('networkidle');

  const eventPaths = [
    ...new Set(
      await page
        .locator('main a[href^="/events/"]')
        .evaluateAll((links) =>
          links
            .map((link) => new URL((link as HTMLAnchorElement).href).pathname.replace(/\/$/, ''))
            .filter((path) => /^\/events\/[^/]+$/.test(path)),
        ),
    ),
  ];

  for (const eventPath of eventPaths) {
    await page.goto(eventPath);
    await page.waitForLoadState('networkidle');

    if ((await page.locator('main a', { hasText: /Join →/ }).count()) > 0) {
      return eventPath;
    }
  }

  throw new Error('No current virtual event with a Join CTA was found from /events.');
}

test.describe('body content links', () => {
  test('renders the QR presenter deck with only concrete scan targets', async ({ page }) => {
    await page.goto('/qr');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex,nofollow',
    );

    const slides = page.locator('[data-qr-slide]');
    await expect(slides.first()).toHaveAttribute('data-qr-url', SITE_URL);
    await expect(slides.first().locator('svg')).toBeVisible();
    await expect(slides.first().locator('a[href="https://lasvegasfortransit.org"]')).toBeVisible();

    const destinations = await slides.evaluateAll((items) =>
      items.map((item) => (item as HTMLElement).dataset.qrUrl ?? ''),
    );

    expect(destinations.length).toBeGreaterThanOrEqual(1);
    expect(destinations[0]).toBe(SITE_URL);
    expect(destinations).not.toContain('');
    expect(destinations).not.toContain('undefined');

    // The membership form slide, when configured, sits immediately after the
    // website slide so it reads as the primary call to action.
    if (destinations.includes(MEMBERSHIP_FORM_URL)) {
      expect(destinations[1]).toBe(MEMBERSHIP_FORM_URL);
      await expect(slides.nth(1).locator(`a[href="${MEMBERSHIP_FORM_URL}"]`)).toBeVisible();
    }

    await expect(page.locator(`a[href="${LINKEDIN_URL}"]`)).toHaveCount(
      destinations.includes(LINKEDIN_URL) ? 1 : 0,
    );
  });

  test('exposes the Join page from persistent site chrome', async ({ page }) => {
    await page.goto('/about');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('nav[aria-label="Primary"] a[href="/join"]')).toHaveText('Join');
    await expect(page.locator('header a[data-mobile-join]')).toContainText('Join');
    await expect(page.locator('footer a[href="/join"]', { hasText: 'Join us' })).toBeVisible();
  });

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

    // The about-page prose link target tracks src/content/pages/about.mdx —
    // /about/strategy is the surviving in-body link while /vision is hidden.
    const storyLink = page.locator('.prose-doc a[href="/about/strategy"]').first();
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

  // Format-aware CTA: a virtual event's primary action invites the visitor to
  // join a call ("Join"). An in-person event must not advertise a join URL —
  // we'd be lying about the format. The contract guards the URL-regex hack
  // from sneaking back as a "fix" if someone ever touches the CTA logic.
  test('virtual event page shows the Join CTA', async ({ page }) => {
    await page.goto(await firstVirtualEventPath(page));

    // Scoped to <main> so the mobile site-header "Join" button doesn't
    // false-positive. The event-detail Join CTA lives in the event header
    // inside main; the site chrome lives outside main.
    const joinCta = page.locator('main a', { hasText: /Join →/ });
    await expect(joinCta).toBeVisible();
  });

  test('in-person event page does not advertise a Join CTA', async ({ page }) => {
    await page.goto('/events/2026-07-02-general-meeting');
    await page.waitForLoadState('networkidle');

    // Scoped to <main> so the mobile site-header "Join" button doesn't
    // false-positive. The event-detail Join CTA lives in the event header
    // inside main; the site chrome lives outside main.
    const joinCta = page.locator('main a', { hasText: /Join →/ });
    await expect(joinCta).toHaveCount(0);
  });

  // Per-event Add-to-calendar download. Static .ics file served from
  // /events/<id>.ics. Guards two things at once: (a) the route still
  // emits at build time; (b) the file is RFC 5545 enough that the OS
  // calendar handler will recognise it.
  test('virtual event publishes a valid .ics feed', async ({ page, request }) => {
    const eventPath = await firstVirtualEventPath(page);
    const response = await request.get(`${eventPath}.ics`);
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toContain('BEGIN:VCALENDAR');
    expect(body).toContain('BEGIN:VEVENT');
    expect(body).toContain('SUMMARY:LVBT General Meeting');
    expect(body).toMatch(/DTSTART:\d{8}T\d{6}Z/);
    expect(body).toMatch(/DTEND:\d{8}T\d{6}Z/);
    expect(body).toContain('LOCATION:https://meet.google.com/');
  });
});
