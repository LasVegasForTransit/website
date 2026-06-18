# Add transit news to the database

Three paths get articles into the Transit News database in Notion (the team's
database/wiki app — see [glossary](../reference/glossary.md#notion)) — pick
whichever fits the moment. The database's ID lives in an environment variable (a
named setting kept outside the code — see [glossary](../reference/glossary.md#env-var)),
`LVBT_TRANSIT_NEWS_DB_ID`; each path lists its own prerequisites below.

---

## Path 1 — pnpm script (one command, any URLs)

The fastest way to add specific articles you already have.

```bash
pnpm add:transit-news https://nevadacurrent.com/2026/06/01/some-article/
```

Multiple URLs at once:

```bash
pnpm add:transit-news \
  https://nevadacurrent.com/2026/06/01/example/ \
  https://reviewjournal.com/2026/06/02/another/
```

The script:

- Fetches each article and extracts headline, date, publication, topics, location from HTML
- Skips duplicates automatically (checks if the URL already exists in the database)
- Adds the full article body as Notion paragraph blocks

**What you see:**

```
Adding 2 article(s) to Transit News database…

  Fetching https://nevadacurrent.com/… ✓ created
  Fetching https://reviewjournal.com/… — already in database, skipping

Done.
```

**Prerequisites (in `.env.local`):**

1. `LVBT_NOTION_API_KEY` — an internal integration token (an API key: a secret, password-like string that lets our code call Notion on our behalf — see [glossary](../reference/glossary.md#api-key))
2. `LVBT_TRANSIT_NEWS_DB_ID` — the 32-char ID from the database's Notion URL
3. The integration must be connected to the Transit News database:
   open the DB in Notion → the ••• (more options) menu → Connections → add your integration

---

## Path 2 — Claude Code skill (conversational intake)

Use this when you want to search for articles first, or want Claude to handle a batch of URLs from a message. (This path needs Claude Code — Anthropic's AI assistant that runs in your terminal — installed and open in this repo.)

In Claude Code, type:

```
/add-transit-news https://nevadacurrent.com/2026/06/01/example/
```

Or, to search and add in one go:

```
/add-transit-news find Las Vegas transit articles from the past week
```

Claude will search, show you a list, ask for confirmation, then run the script on all found URLs.

---

## Path 3 — Notion form (anyone, no CLI)

A public Notion form where anyone — volunteers, the public — pastes an article
URL. A Cloudflare Pages Function (a small backend script that runs on Cloudflare — see [glossary](../reference/glossary.md#pages-function)) (`/api/transit-news-intake`) enriches the
submission automatically: it fetches the URL and fills in headline, date,
publication, topics, location, and the full article body.

**The submitter only needs to paste a URL.** Everything else fills in within seconds.

### How it works

```
Visitor → Notion form view → new database row (URL only)
        → Notion automation fires a webhook
            → /api/transit-news-intake (Cloudflare)
                → fetch URL, extract metadata, write back to the row
```

A _webhook_ is an automated message one service sends another when something happens (see [glossary](../reference/glossary.md#webhook)); a _Notion automation_ is a rule inside Notion that triggers it (see [glossary](../reference/glossary.md#notion-automation)).

### One-time setup

**1. Create the form view** (in Notion, ~2 clicks)

- Open the Transit News database → click **+** next to the views → **Form**
- Name it "Submit an article"
- Keep one required field: **URL**. Make Headline optional (the function fills it).
- Hide Published / Publication / Topics / Location from the form — they're inferred.
- Click **Share form** to get the public link.

**2. Set the Cloudflare secret**

- Generate a random secret: `openssl rand -hex 32` (`openssl` is a command-line tool preinstalled on macOS and Linux; this prints a random 64-character value to use as the secret)
- In the Cloudflare Pages dashboard → Settings → Environment Variables, add
  `LVBT_TRANSIT_NEWS_INTAKE_SECRET` (the value above) and confirm
  `LVBT_NOTION_API_KEY` is set.

**3. Create the Notion automation**

- In the database → the ••• (more options) menu → **Automations** → New automation
- Trigger: **Page added** (⚠️ _not_ "edited" — the function edits properties, and
  an "edited" trigger would re-fire on its own write)
- Action: **Send webhook**
  - URL: `https://<your-pages-domain>/api/transit-news-intake`
  - Add custom header → Key `Authorization`, Value `Bearer <the secret>` (a bearer token: a secret sent in this header to prove the caller is allowed — see [glossary](../reference/glossary.md#bearer-token))
- Save.

**4. Test**

Submit the form with any Las Vegas transit article URL. Within a few seconds the
new row should fill in with headline, date, topics, and the body text.

> Notion doesn't let you preview the webhook payload. If enrichment doesn't fire,
> watch the function's live logs by running `wrangler pages deployment tail`
> ([wrangler](../reference/glossary.md#wrangler) is Cloudflare's command-line tool;
> needs Cloudflare access) — the function logs the raw payload when it can't find
> the page ID, so you can confirm the exact shape.

---

## Troubleshooting

**"LVBT_NOTION_API_KEY is not set"** — add the key to `.env.local`. Get it from Notion → Settings → My connections → your integration.

**"✖ fetch failed"** — the article's site blocked the bot user-agent or returned a non-200. Try opening the URL in a browser; if it loads, the site may require JS. Fall back to Path 2 (Claude Code) which uses a browser to fetch.

**Headline / date extracted wrong** — the site uses non-standard markup. Open an issue or edit `scripts/notion/lib/article-extract.ts` to add a site-specific extractor. The extraction priority order is in [`docs/reference/transit-news-pipeline.md`](../reference/transit-news-pipeline.md).

**Publication / topic not inferred** — add the domain or keyword to `scripts/notion/lib/transit-topics.ts`. The maps are self-documenting.

---

## Full reference

[`docs/reference/transit-news-pipeline.md`](../reference/transit-news-pipeline.md) — schema, deduplication logic, how to extend the maps, and the Cloudflare enrichment function.
