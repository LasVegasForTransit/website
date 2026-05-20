# Add an event

Events live in the LVBT Google Calendar, not in the repo. The site rebuilds against the calendar on a schedule.

## The fast path

1. Open the LVBT public calendar in Google Calendar.
2. Create the event:
   - **Title** — what should show on the events page (e.g. "General Meeting").
   - **Date / time** — in Pacific Time. Always set an end time.
   - **Location** — a meeting URL (virtual), a physical address (in-person), or both (hybrid — put the address in Location and the meeting URL in Description).
   - **Description** — the first paragraph becomes the card / lede summary (keep it to one sentence). Everything after that paragraph becomes the body on the detail page; format it however you want with GCal's rich-text editor (lists, bold, links). Add an `RSVP: https://…` line anywhere if registration goes through an external form.
3. Save. The next scheduled rebuild (within ~1 hour) picks it up. To rush it, trigger a redeploy from the Cloudflare Pages dashboard.

## When an event needs more than what GCal can hold

Most events ship as GCal-only — the description carries both the summary and the long-form body. Reach for an MDX body fragment under `src/content/event-bodies/<slug>.mdx` only when you need things GCal's rich-text editor can't do: shadcn-style components, glossary tooltips, typed internal links, etc. The fragment takes priority over the calendar description.

The slug is `<YYYY-MM-DD>-<slugified-title>` using the event's Pacific-time start date. For "General Meeting" on 2026-05-28 → `2026-05-28-general-meeting`.

```
pnpm event:new
```

walks you through it: it prints the GCal field checklist, then optionally scaffolds the body fragment for you.

## Common failures

- **Build fails: "neither a join URL nor a venue"** — the event in GCal has no Location and no meeting link in the Description. Add one.
- **Build fails: "No upcoming events in the Google Calendar feed"** — every event in the calendar is in the past. Add an upcoming one.
- **Card summary repeats the title** — the event has no human-written description in GCal, so the summary fell back to the title. Open the event in GCal and write one sentence as the first paragraph.
- **Card summary is too long, or shows multiple sentences** — your first paragraph runs long. Break it after the first sentence: the rest will flow into the body below the header.

## Full reference

[`docs/explanation/events-pipeline.md`](../explanation/events-pipeline.md) — schema mapping, slug rules, rebuild cadence, the cron Worker.
