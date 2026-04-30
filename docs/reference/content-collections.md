# Content collections reference

All site content lives under `src/content/`. Schemas are enforced by Zod in `src/content.config.ts` — content that doesn't match the shape will fail the build.

## Folder layout

| Folder                     | Type | Drives                                                                                                        |
| -------------------------- | ---- | ------------------------------------------------------------------------------------------------------------- |
| `src/content/docs/`        | MDX  | Long-form essays (vision, mission, why-now, problems, strategy). Rendered at `/vision` and `/about/strategy`. |
| `src/content/pages/`       | MDX  | Body copy for individual site pages (about, contact, get-involved).                                           |
| `src/content/projects/`    | MDX  | One per project. Drives `/projects` and `/projects/[slug]`.                                                   |
| `src/content/events/`      | MDX  | One per event. Drives `/events` and `/events/[slug]`.                                                         |
| `src/content/initiatives/` | JSON | Project tags. Drives the chips on `/projects`.                                                                |

## Frontmatter shapes

### Event

```yaml
title: string
date: ISO 8601 datetime # required, with timezone
endDate: ISO 8601 datetime # optional
location: string # required
featured: boolean # optional, default false
rsvpUrl: URL # optional
summary: string # required
```

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

Each collection has a `_template.mdx` (or `_template.json`) showing the canonical shape. Copy it when adding new content.
