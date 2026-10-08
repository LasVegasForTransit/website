import {
  linksFromHtml as sharedLinksFromHtml,
  checkInternalLinks as sharedCheckInternalLinks,
  checkInternalLinkResults as sharedCheckInternalLinkResults,
  type LinkRequest,
} from '@lasvegasfortransit/web-platform/links';

const canonicalOrigins = new Set([
  'https://lasvegasfortransit.org',
  'https://www.lasvegasfortransit.org',
]);
export function linksFromHtml(
  html: string,
  pagePath: string,
  localOrigin: string,
): { internal: string[]; external: string[] } {
  return sharedLinksFromHtml(html, pagePath, localOrigin, canonicalOrigins);
}
export function checkInternalLinks(
  urls: Iterable<string>,
  localOrigin: string,
  request: LinkRequest = fetch,
): Promise<string[]> {
  return sharedCheckInternalLinks(urls, localOrigin, request, canonicalOrigins);
}
export function checkInternalLinkResults(
  urls: Iterable<string>,
  localOrigin: string,
  request: LinkRequest = fetch,
): ReturnType<typeof sharedCheckInternalLinkResults> {
  return sharedCheckInternalLinkResults(urls, localOrigin, request, canonicalOrigins);
}
