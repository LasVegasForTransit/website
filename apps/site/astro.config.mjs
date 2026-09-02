// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { EnumChangefreq } from 'sitemap';
import tailwindcss from '@tailwindcss/vite';
import icon from 'astro-icon';

// Sitemap signals are intentionally URL-pattern based, not frontmatter-driven.
// Reading collection frontmatter from astro.config.mjs is fragile (would need
// fs + gray-matter outside the Astro content layer) and the SEO gain over a
// build-timestamp lastmod is marginal. Crawlers re-fetch on each deploy anyway.
// Path normalisation here mirrors scripts/audit/_shared.ts::sitemapPaths() —
// keep both in sync if the sitemap URL shape changes.

/** @param {string} page */
const sitemapFilter = (page) => {
  const path = new URL(page).pathname.replace(/\/$/, '') || '/';
  return path !== '/qr';
};

/**
 * @param {import('@astrojs/sitemap').SitemapItem} item
 * @returns {import('@astrojs/sitemap').SitemapItem}
 */
const sitemapSerialize = (item) => {
  // Astro emits sitemap URLs with trailing slashes (/about/, /projects/) —
  // strip them before pattern matching, otherwise equality checks silently
  // miss every page and fall through to the integration defaults.
  const rawPath = new URL(item.url).pathname;
  const path = rawPath === '/' ? '/' : rawPath.replace(/\/$/, '');

  if (path === '/') {
    return { ...item, changefreq: EnumChangefreq.WEEKLY, priority: 1.0 };
  }
  // The two pages we expect search engines and AI overviews to feature.
  if (path === '/projects' || path === '/about') {
    return { ...item, changefreq: EnumChangefreq.MONTHLY, priority: 0.8 };
  }
  // Match before the broader /projects/ prefix rule below.
  if (path === '/about/strategy') {
    return { ...item, changefreq: EnumChangefreq.MONTHLY, priority: 0.7 };
  }
  if (path === '/letters' || path.startsWith('/letters/')) {
    return { ...item, changefreq: EnumChangefreq.MONTHLY, priority: 0.6 };
  }
  if (path.startsWith('/projects/')) {
    return { ...item, changefreq: EnumChangefreq.MONTHLY, priority: 0.7 };
  }
  // Events churn fastest as the calendar fills in.
  if (path === '/events' || path.startsWith('/events/')) {
    return { ...item, changefreq: EnumChangefreq.WEEKLY, priority: 0.6 };
  }
  if (path === '/join' || path === '/contact') {
    return { ...item, changefreq: EnumChangefreq.MONTHLY, priority: 0.6 };
  }
  // Utility pages — exist for humans, not for ranking.
  if (path === '/sitemap') {
    return { ...item, changefreq: EnumChangefreq.YEARLY, priority: 0.3 };
  }
  return item;
};

export default defineConfig({
  site: 'https://lasvegasfortransit.org',
  integrations: [
    mdx(),
    sitemap({
      changefreq: EnumChangefreq.MONTHLY,
      priority: 0.5,
      lastmod: new Date(),
      filter: sitemapFilter,
      serialize: sitemapSerialize,
    }),
    // Iconify-backed vector icons. Tree-shaken at build — only the icon names
    // actually referenced via `<Icon name="…" />` end up in the bundle. Used
    // for the event format pill and reusable for any future iconography.
    icon(),
  ],
  // /sitemap.xml is the URL most humans (and some lazy crawlers) type, but
  // @astrojs/sitemap publishes the index at /sitemap-index.xml. Astro emits a
  // static HTML meta-refresh redirect for this in dev and in the build; for
  // production a real 301 is also pinned in public/_redirects.
  redirects: {
    '/sitemap.xml': '/sitemap-index.xml',
    '/get-involved': '/go',
  },
  vite: {
    plugins: [tailwindcss()],
  },
  markdown: {
    shikiConfig: {
      theme: 'github-light',
      wrap: true,
    },
  },
});
