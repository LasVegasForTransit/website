import { expect, test, type Locator, type Page } from '@playwright/test';

const LINKEDIN_URL = 'https://www.linkedin.com/company/lasvegasfortransit/';
const SITE_URL = 'https://lasvegasfortransit.org';
const MEMBERSHIP_FORM_URL = 'https://forms.gle/mcLd4EQrGwRPA3bv7';
const CANDID_URL =
  'https://app.candid.org/profile/16646908/las-vegans-for-better-transit-42-1995935';

async function expectExternalOpenIcon(locator: Locator) {
  await expect(locator).toHaveJSProperty('tagName', 'A');
  const marker = await locator.evaluate((link) => {
    const pseudo = window.getComputedStyle(link, '::after');
    return {
      content: pseudo.content,
      display: pseudo.display,
      paddingInlineEnd: pseudo.paddingInlineEnd,
      maskImage:
        pseudo.getPropertyValue('mask-image') || pseudo.getPropertyValue('-webkit-mask-image'),
    };
  });

  expect(marker.content).not.toBe('none');
  expect(marker.display).not.toBe('none');
  expect(parseFloat(marker.paddingInlineEnd)).toBeGreaterThan(0);
  expect(marker.maskImage).not.toBe('none');
}

async function firstVirtualEventPath(page: Page): Promise<string | undefined> {
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

    if ((await page.locator('main a', { hasText: /^Join$/ }).count()) > 0) {
      return eventPath;
    }
  }

  return undefined;
}

async function firstProjectDetailPath(page: Page): Promise<string> {
  await page.goto('/projects');
  await page.waitForLoadState('networkidle');

  const projectPath = await page.locator('main a[href^="/projects/"]').evaluateAll((links) => {
    const paths = links
      .map((link) => (link as HTMLAnchorElement).getAttribute('href') ?? '')
      .map((href) => href.replace(/\/$/, ''))
      .filter((path) => /^\/projects\/[^/]+$/.test(path));
    return [...new Set(paths)][0];
  });

  if (!projectPath) throw new Error('No project detail link was found from /projects.');
  return projectPath;
}

test.describe('body content links', () => {
  test('serves a transit-flavored not found page for missing routes', async ({ page }) => {
    const response = await page.goto('/totally-missing-seo-audit-test/');
    await page.waitForLoadState('networkidle');

    expect(response?.status()).toBe(404);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex,nofollow',
    );
    await expect(page.locator('h1')).toHaveText('Missed the stop?');
    await expect(page.locator('main')).toContainText('This route is not on the map');
    await expect(page.locator('[data-not-found-page]')).toHaveCSS(
      'background-color',
      'rgb(255, 233, 214)',
    );
    await expect(page.locator('[data-site-search]')).toBeVisible();
    await expect(page.locator('[data-site-search] h2')).toHaveCount(0);
    await expect(page.locator('[data-site-search-input]')).toBeVisible();
    await expect(page.locator('[data-site-search-status]')).toBeEmpty();
    await expect(page.locator('[aria-label="Lost route details"]')).toHaveCount(0);
    await expect(page.locator('[aria-label="Helpful pages"]')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('Better frequency pending');
    await expect(page.locator('main')).not.toContainText('blaming the land use');
    await expect(page.locator('main a[href="/events"]')).toBeVisible();
    await expect(page.locator('main a[href="/go"]')).toBeVisible();
    await expect(page.locator('main a[href="/sitemap"]')).toHaveCount(0);
  });

  test('keeps the not found scene immersive through the main viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 820 });
    await page.goto('/totally-missing-seo-audit-test/');
    await page.waitForLoadState('networkidle');

    const coverage = await page.evaluate(() => {
      const main = document.querySelector('main');
      const scene = document.querySelector('[data-not-found-page]');
      const footer = document.querySelector('footer');
      if (!main || !scene || !footer) throw new Error('Missing 404 layout element');

      const mainBox = main.getBoundingClientRect();
      const sceneBox = scene.getBoundingClientRect();
      const footerBox = footer.getBoundingClientRect();
      const sampleY = Math.max(sceneBox.bottom - 2, mainBox.bottom - 2);
      const sampleElement = document.elementFromPoint(window.innerWidth / 2, sampleY);

      return {
        mainBottom: Math.round(mainBox.bottom),
        sceneBottom: Math.round(sceneBox.bottom),
        footerTop: Math.round(footerBox.top),
        sampledPrimaryScene: sampleElement?.closest('[data-not-found-page]') !== null,
      };
    });

    expect(coverage.sceneBottom).toBeGreaterThanOrEqual(coverage.mainBottom - 1);
    expect(coverage.footerTop).toBeLessThanOrEqual(coverage.sceneBottom + 1);
    expect(coverage.sampledPrimaryScene).toBe(true);
  });

  test('indexes brand and colophon while keeping QR out of the sitemap', async ({
    page,
    request,
  }) => {
    for (const path of ['/brand', '/colophon']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
    }

    await page.goto('/qr');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex,nofollow',
    );

    const sitemap = await request.get('/sitemap-0.xml');
    expect(sitemap.ok()).toBe(true);
    const body = await sitemap.text();
    expect(body).toContain('<loc>https://lasvegasfortransit.org/brand/</loc>');
    expect(body).toContain('<loc>https://lasvegasfortransit.org/colophon/</loc>');
    expect(body).not.toContain('<loc>https://lasvegasfortransit.org/qr/</loc>');
    expect(body).not.toContain('<loc>https://lasvegasfortransit.org/vision/</loc>');
  });

  test('builds 404 search results for public pages only', async ({ page }) => {
    await page.goto('/totally-missing-seo-audit-test/');
    await page.waitForLoadState('networkidle');

    const results = await page.evaluate(async () => {
      type PagefindResult = { data: () => Promise<{ url: string }> };
      type Pagefind = { search: (query: string) => Promise<{ results: PagefindResult[] }> };

      const pagefind = (await Function('return import("/pagefind/pagefind.js")')()) as Pagefind;
      const urlsFor = async (query: string) => {
        const search = await pagefind.search(query);
        const items = await Promise.all(search.results.slice(0, 10).map((result) => result.data()));
        return items.map((item) => item.url);
      };

      return {
        brand: await urlsFor('Clearspace logo assets'),
        colophon: await urlsFor('How this website is produced and maintained'),
        qr: await urlsFor('QR Presenter'),
      };
    });

    expect(results.brand).toContain('/brand/');
    expect(results.colophon).toContain('/colophon/');
    expect(results.qr).not.toContain('/qr/');
  });

  test('uses date-specific metadata for recurring event pages', async ({ page }) => {
    await page.goto('/events');
    await page.waitForLoadState('networkidle');

    const eventPaths = [
      ...new Set(
        await page
          .locator('main a[href^="/events/"]')
          .evaluateAll((links) =>
            links
              .map((link) => new URL((link as HTMLAnchorElement).href).pathname)
              .filter((path) => /^\/events\/[^/]+\/?$/.test(path)),
          ),
      ),
    ];

    const metaTitlesByHeading = new Map<string, string[]>();
    for (const eventPath of eventPaths) {
      await page.goto(eventPath);
      await page.waitForLoadState('networkidle');

      const heading = (await page.locator('h1').first().innerText()).trim();
      const metaTitle = await page.title();
      const titles = metaTitlesByHeading.get(heading) ?? [];
      titles.push(metaTitle);
      metaTitlesByHeading.set(heading, titles);
    }

    const repeatedEvents = [...metaTitlesByHeading.entries()].filter(
      ([, titles]) => titles.length > 1,
    );

    expect(repeatedEvents.length).toBeGreaterThan(0);
    for (const [heading, titles] of repeatedEvents) {
      expect(new Set(titles).size, heading).toBe(titles.length);
      for (const title of titles) {
        expect(title, heading).toMatch(/[A-Z][a-z]+ \d{1,2}, 20\d{2}/);
      }
    }
  });

  test('breadcrumbs avoid production URLs by default', async ({ page }) => {
    await page.goto(await firstProjectDetailPath(page));
    await page.waitForLoadState('networkidle');

    const breadcrumbLinks = await page
      .locator('nav[aria-label="Breadcrumb"] a')
      .evaluateAll((links) =>
        links.map((link) => (link as HTMLAnchorElement).getAttribute('href')),
      );

    expect(breadcrumbLinks).toEqual(['/', '/projects']);

    const breadcrumbSchema = await page.evaluate(() => {
      const schemas = Array.from(
        document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]'),
      ).map((script) => JSON.parse(script.textContent ?? '{}') as Record<string, unknown>);

      return schemas.find((schema) => schema['@type'] === 'BreadcrumbList') as
        | {
            itemListElement: Array<{
              item?: string;
              name: string;
            }>;
          }
        | undefined;
    });

    expect(breadcrumbSchema).toBeTruthy();
    expect(breadcrumbSchema?.itemListElement[0]?.item).toBe('/');
    expect(breadcrumbSchema?.itemListElement[1]?.item).toBe('/projects');
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
          footer: box('footer'),
          grid: box('footer .footer-primary'),
          wordmark: box('footer [data-footer-wordmark]'),
          organization: box('footer [data-footer-nav="organization"]'),
          getInvolved: box('footer [data-footer-nav="get-involved"]'),
          mission: box('footer .footer-mission'),
          missionText: box('footer .footer-mission p'),
          meta: box('footer .footer-meta'),
          organizationList: box('footer [data-footer-nav="organization"] ul'),
          getInvolvedList: box('footer [data-footer-nav="get-involved"] ul'),
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
    const utilityNav = page.locator('footer nav[aria-label="Site utilities"]');
    await expect(utilityNav.locator('a[href="/colophon"]', { hasText: 'Colophon' })).toBeVisible();
    await expect(utilityNav.locator('a[href="/brand"]', { hasText: 'Brand' })).toBeVisible();

    const utilityLinks = utilityNav.locator('a');
    await expect(utilityLinks).toHaveCount(5);

    const meta = page.locator('footer .footer-meta');

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

    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('h1')).toHaveClass(/text-display-md/);
    await expect(page.locator('main header .lede')).toBeVisible();
  });

  test('renders full brand guidelines with practical logo assets', async ({ page }) => {
    await page.goto('/brand');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('[data-brand-band]')).toHaveCount(0);
    await expect(page.locator('[data-brand-contents-frame]')).toBeAttached();
    expect(await page.locator('nav[aria-label="Contents"] a').count()).toBeGreaterThan(12);
    for (const id of [
      'foundations',
      'visual-style',
      'color',
      'typography',
      'layout',
      'logos',
      'voice',
    ]) {
      await expect(page.locator(`#${id}`)).toBeVisible();
    }

    await expect(page.locator('[data-brand-color]')).toHaveCount(5);
    await expect(page.locator('button[data-copy-color]')).toHaveCount(5);
    await page.locator('[data-brand-color="primary"]').click();
    await expect(page.locator('[data-brand-color-status]')).toHaveText('#E5471A copied.');
    await expect(page.locator('[data-brand-color="primary-container"]')).toContainText(
      '--color-on-primary-container',
    );

    const downloads = page.locator('main a[download^="lvbt-"]');
    await expect(downloads).toHaveCount(16);
    await expect(page.locator('[data-brand-logo-kit]')).toBeVisible();
    await expect(page.locator('[data-brand-logo-tabs] [role="tab"]')).toHaveCount(2);
    await expect(page.locator('[data-brand-logo-theme-tabs] [role="tab"]')).toHaveCount(2);
    await expect(page.locator('[data-brand-logo-panel]')).toHaveCount(4);
    await expect(page.locator('[data-brand-logo-panel]:visible')).toHaveCount(1);
    await expect(
      page.locator('[data-brand-logo-panel][data-logo-family="mark"][data-logo-theme="light"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-brand-logo-panel][data-logo-family="mark"][data-logo-theme="dark"]'),
    ).toBeHidden();
    await expect(
      page.locator(
        '[data-brand-logo-preview][data-logo-family="mark"][data-logo-theme="light"] [data-brand-logo-specimen] img',
      ),
    ).toBeVisible();
    await expect(page.locator('[data-brand-logo-asset="mark-light-svg"]')).toBeVisible();
    await expect(
      page.locator('[data-brand-logo-asset="mark-light-svg"] button[data-copy-logo]'),
    ).toBeVisible();
    await expect(page.locator('[data-brand-logo-raster] [data-brand-logo-asset]')).toHaveCount(16);
    await expect(page.locator('main a[download][href="/brand/lvbt-logo.svg"]')).toBeVisible();
    await expect(page.locator('main a[download][href="/brand/lvbt-logo-dark.svg"]')).toHaveCount(1);
    await expect(page.locator('main a[download][href="/brand/lvbt-wordmark.svg"]')).toHaveCount(1);
    await page.locator('[data-logo-tab="dark"]').click();
    await expect(
      page.locator('[data-brand-logo-panel][data-logo-family="mark"][data-logo-theme="light"]'),
    ).toBeHidden();
    await expect(
      page.locator('[data-brand-logo-panel][data-logo-family="mark"][data-logo-theme="dark"]'),
    ).toBeVisible();
    await expect(page.locator('[data-brand-logo-asset="mark-dark-svg"]')).toBeVisible();
    await page.locator('[data-logo-family-tab="wordmark"]').click();
    await expect(
      page.locator('[data-brand-logo-panel][data-logo-family="wordmark"][data-logo-theme="dark"]'),
    ).toBeVisible();
    await expect(page.locator('[data-brand-logo-asset="wordmark-dark-svg"]')).toBeVisible();
    await expect(page.locator('button[data-copy-logo]')).toHaveCount(16);
    await expect(page.locator('button[data-copy-logo]').first()).toHaveCSS('cursor', 'pointer');
    await expect(page.locator('button[data-copy-color]').first()).toHaveCSS('cursor', 'pointer');
  });

  test('keeps brand intro lean and moves navigation out of the hero', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/brand');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('[data-brand-intro] nav[aria-label="Contents"]')).toHaveCount(0);
    await expect(page.locator('[data-brand-contents-frame]')).toBeVisible();

    const layout = await page.evaluate(() => {
      const intro = document.querySelector('[data-brand-intro]');
      const contentsFrame = document.querySelector('[data-brand-contents-frame]');
      if (!intro || !contentsFrame) throw new Error('Missing brand layout element');

      const introBox = intro.getBoundingClientRect();

      return {
        introHeight: introBox.height,
        contentsPosition: getComputedStyle(contentsFrame).position,
      };
    });

    expect(layout.introHeight).toBeLessThan(330);
    expect(layout.contentsPosition).toBe('absolute');
  });

  test('keeps brand layout readable at major responsive widths', async ({ page }) => {
    for (const width of [390, 768, 1024, 1440, 1600]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/brand');
      await page.waitForLoadState('networkidle');

      const audit = await page.evaluate(() => {
        const overflowing = [...document.querySelectorAll('main *')].filter((element) => {
          const box = element.getBoundingClientRect();
          return box.width > 0 && (box.left < -1 || box.right > window.innerWidth + 1);
        });
        const cramped = [...document.querySelectorAll('[data-readable]')].filter((element) => {
          const box = element.getBoundingClientRect();
          const textLength = element.textContent?.trim().replace(/\s+/g, ' ').length ?? 0;
          return (
            textLength > 120 &&
            !element.closest('[data-brand-copy-pair]') &&
            box.width > 0 &&
            box.width < 260
          );
        });

        return {
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
          overflowingCount: overflowing.length,
          crampedCount: cramped.length,
        };
      });

      expect(audit.scrollWidth, `scroll width at ${width}px`).toBe(audit.innerWidth);
      expect(audit.overflowingCount, `overflowing elements at ${width}px`).toBe(0);
      expect(audit.crampedCount, `cramped readable elements at ${width}px`).toBe(0);
    }
  });

  test('keeps brand layout standardized at tablet landscape widths', async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 820 });
    await page.goto('/brand');
    await page.waitForLoadState('networkidle');

    const audit = await page.evaluate(() => {
      const shell = document.querySelector('[data-brand-shell]');
      const contentsFrame = document.querySelector('[data-brand-contents-frame]');
      const contents = document.querySelector('[data-brand-contents]');
      const principles = document.querySelector('[data-brand-principles]');
      const colors = document.querySelector('[data-brand-color-list]');
      const pairings = document.querySelector('[data-brand-color-pairings]');
      const preview = document.querySelector('[data-brand-preview]');
      const logoTabs = document.querySelector('[data-brand-logo-tabs-shell]');
      const logoAssets = document.querySelector('[data-brand-logo-raster]');
      const logoFrame = document.querySelector('[data-brand-logo-kit-frame]');
      if (
        !shell ||
        !contentsFrame ||
        !contents ||
        !principles ||
        !colors ||
        !pairings ||
        !logoTabs ||
        !logoAssets ||
        !logoFrame
      ) {
        throw new Error('Missing brand layout element');
      }

      return {
        shellColumns: getComputedStyle(shell).gridTemplateColumns.split(' ').length,
        contentsFramePosition: getComputedStyle(contentsFrame).position,
        hasColorPreview: preview !== null,
        contentsWidth: contents.getBoundingClientRect().width,
        contentsFrameRight: contentsFrame.getBoundingClientRect().right,
        principlesColumns: getComputedStyle(principles).gridTemplateColumns.split(' ').length,
        colorColumns: getComputedStyle(colors).gridTemplateColumns.split(' ').length,
        pairingColumns: [...pairings.querySelectorAll('[data-brand-color-pairing]')].map(
          (pairing) => getComputedStyle(pairing).gridTemplateColumns.split(' ').length,
        ),
        logoFrameColumns: getComputedStyle(logoFrame).gridTemplateColumns.split(' ').length,
        logoAssetColumns: [...logoAssets.querySelectorAll('[data-brand-logo-asset]')].map(
          (asset) => getComputedStyle(asset).gridTemplateColumns.split(' ').length,
        ),
      };
    });

    expect(audit.shellColumns).toBe(1);
    expect(audit.contentsFramePosition).toBe('relative');
    expect(audit.hasColorPreview).toBe(false);
    expect(audit.contentsWidth).toBeLessThan(220);
    expect(audit.contentsFrameRight).toBeLessThanOrEqual(1180);
    expect(audit.principlesColumns).toBe(2);
    expect(audit.colorColumns).toBe(2);
    expect(audit.pairingColumns).toEqual([2, 2, 2, 2, 2]);
    expect(audit.logoFrameColumns).toBe(2);
    expect(audit.logoAssetColumns).toEqual([1, 1, 1, 1]);
  });

  test('keeps brand guide rhythm closer to a reference manual', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/brand');
    await page.waitForLoadState('networkidle');

    const audit = await page.evaluate(() => {
      const principles = document.querySelector('[data-brand-principles]');
      const colorList = document.querySelector('[data-brand-color-list]');
      const shell = document.querySelector('[data-brand-shell]');
      const sections = [...document.querySelectorAll('[data-brand-section]')];
      const sectionHeaders = [...document.querySelectorAll('[data-brand-section-header]')];
      if (
        !principles ||
        !colorList ||
        !shell ||
        sections.length === 0 ||
        sectionHeaders.length === 0
      ) {
        throw new Error('Missing brand guide rhythm element');
      }

      const shellLeft = shell.getBoundingClientRect().left;

      return {
        principlesColumns: getComputedStyle(principles).gridTemplateColumns.split(' ').length,
        colorColumns: getComputedStyle(colorList).gridTemplateColumns.split(' ').length,
        colorWidth: colorList.getBoundingClientRect().width,
        sectionHeadingOffset: sectionHeaders.map((header) => {
          const heading = header.querySelector('h2');
          if (!heading) throw new Error('Missing section heading');
          return Math.round(heading.getBoundingClientRect().left - shellLeft);
        }),
        sectionHeaderPadding: sectionHeaders.map((header) => {
          const style = getComputedStyle(header);
          return {
            top: Number.parseFloat(style.paddingTop),
            bottom: Number.parseFloat(style.paddingBottom),
            left: Number.parseFloat(style.paddingLeft),
            right: Number.parseFloat(style.paddingRight),
          };
        }),
        sectionTopBorders: sections.map((section) => getComputedStyle(section).borderTopWidth),
      };
    });

    expect(audit.principlesColumns).toBe(2);
    expect(audit.colorColumns).toBe(2);
    expect(audit.colorWidth).toBeLessThanOrEqual(1088);
    expect(audit.sectionHeadingOffset.every((offset) => Math.abs(offset) <= 1)).toBe(true);
    expect(
      audit.sectionHeaderPadding.every(
        (padding) =>
          padding.top >= padding.left &&
          padding.top >= padding.right &&
          padding.bottom >= padding.left &&
          padding.bottom >= padding.right,
      ),
    ).toBe(true);
    expect(audit.sectionTopBorders.every((width) => width === '0px')).toBe(true);
  });

  test('renders contents as a compact table of contents, not a tab bar', async ({ page }) => {
    // iPad Mini portrait and tablet portrait: contents must hug its content,
    // stay collapsed, and never fill the content width like a tab strip.
    for (const width of [744, 768]) {
      await page.setViewportSize({ width, height: 1024 });
      await page.goto('/brand');
      await page.waitForLoadState('networkidle');

      const contents = page.locator('[data-brand-contents]');
      await expect(contents).toHaveJSProperty('tagName', 'DETAILS');
      await expect(contents).not.toHaveAttribute('open', '');

      const summary = contents.locator('> summary');
      await expect(summary).toBeVisible();
      await expect(summary).toContainText('Contents');

      const geometry = await page.evaluate(() => {
        const el = document.querySelector('[data-brand-contents]');
        const shell = document.querySelector('[data-brand-shell]');
        if (!el || !shell) throw new Error('Missing brand layout element');
        return {
          contentsWidth: el.getBoundingClientRect().width,
          shellWidth: shell.getBoundingClientRect().width,
        };
      });
      expect(geometry.contentsWidth).toBeLessThan(geometry.shellWidth * 0.5);
    }

    // Wide desktop: contents becomes an outside right rail with every link shown.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/brand');
    await page.waitForLoadState('networkidle');

    const nav = page.locator('nav[aria-label="Contents"]');
    await expect(nav).toBeVisible();
    expect(await nav.locator('a[href^="#"]').count()).toBeGreaterThan(12);
    await expect(nav.locator('a[href="#overview"]')).toBeVisible();
    await expect(nav.locator('a[href="#color-in-practice"]')).toBeVisible();
    await expect(nav.locator('a[href="#voice"]')).toBeVisible();
    await expect(nav.locator('a[href="#typography-display-large"]')).toHaveCount(0);
    await expect(nav.locator('a[href="#logos-lvbt-mark"]')).toHaveCount(0);
    await expect(page.locator('[data-brand-contents-frame]')).toHaveCSS('position', 'absolute');
    await expect(page.locator('[data-brand-contents]')).toHaveCSS('position', 'sticky');
  });

  test('keeps brand logo specimens responsive on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/brand');
    await page.waitForLoadState('networkidle');

    for (const family of ['mark', 'wordmark']) {
      await page.locator(`[data-logo-family-tab="${family}"]`).click();

      for (const theme of ['light', 'dark']) {
        await page.locator(`[data-logo-tab="${theme}"]`).click();

        const measurement = await page.evaluate(
          ({ family, theme }) => {
            const frame = document.querySelector('[data-brand-logo-kit-frame]');
            const preview = document.querySelector(
              `[data-brand-logo-preview][data-logo-family="${family}"][data-logo-theme="${theme}"]`,
            );
            const panel = document.querySelector(
              `[data-brand-logo-panel][data-logo-family="${family}"][data-logo-theme="${theme}"]`,
            );
            const specimen = preview?.querySelector('[data-brand-logo-specimen]');
            const details = panel?.querySelector('[data-brand-logo-details]');
            const actions = panel?.querySelector('[data-brand-logo-actions]');
            const tabs = document.querySelector('[data-brand-logo-tabs-shell]');
            if (!frame || !specimen || !details || !actions || !tabs) {
              throw new Error('Missing logo panel element');
            }

            const frameBox = frame.getBoundingClientRect();
            const specimenBox = specimen.getBoundingClientRect();
            const tabsBox = tabs.getBoundingClientRect();
            const detailsBox = details.getBoundingClientRect();
            const actionsBox = actions.getBoundingClientRect();

            return {
              frameWidth: frameBox.width,
              specimenWidth: specimenBox.width,
              tabsTop: tabsBox.top,
              tabsBottom: tabsBox.bottom,
              detailsTop: detailsBox.top,
              specimenBottom: specimenBox.bottom,
              actionsWidth: actionsBox.width,
            };
          },
          { family, theme },
        );

        expect(measurement.specimenWidth).toBeLessThanOrEqual(measurement.frameWidth);
        expect(measurement.tabsTop - measurement.specimenBottom).toBeLessThanOrEqual(1);
        expect(measurement.detailsTop - measurement.tabsBottom).toBeLessThanOrEqual(1);
        expect(measurement.actionsWidth).toBeLessThanOrEqual(measurement.frameWidth);
      }
    }
  });

  test('keeps brand color reference readable on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/brand');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('[data-brand-preview]')).toHaveCount(0);

    const colorMeasurements = await page.locator('[data-brand-color]').evaluateAll((cards) =>
      cards.map((card) => {
        const swatch = card.querySelector('[data-brand-color-swatch]');
        const copy = card.querySelector('[data-brand-color-copy]');
        if (!swatch || !copy) throw new Error('Missing color card element');

        const cardBox = card.getBoundingClientRect();
        const swatchBox = swatch.getBoundingClientRect();
        const copyBox = copy.getBoundingClientRect();

        return {
          cardWidth: cardBox.width,
          swatchWidth: swatchBox.width,
          copyTop: Math.round(copyBox.top),
          swatchBottom: Math.round(swatchBox.bottom),
          copyWidth: copyBox.width,
        };
      }),
    );

    for (const measurement of colorMeasurements) {
      expect(measurement.cardWidth).toBeGreaterThan(320);
      expect(measurement.copyWidth).toBeGreaterThan(230);
      expect(measurement.swatchWidth).toBeGreaterThan(160);
      expect(measurement.copyTop).toBeGreaterThanOrEqual(measurement.swatchBottom);
    }
  });

  test('uses semantic article headings for about approach items', async ({ page }) => {
    await page.goto('/about');
    await page.waitForLoadState('networkidle');

    const audit = await page.evaluate(() => {
      const heading = [...document.querySelectorAll('main h2')].find(
        (element) => element.textContent?.trim() === 'Our approach',
      );
      const section = heading?.closest('section');
      const list = section?.querySelector('ul[data-about-approach-list]');
      const articles = [...(list?.querySelectorAll('li > article') ?? [])];
      const itemHeadings = articles.map((article) => article.querySelector('h3'));
      const bodies = articles.map((article) => article.querySelector('p'));

      return {
        listTag: list?.tagName,
        approachDefinitionNodeCount: list?.querySelectorAll('dt, dd').length ?? 0,
        articleCount: articles.length,
        headingTags: itemHeadings.map((itemHeading) => itemHeading?.tagName ?? null),
        headingClasses: itemHeadings.map((itemHeading) => itemHeading?.className ?? ''),
        bodyClasses: bodies.map((body) => body?.className ?? ''),
      };
    });

    expect(audit.listTag).toBe('UL');
    expect(audit.approachDefinitionNodeCount).toBe(0);
    expect(audit.articleCount).toBe(5);
    expect(audit.headingTags.every((tag) => tag === 'H3')).toBe(true);
    expect(audit.headingClasses.every((className) => className.includes('text-title-lg'))).toBe(
      true,
    );
    expect(audit.headingClasses.some((className) => className.includes('text-title-md'))).toBe(
      false,
    );
    expect(audit.bodyClasses.every((className) => className.includes('text-body-md'))).toBe(true);
  });

  test('keeps top-level section headings on the larger MD3 headline style', async ({ page }) => {
    for (const path of ['/about', '/programs', '/go', '/join', '/brand', '/contact', '/events']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');

      const classes = await page.locator('main section h2:not(.sr-only)').evaluateAll((headings) =>
        headings.map((heading) => ({
          text: (heading as HTMLElement).innerText,
          className: (heading as HTMLElement).className,
        })),
      );

      expect(classes.length, path).toBeGreaterThan(0);
      expect(
        classes.every(({ className }) => className.includes('text-headline-lg')),
        JSON.stringify({ path, classes }),
      ).toBe(true);
      expect(
        classes.some(({ className }) => /text-(headline-md|headline-sm)/.test(className)),
        JSON.stringify({ path, classes }),
      ).toBe(false);
    }
  });

  test('does not render overline all-caps labels in site chrome and body content', async ({
    page,
  }) => {
    for (const path of [
      '/about',
      '/',
      '/programs',
      '/go',
      '/join',
      '/brand',
      '/contact',
      '/events',
      '/qr',
    ]) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');

      const transformed = await page
        .locator('body p, body span, body a, body button, body dt, body cite')
        .evaluateAll((elements) =>
          elements
            .filter((element) => {
              const rect = element.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            })
            .map((element) => {
              const style = getComputedStyle(element);
              return {
                text: (element.textContent ?? '').trim(),
                textTransform: style.textTransform,
              };
            })
            .filter(({ text, textTransform }) => text && textTransform === 'uppercase'),
        );

      expect(transformed, path).toEqual([]);
    }
  });

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
      items
        .map((item) => (item as HTMLElement).dataset.qrUrl ?? '')
        .filter((destination) => destination.length > 0),
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

    // Scoped to the individual scan cards — the flyer slide (further down
    // the same page) links to the same destinations again in its grid, so
    // a page-wide count would double this up.
    await expect(
      page.locator('[data-qr-slide]:not(.qr-flyer-slide)').locator(`a[href="${LINKEDIN_URL}"]`),
    ).toHaveCount(destinations.includes(LINKEDIN_URL) ? 1 : 0);
  });

  test('renders the QR flyer as a readable web slide', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/qr#qr-flyer');
    await page.waitForLoadState('networkidle');

    const hasJoinSlide = (await page.locator('#qr-join').count()) > 0;
    const flyer = await page.evaluate(() => {
      const slide = document.querySelector<HTMLElement>('#qr-flyer');
      const flyer = document.querySelector<HTMLElement>('.qr-flyer');
      const grid = document.querySelector<HTMLElement>('.qr-flyer-grid');
      const values = [...document.querySelectorAll<HTMLElement>('.qr-flyer-value')];
      if (!slide || !flyer || !grid || values.length === 0) {
        throw new Error('Missing QR flyer elements');
      }

      const slideStyle = getComputedStyle(slide);
      const flyerRect = flyer.getBoundingClientRect();
      const gridColumns = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean);
      const valueRects = values.map((value) => value.getBoundingClientRect());

      return {
        slideBackground: slideStyle.backgroundColor,
        flyerWidth: flyerRect.width,
        gridColumnCount: gridColumns.length,
        narrowestValue: Math.min(...valueRects.map((rect) => rect.width)),
        text: values.map((value) => value.textContent?.replace(/\s+/g, ' ').trim() ?? ''),
      };
    });

    expect(flyer.slideBackground).not.toBe('rgb(247, 244, 236)');
    expect(flyer.flyerWidth).toBeGreaterThanOrEqual(900);
    expect(flyer.gridColumnCount).toBeGreaterThanOrEqual(2);
    expect(flyer.narrowestValue).toBeGreaterThanOrEqual(130);
    expect(flyer.text).toContain('lasvegasfortransit.org');
    if (hasJoinSlide) expect(flyer.text).toContain('lasvegasfortransit.org/join');
    expect(flyer.text).not.toContain(MEMBERSHIP_FORM_URL.replace(/^https?:\/\//, ''));
  });

  test('exposes the Join page from persistent site chrome', async ({ page }) => {
    await page.goto('/about');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('nav[aria-label="Primary"] a[href="/join"]')).toHaveText('Join');
    await expect(page.locator('header a[data-mobile-join]')).toContainText('Join');
    await expect(page.locator('footer a[href="/join"]', { hasText: 'Join us' })).toBeVisible();
  });

  test('exposes the Programs page from persistent site chrome', async ({ page }) => {
    await page.goto('/about');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('nav[aria-label="Primary"] a[href="/programs"]')).toHaveText(
      'Programs',
    );
    await expect(page.locator('nav[aria-label="Primary"] a[href="/projects"]')).toHaveText(
      'Projects',
    );
    expect(await page.locator('footer a[href="/programs"]').count()).toBeGreaterThan(0);
    expect(await page.locator('footer a[href="/projects"]').count()).toBeGreaterThan(0);

    await page.goto('/programs');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('main h1')).toBeVisible();
    await expect(page.locator('main a[href="/projects"]')).toBeVisible();
    expect(await page.locator('main article, main li').count()).toBeGreaterThan(0);
  });

  test('links to the public Candid profile from the About page', async ({ page }) => {
    await page.goto('/about');
    await page.waitForLoadState('networkidle');

    const candidLink = page.locator(
      `main header dl [data-about-imprint-value="Tax status"] a[href="${CANDID_URL}"]`,
    );
    await expect(candidLink).toHaveText('Candid');
    await expect(candidLink).toHaveAttribute('target', '_blank');
    await expect(candidLink).toHaveAttribute('rel', /noopener/);
    await expectExternalOpenIcon(candidLink);

    const footerLink = page.locator(`footer a[href="${CANDID_URL}"]`);
    await expect(footerLink).toHaveText('Candid');
    await expect(footerLink).toHaveAttribute('rel', /noopener/);
    await expectExternalOpenIcon(footerLink);

    const footerExternalLinks = page.locator(
      '.footer-primary a[href^="https://"], .footer-utilities a[href^="https://"]',
    );
    await expect(footerExternalLinks.first()).toBeVisible();
    for (const link of await footerExternalLinks.all()) {
      await expectExternalOpenIcon(link);
    }

    await page.goto('/sitemap');
    await page.waitForLoadState('networkidle');

    const sitemapLink = page.locator(`main a[href="${CANDID_URL}"]`);
    await expect(sitemapLink).toHaveText(/Candid/);
    await expect(sitemapLink).toHaveAttribute('rel', /noopener/);
    await expectExternalOpenIcon(sitemapLink);

    const sitemapExternalLinks = page.locator('main a[rel~="noopener"]');
    await expect(sitemapExternalLinks.first()).toBeVisible();
    for (const link of await sitemapExternalLinks.all()) {
      await expectExternalOpenIcon(link);
    }
  });

  test('omits the shared hero rule on the sitemap page', async ({ page }) => {
    await page.goto('/sitemap');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('main h1')).toHaveText('Sitemap');
    await expect(page.locator('main > hr.rule-thick.container-page')).toHaveCount(0);
  });

  test('adds open icons to external links automatically', async ({ page }) => {
    let totalExternalLinks = 0;

    for (const path of ['/about', '/events', '/contact', '/colophon', '/sitemap']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');

      const externalLinks = page.locator(
        `main a[href^="https://"]:not([href^="${SITE_URL}"]):not([href^="https://www.lasvegasfortransit.org"]):not(.block):not(.flex):not(.grid):not(.inline-flex):not([data-external-icon="false"]),
         main a[href^="http://"]:not([href^="http://lasvegasfortransit.org"]):not([href^="http://www.lasvegasfortransit.org"]):not(.block):not(.flex):not(.grid):not(.inline-flex):not([data-external-icon="false"])`,
      );

      const count = await externalLinks.count();
      totalExternalLinks += count;

      for (const link of await externalLinks.all()) {
        await expectExternalOpenIcon(link);
      }
    }

    expect(totalExternalLinks).toBeGreaterThan(0);
  });

  test('does not render external icons as flex card children', async ({ page }) => {
    await page.goto('/go');
    await page.waitForLoadState('networkidle');

    const givebutterLink = page.locator('main a[href="https://givebutter.com/lvbt"]');
    await expect(givebutterLink).toContainText('Give on Givebutter');

    const icon = await givebutterLink.evaluate((link) => {
      const pseudo = getComputedStyle(link, '::after');
      return {
        content: pseudo.content,
        display: pseudo.display,
        maskImage:
          pseudo.getPropertyValue('mask-image') || pseudo.getPropertyValue('-webkit-mask-image'),
      };
    });

    expect(icon.content).toBe('none');
    expect(icon.maskImage).toBe('none');
  });

  test('marks header nav links current only on exact route matches', async ({ page }) => {
    const desktopJoin = page.locator('nav[aria-label="Primary"] a[href="/join"]');

    await page.goto('/join');
    await page.waitForLoadState('networkidle');
    await expect(desktopJoin).toHaveAttribute('aria-current', 'page');

    await page.goto('/join/events-coordinator');
    await page.waitForLoadState('networkidle');
    await expect(desktopJoin).not.toHaveAttribute('aria-current', 'page');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/about');
    await page.waitForLoadState('networkidle');
    await page.locator('button[data-nav-toggle]').click();
    await expect(
      page.locator('nav[aria-label="Mobile navigation"] a[href="/about"]'),
    ).toHaveAttribute('aria-current', 'page');

    await page.goto('/about/strategy');
    await page.waitForLoadState('networkidle');
    await page.locator('button[data-nav-toggle]').click();
    await expect(
      page.locator('nav[aria-label="Mobile navigation"] a[href="/about"]'),
    ).not.toHaveAttribute('aria-current', 'page');
  });

  test('renders LinkedIn in contact and footer social surfaces', async ({ page }) => {
    await page.goto('/contact');
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready);

    const contactLinkedIn = page.locator(`main a[href="${LINKEDIN_URL}"]`).first();
    const footerLinkedIn = page.locator(`footer a[href="${LINKEDIN_URL}"]`).first();

    await expect(contactLinkedIn).toBeVisible();
    await contactLinkedIn.hover();
    // The contact social card inverts to the ink surface (#0f1115) on hover.
    await expect(contactLinkedIn).toHaveCSS('background-color', 'rgb(15, 17, 21)');

    await expect(footerLinkedIn).toBeVisible();
    await footerLinkedIn.hover();
    await expect(footerLinkedIn).toHaveCSS('color', 'rgb(229, 71, 26)');
  });

  test('gives body links visible hover feedback on light surfaces', async ({ page }) => {
    await page.goto('/about');
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready);

    const bodyLink = page.locator('main a.body-link[href="/projects"]').first();

    await bodyLink.hover();
    await expect(bodyLink).toHaveCSS('color', 'rgb(191, 58, 16)');
  });

  test('gives direct contact email links visible hover feedback', async ({ page }) => {
    await page.goto('/contact');
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready);

    const emailLink = page.locator('main a[href^="mailto:"]').first();

    await emailLink.hover();
    // The contact email card inverts to the ink surface (#0f1115) on hover.
    await expect(emailLink).toHaveCSS('background-color', 'rgb(15, 17, 21)');
  });

  test('uses an inline editorial treatment in prose and lede copy', async ({ page }) => {
    await page.goto('/about');
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready);

    // The about-page prose link target tracks src/content/pages/about.mdx —
    // /about/strategy is the surviving in-body link while /vision is hidden.
    const storyLink = page.locator('.prose-doc a[href="/about/strategy"]').first();
    const bodyLink = page.locator('main a.body-link[href="/projects"]').first();

    await expect(storyLink).toHaveCSS('text-decoration-line', 'underline');
    await expect(storyLink).toHaveCSS('font-weight', '600');

    await expect(bodyLink).toHaveCSS('text-decoration-line', 'underline');
    await expect(bodyLink).toHaveCSS('font-weight', '600');
  });

  // Format-aware CTA: a virtual event's primary action invites the visitor to
  // join a call ("Join"). An in-person event must not advertise a join URL —
  // we'd be lying about the format. The contract guards the URL-regex hack
  // from sneaking back as a "fix" if someone ever touches the CTA logic.
  test('virtual event page shows the Join CTA', async ({ page }) => {
    const eventPath = await firstVirtualEventPath(page);
    if (!eventPath) {
      test.skip(true, 'No current virtual or hybrid event with a Join CTA is in the feed.');
      return;
    }

    // Scoped to <main> so the mobile site-header "Join" button doesn't
    // false-positive. The event-detail Join CTA lives in the event header
    // inside main; the site chrome lives outside main.
    const joinCta = page.locator('main a', { hasText: /^Join$/ });
    await expect(joinCta).toBeVisible();
  });

  test('an event without join info advertises no Join CTA', async ({ page }) => {
    await page.goto('/events');
    await page.waitForLoadState('networkidle');

    // Find an event with no join URL — in-person, or one whose details aren't
    // set yet (no format attribute at all). Derived from the card's data-format
    // rather than a hardcoded slug, so it survives the live calendar changing.
    const noJoin = page.locator(
      'main a[data-event-when]:not([data-format="virtual"]):not([data-format="hybrid"])',
    );
    test.skip(
      (await noJoin.count()) === 0,
      'No in-person or TBA event in the feed to assert against.',
    );
    const href = await noJoin.first().getAttribute('href');

    await page.goto(href!);
    await page.waitForLoadState('networkidle');

    // Scoped to <main> so the mobile site-header "Join" button doesn't
    // false-positive. The event-detail Join CTA lives in the event header
    // inside main; the site chrome lives outside main.
    const joinCta = page.locator('main a', { hasText: /^Join$/ });
    await expect(joinCta).toHaveCount(0);
  });

  // Per-event Add-to-calendar download. Static .ics file served from
  // /events/<id>.ics. Guards two things at once: (a) the route still
  // emits at build time; (b) the file is RFC 5545 enough that the OS
  // calendar handler will recognise it.
  test('virtual event publishes a valid .ics feed', async ({ page, request }) => {
    // firstVirtualEventPath leaves the page on the chosen event's detail view,
    // so the title and join URL come from the rendered page rather than
    // hardcoded calendar strings that drift when the event is renamed.
    const eventPath = await firstVirtualEventPath(page);
    if (!eventPath) {
      test.skip(true, 'No current virtual or hybrid event with a Join CTA is in the feed.');
      return;
    }
    const title = (await page.locator('main h1').first().textContent())?.trim() ?? '';
    const joinUrl = await page
      .locator('main a', { hasText: /^Join$/ })
      .first()
      .getAttribute('href');

    const response = await request.get(`${eventPath}.ics`);
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toContain('BEGIN:VCALENDAR');
    expect(body).toContain('BEGIN:VEVENT');
    expect(title.length).toBeGreaterThan(0);
    expect(body).toContain(`SUMMARY:${title}`);
    expect(body).toMatch(/DTSTART:\d{8}T\d{6}Z/);
    expect(body).toMatch(/DTEND:\d{8}T\d{6}Z/);
    expect(joinUrl).toBeTruthy();
    expect(body).toContain(`LOCATION:${joinUrl}`);
  });
});
