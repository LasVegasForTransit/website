// Custom Astro content-collection loader. Fetches the public Google Calendar
// ICS feed at build, parses each VEVENT with ical.js, and emits entries that
// satisfy the `events` collection schema in src/content.config.ts.
//
// Hard cutover: the build fails if the feed returns zero upcoming events.
// That surfaces a misconfigured or empty calendar loudly rather than
// silently shipping an empty /events page.
//
// Body content is handled by a separate `eventBodies` collection (globbed
// from src/content/event-bodies/*.mdx). The detail page joins on slug.

import type { Loader } from 'astro/loaders';
import ICAL from 'ical.js';
import { site } from './site';
import { slugify } from './slugify';

import type { EventLocation } from './event-format';
import { TIMEZONE } from './event-time';

type EventData = {
  title: string;
  date: Date;
  endDate?: Date;
  // Undefined when the event has no arranged join URL or venue yet.
  location?: EventLocation;
  rsvpUrl?: string;
  featured: boolean;
  summary: string;
  body?: string;
};

const CONFERENCE_HOST_RE =
  /(meet\.google\.com|zoom\.us|teams\.microsoft\.com|webex\.com|whereby\.com)/i;

const ptDateFmt = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: TIMEZONE,
});

function ptDateSlug(d: Date): string {
  // en-CA short date gives YYYY-MM-DD.
  return ptDateFmt.format(d);
}

function isUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim());
}

function findConferenceUrl(text: string): string | undefined {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/https?:\/\/\S+/);
    if (m && CONFERENCE_HOST_RE.test(m[0])) return m[0];
  }
  return undefined;
}

function findRsvpUrl(description: string): string | undefined {
  const m = description.match(/^\s*RSVP:\s*(https?:\/\/\S+)/im);
  return m?.[1];
}

// Google Calendar's web editor saves rich-text descriptions as HTML — paragraph
// tags, lists, bold runs. The ICS feed delivers that HTML verbatim. We split it
// into two pieces:
//
//   summary  →  first paragraph, plain text (used on cards + detail-page lede)
//   body     →  HTML for everything after the first paragraph (rendered as the
//                long-form section on the detail page when no MDX fragment is
//                present)
//
// Anything after the Google-Meet auto-boilerplate footer ("Join with Google
// Meet: …", phone numbers, "Learn more about Meet at: …") is dropped before
// splitting. Authors write their content; we never show GCal's plumbing.
const MEET_BOILERPLATE_BOUNDARY_RE = /\n\s*(?:Join with Google Meet:|Video call link:)/i;

function stripHtml(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}

function parseDescription(
  rawDescription: string,
  title: string,
): { summary: string; body: string | undefined } {
  const boundary = rawDescription.search(MEET_BOILERPLATE_BOUNDARY_RE);
  const authored = (boundary >= 0 ? rawDescription.slice(0, boundary) : rawDescription).trim();

  if (!authored) {
    return { summary: title, body: undefined };
  }

  const firstP = authored.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  if (firstP && firstP.index !== undefined) {
    const summaryText = stripHtml(firstP[1]) || title;
    const rest = (
      authored.slice(0, firstP.index) + authored.slice(firstP.index + firstP[0].length)
    ).trim();
    return { summary: summaryText, body: rest || undefined };
  }

  // Plain-text description (no <p> wrapping). Split on blank lines.
  const [first, ...rest] = authored.split(/\r?\n\s*\r?\n/).map((p) => p.trim());
  return {
    summary: first || title,
    body: rest.filter(Boolean).join('\n\n') || undefined,
  };
}

// Cap RRULE expansion at 1 year from build time so infinite recurrences don't
// loop forever.
const HORIZON_MS = 365 * 24 * 60 * 60 * 1000;

// Build a single loader entry from a resolved event instance. `recurrenceKey`
// is the RRULE-generated time string for the occurrence; it makes each
// occurrence's digest unique so Astro's incremental cache invalidates correctly
// when a specific instance is moved without changing the rest of the series.
function buildEventEntry(
  uid: string,
  event: ICAL.Event,
  startDate: Date,
  endDate: Date | undefined,
  recurrenceKey: string,
): { slug: string; data: EventData; digestInput: string } | null {
  const title = event.summary?.trim() ?? '';
  if (!title) return null;

  const description = event.description?.trim() ?? '';
  const rawLocation = event.location?.trim() ?? '';

  let joinUrl: string | undefined;
  let venueName: string | undefined;
  if (rawLocation && isUrl(rawLocation)) {
    joinUrl = rawLocation;
  } else if (rawLocation) {
    venueName = rawLocation;
  }
  if (!joinUrl) {
    const fromDesc = findConferenceUrl(description);
    if (fromDesc) joinUrl = fromDesc;
  }

  const venue = venueName
    ? {
        name: venueName,
        addressLocality: 'Las Vegas',
        addressRegion: 'NV',
        addressCountry: 'US',
      }
    : undefined;

  // Resolve the location union from what the calendar gave us. An event with
  // neither a join URL nor a venue is still a real, dated event — it just
  // hasn't had its attendance details arranged yet (e.g. a board meeting whose
  // location is pending). It gets no `location` (the absence of the union, not
  // a sentinel) rather than being dropped, so the calendar stays the source of
  // truth and the surfaces render a pending state.
  let location: EventLocation | undefined;
  if (joinUrl && venue) location = { format: 'hybrid', joinUrl, venue };
  else if (joinUrl) location = { format: 'virtual', joinUrl };
  else if (venue) location = { format: 'in-person', venue };

  const slug = `${ptDateSlug(startDate)}-${slugify(title)}`;
  const { summary, body } = parseDescription(description, title);

  const data: EventData = {
    title,
    date: startDate,
    endDate,
    location,
    rsvpUrl: findRsvpUrl(description),
    featured: false,
    summary,
    body,
  };

  return {
    slug,
    data,
    digestInput: [
      uid,
      recurrenceKey,
      title,
      startDate.toISOString(),
      endDate?.toISOString() ?? '',
      rawLocation,
      description,
    ].join('|'),
  };
}

export function calendarEventsLoader(): Loader {
  return {
    name: 'calendar-events-loader',
    load: async ({ store, parseData, generateDigest, logger }) => {
      logger.info(`Fetching events from ${site.calendar.icsUrl}`);
      const res = await fetch(site.calendar.icsUrl);
      if (!res.ok) {
        throw new Error(`Failed to fetch calendar ICS feed: ${res.status} ${res.statusText}`);
      }
      const text = await res.text();

      const jcal = ICAL.parse(text);
      const vcal = new ICAL.Component(jcal);
      const vevents = vcal.getAllSubcomponents('vevent');

      store.clear();

      const now = Date.now();
      const horizonMs = now + HORIZON_MS;
      const entries: Array<{ slug: string; data: EventData; digestInput: string }> = [];

      // Google Calendar expresses a rescheduled instance of a recurring event
      // as a second VEVENT with the same UID and a RECURRENCE-ID property. The
      // naive approach of iterating all VEVENTs produces two entries — one from
      // the master's DTSTART (the original date) and one from the exception's
      // DTSTART (the new date). The master's entry wins as nearest-upcoming and
      // the site shows the wrong date.
      //
      // Fix: group by UID, register exceptions via relateException(), then
      // expand the master through iterator() + getOccurrenceDetails() so each
      // occurrence resolves to its correct (post-exception) start time.
      const mastersByUid = new Map<string, ICAL.Component>();
      const exceptionsByUid = new Map<string, ICAL.Component[]>();

      for (const ve of vevents) {
        const uid = (ve.getFirstPropertyValue('uid') as string | null) ?? '';
        if (!uid) continue;
        if (ve.getFirstProperty('recurrence-id')) {
          const list = exceptionsByUid.get(uid) ?? [];
          list.push(ve);
          exceptionsByUid.set(uid, list);
        } else {
          mastersByUid.set(uid, ve);
        }
      }

      for (const [uid, masterVe] of mastersByUid) {
        const masterEvent = new ICAL.Event(masterVe);

        for (const exVe of exceptionsByUid.get(uid) ?? []) {
          masterEvent.relateException(exVe);
        }

        if (masterEvent.isRecurring()) {
          const iter = masterEvent.iterator();
          let nextTime: ICAL.Time | null;
          while ((nextTime = iter.next())) {
            if (nextTime.toJSDate().getTime() > horizonMs) break;
            const details = masterEvent.getOccurrenceDetails(nextTime);
            // details.item is the exception VEVENT when one exists; the master otherwise.
            const instance = details.item as ICAL.Event;
            const startDate = details.startDate.toJSDate();
            const endDate = details.endDate?.toJSDate();
            const entry = buildEventEntry(uid, instance, startDate, endDate, nextTime.toString());
            if (entry) entries.push(entry);
          }
        } else {
          const startDate = masterEvent.startDate.toJSDate();
          const endDate = masterEvent.endDate?.toJSDate();
          const entry = buildEventEntry(
            uid,
            masterEvent,
            startDate,
            endDate,
            masterEvent.startDate.toString(),
          );
          if (entry) entries.push(entry);
        }
      }

      // Orphaned exceptions: master series deleted but exception VEVENT remains.
      for (const [uid, exVes] of exceptionsByUid) {
        if (mastersByUid.has(uid)) continue;
        for (const exVe of exVes) {
          const event = new ICAL.Event(exVe);
          if (!event.startDate) continue;
          const startDate = event.startDate.toJSDate();
          const endDate = event.endDate?.toJSDate();
          const recKey = event.recurrenceId?.toString() ?? startDate.toISOString();
          const entry = buildEventEntry(uid, event, startDate, endDate, recKey);
          if (entry) entries.push(entry);
        }
      }

      // Sort ascending; auto-feature the nearest upcoming event so the
      // events page hero always has a target. Mirrors the prior
      // events/index.astro fallback at the entry level so every consumer
      // gets the same featured flag.
      entries.sort((a, b) => a.data.date.getTime() - b.data.date.getTime());
      const nearestUpcoming = entries.find((e) => e.data.date.getTime() >= now);
      if (nearestUpcoming) nearestUpcoming.data.featured = true;

      const upcomingCount = entries.filter((e) => e.data.date.getTime() >= now).length;
      if (upcomingCount === 0) {
        throw new Error(
          'No upcoming events in the Google Calendar feed. Add at least one upcoming event in Google Calendar before deploying.',
        );
      }

      for (const { slug, data, digestInput } of entries) {
        const parsed = await parseData({
          id: slug,
          data: data as unknown as Record<string, unknown>,
        });
        store.set({
          id: slug,
          data: parsed,
          digest: generateDigest(digestInput),
        });
      }

      logger.info(`Loaded ${entries.length} event(s) from calendar (${upcomingCount} upcoming).`);
    },
  };
}
