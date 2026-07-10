# Content collections reference

What lives in each content folder and the exact shape each file must follow. Reach for this when you're adding or editing a page, project, event, or initiative and need to know which fields are required.

A _content collection_ is Astro's name for a folder of content files that all share the same shape (see [glossary](./glossary.md#content-collection)). All site content lives under `src/content/`. Schemas (the rules for what fields a file must have) are enforced by Zod (a tool that checks data matches an expected shape — see [glossary](./glossary.md#zod)) in `src/content.config.ts` — content that doesn't match the shape will fail the build. That's deliberate: a typo in a content file stops the build with a clear message instead of shipping a broken page.

## Folder layout

Most collections are authored in MDX (Markdown with the ability to drop in interactive components — see [glossary](./glossary.md#mdx)).

| Folder                      | Type            | Drives                                                                                                                                                                                                                                            |
| --------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/content/docs/`         | MDX             | Long-form essays (vision, mission, why-now, problems, strategy). Rendered at `/vision` and `/about/strategy`.                                                                                                                                     |
| `src/content/pages/`        | MDX             | Body copy for individual site pages (about, contact, get-involved).                                                                                                                                                                               |
| `src/content/projects/`     | MDX             | One per project. Drives `/projects` and `/projects/[slug]`.                                                                                                                                                                                       |
| `src/content/letters/`      | MDX             | One per letter. Drives `/letters` and `/letters/[slug]`. See "Letter" below for what belongs here.                                                                                                                                                |
| _(events)_                  | Google Calendar | Event metadata. Pulled at build time by the custom loader in `src/lib/events-loader.ts`. See [events pipeline](../explanation/events-pipeline.md).                                                                                                |
| `src/content/event-bodies/` | MDX             | Optional long-form body for a specific event, keyed by slug. Rendered below the event header on `/events/[slug]`.                                                                                                                                 |
| _(newsletter)_              | Beehiiv RSS     | Newsletter issues. Pulled at build time by the loader in `src/lib/newsletter-loader.ts` from the feed at `PUBLIC_LVBT_NEWSLETTER_FEED_URL`. Drives `/newsletter`; each card links out to the Beehiiv post (issues are never hosted on this site). |
| `src/content/initiatives/`  | JSON            | Project tags. Drives the chips on `/projects`.                                                                                                                                                                                                    |

## Frontmatter shapes

### Event

Events come from the public LVBT Google Calendar (GCal); there is no MDX frontmatter (the settings block at the top of an MDX file — see [glossary](./glossary.md#frontmatter)) to author. The custom loader in `src/lib/events-loader.ts` maps calendar fields to this validated shape:

```ts
{
  title: string;                 // from GCal SUMMARY
  date: Date;                    // from GCal DTSTART
  endDate?: Date;                // from GCal DTEND
  location?: {
    format: 'virtual' | 'in-person' | 'hybrid';  // derived from location / join URL
    venue?: {
      name;
      streetAddress?;
      addressLocality;
      addressRegion;
      postalCode?;
      addressCountry;
    };
    joinUrl?: URL;
  };
  rsvpUrl?: URL;                 // from a `RSVP: <url>` line in the GCal description
  admissionUrl?: URL;            // from `ADMISSION: <url>` or `TICKETS: <url>`
  admissionLabel?: 'Admission' | 'Tickets';
  featured: boolean;             // auto: nearest upcoming event wins
  summary: string;               // first paragraph of the GCal description (HTML stripped); fallback to title
  body?: string;                 // HTML for everything after the first paragraph; rendered on the detail page when no MDX fragment exists
  schema?: {                     // derived defaults for Schema.org Event JSON-LD
    schemaType?;
    status?;
    images?;
    isAccessibleForFree?;
    keywords?;
    about?;
    audience?;
    offer?;
  };
}
```

Authoring lives in Google Calendar — see [`docs/guides/add-an-event.md`](../guides/add-an-event.md) and [`docs/explanation/events-pipeline.md`](../explanation/events-pipeline.md).

### Event body (optional)

```yaml
slug: string # must match the event's derived slug (<YYYY-MM-DD>-<slugified-title>, PT date)
```

MDX body renders below the event header on `/events/[slug]`. Use sparingly — most events ship as header-only.

### Newsletter issue

Newsletter issues come from the Beehiiv RSS feed (an XML feed of recent issues — see [glossary](./glossary.md#rss)); there is no MDX to author. Set `PUBLIC_LVBT_NEWSLETTER_FEED_URL` (and `PUBLIC_LVBT_NEWSLETTER_URL` for the "Read on Beehiiv" links) — see [`.env.example`](../../.env.example). The loader in `src/lib/newsletter-loader.ts` maps each feed `<item>` to this validated shape:

```ts
{
  title: string;     // <title>
  link: URL;         // <link> — the Beehiiv post; the site links out, never hosts the issue
  pubDate: Date;     // <pubDate>
  excerpt: string;   // first ~220 chars of <description>/<content:encoded>, HTML stripped
  image?: string;    // <enclosure> or <media:content> thumbnail, if the feed includes one
}
```

When the feed URL is unset (e.g. local dev with no `.env.local`) or the feed has no published items yet, the collection is empty and `/newsletter` shows a subscribe-only state instead of a list.

### Project

```yaml
title: string
status: 'active' | 'planned' | 'complete' | 'paused'
initiatives: string[]             # slugs from src/content/initiatives/
tldr: string
contacts:
  - name: string
    role: string
startDate: ISO 8601 date
order: number                     # optional, lower = earlier
```

Project bodies use a standard public-brief structure: `## Overview`, `## Motivation`, `## Approach`, and `## Activities`, with `## Updates` added only when there is dated progress to record. The `Motivation` section explains the public problem, who is affected, why LVBT is acting, and why the work matters now. `Activities` names the concrete things the page will eventually point to: reports, events, comments, coalitions, chapters, briefs, evidence logs, media packages, published stories, public relationships, or other recorded results.

### Letter

```yaml
title: string
date: ISO 8601 date # when the letter was posted
summary: string
author: string # e.g. "Willie Chalmers III"
authorTitle: string # e.g. "President" — the author's role on THIS letter
order: number # optional, lower = earlier
```

The page is titled "Letters from Leadership," not "Letters from the President," on purpose. The main use case today is letters from the president, but leadership is more than whoever's in charge — this collection is open to other officers, board members, and team leads, and eventually to open letters that aren't tied to one individual author. That's why `author`/`authorTitle` are per-letter fields rather than a name hardcoded into the page template: each letter can be signed by whoever actually wrote it.

### Initiative (JSON)

```json
{
  "title": "string",
  "description": "string",
  "color": "primary" | "ink" | "mute"
}
```

### Long-form doc / page

Front-matter is `{ title, summary }` plus an MDX body. Slug is the filename.

## Where the schema is

`src/content.config.ts` lists every collection's exact fields and types (this page summarizes them, but that file is what the build actually checks). When in doubt, read it — it's the source of truth, not this page.

## Templates

Each MDX/JSON-backed collection has a `_template.mdx` (or `_template.json`) showing the canonical shape. Copy it when adding new content. The leading underscore is a convention: for collections that use it (currently `projects`, `programs`, `letters`), the collection's `glob()` loader pattern in `src/content.config.ts` excludes `_`-prefixed files at the source, so the template never enters the content store and never needs per-page filtering to keep it out of listings, sitemaps, or `/llms-full.txt`. A new MDX/JSON collection that wants this convention needs to opt in the same way — the underscore prefix alone does nothing on its own. Events have no template — they're created in Google Calendar; `pnpm event:new` scaffolds an optional body fragment.
