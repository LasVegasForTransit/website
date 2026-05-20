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

type EventFormat = 'virtual' | 'in-person' | 'hybrid';

type EventData = {
  title: string;
  date: Date;
  endDate?: Date;
  format: EventFormat;
  venue?: {
    name: string;
    addressLocality: string;
    addressRegion: string;
    addressCountry: string;
  };
  joinUrl?: string;
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
  timeZone: 'America/Los_Angeles',
});

function ptDateSlug(d: Date): string {
  // en-CA short date gives YYYY-MM-DD.
  return ptDateFmt.format(d);
}

function slugifyTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
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
      const entries: Array<{ slug: string; data: EventData; digestInput: string }> = [];

      for (const ve of vevents) {
        const event = new ICAL.Event(ve);
        const title = event.summary?.trim() ?? '';
        if (!title) continue;
        if (!event.startDate) continue;

        const startDate = event.startDate.toJSDate();
        const endDate = event.endDate?.toJSDate();
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

        let format: EventFormat;
        if (joinUrl && venueName) format = 'hybrid';
        else if (joinUrl) format = 'virtual';
        else if (venueName) format = 'in-person';
        else {
          throw new Error(
            `Calendar event "${title}" (${startDate.toISOString()}) has neither a join URL nor a venue. Add a Meet/Zoom URL or a physical address.`,
          );
        }

        const venue = venueName
          ? {
              name: venueName,
              addressLocality: 'Las Vegas',
              addressRegion: 'NV',
              addressCountry: 'US',
            }
          : undefined;

        const slug = `${ptDateSlug(startDate)}-${slugifyTitle(title)}`;
        const { summary, body } = parseDescription(description, title);

        const data: EventData = {
          title,
          date: startDate,
          endDate,
          format,
          venue,
          joinUrl,
          rsvpUrl: findRsvpUrl(description),
          featured: false,
          summary,
          body,
        };

        entries.push({
          slug,
          data,
          digestInput: [
            event.uid,
            title,
            startDate.toISOString(),
            endDate?.toISOString() ?? '',
            rawLocation,
            description,
          ].join('|'),
        });
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
