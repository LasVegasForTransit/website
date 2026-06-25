---
name: add-transit-news
description: >-
  Add one or more Las Vegas transit news articles to the Notion Transit News
  database. Handles URL intake: fetches the article, extracts headline/date/
  publication/topics/location from HTML meta tags, deduplicates by URL, and
  creates a new Notion page with the article body as paragraph blocks.

  Also handles the search-first flow: "find Las Vegas transit articles from the
  past week" → Claude searches, collects URLs, then runs intake on each.
---

# Add Transit News

Add articles to the Notion Transit News database (configured via `LVBT_TRANSIT_NEWS_DB_ID` in `.env.local`).

## When invoked with URLs

For each URL the user provides:

1. Run `pnpm add:transit-news <url> [url ...]` from the repo root.
2. Show the terminal output verbatim — the script prints per-URL status (✓ created / — skipped / ✖ error).
3. If any URL errored, report why (HTTP status, missing metadata, etc.) and suggest a fix.

```bash
pnpm add:transit-news https://nevadacurrent.com/2026/06/01/example/
```

## When invoked with a search request

If the user says something like "find transit news from the past week" or "search for BRT articles":

1. Use WebSearch to find relevant Las Vegas transit news articles. Search terms to try:
   - `"Las Vegas" transit site:nevadacurrent.com OR site:reviewjournal.com OR site:lasvegassun.com`
   - `"Las Vegas" "bus rapid transit" OR "RTC" OR "Maryland Parkway" news`
   - `"Las Vegas transit" after:YYYY-MM-DD` (use today minus 7 days)
2. Collect the URLs — aim for 5–15 articles.
3. Show the list to the user for quick approval: "Found N articles. Add all?"
4. On approval, run `pnpm add:transit-news <url1> <url2> ...` with all URLs.

## Metadata inference (what the script does automatically)

| Field       | Source                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------- |
| Headline    | `og:title` → `twitter:title` → `<title>` tag                                                |
| Published   | `article:published_time` → `og:article:published_time` → JSON-LD `datePublished` → `<time>` |
| Publication | Domain map in `scripts/notion/lib/transit-topics.ts`                                        |
| Topics      | Keyword scan of headline + first 500 chars of body                                          |
| Location    | Keyword scan (henderson, north las vegas, clark county, las vegas, nevada)                  |
| Body text   | `<article>` → `<main>` → `<body>`, scripts/nav/footer stripped                              |

Full extraction priority order: [`docs/reference/transit-news-pipeline.md`](../../docs/reference/transit-news-pipeline.md).

## Extending the domain or topic maps

If a publication or topic isn't being inferred correctly, edit:

- `scripts/notion/lib/transit-topics.ts` — `DOMAIN_TO_PUBLICATION`, `TOPIC_PATTERNS`, `LOCATION_PATTERNS`

No config file needed — it's plain TypeScript, takes effect immediately on the next run.

## Prerequisites

- `LVBT_NOTION_API_KEY` and `LVBT_TRANSIT_NEWS_DB_ID` must be set in `.env.local`
- The integration must be connected to the Transit News database: open the DB in Notion → ••• → Connections → add your integration
- Run `pnpm install` once if you haven't (wires hooks and tsx)
