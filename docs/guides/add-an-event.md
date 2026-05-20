# Add an event

Events live in the LVBT Google Calendar, not in the repo. The site rebuilds against the calendar on a schedule.

## The fast path

1. Open the LVBT public calendar in Google Calendar.
2. Create the event:
   - **Title** — what should show on the events page (e.g. "General Meeting").
   - **Date / time** — in Pacific Time. Always set an end time.
   - **Location** — a meeting URL (virtual), a physical address (in-person), or both (hybrid — put the address in Location and the meeting URL in Description).
   - **Description** — start with a one-sentence summary (this becomes the card blurb). Add an `RSVP: https://…` line if registration is via an external form.
3. Save. The next scheduled rebuild (within ~1 hour) picks it up. To rush it, trigger a redeploy from the Cloudflare Pages dashboard.

## When an event needs more than a card

Some events warrant long-form copy on their detail page — an agenda, a briefing, a recap. That copy lives in `src/content/event-bodies/<slug>.mdx`.

The slug is `<YYYY-MM-DD>-<slugified-title>` using the event's Pacific-time start date. For "General Meeting" on 2026-05-28 → `2026-05-28-general-meeting`.

```
pnpm event:new
```

walks you through it: it prints the GCal field checklist, then optionally scaffolds the body fragment for you.

## Common failures

- **Build fails: "neither a join URL nor a venue"** — the event in GCal has no Location and no meeting link in the Description. Add one.
- **Build fails: "No upcoming events in the Google Calendar feed"** — every event in the calendar is in the past. Add an upcoming one.
- **Card summary says "LVBT General Meeting" twice** — the event has no human-written description in GCal, so the summary fell back to the title. Open the event in GCal and write one sentence.

## Full reference

[`docs/explanation/events-pipeline.md`](../explanation/events-pipeline.md) — schema mapping, slug rules, rebuild cadence, the cron Worker.
