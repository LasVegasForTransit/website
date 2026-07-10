import { expect, test, type Page } from '@playwright/test';

async function openForPrint(page: Page, path: string) {
  await page.emulateMedia({ media: 'print' });
  await page.goto(path);
  await page.waitForLoadState('networkidle');
}

async function hiddenRevealSummaries(page: Page) {
  return page.locator('main :is(.reveal, .reveal-stat, .reveal-quote)').evaluateAll((nodes) =>
    nodes
      .map((node) => {
        const styles = getComputedStyle(node);
        return {
          text: (node.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
          opacity: styles.opacity,
          transform: styles.transform,
          clipPath: styles.clipPath,
        };
      })
      .filter(
        (item) => item.opacity !== '1' || item.transform !== 'none' || item.clipPath !== 'none',
      ),
  );
}

test.describe('print layout', () => {
  test('prints reveal-driven content instead of leaving it hidden', async ({ page }) => {
    await openForPrint(page, '/');
    expect(await hiddenRevealSummaries(page)).toEqual([]);

    await openForPrint(page, '/join');
    expect(await hiddenRevealSummaries(page)).toEqual([]);
  });

  test('collapses persistent site chrome into paper chrome', async ({ page }) => {
    await openForPrint(page, '/about');

    const chrome = await page.evaluate(() => {
      const header = document.querySelector('[data-site-header]');
      const topbar = document.querySelector('[data-print-topbar]');
      const logomark = document.querySelector('[data-print-topbar] img');
      const primaryNav = document.querySelector('nav[aria-label="Primary"]');
      const headerCta = document.querySelector('[data-header-cta]');
      const progress = document.querySelector('.site-scroll-progress');
      const mobileNav = document.querySelector('[data-nav-overlay]');
      const footer = document.querySelector('footer');
      const footerMiddle = document.querySelector('[data-footer-middle]');
      const footerLinkSheet = document.querySelector('[data-print-link-sheet]');
      const footerMark = footerLinkSheet?.querySelector('.print-link-sheet__brand > img');
      const footerWordmark = footerLinkSheet?.querySelector('.print-link-sheet__wordmark');
      const footerBottomAnchor = footerLinkSheet?.querySelector('.print-link-sheet__bottom-anchor');

      if (
        !header ||
        !topbar ||
        !logomark ||
        !footer ||
        !footerMiddle ||
        !footerLinkSheet ||
        !footerMark ||
        !footerWordmark ||
        !footerBottomAnchor
      ) {
        throw new Error('Missing print chrome element');
      }

      const topbarRect = topbar.getBoundingClientRect();
      const h1Rect = document.querySelector('h1')?.getBoundingClientRect();
      const footerRect = footer.getBoundingClientRect();
      const footerLinkSheetRect = footerLinkSheet.getBoundingClientRect();
      const footerBottomAnchorRect = footerBottomAnchor.getBoundingClientRect();
      const footerLinkSheetStyles = getComputedStyle(footerLinkSheet);
      const footerLinkSheetBorderTopColor = footerLinkSheetStyles.borderTopColor;
      const footerLinkSheetBorderTopRgb = footerLinkSheetBorderTopColor
        .match(/\d+/g)
        ?.slice(0, 3)
        .map(Number);

      return {
        headerDisplay: getComputedStyle(header).display,
        topbarDisplay: getComputedStyle(topbar).display,
        topbarHeight: topbarRect.height,
        headingTop: h1Rect?.top ?? 0,
        topbarBottom: topbarRect.bottom,
        pageBackground: getComputedStyle(document.body).backgroundColor,
        logomarkDisplay: getComputedStyle(logomark).display,
        logomarkWidth: logomark.getBoundingClientRect().width,
        primaryNavVisible: primaryNav ? primaryNav.getClientRects().length > 0 : null,
        headerCtaVisible: headerCta ? headerCta.getClientRects().length > 0 : null,
        progressDisplay: progress ? getComputedStyle(progress).display : null,
        mobileNavDisplay: mobileNav ? getComputedStyle(mobileNav).display : null,
        footerBreakBefore: getComputedStyle(footer).breakBefore,
        footerHeight: footerRect.height,
        bodyDisplay: getComputedStyle(document.body).display,
        footerMiddleDisplay: getComputedStyle(footerMiddle).display,
        footerLinkSheetBreakBefore: getComputedStyle(footerLinkSheet).breakBefore,
        footerLinkSheetDisplay: getComputedStyle(footerLinkSheet).display,
        footerLinkSheetBorderTopWidth: footerLinkSheetStyles.borderTopWidth,
        footerLinkSheetBorderTopRgb,
        footerLinkSheetPaddingBottom: footerLinkSheetStyles.paddingBottom,
        footerLinkSheetText: footerLinkSheet.textContent?.replace(/\s+/g, ' ').trim() ?? '',
        footerLinkSheetTitle:
          footerLinkSheet.querySelector('#print-footer-title')?.textContent?.trim() ?? '',
        footerLinkSheetSectionTitleCount: footerLinkSheet.querySelectorAll(
          '.print-link-sheet__section :is(h2, h3)',
        ).length,
        footerMarkWidth: footerMark.getBoundingClientRect().width,
        footerWordmarkWidth: footerWordmark.getBoundingClientRect().width,
        footerWordmarkHeight: footerWordmark.getBoundingClientRect().height,
        footerMarkSrc: footerMark.getAttribute('src') ?? '',
        footerLinkSheetWordmarkSrc:
          footerLinkSheet.querySelector('.print-link-sheet__wordmark')?.getAttribute('src') ?? '',
        footerContactListCount: footerLinkSheet.querySelectorAll(
          '.print-link-sheet__contact-list dd',
        ).length,
        footerBottomAnchorDisplay: getComputedStyle(footerBottomAnchor).display,
        footerBottomAnchorPosition: getComputedStyle(footerBottomAnchor).position,
        footerBottomAnchorBottomGap: Math.round(
          footerLinkSheetRect.bottom - footerBottomAnchorRect.bottom,
        ),
        sourceChunkCount: footerLinkSheet.querySelectorAll('.print-link-sheet__chunk').length,
      };
    });

    expect(chrome.headerDisplay).toBe('none');
    expect(chrome.topbarDisplay).not.toBe('none');
    expect(chrome.topbarHeight).toBeLessThan(54);
    expect(chrome.headingTop - chrome.topbarBottom).toBeLessThan(42);
    expect(chrome.pageBackground).toBe('rgb(255, 255, 255)');
    expect(chrome.logomarkDisplay).not.toBe('none');
    expect(chrome.logomarkWidth).toBeGreaterThan(24);
    expect(chrome.primaryNavVisible).toBe(false);
    expect(chrome.headerCtaVisible).toBe(false);
    expect(chrome.progressDisplay).toBe('none');
    expect(chrome.mobileNavDisplay).toBe('none');
    expect(chrome.bodyDisplay).toBe('block');
    expect(chrome.footerBreakBefore).toBe('page');
    expect(chrome.footerHeight).toBeGreaterThan(650);
    expect(chrome.footerMiddleDisplay).toBe('none');
    expect(chrome.footerLinkSheetBreakBefore).toBe('page');
    expect(chrome.footerLinkSheetDisplay).not.toBe('none');
    expect(chrome.footerLinkSheetBorderTopWidth).not.toBe('0px');
    expect(chrome.footerLinkSheetBorderTopRgb?.every((channel) => channel < 40)).toBe(true);
    expect(Number.parseFloat(chrome.footerLinkSheetPaddingBottom)).toBeGreaterThan(30);
    expect(chrome.footerLinkSheetTitle).toBe('Las Vegans for Better Transit directory');
    expect(chrome.footerLinkSheetText).not.toContain('Keep going');
    expect(chrome.footerLinkSheetText).not.toContain('Start here');
    expect(chrome.footerLinkSheetText).not.toContain('Links');
    expect(chrome.footerLinkSheetText).not.toContain('Organization pages');
    expect(chrome.footerLinkSheetText).not.toContain('Membership and updates');
    expect(chrome.footerLinkSheetText).not.toContain('Website records');
    expect(chrome.footerLinkSheetSectionTitleCount).toBe(0);
    expect(chrome.footerMarkSrc).toBe('/brand/lvbt-logo-dark.svg');
    expect(chrome.footerMarkWidth).toBeGreaterThan(75);
    expect(chrome.footerWordmarkWidth).toBeGreaterThan(chrome.footerMarkWidth * 2);
    expect(chrome.footerWordmarkHeight).toBeLessThan(chrome.footerWordmarkWidth / 2);
    expect(chrome.footerLinkSheetWordmarkSrc).toBe('/brand/lvbt-wordmark-dark.svg');
    expect(chrome.footerContactListCount).toBe(2);
    expect(chrome.footerBottomAnchorDisplay).not.toBe('none');
    expect(chrome.footerBottomAnchorPosition).toBe('absolute');
    expect(chrome.footerBottomAnchorBottomGap).toBeLessThan(24);
    expect(chrome.sourceChunkCount).toBeGreaterThanOrEqual(3);
    expect(chrome.footerLinkSheetText).toContain('Programs lasvegasfortransit.org /programs');
    expect(chrome.footerLinkSheetText).toContain('Email hello@lasvegasfortransit.org');
  });

  test('prints project directory cards as compact paper entries', async ({ page }) => {
    await openForPrint(page, '/projects');

    const directory = await page.evaluate(() => {
      const initiativeHeader = document.querySelector('[data-initiative-header]');
      const initiativePermalink = document.querySelector('[data-initiative-permalink]');
      const firstCard = document.querySelector('[data-print-card]');
      const initiativeSection = firstCard?.closest('section');
      const projectList = firstCard?.parentElement;
      const status = firstCard?.querySelector(':scope [data-status-pill]');
      const printedUrl = firstCard?.querySelector('[data-print-card-url]');
      const screenAction = firstCard?.querySelector(':scope > :is(p, span).font-bold');
      const projectOnlyPrintHooks = document.querySelectorAll(
        '[data-project-directory], [data-project-initiative-section], [data-project-print-list]',
      );
      if (
        !initiativeSection ||
        !initiativeHeader ||
        !initiativePermalink ||
        !projectList ||
        !firstCard ||
        !status ||
        !printedUrl ||
        !screenAction
      ) {
        throw new Error('Missing project print hook');
      }

      const cardRect = firstCard.getBoundingClientRect();
      const statusRect = status.getBoundingClientRect();
      const sectionStyle = getComputedStyle(initiativeSection);
      const cardStyle = getComputedStyle(firstCard);
      const printedUrlStyle = getComputedStyle(printedUrl);
      const firstHeader = document.querySelectorAll('[data-initiative-header]')[0];
      const secondHeader = document.querySelectorAll('[data-initiative-header]')[1];
      const previousCard = secondHeader
        ?.closest('section')
        ?.previousElementSibling?.querySelector('[data-print-card]:last-child');
      const previousCardRect = previousCard?.getBoundingClientRect();
      const secondHeaderRect = secondHeader?.getBoundingClientRect();

      return {
        projectOnlyPrintHookCount: projectOnlyPrintHooks.length,
        sectionMarginTop: sectionStyle.marginTop,
        projectListDisplay: getComputedStyle(projectList).display,
        projectListColumns: getComputedStyle(projectList).gridTemplateColumns,
        initiativeHeaderPosition: getComputedStyle(initiativeHeader).position,
        initiativeHeaderBreakAfter: getComputedStyle(initiativeHeader).breakAfter,
        initiativePermalinkHref: initiativePermalink.getAttribute('href'),
        initiativePermalinkPointerEvents: getComputedStyle(initiativePermalink).pointerEvents,
        firstHeaderBottom: firstHeader?.getBoundingClientRect().bottom ?? 0,
        cardBreakInside: getComputedStyle(firstCard).breakInside,
        cardDisplay: cardStyle.display,
        cardPaddingLeft: cardStyle.paddingLeft,
        cardBorderTopWidth: cardStyle.borderTopWidth,
        cardBackground: cardStyle.backgroundColor,
        cardUrl: firstCard.getAttribute('data-print-url'),
        printedUrlDisplay: printedUrlStyle.display,
        printedUrlText: printedUrl.textContent?.replace(/\s+/g, ' ').trim() ?? '',
        statusInsideCard:
          statusRect.left >= cardRect.left &&
          statusRect.right <= cardRect.right &&
          statusRect.top >= cardRect.top &&
          statusRect.bottom <= cardRect.bottom,
        secondHeaderClearsPreviousCard:
          previousCardRect && secondHeaderRect
            ? secondHeaderRect.top >= previousCardRect.bottom
            : true,
        screenActionDisplay: getComputedStyle(screenAction).display,
      };
    });

    expect(directory.projectOnlyPrintHookCount).toBe(0);
    expect(Number.parseFloat(directory.sectionMarginTop)).toBeGreaterThanOrEqual(0);
    expect(directory.projectListDisplay).toBe('block');
    expect(directory.projectListColumns).toBe('none');
    expect(directory.initiativeHeaderPosition).toBe('static');
    expect(directory.initiativeHeaderBreakAfter).toBe('avoid');
    expect(directory.initiativePermalinkHref).toMatch(/^#/);
    expect(directory.initiativePermalinkPointerEvents).toBe('none');
    expect(directory.firstHeaderBottom).toBeLessThan(420);
    expect(directory.cardBreakInside).toBe('avoid');
    expect(directory.cardDisplay).toBe('block');
    expect(Number.parseFloat(directory.cardPaddingLeft)).toBeGreaterThan(10);
    expect(Number.parseFloat(directory.cardBorderTopWidth)).toBeGreaterThan(0);
    expect(directory.cardBackground).not.toBe('rgba(0, 0, 0, 0)');
    expect(directory.cardUrl).toMatch(/^\/projects\/[a-z0-9-]+$/);
    expect(directory.printedUrlDisplay).not.toBe('none');
    expect(directory.printedUrlText).toContain('lasvegasfortransit.org');
    expect(directory.printedUrlText).toContain(directory.cardUrl);
    expect(directory.statusInsideCard).toBe(true);
    expect(directory.secondHeaderClearsPreviousCard).toBe(true);
    expect(directory.screenActionDisplay).toBe('none');
  });

  test('prints generic linked cards with visible destinations', async ({ page }) => {
    await openForPrint(page, '/roadmap');

    const card = await page.evaluate(() => {
      const linkedCard = document.querySelector('[data-print-card][data-print-url]');
      const printedLink = linkedCard?.querySelector(':scope > [data-print-link]');
      const action = linkedCard?.querySelector(':scope > span.font-bold');

      if (!linkedCard || !printedLink || !action) {
        throw new Error('Missing generic linked-card print output');
      }

      return {
        cardUrl: linkedCard.getAttribute('data-print-url'),
        printedLinkDisplay: getComputedStyle(printedLink).display,
        printedLinkText: printedLink.textContent?.replace(/\s+/g, ' ').trim() ?? '',
        printedLinkBefore: getComputedStyle(printedLink, '::before').content,
        printedLinkAfter: getComputedStyle(printedLink, '::after').content,
        actionDisplay: getComputedStyle(action).display,
      };
    });

    expect(card.cardUrl).toMatch(/^\/projects\/[a-z0-9-]+$/);
    expect(card.printedLinkDisplay).toBe('block');
    expect(card.printedLinkText).toContain('lasvegasfortransit.org');
    expect(card.printedLinkText).toContain(card.cardUrl);
    expect(card.printedLinkBefore).toBe('none');
    expect(card.printedLinkAfter).toBe('none');
    expect(card.actionDisplay).toBe('none');
  });

  test('removes external-link indicators from print output', async ({ page }) => {
    await openForPrint(page, '/about');

    const indicators = await page.evaluate(() => {
      return [...document.querySelectorAll<HTMLAnchorElement>('main a[href^="https://"]')]
        .filter((link) => !new URL(link.href).hostname.endsWith('lasvegasfortransit.org'))
        .map((link) => {
          const styles = getComputedStyle(link, '::after');

          return {
            href: link.href,
            content: styles.content,
            display: styles.display,
            height: styles.height,
            marginInlineStart: styles.marginInlineStart,
            maskImage:
              styles.getPropertyValue('mask-image') ||
              styles.getPropertyValue('-webkit-mask-image'),
            width: styles.width,
          };
        });
    });

    expect(indicators.length).toBeGreaterThan(0);
    expect(indicators).toEqual(
      indicators.map((indicator) => ({
        ...indicator,
        content: 'none',
        display: 'none',
        height: '0px',
        marginInlineStart: '0px',
        maskImage: 'none',
        width: '0px',
      })),
    );
  });

  test('prints project detail metadata as a sidebar', async ({ page }) => {
    await page.setViewportSize({ width: 720, height: 1000 });
    await openForPrint(page, '/projects/stop-by-stop-audit');

    const detail = await page.evaluate(() => {
      const layout = document.querySelector(
        'main > .container-page:has(> article.prose-doc + aside)',
      );
      const article = layout?.querySelector(':scope > article');
      const aside = layout?.querySelector(':scope > aside');
      const helpLink = aside?.querySelector('[data-screen-action]');

      if (!layout || !article || !aside || !helpLink) {
        throw new Error('Missing project detail print layout');
      }

      const articleRect = article.getBoundingClientRect();
      const asideRect = aside.getBoundingClientRect();
      const layoutStyle = getComputedStyle(layout);
      const asideStyle = getComputedStyle(aside);

      return {
        layoutDisplay: layoutStyle.display,
        layoutColumns: layoutStyle.gridTemplateColumns,
        asideLeft: asideRect.left,
        articleRight: articleRect.right,
        verticalDelta: Math.abs(asideRect.top - articleRect.top),
        asideBorderLeftWidth: asideStyle.borderLeftWidth,
        helpLinkDisplay: getComputedStyle(helpLink).display,
      };
    });

    expect(detail.layoutDisplay).toBe('grid');
    expect(detail.layoutColumns).not.toBe('none');
    expect(detail.asideLeft).toBeGreaterThanOrEqual(detail.articleRight);
    expect(detail.verticalDelta).toBeLessThan(12);
    expect(Number.parseFloat(detail.asideBorderLeftWidth)).toBeGreaterThan(0);
    expect(detail.helpLinkDisplay).toBe('none');
  });

  test('omits decorative icons from printed program pages', async ({ page }) => {
    await openForPrint(page, '/programs');

    const iconDisplay = await page.evaluate(() => {
      const icon = [...document.querySelectorAll<HTMLElement>('main [aria-hidden="true"]')].find(
        (element) => element.querySelector('svg'),
      );

      if (!icon) throw new Error('Missing decorative program icon');
      return getComputedStyle(icon).display;
    });

    expect(iconDisplay).toBe('none');
  });

  test('keeps print stack-list items together', async ({ page }) => {
    await openForPrint(page, '/programs');

    const printStack = await page.evaluate(() => {
      const list = document.querySelector('[data-print-stack-list]');
      const item = list?.querySelector(':scope > li');
      const card = item?.querySelector('[data-print-keep-together]');

      if (!list || !item || !card) {
        throw new Error('Missing print stack hooks');
      }

      const listStyles = getComputedStyle(list);
      const itemStyles = getComputedStyle(item);
      const cardStyles = getComputedStyle(card);

      return {
        listDisplay: listStyles.display,
        listColumns: listStyles.gridTemplateColumns,
        itemBreakInside: itemStyles.breakInside,
        cardBreakInside: cardStyles.breakInside,
        cardDisplay: cardStyles.display,
        cardText: card.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      };
    });

    expect(printStack.listDisplay).toBe('block');
    expect(printStack.listColumns).toBe('none');
    expect(['avoid', 'avoid-page']).toContain(printStack.itemBreakInside);
    expect(['avoid', 'avoid-page']).toContain(printStack.cardBreakInside);
    expect(printStack.cardDisplay).toBe('block');
    expect(printStack.cardText).toContain('Bus Buddies');
    expect(printStack.cardText).toContain('A short-form video series');
  });

  test('prints useful link destinations without encoded mailto bodies', async ({ page }) => {
    await openForPrint(page, '/join');

    const links = await page.evaluate(() => {
      const membershipLink = document.querySelector<HTMLAnchorElement>(
        '#membership a[data-print-url]',
      );
      const emailLink = [...document.querySelectorAll('main a[data-print-url]')].find((link) =>
        link.textContent?.includes('hello@lasvegasfortransit.org'),
      ) as HTMLAnchorElement | undefined;
      if (!membershipLink || !emailLink) throw new Error('Missing print URL hook');

      return {
        membershipPrintUrl: membershipLink.getAttribute('data-print-url'),
        membershipText: membershipLink.textContent?.replace(/\s+/g, ' ').trim() ?? '',
        emailPrintUrl: emailLink.getAttribute('data-print-url'),
        emailDisplay: getComputedStyle(emailLink).display,
      };
    });

    expect(links.membershipPrintUrl).toMatch(
      /^(https:\/\/forms\.gle\/|hello@lasvegasfortransit\.org$)/,
    );
    expect(links.membershipPrintUrl).not.toContain('subject=');
    expect(links.membershipPrintUrl).not.toContain('body=');
    expect(links.membershipText).toMatch(/Become a member|hello@lasvegasfortransit\.org/);
    expect(links.emailPrintUrl).toBe('hello@lasvegasfortransit.org');
    expect(links.emailPrintUrl).not.toContain('subject=');
    expect(links.emailPrintUrl).not.toContain('body=');
    expect(links.emailDisplay).not.toBe('none');
  });

  test('prints QR scan cards as individual paper cards', async ({ page }) => {
    await openForPrint(page, '/qr');

    const qr = await page.evaluate(() => {
      const deck = document.querySelector('[data-qr-deck]');
      const slide = document.querySelector('[data-qr-slide]');
      const flyerSlide = document.querySelector('.qr-flyer-slide');
      const flyer = document.querySelector('.qr-flyer');
      const flyerGrid = document.querySelector('.qr-flyer-grid');
      const flyerValues = [...document.querySelectorAll('.qr-flyer-value')];
      const exit = document.querySelector('.qr-exit');
      const dots = document.querySelector('.qr-pagination');
      if (!deck || !slide || !flyerSlide || !flyer || !flyerGrid || !exit || !dots) {
        throw new Error('Missing QR print element');
      }

      const tokenProbe = document.createElement('div');
      tokenProbe.style.backgroundColor = 'var(--paper)';
      document.body.appendChild(tokenProbe);
      const paperColor = getComputedStyle(tokenProbe).backgroundColor;
      tokenProbe.remove();

      return {
        bodyOverflow: getComputedStyle(document.body).overflow,
        deckDisplay: getComputedStyle(deck).display,
        slideMinWidth: getComputedStyle(slide).minWidth,
        slideBreakAfter: getComputedStyle(slide).breakAfter,
        flyerSlideBackground: getComputedStyle(flyerSlide).backgroundColor,
        paperColor,
        flyerDisplay: getComputedStyle(flyer).display,
        flyerBorderTopWidth: getComputedStyle(flyer).borderTopWidth,
        flyerGridColumns: getComputedStyle(flyerGrid).gridTemplateColumns.split(' ').filter(Boolean)
          .length,
        flyerText: flyerValues.map((value) => value.textContent?.replace(/\s+/g, ' ').trim() ?? ''),
        exitDisplay: getComputedStyle(exit).display,
        dotsDisplay: getComputedStyle(dots).display,
      };
    });

    expect(qr.bodyOverflow).toBe('visible');
    expect(qr.deckDisplay).toBe('block');
    expect(qr.slideMinWidth).toBe('0px');
    expect(qr.slideBreakAfter).toBe('page');
    expect(qr.flyerSlideBackground).toBe(qr.paperColor);
    expect(qr.flyerDisplay).toBe('grid');
    expect(qr.flyerBorderTopWidth).toBe('0px');
    expect(qr.flyerGridColumns).toBe(2);
    expect(qr.flyerText).toContain('lasvegasfortransit.org');
    expect(qr.exitDisplay).toBe('none');
    expect(qr.dotsDisplay).toBe('none');
  });

  test('prints brand guidelines as a paper guide instead of captured web controls', async ({
    page,
  }) => {
    await openForPrint(page, '/brand');

    const brand = await page.evaluate(() => {
      const contents = document.querySelector('[data-brand-contents-frame]');
      const logoTabs = document.querySelector('[data-brand-logo-tabs-shell]');
      const logoActions = [...document.querySelectorAll('[data-brand-logo-actions]')];
      const logoButtons = [...document.querySelectorAll('[data-brand-logo-kit] button')];
      const footer = document.querySelector('footer');
      const printAssetGuide = document.querySelector('[data-brand-print-assets]');
      const printOnlyControls = [...document.querySelectorAll('[data-brand-print-only]')];

      if (!contents || !logoTabs || !footer || !printAssetGuide) {
        throw new Error('Missing brand print layout element');
      }

      return {
        contentsDisplay: getComputedStyle(contents).display,
        logoTabsDisplay: getComputedStyle(logoTabs).display,
        logoActionDisplays: logoActions.map((action) => getComputedStyle(action).display),
        logoButtonDisplays: logoButtons.map((button) => getComputedStyle(button).display),
        footerDisplay: getComputedStyle(footer).display,
        printAssetGuideDisplay: getComputedStyle(printAssetGuide).display,
        printAssetGuideText: printAssetGuide.textContent?.replace(/\s+/g, ' ').trim() ?? '',
        printOnlyDisplays: printOnlyControls.map((control) => getComputedStyle(control).display),
      };
    });

    expect(brand.contentsDisplay).toBe('none');
    expect(brand.logoTabsDisplay).toBe('none');
    expect(brand.logoActionDisplays.every((display) => display === 'none')).toBe(true);
    expect(brand.logoButtonDisplays.every((display) => display === 'none')).toBe(true);
    expect(brand.footerDisplay).not.toBe('none');
    expect(brand.printAssetGuideDisplay).not.toBe('none');
    expect(brand.printAssetGuideText).toContain('Logo asset reference');
    expect(brand.printAssetGuideText).toContain('/brand/lvbt-logo.svg');
    expect(brand.printOnlyDisplays.every((display) => display !== 'none')).toBe(true);
  });

  test('lets long brand print sections fragment instead of pushing whole sections', async ({
    page,
  }) => {
    await openForPrint(page, '/brand');

    const fragmentation = await page.evaluate(() => {
      const sectionGrid = document.querySelector('[data-brand-section-flow]');
      const normalArticle = document.querySelector('[data-brand-principle]');
      const protectedExample = document.querySelector('[data-brand-example]');
      if (!sectionGrid || !normalArticle || !protectedExample) {
        throw new Error('Missing brand print fragmentation element');
      }

      return {
        sectionGridDisplay: getComputedStyle(sectionGrid).display,
        normalArticleBreakInside: getComputedStyle(normalArticle).breakInside,
        protectedExampleBreakInside: getComputedStyle(protectedExample).breakInside,
      };
    });

    expect(fragmentation.sectionGridDisplay).toBe('block');
    expect(fragmentation.normalArticleBreakInside).toBe('auto');
    expect(fragmentation.protectedExampleBreakInside).toBe('avoid');
  });
});
