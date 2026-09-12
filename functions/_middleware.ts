/// <reference types="@cloudflare/workers-types" />

// lvwwd.org is the Week Without Driving campaign's own hostname, attached
// to this same Pages project as a custom domain. Until the campaign has a
// standalone site, that host serves the /wwd page as its front page and
// nothing else: assets the page needs pass through, the LVBT-only routes
// (the header nav, /projects, ...) redirect to the main site, and the
// long-form /wwd path collapses to /. Every other hostname is untouched.
//
// The page keeps its lasvegasfortransit.org canonical (built into the HTML
// from src/lib/site.ts), so search engines treat lvwwd.org as a mirror,
// not a duplicate. Remove this file when the standalone site launches and
// the domain moves.

interface Env {
  ASSETS: Fetcher;
}

export const CAMPAIGN_HOST = 'lvwwd.org';
export const CAMPAIGN_PAGE_PATH = '/wwd/';
export const MAIN_SITE_ORIGIN = 'https://lasvegasfortransit.org';
const MAIN_SITE_HOST = new URL(MAIN_SITE_ORIGIN).hostname;

// Static paths the campaign page loads from its own host. Anything not on
// this list (and not the page itself) redirects to the main site.
const PASSTHROUGH_PREFIXES = ['/_astro/', '/scripts/', '/fonts/', '/brand/', '/pagefind/'];
const PASSTHROUGH_FILES = new Set(['/favicon.svg', '/logo.png', '/og-default.png']);

function isCampaignPagePath(pathname: string): boolean {
  return pathname === '/wwd' || pathname === CAMPAIGN_PAGE_PATH;
}

function isPassthrough(pathname: string): boolean {
  return (
    PASSTHROUGH_FILES.has(pathname) ||
    PASSTHROUGH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const host = url.hostname.toLowerCase();

  // The campaign has its own address, so the main site points at it rather
  // than serving a second copy under /wwd. Temporary (302) because the main
  // site is expected to get a programme page of its own at this path once
  // the campaign settles. The redirect lives here rather than in
  // public/_redirects so it applies to this host only: a rule there would
  // also catch the internal asset fetch below and send it back out.
  if (host === MAIN_SITE_HOST && isCampaignPagePath(url.pathname)) {
    return Response.redirect(`https://${CAMPAIGN_HOST}/${url.search}`, 302);
  }

  if (host === `www.${CAMPAIGN_HOST}`) {
    return Response.redirect(`https://${CAMPAIGN_HOST}${url.pathname}${url.search}`, 301);
  }

  if (host !== CAMPAIGN_HOST) {
    return context.next();
  }

  const { pathname } = url;

  if (pathname === '/') {
    const page = new URL(CAMPAIGN_PAGE_PATH, url);
    page.search = url.search;
    return context.env.ASSETS.fetch(new Request(page.toString(), context.request));
  }

  if (isCampaignPagePath(pathname)) {
    return Response.redirect(`https://${CAMPAIGN_HOST}/${url.search}`, 301);
  }

  if (pathname === '/robots.txt') {
    return new Response('User-agent: *\nAllow: /\n', {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  if (isPassthrough(pathname)) {
    return context.next();
  }

  return Response.redirect(`${MAIN_SITE_ORIGIN}${pathname}${url.search}`, 301);
};
