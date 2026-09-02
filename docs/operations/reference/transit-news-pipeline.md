# Transit News pipeline reference

Technical reference for the three-layer transit news intake pipeline — read this to understand or
change how it works. (To just add an article, use the
[how-to guide](../../product/how-to/add-transit-news.md).) That guide calls these same three layers
"Paths 1–3"; the mapping is one-to-one (Layer 1 = Path 1, and so on). Unfamiliar terms like
[data source](../../development/reference/glossary.md#data-source),
[webhook](../../development/reference/glossary.md#webhook), or
[bearer token](../../development/reference/glossary.md#bearer-token) are defined in the
[glossary](../../development/reference/glossary.md).

---

## Database

**Notion database:** configured via `LVBT_TRANSIT_NEWS_DB_ID` (the 32-char ID from the database's
Notion URL)

| Property    | Notion type  | Notes                                                           |
| ----------- | ------------ | --------------------------------------------------------------- |
| Headline    | title        | Required. Extracted from `og:title` → `<title>`                 |
| URL         | url          | Required. Dedup key for Layers 1–2                              |
| Published   | date         | ISO 8601 with optional time (`2026-06-01T14:30:00-07:00`)       |
| Publication | select       | Inferred from domain map; new values auto-create select options |
| Topics      | multi_select | Multiple tags per article; auto-inferred from keyword scan      |
| Location    | select       | First matching location from keyword scan                       |

---

## Metadata extraction

All three layers use the same extraction logic. Priority order:

### Headline

1. `<meta property="og:title">` content
2. `<meta name="twitter:title">` content
3. `<title>` tag (site name suffix stripped after `-` or `|`)

### Published date

1. `<meta property="article:published_time">` content
2. `<meta property="og:article:published_time">` content
3. JSON-LD `"datePublished"` value (JSON-LD is a block of structured data many sites embed in a
   `<script>` tag for search engines)
4. First `<time>` element's `datetime` attribute

These are the standard ways news sites mark up a publish date in their HTML, tried in order until
one is found. If a time-zone offset is present it's preserved; date-only values are stored as
`YYYY-MM-DD` (the ISO 8601 date format, e.g. `2026-06-01`).

### Body text

1. First `<article>` element's inner content
2. First `<main>` element's inner content
3. `<body>` content (fallback)

`<script>`, `<style>`, `<nav>`, `<header>`, `<footer>`, `<aside>` blocks are removed before text
extraction.

---

## Publication inference

Controlled by `DOMAIN_TO_PUBLICATION` in `scripts/notion/lib/transit-topics.ts`.

The hostname is matched after stripping the `www.` prefix. Both exact matches and subdomain matches
are supported (`foo.lasvegassun.com` → `Las Vegas Sun`).

**To add a new publication:** append to `DOMAIN_TO_PUBLICATION`:

```ts
'klas.com': 'KLAS-TV',
```

---

## Topic inference

Controlled by `TOPIC_PATTERNS` in `scripts/notion/lib/transit-topics.ts`.

The scanner concatenates `headline + first 500 chars of body`, lowercases it, and checks each
pattern list. Multiple topics can match a single article.

**To add a new topic:**

```ts
{ patterns: ['brightline', 'high-speed rail', 'hsr'], topic: 'High-Speed Rail' },
```

---

## Location inference

Controlled by `LOCATION_PATTERNS` in `scripts/notion/lib/transit-topics.ts`.

Returns the first matching location (earlier entries have higher priority). If no pattern matches,
Location is left unset.

---

## Deduplication

Layers 1 and 2 query the data source filtering on `URL equals <url>` before creating a page. If a
match exists, the article is skipped — so re-running the same URL, or mixing manual and scripted
runs, never produces duplicates.

Layer 3 (the Notion form) enriches the row the submitter just created rather than creating a new
one, so it does not dedup. If the same article is submitted twice, two rows result; sort the
database by URL to spot and merge them. (A dedup check in the enrichment function is a possible
future addition.)

---

## Layer 1 — pnpm script

**File:** `scripts/notion/add-transit-news.ts` **Command:** `pnpm add:transit-news <url> [url ...]`
**Config:** reads `LVBT_NOTION_API_KEY` and `LVBT_TRANSIT_NEWS_DB_ID` from `.env.local` via
`parseEnvFile` — nothing hardcoded **Notion API:** the shared `scripts/notion/lib/notion-client.ts`
(current data-source model). The script resolves the database's data source via
`GET /v1/databases/{id}`, then queries `POST /v1/data_sources/{id}/query` and creates pages with a
`data_source_id` parent **Concurrency:** sequential (one article at a time) **Body blocks:** up to
100 paragraph blocks per Notion API call, 2000 chars per block, split at sentence boundaries

---

## Layer 2 — Claude Code skill

**File:** `.claude/skills/add-transit-news.md` **Invocation:** `/add-transit-news` in Claude Code
**What it adds over Layer 1:** semantic URL discovery (WebSearch), smarter date parsing, can handle
non-standard sites by using the browser

---

## Layer 3 — Notion form + Cloudflare enrichment

The public, zero-CLI path. A Notion form view collects submissions; a Cloudflare Pages Function
enriches each one. Runs on infrastructure the site already uses — no Notion Workers beta required.

**Function:** `functions/api/transit-news-intake.ts` **Endpoint:** `POST /api/transit-news-intake`
**Auth:** `Authorization: Bearer <LVBT_TRANSIT_NEWS_INTAKE_SECRET>`
([timing-safe](../../development/reference/glossary.md#timing-safe) compare) **Secrets:**
`LVBT_NOTION_API_KEY`, `LVBT_TRANSIT_NEWS_INTAKE_SECRET` (Cloudflare Pages env)

### Endpoint contract

The exact request/response shape, so you can test it or change the automation without reading the
code.

**Request:** `POST /api/transit-news-intake` with header `Authorization: Bearer <secret>` and a JSON
body — the Notion automation's webhook payload. The function only needs the triggering page's ID
somewhere in that body.

**Responses** (all JSON):

| HTTP status | Body                                               | Meaning                                                                                                                                             |
| ----------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `200`       | `{ "enriched": true, "url": "…" }`                 | Row enriched successfully.                                                                                                                          |
| `200`       | `{ "enriched": false, "reason": "scrape_failed" }` | Couldn't fetch the article (site blocked us / non-200). Returned as `200` on purpose so Notion doesn't keep retrying; the row is left as submitted. |
| `400`       | `{ "error": "invalid_body" }`                      | Body wasn't valid JSON.                                                                                                                             |
| `400`       | `{ "error": "no_page_id" }`                        | No page ID found in the payload (raw payload is logged so you can find the right field).                                                            |
| `400`       | `{ "error": "no_url" }`                            | The page has no URL property to enrich from.                                                                                                        |
| `401`       | `{ "error": "unauthorized" }`                      | Missing or wrong bearer token.                                                                                                                      |
| `502`       | `{ "error": "service_unavailable" }`               | A Notion API call failed.                                                                                                                           |
| `503`       | `{ "error": "service_unavailable" }`               | Required secrets aren't configured on Cloudflare.                                                                                                   |

### Request flow

1. Notion form submission creates a database row (URL only)
2. A Notion database automation (trigger: **page added**) fires a "Send webhook" action at the
   endpoint, with the bearer header
3. The function extracts the page ID from the payload, then `GET /v1/pages/{id}` to read the
   authoritative URL — it does **not** trust the webhook's property serialization, whose shape
   Notion leaves undocumented
4. `fetchArticle(url)` → extract headline/date/publication/topics/location/body
5. `PATCH /v1/pages/{id}` writes inferred properties (Headline only if the submitter left it blank),
   then appends body paragraph blocks

### Payload shape resilience

Notion's automation webhook payload is configurable and not formally documented (Notion suggests
webhook.site to inspect it). `findPageId()` probes the known candidate paths (`data.id`, `id`,
`page.id`, `data.page.id`, `entity.id`) and validates against a Notion-ID regex. If none match, the
function logs the full raw payload and returns 400 so the exact path can be confirmed in
`wrangler pages deployment tail`.

### Loop prevention

The function edits page properties. The automation **must** trigger on _page added_, never _page
edited_ — otherwise the function's own write re-fires it.

### Failure handling

A scrape failure (site blocks the bot, non-200) is effectively permanent, so the function returns
200 with `{ enriched: false, reason: 'scrape_failed' }` rather than a 5xx — this avoids a Notion
automation retry storm. The row stays as the submitter typed it.

---

## Verification

How to confirm each layer works.

**Layer 1 (the script):**

```bash
pnpm add:transit-news https://nevadacurrent.com/<some-article>/
```

Expect `✓ created`, then check the new row in the Notion database. Run the same URL again — it
should print `— already in database, skipping`, which proves deduplication.

**Layer 3 (the Cloudflare function), locally:**

1. Set `LVBT_NOTION_API_KEY` and `LVBT_TRANSIT_NEWS_INTAKE_SECRET` in `.env.local`.
2. Start the dev server with `pnpm dev` (it runs the Pages Function too — see
   [local-dev.md](../../development/reference/local-dev.md)).
3. Send a test request, using a real Notion page ID from the database and your intake secret:

```bash
curl -i -X POST http://localhost:4321/api/transit-news-intake \
  -H "Authorization: Bearer <your LVBT_TRANSIT_NEWS_INTAKE_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"data":{"id":"<a-notion-page-id>"}}'
```

Expect `200` with `{"enriched":true,…}` and that page's fields filled in. A wrong or missing bearer
token returns `401`; a body with no page ID returns `400` with `no_page_id` (and logs the raw
payload).

**Layer 3, end-to-end:** submit the Notion form with any Las Vegas transit URL; within a few seconds
the new row should fill in. If it doesn't, tail the logs with `wrangler pages deployment tail`.

---

## Parked — Notion Worker scaffold

`scripts/workers/transit-news-sync/` contains a Notion Worker (Sync + Tool) that would add a weekly
Google News RSS pull and a Notion-AI-callable tool. **Notion Workers are in private beta**, so this
is parked until access lands. When it does: `ntn workers deploy` from that directory. Nothing else
depends on it.

A weekly RSS sync could alternatively run as a standalone Cloudflare Worker with a Cron Trigger
(Pages Functions don't support cron) — not built yet.

---

## Extending the pipeline

### New extraction site

If a site uses non-standard markup, add a site-specific extractor to
`scripts/notion/lib/article-extract.ts`. Both Layer 1 and Layer 3 use it, so one edit covers the
script and the Cloudflare function.

### New publication / topic / location

Edit the maps in `scripts/notion/lib/transit-topics.ts`. Shared by every layer.
