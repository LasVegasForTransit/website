// RFC 5545 VCALENDAR/VEVENT builder for the per-event Add-to-calendar
// download. One function in, one string out — no temp files, no streams.
// Keep this byte-exact (CRLF line breaks, ≤75 octets per line) and
// validated against icalendar.org's tester if the output ever changes.
import type { CollectionEntry } from 'astro:content';
import { site } from './site';

// UTC stamp in iCalendar's `YYYYMMDDTHHMMSSZ` form. Toolkits accept the
// local-with-TZID form too, but the UTC form needs no VTIMEZONE block
// alongside it and round-trips correctly through Google / Apple / Outlook.
function icsDateUtc(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

// Per RFC 5545 §3.3.11: backslash, semicolon, comma, and newline are the
// four characters that need escaping inside TEXT-typed property values.
function escapeIcsText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// Same one-hour fallback as event-time.ts. Keep these constants colocated
// per-module — they're values consumed at different call sites, and
// cross-module imports would invert the dependency direction (this is
// the lower-level lib).
const ASSUMED_DURATION_MS = 60 * 60 * 1000;

function composeLocation(event: CollectionEntry<'events'>['data']): string {
  if (event.format === 'virtual') {
    return event.joinUrl ?? '';
  }
  const parts: string[] = [];
  if (event.venue) {
    parts.push(event.venue.name);
    if (event.venue.streetAddress) parts.push(event.venue.streetAddress);
    parts.push(`${event.venue.addressLocality}, ${event.venue.addressRegion}`);
  }
  let location = parts.filter(Boolean).join(', ');
  if (event.format === 'hybrid' && event.joinUrl) {
    location += location ? ` (also online: ${event.joinUrl})` : event.joinUrl;
  }
  return location;
}

export function buildIcs(event: CollectionEntry<'events'>): string {
  const eventUrl = new URL(`/events/${event.id}/`, site.url).toString();
  const dtStart = icsDateUtc(event.data.date);
  const dtEnd = icsDateUtc(
    event.data.endDate ?? new Date(event.data.date.getTime() + ASSUMED_DURATION_MS),
  );
  const dtStamp = icsDateUtc(new Date());
  const location = composeLocation(event.data);

  // PRODID identifies the calendar generator. Format is `-//OWNER//PRODUCT
  // VERSION//LANG` per RFC 5545. Lang token stays EN until we localise.
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${site.name}//Events//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.id}@lasvegasfortransit.org`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${escapeIcsText(event.data.title)}`,
    `DESCRIPTION:${escapeIcsText(event.data.summary)}`,
    location ? `LOCATION:${escapeIcsText(location)}` : null,
    `URL:${eventUrl}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter((line): line is string => line !== null);

  // RFC 5545 §3.1 mandates CRLF line endings between content lines.
  return lines.join('\r\n') + '\r\n';
}
