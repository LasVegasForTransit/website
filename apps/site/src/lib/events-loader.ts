// Custom Astro content-collection loader. Fetches the public Google Calendar
// ICS feed at build, parses each VEVENT with the shared runtime-safe parser,
// and emits entries that satisfy the `events` collection schema in
// src/content.config.ts.
//
// Hard cutover: the build fails if the feed returns zero upcoming events.
// That surfaces a misconfigured or empty calendar loudly rather than
// silently shipping an empty /events page.

import type { Loader } from 'astro/loaders';
import { site } from './site';
import { fetchCalendarFeed } from './calendar-feed';
import { parseEventsFromIcs } from './events-parse';

export function calendarEventsLoader(): Loader {
  return {
    name: 'calendar-events-loader',
    load: async ({ store, parseData, generateDigest, logger }) => {
      logger.info(`Fetching events from ${site.calendar.icsUrl}`);
      const text = await fetchCalendarFeed(site.calendar.icsUrl, logger);
      if (text === null) return;

      store.clear();

      const { entries, upcomingCount } = parseEventsFromIcs(text, Date.now());
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
