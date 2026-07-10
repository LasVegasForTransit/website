import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

const BRAND_EMBER = '#e5471a';
const BRAND_ON_EMBER_COLORS = new Set(['#f7f4ec']);

type AxeResult = Awaited<ReturnType<InstanceType<typeof AxeBuilder>['analyze']>>;
type AxeNode = AxeResult['violations'][number]['nodes'][number];
type AxeViolation = AxeResult['violations'][number];

function normalizeColor(value: unknown): string | undefined {
  return typeof value === 'string' ? value.toLowerCase() : undefined;
}

function isAcceptedOnEmberNode(node: AxeNode): boolean {
  return node.any.some((check) => {
    const data = check.data as { fgColor?: unknown; bgColor?: unknown } | undefined;
    const foreground = normalizeColor(data?.fgColor);
    return (
      foreground !== undefined &&
      BRAND_ON_EMBER_COLORS.has(foreground) &&
      normalizeColor(data?.bgColor) === BRAND_EMBER
    );
  });
}

export async function preparePageForA11y(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({
    content: '*, *::before, *::after { animation: none !important; transition: none !important; }',
  });
  await page.evaluate(() => {
    document
      .querySelectorAll('.reveal, .reveal-stat, .reveal-quote')
      .forEach((el) => el.classList.add('is-visible'));
  });
}

export function actionableViolations(violations: AxeViolation[]): AxeViolation[] {
  return violations
    .map((violation) => ({
      ...violation,
      nodes:
        violation.id === 'color-contrast'
          ? violation.nodes.filter((node) => !isAcceptedOnEmberNode(node))
          : violation.nodes,
    }))
    .filter((violation) => violation.nodes.length > 0);
}

export function summarizeViolations(violations: AxeViolation[]): string {
  return violations
    .map((violation) => {
      const nodes = violation.nodes
        .slice(0, 3)
        .map(
          (node) =>
            `      target=${JSON.stringify(node.target)} fg/bg=${node.any[0]?.data?.fgColor ?? '?'}/${node.any[0]?.data?.bgColor ?? '?'} ratio=${node.any[0]?.data?.contrastRatio ?? '?'}`,
        )
        .join('\n');
      return `  - [${violation.impact}] ${violation.id}: ${violation.help} (${violation.nodes.length} node${violation.nodes.length === 1 ? '' : 's'})\n${nodes}`;
    })
    .join('\n');
}

export async function axeBlockingViolations(page: Page): Promise<AxeViolation[]> {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  return actionableViolations(result.violations);
}

export async function semanticPageAudit(page: Page) {
  return page.evaluate(() => {
    const headingLevels = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].map(
      (heading) => ({
        level: Number(heading.tagName.slice(1)),
        text: heading.textContent?.trim().replace(/\s+/g, ' ') ?? '',
      }),
    );
    const headingJumps = headingLevels.flatMap((heading, index) => {
      const previous = headingLevels[index - 1];
      return previous && heading.level > previous.level + 1
        ? [`${previous.text || previous.level} -> ${heading.text || heading.level}`]
        : [];
    });
    const skipLink = document.querySelector<HTMLAnchorElement>('a[href="#main"]');

    return {
      headingJumps,
      h1Text: headingLevels.filter((heading) => heading.level === 1).map((heading) => heading.text),
      mainCount: document.querySelectorAll('main').length,
      skipLinkHasTarget: !skipLink || document.getElementById('main') !== null,
    };
  });
}

export async function unnamedVisibleControls(page: Page) {
  return page.evaluate(() => {
    const labelledByText = (element: Element) =>
      (element.getAttribute('aria-labelledby') ?? '')
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
        .join(' ')
        .trim();

    const nativeLabelText = (element: Element) => {
      if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
        return '';
      }
      return [...(element.labels ?? [])]
        .map((label) => label.textContent?.trim() ?? '')
        .join(' ')
        .trim();
    };

    const accessibleText = (element: Element) =>
      [
        element.getAttribute('aria-label'),
        labelledByText(element),
        nativeLabelText(element),
        element.textContent,
        element.getAttribute('title'),
        element instanceof HTMLInputElement ? element.getAttribute('value') : null,
      ]
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

    const isVisible = (element: Element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity) > 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    };

    return [...document.querySelectorAll('a[href], button, input, textarea, select')]
      .filter(isVisible)
      .filter((element) => !accessibleText(element))
      .map((element) => ({
        classes: element.getAttribute('class') ?? '',
        html: element.outerHTML.slice(0, 180),
        tag: element.tagName.toLowerCase(),
      }));
  });
}
