/**
 * Fetch an article URL and extract structured metadata for the Transit News database.
 *
 * Extraction priority:
 *   Headline  — og:title → <title>
 *   Date      — article:published_time → og:article:published_time → JSON-LD datePublished → <time>
 *   Body      — strip tags from the largest <article> or <main> block; fall back to <body>
 */

export interface ArticleData {
  headline: string;
  url: string;
  publishedIso: string | null;
  bodyText: string;
}

export async function fetchArticle(url: string): Promise<ArticleData> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; LVBTBot/1.0; +https://lasvegasfortransit.org)',
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`);
  }

  const html = await res.text();
  const finalUrl = res.url; // follow redirects

  return {
    headline: extractHeadline(html),
    url: finalUrl,
    publishedIso: extractDate(html),
    bodyText: extractBody(html),
  };
}

// ---------------------------------------------------------------------------
// Extraction helpers — intentionally simple regex-based HTML parsing. These
// handle real-world news sites well enough without pulling in a full parser.
// ---------------------------------------------------------------------------

function extractHeadline(html: string): string {
  // og:title
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (og?.[1]) return decode(og[1]);

  // twitter:title
  const tw = html.match(/<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i);
  if (tw?.[1]) return decode(tw[1]);

  // <title>
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (title?.[1])
    return decode(title[1])
      .replace(/\s*[-|].*$/, '')
      .trim();

  return 'Untitled';
}

function extractDate(html: string): string | null {
  const candidates: string[] = [];

  // <meta property="article:published_time" …>
  const ap = html.match(
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
  );
  if (ap?.[1]) candidates.push(ap[1]);

  // <meta property="og:article:published_time" …>
  const oa = html.match(
    /<meta[^>]+property=["']og:article:published_time["'][^>]+content=["']([^"']+)["']/i,
  );
  if (oa?.[1]) candidates.push(oa[1]);

  // JSON-LD datePublished
  const ld = html.match(/"datePublished"\s*:\s*"([^"]+)"/);
  if (ld?.[1]) candidates.push(ld[1]);

  // <time datetime="…">
  const time = html.match(/<time[^>]+datetime=["']([^"']+)["']/i);
  if (time?.[1]) candidates.push(time[1]);

  for (const raw of candidates) {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return raw.includes('T') ? raw : d.toISOString().slice(0, 10);
  }

  return null;
}

function extractBody(html: string): string {
  // Try <article> first, then <main>, then <body>
  const article = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  const main = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);

  const source = article?.[1] ?? main?.[1] ?? body?.[1] ?? html;
  return stripTags(source).trim();
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decode(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}
