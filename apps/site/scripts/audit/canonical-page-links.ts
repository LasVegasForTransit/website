import {
  linksFromHtml as resolveRawLinks,
  type LinkRequest,
} from '@lasvegasfortransit/web-platform/links';
import { linksFromHtml } from './build-links';

const canonicalOrigin = 'https://lasvegasfortransit.org';

interface PageLinkOptions {
  request?: LinkRequest;
  checked?: Set<string>;
}

function checkAnchorOrigins(anchors: string, pagePath: string): void {
  // Resolve and decode raw hrefs without the same-site alias mapping. Otherwise
  // HTTP and www links would look canonical after being mapped to the Worker.
  const links = resolveRawLinks(anchors, pagePath, canonicalOrigin);
  for (const link of links.external) {
    const url = new URL(link);
    if (['lasvegasfortransit.org', 'www.lasvegasfortransit.org'].includes(url.hostname))
      throw new Error(`Link ${link} on ${pagePath} uses a noncanonical origin.`);
  }
}

function isSignInGate(response: Response, url: URL): boolean {
  const destination = new URL(response.headers.get('location') ?? '/', url);
  return (
    url.pathname.startsWith('/account/') &&
    response.status === 303 &&
    destination.origin === url.origin &&
    destination.pathname === '/sign-in/' &&
    destination.searchParams.get('next') === url.pathname
  );
}

export async function checkCanonicalPageLinks(
  html: string,
  pagePath: string,
  localOrigin: string,
  options: PageLinkOptions = {},
): Promise<void> {
  const { request = fetch, checked = new Set<string>() } = options;
  const anchors = [...html.matchAll(/<a\b[^>]*>/gi)].map((match) => match[0]).join('\n');
  checkAnchorOrigins(anchors, pagePath);
  // Resolve protocol-relative production links with production's HTTPS scheme,
  // then exercise their paths against the compiled local Worker.
  const productionLinks = linksFromHtml(anchors, pagePath, canonicalOrigin);
  const links = new Set([
    ...linksFromHtml(anchors, pagePath, localOrigin).internal,
    ...productionLinks.internal.map((link) => {
      const url = new URL(link);
      return new URL(`${url.pathname}${url.search}`, localOrigin).href;
    }),
  ]);
  for (const link of links) {
    const url = new URL(link);
    const pathname = url.pathname;
    if (
      /\.[^/]+$/.test(pathname) ||
      /^\/(?:api|cdn-cgi|_astro|pagefind|assets|images|icons|fonts|scripts|styles)(?:\/|$)/.test(
        pathname,
      )
    )
      continue;
    if (!pathname.endsWith('/'))
      throw new Error(`Link ${link} on ${pagePath} skips its canonical trailing slash.`);
    if (checked.has(link)) continue;
    const response = await request(link, {
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.text();
    // Account pages deliberately send signed-out visitors to sign in. This is
    // access control, with a canonical destination, rather than a stale page URL.
    if (isSignInGate(response, url)) {
      checked.add(link);
      continue;
    }
    if (response.status !== 200)
      throw new Error(
        `Expected direct 200 for link ${link} on ${pagePath}; received ${response.status}.`,
      );
    const canonical = `${canonicalOrigin}${pathname}`;
    if (!body.includes(`<link rel="canonical" href="${canonical}"`))
      throw new Error(`Expected self-canonical ${canonical} for link on ${pagePath}.`);
    checked.add(link);
  }
}
