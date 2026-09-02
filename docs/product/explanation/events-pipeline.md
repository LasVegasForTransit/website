# Events pipeline

This page explains how events get onto the site — for anyone adding an event or touching the events
code. The short version: you create events in Google Calendar, and the site pulls them in
automatically when it rebuilds.

Events on the site come from a public Google Calendar. The site rebuilds against the calendar on a
schedule; the calendar is the source of truth for both event metadata (title, time, location, join
URL) and event body copy (the rich-text description). MDX fragments (Markdown files that can embed
interactive components — see [glossary](../../development/reference/glossary.md#mdx)) under
[`src/content/event-bodies/`](../../../apps/site/src/content/event-bodies) are an optional override
for events that need MDX features (components, typed links) — most events ship as just GCal.

## The flow

The diagram below traces how a calendar entry becomes a page. An ICS feed is the standard file
format calendars publish their events in; a slug is the short, URL-friendly id at the end of a
page's address (e.g. `2026-05-28-general-meeting`). `getCollection` and `getEntry` are Astro
functions that read content at build time — `getCollection` loads every item in a group, `getEntry`
loads one by its slug.

```text
Google Calendar (public ICS feed)
        │   src/lib/site.ts → site.calendar.icsUrl
        ▼
src/lib/events-loader.ts                     src/content/event-bodies/<slug>.mdx
        │  (custom Astro content-collection         │   (optional, keyed by slug)
        │   loader; runs at build)                  │
        ▼                                            ▼
astro:content getCollection('events')        getEntry('eventBodies', slug)
        │
        ▼
events/index.astro · events/[...slug].astro · events/[...slug].ics.ts · go.astro
```

## Authoring an event

**Always start in Google Calendar.** The site cannot create or modify events.

1. Open the LVBT calendar (the only one).
2. Create an event with these fields:

| GCal field  | Becomes                                                                                                              | Notes                                                                                                 |
| ----------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Title       | `title`                                                                                                              | Trimmed; surfaces on cards and detail page.                                                           |
| Date / time | `date`, `endDate`                                                                                                    | Always set an end time — the `.ics` builder needs one, and the "Live now" check needs the end window. |
| Location    | `joinUrl` if URL, else `venue`                                                                                       | Put a meeting URL here for a virtual event, or a physical address for an in-person event.             |
| Description | `summary` (first paragraph) + `body` (everything after, as HTML) + optional `joinUrl`, `rsvpUrl`, and admission link | See conventions below.                                                                                |

<!-- markdownlint-disable MD029 -- the table above splits the numbered steps -->

3. (Optional) Add long-form body copy under `src/content/event-bodies/<slug>.mdx`. The slug is
   `<YYYY-MM-DD>-<slugified-title>` using the Pacific-time date. `pnpm event:new` walks through
   this.

<!-- markdownlint-enable MD029 -->

### Description conventions

The description is two pieces of content in one field, separated by paragraph breaks:

- **First paragraph** → `summary`. Plain text, stripped of any inline formatting, used on event
  cards and as the detail-page lede. One sentence is ideal. If you write nothing, the summary falls
  back to the title — that's ugly on cards.
- **Everything after** → `body`. Rendered as HTML below the event header on the detail page, with
  whatever rich formatting (lists, bold, links) you applied in Google Calendar's description editor.

Google Calendar's auto-appended footer ("Join with Google Meet: …", phone numbers, "Learn more about
Meet at: …") is detected by its boundary and dropped before either field is derived — you never have
to scrub it manually.

Two other conventions the build watches for:

- **A Meet / Zoom / Teams / Webex / Whereby URL on its own line** is picked up as `joinUrl` if the
  Location field is a physical address. Use this for hybrid events.
- **A line starting with `RSVP:`** registers a sign-up link. Example:
  `RSVP: https://forms.gle/abc-def`.
- **A line starting with `ADMISSION:` or `TICKETS:`** registers the admission link. Use this only
  for a page where someone can get admission or a ticket, even when the event is free. Examples:
  `ADMISSION: https://lu.ma/abc-def` or `TICKETS: https://lu.ma/abc-def`.
- **A Google-style physical address** such as
  `7-Eleven, 4728 W Craig Rd, North Las Vegas, NV 89032, USA` is split into a Schema.org `Place`
  with a `PostalAddress`.

### Format inference

`format` is derived, not authored:

| Join URL | Venue | Result                                         |
| -------- | ----- | ---------------------------------------------- |
| ✓        | —     | `virtual`                                      |
| —        | ✓     | `in-person`                                    |
| ✓        | ✓     | `hybrid`                                       |
| —        | —     | Event still builds; page shows details pending |

## Structured data

Each event detail page emits Schema.org `Event` JSON-LD. The site includes the event title, summary,
canonical URL, stable event id, start and end times, duration, attendance mode, organizer, language,
default image, accessibility/free-attendance flag, transit-related topics, and location when the
calendar provides one. `RSVP:` links publish as a registration action; `ADMISSION:` and `TICKETS:`
links publish as event offers.

Virtual and hybrid events use Schema.org `VirtualLocation`, which is valid structured data. Google's
Event rich-result feature is narrower: virtual-only events and events with no physical location are
reported by `pnpm check:structured-data` as non-fatal Google eligibility notes. Physical events need
a real postal address for Google eligibility.

## Slug

The slug used for the URL (`/events/<slug>`) and for matching body fragments is:

```text
<YYYY-MM-DD>-<slugified-title>
```

Both parts derived in **Pacific Time**. Example: a "General Meeting" at 6:30 PM PT on 2026-05-28 →
`2026-05-28-general-meeting`.

If you rename a calendar event, the URL changes. That's working as intended — past URLs may break,
the calendar's UID isn't user-friendly enough to use as the slug.

## Rebuild cadence

A GitHub Actions (GitHub's built-in automation that runs scripts on a schedule or on each push)
scheduled workflow — a "cron" job, meaning it runs on a fixed timetable — at
[`.github/workflows/cron-rebuild.yml`](../../../.github/workflows/cron-rebuild.yml) fires twice a
day (roughly morning and evening PT) and dispatches the `Deploy production` workflow. The Pages
build re-fetches the calendar on its way through.

Why twice a day: event metadata changes a few times a week at most; a morning and an evening rebuild
keep the site current without burning Cloudflare Pages Free's 500-builds/month budget (twice daily =
60/month). Tighten the cron in the workflow file if events start moving faster than that.

Why GitHub Actions and not a Cloudflare Worker: the trigger needs zero long-lived credentials this
way. The workflow uses the auto-issued `GITHUB_TOKEN`, scope-limited to `actions: write` on this
repo. No PATs, no Worker secrets, no API token rotation. Logs surface in the Actions UI alongside
every other deploy.

For a same-day correction, push a commit or click **Run workflow** on the `cron-rebuild` (or
`Deploy production`) workflow page — both trigger an immediate redeploy.

Worst-case staleness: ~12 hours (gap between the morning and evening rebuilds) + however long
Google's ICS edge cache holds (typically near-instant, can be a few hours for public calendars). For
anything time-sensitive, hit **Run workflow** in the Actions UI rather than wait.

## Failure modes the build will surface

- **Empty calendar / no upcoming events** → the loader throws and the build fails. Populate at least
  one upcoming event in GCal.
- **Event with neither join URL nor venue** → the page still builds and shows "Location to be
  announced." The structured-data audit reports a non-fatal Google eligibility note until you add a
  meeting URL or physical address.
- **End time missing** → currently allowed (the schema's `endDate` is optional), but downstream
  behavior degrades: `.ics` falls back to a 1-hour duration and "Live now" never fires correctly.
  Always set an end time.
- **ICS fetch fails (network / Google returns non-2xx)** → loader throws with the status. Retry the
  deploy; if persistent, check the calendar's "Make available to public" setting in GCal share
  settings.

## What's deliberately NOT supported

- Editing events on the website. Calendar only.
- Two-way sync. One-way: calendar → site.
- Past events deeper than what Google exports in the public ICS window. If preserving deep history
  matters later, snapshot the feed periodically and merge.
