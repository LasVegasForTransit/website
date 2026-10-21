# Add transit news to the database

Use this guide to add articles to Transit News in Notion, the team's shared database app. Use Path 1
for article links you already have, Path 2 to search with Claude Code, or Path 3 to submit a link
through a public form without installing tools. The database's ID lives in an environment variable
(a named setting kept outside the code — see [glossary](../reference/glossary.md#env-var)),
`LVBT_TRANSIT_NEWS_DB_ID`; each path lists its own prerequisites below.

---

## Path 1 — pnpm script (one command, any URLs)

Use this command when you already have the article links. Complete
[local setup](../tutorials/first-time-setup.md) first, then configure these values in
`apps/site/.env.local`:

1. `LVBT_NOTION_API_KEY` is the secret that allows the script to use Notion. Keep it private.
2. `LVBT_TRANSIT_NEWS_DB_ID` is the 32-character ID from the database's Notion address.
3. Connect the integration to Transit News: open the database in Notion, select the **•••** menu,
   then **Connections**, and add the integration.

Run commands from the repository root. These commands add rows to the connected database. The
article addresses below are examples; replace them with real article links.

```bash
pnpm -C apps/site add:transit-news https://nevadacurrent.com/2026/06/01/some-article/
```

Multiple URLs at once:

```bash
pnpm -C apps/site add:transit-news \
  https://nevadacurrent.com/2026/06/01/example/ \
  https://reviewjournal.com/2026/06/02/another/
```

The script reads each article's web page and fills in its headline, date, publication, topics, and
location. It skips a link already in the database and adds the article text as paragraphs.

**What you see:**

```text
Adding 2 article(s) to Transit News database…

  Fetching https://nevadacurrent.com/… ✓ created
  Fetching https://reviewjournal.com/… — already in database, skipping

Done.
```

Check the new Notion page, including the article text. `✓ created` confirms page creation, not that
every body paragraph was saved. Repeating the URL skips an existing page rather than repairing it.
Inspect a partial page before deciding how to repair it.

---

## Path 2 — Claude Code skill (conversational intake)

Use this when you want to search for articles first, or want Claude to handle a batch of URLs from a
message. (This path needs Claude Code — Anthropic's AI assistant that runs in your terminal —
installed and open in this repo, with the same Notion settings as Path 1.)

In Claude Code, type:

```text
/add-transit-news https://nevadacurrent.com/2026/06/01/example/
```

Or, to search and add in one go:

```text
/add-transit-news find Las Vegas transit articles from the past week
```

Claude will search, show you a list, ask for confirmation, then run the script on all found URLs.

---

## Path 3 — Notion form (anyone, no CLI)

Anyone can paste an article link into the public Notion form. The website's server-side
`/api/transit-news-intake` handler fills in the submission: it fetches the URL and fills in
headline, date, publication, topics, location, and the full article body.

The submitter needs only the form link and an article address. The remaining setup is for a
maintainer with permission to change the database automation and website secrets.

### How it works

```text
Visitor → Notion form view → new database row (URL only)
        → Notion automation fires a webhook
            → /api/transit-news-intake (Cloudflare)
                → fetch URL, extract metadata, write back to the row
```

A _webhook_ is an automated message one service sends another when something happens (see
[glossary](../reference/glossary.md#webhook)); a _Notion automation_ is a rule inside Notion that
triggers it (see [glossary](../reference/glossary.md#notion-automation)).

### One-time setup

#### 1. Create the form view (in Notion, ~2 clicks)

- Open the Transit News database → click **+** next to the views → **Form**
- Name it "Submit an article"
- Keep one required field: **URL**. Make Headline optional (the function fills it).
- Hide Published / Publication / Topics / Location from the form — they're inferred.
- Click **Share form** to get the public link.

#### 2. Set the Cloudflare secret

- Run `pnpm bootstrap --production`. If `LVBT_TRANSIT_NEWS_INTAKE_SECRET` is not set anywhere yet,
  bootstrap generates a random value, stores it on the production Worker, Pages fallback and GitHub,
  and offers to show it once. Copy it for step 3. It also asks for `LVBT_NOTION_API_KEY` if that is
  missing.
- If the secret is already set but nobody has the value, run
  `pnpm bootstrap --production --rotate LVBT_TRANSIT_NEWS_INTAKE_SECRET` to make a new one
  everywhere, then use it in step 3. See [platform secrets](../reference/platform-secrets.md).

#### 3. Create the Notion automation

- In the database → the ••• (more options) menu → **Automations** → New automation
- Trigger: **Page added**. Do not choose **edited**: the handler edits the row, which would trigger
  the automation again.
- Action: **Send webhook**
  - URL: `https://lasvegasfortransit.org/api/transit-news-intake`
  - Add custom header → Key `Authorization`, Value `Bearer <the secret>` (a bearer token: a secret
    sent in this header to prove the caller is allowed — see
    [glossary](../reference/glossary.md#bearer-token))
- Save.

#### 4. Test

Submit the form with any Las Vegas transit article URL. Within a few seconds the new row should fill
in with headline, date, topics, and the body text.

> Notion doesn't let you preview the webhook payload. If enrichment doesn't fire, watch the
> production website Worker's logs in the LVBT Cloudflare account. The handler logs the submitted
> message when it cannot find the page ID. Inspect it privately; do not paste raw messages or
> credentials into an issue or public chat.

---

## Troubleshooting

**"LVBT_NOTION_API_KEY is not set"** — add the key to `apps/site/.env.local`. Get it from Notion →
Settings → My connections → your integration.

**"✖ fetch failed"** — the article's site blocked the bot user-agent or returned an unsuccessful
response. Try opening the URL in a browser; if it loads, the site may require JavaScript. Fall back
to Path 2 (Claude Code) which uses a browser to fetch.

**Headline / date extracted wrong** — the site uses non-standard markup. Open an issue or edit
`apps/site/scripts/notion/lib/article-extract.ts` to add a site-specific extractor. The extraction
priority order is in
[`docs/reference/transit-news-pipeline.md`](../reference/transit-news-pipeline.md).

**Publication / topic not inferred** — add the domain or keyword to
`apps/site/scripts/notion/lib/transit-topics.ts`. These lists match domains and words to
publications and topics. Check the existing entries before adding one.

---

## Full reference

[`docs/reference/transit-news-pipeline.md`](../reference/transit-news-pipeline.md) — schema,
deduplication logic, how to extend the maps, and the Cloudflare enrichment function.
