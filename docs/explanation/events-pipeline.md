# Events pipeline

Events on the site come from a public Google Calendar. The site rebuilds against the calendar on a schedule; the calendar is the source of truth for both event metadata (title, time, location, join URL) and event body copy (the rich-text description). MDX fragments under [`src/content/event-bodies/`](../../src/content/event-bodies/) are an optional override for events that need MDX features (components, typed links) — most events ship as just GCal.

## The flow

```
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

| GCal field  | Becomes                                                                                                    | Notes                                                                                                 |
| ----------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Title       | `title`                                                                                                    | Trimmed; surfaces on cards and detail page.                                                           |
| Date / time | `date`, `endDate`                                                                                          | Always set an end time — the `.ics` builder needs one, and the "Live now" check needs the end window. |
| Location    | `joinUrl` if URL, else `venue.name`                                                                        | Put a meeting URL here for a virtual event, a physical address for an in-person event.                |
| Description | `summary` (first paragraph) + `body` (everything after, as HTML) + optional `joinUrl` + optional `rsvpUrl` | See conventions below.                                                                                |

3. (Optional) Add long-form body copy under `src/content/event-bodies/<slug>.mdx`. The slug is `<YYYY-MM-DD>-<slugified-title>` using the Pacific-time date. `pnpm event:new` walks through this.

### Description conventions

The description is two pieces of content in one field, separated by paragraph breaks:

- **First paragraph** → `summary`. Plain text, stripped of any inline formatting, used on event cards and as the detail-page lede. One sentence is ideal. If you write nothing, the summary falls back to the title — that's ugly on cards.
- **Everything after** → `body`. Rendered as HTML below the event header on the detail page, with whatever rich formatting (lists, bold, links) you applied in Google Calendar's description editor.

Google Calendar's auto-appended footer ("Join with Google Meet: …", phone numbers, "Learn more about Meet at: …") is detected by its boundary and dropped before either field is derived — you never have to scrub it manually.

Two other conventions the build watches for:

- **A Meet / Zoom / Teams / Webex / Whereby URL on its own line** is picked up as `joinUrl` if the Location field is a physical address. Use this for hybrid events.
- **A line starting with `RSVP:`** registers an `rsvpUrl`. Example: `RSVP: https://lu.ma/abc-def`.

### Format inference

`format` is derived, not authored:

| Join URL | Venue | Result                              |
| -------- | ----- | ----------------------------------- |
| ✓        | —     | `virtual`                           |
| —        | ✓     | `in-person`                         |
| ✓        | ✓     | `hybrid`                            |
| —        | —     | **build fails** (loud, intentional) |

## Slug

The slug used for the URL (`/events/<slug>`) and for matching body fragments is:

```
<YYYY-MM-DD>-<slugified-title>
```

Both parts derived in **Pacific Time**. Example: a "General Meeting" at 6:30 PM PT on 2026-05-28 → `2026-05-28-general-meeting`.

If you rename a calendar event, the URL changes. That's working as intended — past URLs may break, the calendar's UID isn't user-friendly enough to use as the slug.

## Rebuild cadence

Pages doesn't natively run cron triggers, so a small separate Cloudflare Worker under [`cron-rebuild/`](../../cron-rebuild/) runs hourly and POSTs the Pages Deploy Hook. The Pages build re-fetches the calendar.

Setup:

1. Cloudflare Pages dashboard → Settings → Builds & deployments → **create a Deploy Hook** for production.
2. From `cron-rebuild/`:
   ```
   pnpm dlx wrangler deploy
   pnpm dlx wrangler secret put PAGES_DEPLOY_HOOK_URL
   # paste the hook URL when prompted
   ```

Worst-case staleness is ~1 hour (cron tick) + however long Google's ICS edge cache holds (often near-instant, can be ~hours for public calendars). For a same-day correction, trigger a redeploy manually from the Pages dashboard.

## Failure modes the build will surface

- **Empty calendar / no upcoming events** → the loader throws and the build fails. Populate at least one upcoming event in GCal.
- **Event with neither join URL nor venue** → loader throws. Add a Meet URL or a physical address to the calendar event.
- **End time missing** → currently allowed (the schema's `endDate` is optional), but downstream behavior degrades: `.ics` falls back to a 1-hour duration and "Live now" never fires correctly. Always set an end time.
- **ICS fetch fails (network / Google returns non-2xx)** → loader throws with the status. Retry the deploy; if persistent, check the calendar's "Make available to public" setting in GCal share settings.

## What's deliberately NOT supported

- Editing events on the website. Calendar only.
- Two-way sync. One-way: calendar → site.
- Past events deeper than what Google exports in the public ICS window. If preserving deep history matters later, snapshot the feed periodically and merge.
