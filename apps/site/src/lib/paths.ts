import { site } from './site';

/**
 * Single source of truth for internal URL shapes. Initiative links are
 * fragment anchors into the projects index, not separate routes — the index
 * groups projects by initiative under matching section ids.
 */
export const paths = {
  projects: '/projects',
  project: (id: string) => `/projects/${id}`,
  initiative: (id: string) => `/projects#${id}`,
  letters: '/letters',
  letter: (id: string) => `/letters/${id}`,
  events: '/events',
  join: '/join',
} as const;

/**
 * Absolute, canonical URL for a site-relative pathname — the same
 * `new URL(pathname, site.url).toString()` expression every detail page's
 * `<StructuredData>`/canonical-link computation needs, in one place instead
 * of independently re-typed per page.
 */
export function canonicalUrl(pathname: string): string {
  return new URL(pathname, site.url).toString();
}

/**
 * Strip a URL down to what's readable displayed as plain text or printed:
 * no protocol, no "www.", no trailing slash. One version instead of
 * independently re-typed per page (qr.astro, Footer.astro, ProjectCard.astro).
 */
export function displayUrl(url: string): string {
  return url
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '');
}
