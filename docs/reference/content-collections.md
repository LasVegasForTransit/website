# Content collections reference

What lives in each content folder and the exact shape each file must follow. Reach for this when
you're adding or editing a page, project, event, or initiative and need to know which fields are
required.

A _content collection_ is Astro's name for a folder of content files that all share the same shape
(see [glossary](./glossary.md#content-collection)). All site content lives under
`apps/site/src/content/`. Schemas (the rules for what fields a file must have) are enforced by Zod
(a tool that checks data matches an expected shape — see [glossary](./glossary.md#zod)) in
`apps/site/src/content.config.ts` — content that doesn't match the shape will fail the build. That's
deliberate: a typo in a content file stops the build with a clear message instead of shipping a
broken page.

## Folder layout

Most collections are authored in MDX (Markdown with the ability to drop in interactive components —
see [glossary](./glossary.md#mdx)).

| Folder                                | Type            | Drives                                                                                                                                                                                                                                                      |
| ------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/site/src/content/docs/`         | MDX             | Long-form essays (vision, mission, why-now, problems, strategy). Rendered at `/vision` and `/about/strategy`.                                                                                                                                               |
| `apps/site/src/content/pages/`        | MDX             | Body copy for individual site pages (about, contact, get-involved).                                                                                                                                                                                         |
| `apps/site/src/content/projects/`     | MDX             | One per project. Drives `/projects` and `/projects/[slug]`.                                                                                                                                                                                                 |
| `apps/site/src/content/programs/`     | MDX             | One per named, ongoing program. Drives `/programs` and `/programs/[slug]`.                                                                                                                                                                                  |
| `apps/site/src/content/work-areas/`   | MDX             | Broad areas that explain how programs and projects connect. Shown below named programs on `/programs`.                                                                                                                                                      |
| `apps/site/src/content/letters/`      | MDX             | One per letter. Drives `/letters` and `/letters/[slug]`. See "Letter" below for what belongs here.                                                                                                                                                          |
| _(events)_                            | Google Calendar | Event metadata. Pulled at build time by the custom loader in `apps/site/src/lib/events-loader.ts`. See [events pipeline](../explanation/events-pipeline.md).                                                                                                |
| `apps/site/src/content/event-bodies/` | MDX             | Optional long-form body for a specific event, matched by calendar occurrence identity (or filename for legacy fragments). Rendered below the event header on `/events/[slug]`.                                                                              |
| _(newsletter)_                        | Beehiiv RSS     | Newsletter issues. Pulled at build time by the loader in `apps/site/src/lib/newsletter-loader.ts` from the feed at `PUBLIC_LVBT_NEWSLETTER_FEED_URL`. Drives `/newsletter`; each card links out to the Beehiiv post (issues are never hosted on this site). |
| `apps/site/src/content/initiatives/`  | JSON            | Project tags. Drives the chips on `/projects`.                                                                                                                                                                                                              |

## Frontmatter shapes

### Event

Events come from the public LVBT Google Calendar (GCal); there is no MDX frontmatter (the settings
block at the top of an MDX file — see [glossary](./glossary.md#frontmatter)) to author. The custom
loader in `apps/site/src/lib/events-loader.ts` maps calendar fields to this validated shape:

```ts
{
  title: string;                 // from GCal SUMMARY
  calendarUid: string;           // from GCal UID; shared by all occurrences in a series
  calendarOccurrenceId: string;  // UID + original recurrence time; one-off events use their UID
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
    status?;                     // EventCancelled for GCal STATUS:CANCELLED; EventScheduled otherwise
    images?;
    isAccessibleForFree?;
    keywords?;
    about?;
    audience?;
    offer?;
  };
}
```

Authoring lives in Google Calendar — see [`docs/guides/add-an-event.md`](../guides/add-an-event.md)
and [`docs/explanation/events-pipeline.md`](../explanation/events-pipeline.md).

### Event body (optional)

```yaml
slug: string # original event slug (<YYYY-MM-DD>-<slugified-title>, PT date)
calendarOccurrenceId: string # optional stable identity from the loaded event
discussionTopic: string # optional occurrence-specific question shown in its program feature
```

MDX renders below the event header on `/events/[slug]`. Regular event copy belongs in Google
Calendar; use a fragment for rich content or a recap. Set `calendarOccurrenceId` to keep it attached
when an event is renamed or rescheduled. Recurring occurrences use
`<UID>#<original recurrence time>` (for example `series@google.com#2026-10-15T18:30:00`); one-off
events use the UID alone. Copy the loader's exact identity, including its time-zone representation.
A fragment without an identity uses its filename to match the event slug for compatibility.

### Newsletter issue

Newsletter issues come from the Beehiiv RSS feed (an XML feed of recent issues — see
[glossary](./glossary.md#rss)); there is no MDX to author. Set `PUBLIC_LVBT_NEWSLETTER_FEED_URL`
(and `PUBLIC_LVBT_NEWSLETTER_URL` for the "Read on Beehiiv" links) — see
[`apps/site/.env.example`](../../apps/site/.env.example). The loader in
`apps/site/src/lib/newsletter-loader.ts` maps each feed `<item>` to this validated shape:

```ts
{
  title: string;     // <title>
  link: URL;         // <link> — the Beehiiv post; the site links out, never hosts the issue
  pubDate: Date;     // <pubDate>
  excerpt: string;   // first ~220 chars of <description>/<content:encoded>, HTML stripped
  image?: string;    // <enclosure> or <media:content> thumbnail, if the feed includes one
}
```

When the feed URL is unset (e.g. local dev with no `apps/site/.env.local`) or the feed has no
published items yet, the collection is empty and `/newsletter` shows a subscribe-only state instead
of a list.

### Project

```yaml
title: string
status: 'active' | 'planned' | 'complete' | 'paused'
program: string                  # optional slug from src/content/programs/
initiatives: string[]             # slugs from src/content/initiatives/
tldr: string
contacts:
  - name: string
    role: string
startDate: ISO 8601 date
order: number                     # optional, lower = earlier
```

Project bodies use a standard public-brief structure: `## Overview`, `## Motivation`, `## Approach`,
and `## Activities`, with `## Updates` added only when there is dated progress to record. The
`Motivation` section explains the public problem, who is affected, why LVBT is acting, and why the
work matters now. `Activities` names the concrete things the page will eventually point to: reports,
events, comments, coalitions, chapters, briefs, evidence logs, media packages, published stories,
public relationships, or other recorded results.

### Program

```yaml
title: string
summary: string
image: # optional feature image; supply its intrinsic dimensions
  src: string # normally /programs/<file> from public/programs/
  alt: string # required description
  width: number # positive intrinsic pixel width
  height: number # positive intrinsic pixel height
  kind: 'photo' | 'screenshot' # optional; photos fill the area, screenshots fit completely
  caption: string # optional
  credit: # optional; all fields required when included
    name: string
    url: URL
    license: string
    licenseUrl: URL
designation: 'community-gatherings' | 'annual-challenges' | 'civic-technology'
icon: string
order: number
cadence: string # optional recurring schedule
status: 'active' | 'planned'
participationUrl: URL # optional external site for current participation details
participationLabel: string # optional action text; requires participationUrl
calendarSeriesUid: string # optional GCal UID connecting the program to its event series
eventNoun: string # optional singular noun, e.g. meetup or walk; defaults to event
venue: # optional standing or proposed meeting place for an ongoing program
  name: string
  address: string
  mapUrl: URL
  status: 'proposed' | 'confirmed'
```

One program file holds the purpose and identity that persist across events, yearly editions, or
ongoing projects. For example, LVBT Labs builds civic tech tools for urbanism and transit advocacy;
it has a catalog and contribution path rather than a recurring meeting schedule. The filename is its
stable `/programs/[slug]` URL. The summary is the short introduction for the directory, metadata,
and detail page. Each program has its own page section, with a heading, icon, short summary, and
explicit link to its program page. On desktop, sections occupy at least the usable viewport below
the header and use native proximity snapping; longer content expands normally. Images share an 8:5
area beside the text. Photos use a centered crop; screenshots fit completely with a muted border. On
mobile, images appear between the program name and introduction, with natural section height and no
snapping. Images have no visible captions; required credits are collected on the colophon. A program
with a calendar series and no image uses that column for its selected occurrence: the authored
discussion topic, date, time, venue, and an action to the LVBT event page. Without an authored
topic, the occurrence's date becomes the focal text. Without an occurrence, the recurring schedule
and events-calendar fallback remain available. Topic copy comes from the matching event body's
optional `discussionTopic` and never carries into another occurrence. Full descriptions belong in
the program's MDX body and detail page. Designation is an editorial classification, not a displayed
label, parent route, or layout selector. A program may name a recurring meeting place with its
confirmation status. Put dates, final venues, and registration for a particular occurrence in the
events calendar or the linked participant site.

For a program with `calendarSeriesUid`, its page selects an ongoing occurrence, then the nearest
upcoming one, then the most recent completed one. Cancelled occurrences are excluded. Selection runs
at build time and in the browser on page load and every minute; it follows the series UID even if an
occurrence is renamed or rescheduled. Calendar changes arrive with the next rebuild; clock-based
rollover between already loaded occurrences does not require a rebuild. The details panel uses that
occurrence's date, time, and venue. Both its date and primary action link directly to the selected
LVBT event page. An upcoming or ongoing occurrence offers **RSVP**; a completed occurrence offers
**View last event**, using `eventNoun` when provided (for example, **View last meetup**). This
destination is independent of any signup URL on the event. Without a matching occurrence, the page
shows the standing schedule and an events-calendar link. `participationUrl` takes precedence for
programs with their own participant site. Only programs with `calendarSeriesUid` render an event
panel. Other programs use their MDX body and optional participation action, without a schedule,
venue, or calendar fallback being invented for them. The shared template provides the shell, not a
universal program format.

### Work area

```yaml
title: string
summary: string
icon: string
order: number
projects: string[] # optional project slugs
cohorts: [] # optional named cohorts
```

Work areas describe enduring parts of LVBT's work. They are not named programs and have no detail
route. Keep specific gatherings and challenges in `programs/`.

### Letter

```yaml
title: string
date: ISO 8601 date # when the letter was posted
summary: string
author: string # e.g. "Willie Chalmers III"
authorTitle: string # e.g. "President" — the author's role on THIS letter
order: number # optional, lower = earlier
```

The page is titled "Letters from Leadership," not "Letters from the President," on purpose. The main
use case today is letters from the president, but leadership is more than whoever's in charge — this
collection is open to other officers, board members, and team leads, and eventually to open letters
that aren't tied to one individual author. That's why `author`/`authorTitle` are per-letter fields
rather than a name hardcoded into the page template: each letter can be signed by whoever actually
wrote it.

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

`apps/site/src/content.config.ts` lists every collection's exact fields and types (this page
summarizes them, but that file is what the build actually checks). When in doubt, read it — it's the
source of truth, not this page.

## Templates

Each MDX/JSON-backed collection has a `_template.mdx` (or `_template.json`) showing the canonical
shape. Copy it when adding new content. The leading underscore is a convention: for collections that
use it (currently `projects`, `programs`, `letters`), the collection's `glob()` loader pattern in
`apps/site/src/content.config.ts` excludes `_`-prefixed files at the source, so the template never
enters the content store and never needs per-page filtering to keep it out of listings, sitemaps, or
`/llms-full.txt`. A new MDX/JSON collection that wants this convention needs to opt in the same way
— the underscore prefix alone does nothing on its own. Events have no template — they're created in
Google Calendar; `pnpm -C apps/site event:new` scaffolds an optional body fragment.
