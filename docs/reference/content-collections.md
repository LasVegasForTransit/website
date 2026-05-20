# Content collections reference

All site content lives under `src/content/`. Schemas are enforced by Zod in `src/content.config.ts` — content that doesn't match the shape will fail the build.

## Folder layout

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

Events come from the public LVBT Google Calendar; there is no MDX frontmatter to author. The custom loader in `src/lib/events-loader.ts` maps calendar fields to this validated shape:

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

`src/content.config.ts`. When in doubt, read it — it's the source of truth, not this page.

## Templates

Each MDX/JSON-backed collection has a `_template.mdx` (or `_template.json`) showing the canonical shape. Copy it when adding new content. Events have no template — they're created in Google Calendar; `pnpm event:new` scaffolds an optional body fragment.
