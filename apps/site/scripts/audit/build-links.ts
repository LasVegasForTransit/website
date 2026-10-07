const canonicalOrigins = new Set([
  'https://lasvegasfortransit.org',
  'https://www.lasvegasfortransit.org',
]);

function decodeAttribute(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(x[\da-f]+|\d+);/gi, (_match, code: string) =>
      String.fromCodePoint(
        code.startsWith('x') ? Number.parseInt(code.slice(1), 16) : Number(code),
      ),
    );
}
function resolveLink(value: string, base: string, localOrigin: string): URL | undefined {
  if (!value || value.startsWith('#')) return undefined;
  const url = new URL(decodeAttribute(value), base);
  if (!['http:', 'https:'].includes(url.protocol)) return undefined;
  if (canonicalOrigins.has(url.origin)) return new URL(`${url.pathname}${url.search}`, localOrigin);
  url.hash = '';
  return url;
}
export function linksFromHtml(
  html: string,
  pagePath: string,
  localOrigin: string,
): { internal: string[]; external: string[] } {
  const base = new URL(pagePath, localOrigin).href;
  const internal = new Set<string>();
  const external = new Set<string>();
  // These are compiled HTML attributes, not source-code or Markdown links.
  const attributes =
    /\b(?:href|src|poster|action|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  for (const match of html.matchAll(attributes)) {
    const raw = match[1] ?? match[2] ?? match[3] ?? '';
    const values = /^srcset/i.test(match[0])
      ? raw.split(',').map((entry) => entry.trim().split(/\s+/)[0] ?? '')
      : [raw];
    for (const value of values) {
      const url = resolveLink(value, base, localOrigin);
      if (url) (url.origin === localOrigin ? internal : external).add(url.href);
    }
  }
  return { internal: [...internal], external: [...external] };
}

type LinkRequest = (
  url: string,
  options: { redirect: 'manual'; signal: AbortSignal },
) => Promise<Response>;
async function checkLink(
  initial: string,
  localOrigin: string,
  request: LinkRequest,
): Promise<string | undefined> {
  let url = initial;
  const visited = new Set<string>();
  for (;;) {
    if (visited.has(url) || visited.size >= 8)
      throw new Error(`Invalid redirect chain: ${initial}`);
    visited.add(url);
    const response = await request(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
    // Drain response bodies to release connections between the many local requests.
    await response.arrayBuffer();
    if (response.ok) return undefined;
    if (![301, 302, 303, 307, 308].includes(response.status))
      throw new Error(`Broken build link (${response.status}): ${initial}`);
    const location = response.headers.get('location');
    if (!location) throw new Error(`Redirect has no destination: ${url}`);
    const destination = resolveLink(location, url, localOrigin);
    if (!destination) throw new Error(`Invalid redirect destination: ${url}`);
    if (destination.origin !== localOrigin) return destination.href;
    url = destination.href;
  }
}

export async function checkInternalLinks(
  urls: Iterable<string>,
  localOrigin: string,
  request: (
    url: string,
    options: { redirect: 'manual'; signal: AbortSignal },
  ) => Promise<Response> = fetch,
): Promise<string[]> {
  const external = new Set<string>();
  for (const initial of urls) {
    const redirected = await checkLink(initial, localOrigin, request);
    if (redirected) external.add(redirected);
  }
  return [...external];
}
