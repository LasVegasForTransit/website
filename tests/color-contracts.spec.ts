import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { builtSitemapPaths } from './sitemap-paths';

const paths = [...builtSitemapPaths(import.meta.url), '/totally-missing-seo-audit-test/'];

const SCHEMES = ['light', 'dark'] as const;
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const legacyColorPatterns = [
  /--color-(?:ink|paper|rule)\b/,
  /\b(?:bg|text|border)-(?:ink|paper|rule)(?:\/[^\s"'`]+)?\b/,
];

type PrimaryRole = {
  backgroundCss: string;
  backgroundClasses: string[];
  foregroundClass: string;
  foregroundCss: string;
  minContrast: number;
  name: string;
};

function contrastRatio(foreground: string, background: string): number {
  const fg = parseRgb(foreground);
  const bg = parseRgb(background);
  const lighter = Math.max(relativeLuminance(fg), relativeLuminance(bg));
  const darker = Math.min(relativeLuminance(fg), relativeLuminance(bg));
  return (lighter + 0.05) / (darker + 0.05);
}

function parseRgb(color: string): [number, number, number] {
  if (color.startsWith('color(srgb')) {
    const channels = color
      .match(/-?\d+(\.\d+)?/g)
      ?.slice(0, 3)
      .map((channel) => Number(channel) * 255);
    if (channels && channels.length === 3) {
      return [channels[0]!, channels[1]!, channels[2]!];
    }
  }

  const channels = color
    .match(/\d+(\.\d+)?/g)
    ?.slice(0, 3)
    .map(Number);
  if (!channels || channels.length !== 3) {
    throw new Error(`Expected an rgb() color, received ${color}`);
  }
  return [channels[0]!, channels[1]!, channels[2]!];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const [lr, lg, lb] = [r, g, b].map((channel) => {
    const scaled = channel / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lr! + 0.7152 * lg! + 0.0722 * lb!;
}

function walkFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) return walkFiles(path);
    return path;
  });
}

function authoredColorContractFiles(): string[] {
  const sourceFiles = walkFiles(join(repoRoot, 'src')).filter((path) =>
    /\.(astro|css|ts|tsx|mdx|json)$/.test(path),
  );
  return [
    ...sourceFiles,
    join(repoRoot, 'docs/reference/design-tokens.md'),
    join(repoRoot, 'docs/explanation/design-system.md'),
  ];
}

async function primaryRoles(page: Page): Promise<PrimaryRole[]> {
  return page.evaluate(() => {
    const probe = document.createElement('div');
    document.documentElement.appendChild(probe);

    const resolveColor = (className: string, property: 'backgroundColor' | 'color') => {
      probe.className = className;
      const value = getComputedStyle(probe)[property];
      probe.className = '';
      return value;
    };

    const roles = [
      {
        backgroundCss: resolveColor('bg-primary', 'backgroundColor'),
        backgroundClasses: ['bg-primary'],
        foregroundClass: 'text-on-primary',
        foregroundCss: resolveColor('text-on-primary', 'color'),
        minContrast: 3,
        name: 'primary',
      },
      {
        backgroundCss: resolveColor('bg-primary-container', 'backgroundColor'),
        backgroundClasses: ['bg-primary-container', 'bg-primary-soft'],
        foregroundClass: 'text-on-primary-container',
        foregroundCss: resolveColor('text-on-primary-container', 'color'),
        minContrast: 4.5,
        name: 'primary container',
      },
    ];

    probe.remove();
    return roles;
  });
}

/**
 * Resolve a foreground/background token pair from utility classes on a bare
 * probe element. Surface-context classes (e.g. .bg-slab) are applied to the
 * probe so the on-* roles remap exactly as they do in the page.
 */
async function neutralPairs(page: Page) {
  return page.evaluate(() => {
    const probe = document.createElement('div');
    document.documentElement.appendChild(probe);

    const bg = (className: string) => {
      probe.className = className;
      const v = getComputedStyle(probe).backgroundColor;
      probe.className = '';
      return v;
    };
    const fg = (contextClass: string, className: string) => {
      probe.className = `${contextClass} ${className}`.trim();
      const v = getComputedStyle(probe).color;
      probe.className = '';
      return v;
    };

    const pairs = [
      { name: 'on-surface / surface', fg: fg('', 'text-on-surface'), bg: bg('bg-surface') },
      {
        name: 'on-surface-variant / surface',
        fg: fg('', 'text-on-surface-variant'),
        bg: bg('bg-surface'),
      },
      {
        name: 'on-surface-variant / surface-container',
        fg: fg('bg-surface-container', 'text-on-surface-variant'),
        bg: bg('bg-surface-container'),
      },
      { name: 'on-slab / slab', fg: fg('bg-slab', 'text-on-slab'), bg: bg('bg-slab') },
      {
        name: 'on-slab-variant / slab',
        fg: fg('bg-slab', 'text-on-slab-variant'),
        bg: bg('bg-slab'),
      },
      {
        name: 'primary-soft / slab',
        fg: fg('bg-slab', 'text-primary-soft'),
        bg: bg('bg-slab'),
      },
      { name: 'primary-ink / surface', fg: fg('', 'text-primary-ink'), bg: bg('bg-surface') },
    ];

    probe.remove();
    return pairs;
  });
}

async function renderedRulePairs(page: Page) {
  return page.evaluate(() => {
    const transparent = new Set(['transparent', 'rgba(0, 0, 0, 0)']);
    const paintedBackgroundFor = (element: Element) => {
      let current: Element | null = element.parentElement;
      while (current) {
        const background = getComputedStyle(current).backgroundColor;
        if (!transparent.has(background)) return background;
        current = current.parentElement;
      }
      return getComputedStyle(document.body).backgroundColor;
    };

    return [...document.querySelectorAll('hr.rule-thick, hr.rule-thin')]
      .filter((rule) => {
        const box = rule.getBoundingClientRect();
        return box.width > 0;
      })
      .map((rule) => ({
        background: paintedBackgroundFor(rule),
        border: getComputedStyle(rule).borderTopColor,
        className: rule.getAttribute('class') ?? '',
      }));
  });
}

async function plainSurfaceVariantDescendantPairs(surface: Locator) {
  return surface.evaluate((element) => {
    const background = getComputedStyle(element).backgroundColor;
    return [...element.querySelectorAll('.text-on-surface-variant')]
      .filter((candidate) => {
        const className = candidate.getAttribute('class') ?? '';
        return !className.includes('group-hover') && !className.includes('group-focus-visible');
      })
      .map((candidate) => ({
        background,
        color: getComputedStyle(candidate).color,
        text: candidate.textContent?.trim().replace(/\s+/g, ' ') ?? '',
      }));
  });
}

test('authored color API uses semantic roles instead of legacy aliases', () => {
  const violations = authoredColorContractFiles().flatMap((path) => {
    const text = readFileSync(path, 'utf8');
    return text
      .split('\n')
      .flatMap((line, index) =>
        legacyColorPatterns
          .filter((pattern) => pattern.test(line))
          .map(() => `${relative(repoRoot, path)}:${index + 1}: ${line.trim()}`),
      );
  });

  expect(violations).toEqual([]);
});

for (const scheme of SCHEMES) {
  for (const path of paths) {
    test(`primary surfaces use matching foreground roles [${scheme}]: ${path}`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(path, { waitUntil: 'domcontentloaded' });

      const roles = await primaryRoles(page);
      const violations = await page.evaluate((roleList) => {
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

        return roleList.flatMap((role) => {
          const selector = role.backgroundClasses.map((className) => `.${className}`).join(',');
          return [...document.querySelectorAll(selector)]
            .filter((element) => element.textContent?.trim())
            .filter(isVisible)
            .filter((element) => !element.classList.contains(role.foregroundClass))
            .map((element) => ({
              className: element.getAttribute('class') ?? '',
              role: role.name,
              tagName: element.tagName.toLowerCase(),
              text: element.textContent?.trim().replace(/\s+/g, ' ').slice(0, 80) ?? '',
            }));
        });
      }, roles);

      expect(violations).toEqual([]);

      for (const role of roles) {
        expect(
          contrastRatio(role.foregroundCss, role.backgroundCss),
          `${role.name} (${role.foregroundCss} on ${role.backgroundCss})`,
        ).toBeGreaterThanOrEqual(role.minContrast);
      }
    });
  }
}

for (const scheme of SCHEMES) {
  test(`inverted interactive surfaces keep surface variants readable [${scheme}]`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/events/', { waitUntil: 'domcontentloaded' });

    const surfaces = page
      .locator('.hover\\:bg-on-surface, .focus-visible\\:bg-on-surface')
      .filter({ has: page.locator('.text-on-surface-variant') });
    const count = await surfaces.count();
    expect(count).toBeGreaterThan(0);

    for (let index = 0; index < count; index += 1) {
      const surface = surfaces.nth(index);
      await expect(surface).toBeVisible();

      await surface.hover();
      await page.waitForTimeout(200);
      for (const pair of await plainSurfaceVariantDescendantPairs(surface)) {
        expect(
          contrastRatio(pair.color, pair.background),
          `hovered inverted surface "${pair.text}" [${scheme}] (${pair.color} on ${pair.background})`,
        ).toBeGreaterThanOrEqual(4.5);
      }

      await surface.focus();
      await page.waitForTimeout(200);
      for (const pair of await plainSurfaceVariantDescendantPairs(surface)) {
        expect(
          contrastRatio(pair.color, pair.background),
          `focused inverted surface "${pair.text}" [${scheme}] (${pair.color} on ${pair.background})`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
}

// Neutral role pairs are theme-global, so probe them once per scheme on the
// home page. Every foreground/background pairing a component relies on must
// clear WCAG AA (4.5:1) in both light and dark.
for (const scheme of SCHEMES) {
  test(`neutral role pairs clear AA [${scheme}]`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const pairs = await neutralPairs(page);
    for (const pair of pairs) {
      expect(
        contrastRatio(pair.fg, pair.bg),
        `${pair.name} [${scheme}] (${pair.fg} on ${pair.bg})`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
}

for (const scheme of SCHEMES) {
  for (const path of paths) {
    test(`horizontal rules clear non-text contrast [${scheme}]: ${path}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(path, { waitUntil: 'domcontentloaded' });

      const pairs = await renderedRulePairs(page);
      for (const pair of pairs) {
        expect(
          contrastRatio(pair.border, pair.background),
          `${path} ${pair.className} [${scheme}] (${pair.border} on ${pair.background})`,
        ).toBeGreaterThanOrEqual(3);
      }
    });
  }
}
