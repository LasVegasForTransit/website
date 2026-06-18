# Content collections reference

What lives in each content folder and the exact shape each file must follow. Reach for this when you're adding or editing a page, project, event, or initiative and need to know which fields are required.

A _content collection_ is Astro's name for a folder of content files that all share the same shape (see [glossary](./glossary.md#content-collection)). All site content lives under `src/content/`. Schemas (the rules for what fields a file must have) are enforced by Zod (a tool that checks data matches an expected shape — see [glossary](./glossary.md#zod)) in `src/content.config.ts` — content that doesn't match the shape will fail the build. That's deliberate: a typo in a content file stops the build with a clear message instead of shipping a broken page.

## Folder layout

Most collections are authored in MDX (Markdown with the ability to drop in interactive components — see [glossary](./glossary.md#mdx)).

| Folder                      | Type            | Drives                                                                                                                                             |
| --------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/content/docs/`         | MDX             | Long-form essays (vision, mission, why-now, problems, strategy). Rendered at `/vision` and `/about/strategy`.                                      |
| `src/content/pages/`        | MDX             | Body copy for individual site pages (about, contact, get-involved).                                                                                |
| `src/content/projects/`     | MDX             | One per project. Drives `/projects` and `/projects/[slug]`.                                                                                        |
| _(events)_                  | Google Calendar | Event metadata. Pulled at build time by the custom loader in `src/lib/events-loader.ts`. See [events pipeline](../explanation/events-pipeline.md). |
| `src/content/event-bodies/` | MDX             | Optional long-form body for a specific event, keyed by slug. Rendered below the event header on `/events/[slug]`.                                  |
| `src/content/initiatives/`  | JSON            | Project tags. Drives the chips on `/projects`.                                                                                                     |

## Frontmatter shapes

### Event

Events come from the public LVBT Google Calendar (GCal); there is no MDX frontmatter (the settings block at the top of an MDX file — see [glossary](./glossary.md#frontmatter)) to author. The custom loader in `src/lib/events-loader.ts` maps calendar fields to this validated shape:

```ts
{
  title: string;                 // from GCal SUMMARY
  date: Date;                    // from GCal DTSTART
  endDate?: Date;                // from GCal DTEND
  format: 'virtual' | 'in-person' | 'hybrid';  // derived from location / join URL
  venue?: { name; addressLocality; addressRegion; addressCountry };
  joinUrl?: URL;                 // Meet/Zoom/Teams/etc. URL
  rsvpUrl?: URL;                 // from a `RSVP: <url>` line in the GCal description
  featured: boolean;             // auto: nearest upcoming event wins
  summary: string;               // first paragraph of the GCal description (HTML stripped); fallback to title
  body?: string;                 // HTML for everything after the first paragraph; rendered on the detail page when no MDX fragment exists
}
```

Authoring lives in Google Calendar — see [`docs/guides/add-an-event.md`](../guides/add-an-event.md) and [`docs/explanation/events-pipeline.md`](../explanation/events-pipeline.md).

### Event body (optional)

```yaml
slug: string # must match the event's derived slug (<YYYY-MM-DD>-<slugified-title>, PT date)
```

MDX body renders below the event header on `/events/[slug]`. Use sparingly — most events ship as header-only.

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

### Initiative (JSON)

```json
{
  "title": "string",
  "description": "string",
  "color": "accent" | "ink" | "mute"
}
```

### Long-form doc / page

Front-matter is `{ title, summary }` plus an MDX body. Slug is the filename.

## Where the schema is

`src/content.config.ts` lists every collection's exact fields and types (this page summarizes them, but that file is what the build actually checks). When in doubt, read it — it's the source of truth, not this page.

## Templates

Each MDX/JSON-backed collection has a `_template.mdx` (or `_template.json`) showing the canonical shape. Copy it when adding new content. The leading underscore is a convention that tells Astro to ignore the file as content — so the template itself never becomes a published page. Events have no template — they're created in Google Calendar; `pnpm event:new` scaffolds an optional body fragment.
