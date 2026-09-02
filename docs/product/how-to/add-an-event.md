# Add an event

This guide shows how to add an event (a meeting, action, or gathering) to the LVBT events page. Use
it whenever you want a new event to appear on the site.

Events live in the LVBT (Las Vegans for Better Transit) Google Calendar, not in the repo. Keeping
them in the calendar means non-developers can add and edit events without touching code, and the
site stays in sync automatically. The site rebuilds against the calendar on a schedule, so a
calendar change shows up on the site on its own.

## Before you start

- Edit access to the LVBT Google Calendar (ask a team lead if you can't create events on it).
- Only for the optional MDX (Markdown plus components — see
  [glossary](../../development/reference/glossary.md#mdx)) body fragment below: a local copy of the
  repo with `pnpm` (our package manager — see
  [glossary](../../development/reference/glossary.md#pnpm)) installed.

## The fast path

1. Open the LVBT public calendar in Google Calendar.
2. Create the event:
   - **Title** — what should show on the events page (e.g. "General Meeting").
   - **Date / time** — in Pacific Time (Las Vegas's time zone, UTC−8/−7). Always set an end time.
   - **Location** — a meeting URL (virtual), a full physical address (in-person), or both (hybrid —
     put the address in Location and the meeting URL in Description). For physical events, use the
     full Google-style address so the site can publish a real postal address in structured data.
   - **Description** — the first paragraph becomes the card / lede summary (keep it to one
     sentence). Everything after that paragraph becomes the body on the detail page; format it
     however you want with GCal's rich-text editor (the toolbar for bold, lists, links — like a mini
     word processor). Add `RSVP: https://…` if registration goes through an external sign-up form.
     Add `ADMISSION: https://…` or `TICKETS: https://…` only when the link is where people get
     admission or tickets, even for a free event.
3. Save. The next scheduled rebuild (within ~1 hour) picks it up. To rush it, trigger a redeploy
   from the Cloudflare Pages dashboard.

## When an event needs more than what GCal can hold

Most events ship as GCal-only — the description carries both the summary and the long-form body.
Reach for an MDX body fragment (a small `.mdx` file holding just the rich body content for one
event) under `src/content/event-bodies/<slug>.mdx` only when you need things GCal's rich-text editor
can't do: custom components, glossary tooltips, typed internal links, etc. The fragment takes
priority over the calendar description.

The slug (the URL-safe id for the event, used as its filename) is `<YYYY-MM-DD>-<slugified-title>`
using the event's Pacific-time start date — lowercased, spaces turned into hyphens. For "General
Meeting" on 2026-05-28 → `2026-05-28-general-meeting`.

```text
pnpm event:new
```

walks you through it: it prints the GCal field checklist, then optionally scaffolds the body
fragment for you.

## Common failures

- **Structured-data audit says "no location yet"**
  - _What it means:_ the event in GCal has no Location and no meeting link in the Description, so
    the page can publish the event but Google won't treat it as eligible for its Event rich result.
  - _How to fix:_ open the event in GCal and add either a physical address in Location or a meeting
    URL in the Description.
- **Build fails: "No upcoming events in the Google Calendar feed"**
  - _What it means:_ every event in the calendar is in the past, so there's nothing future to show.
  - _How to fix:_ add at least one event with a future date.
- **Card summary repeats the title**
  - _What it means:_ the event has no human-written description in GCal, so the summary fell back to
    the title.
  - _How to fix:_ open the event in GCal and write one sentence as the first paragraph of the
    Description.
- **Card summary is too long, or shows multiple sentences**
  - _What it means:_ your first paragraph runs long, and the whole first paragraph is used as the
    summary.
  - _How to fix:_ break it after the first sentence — start a new paragraph, and the rest will flow
    into the body below the header.

## Full reference

[`docs/explanation/events-pipeline.md`](../explanation/events-pipeline.md) — schema mapping, slug
rules, rebuild cadence, the cron Worker.
