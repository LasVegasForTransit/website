import ICAL from 'ical.js';
import {
  type EventAdmissionLabel,
  type EventLocation,
  type EventSchemaMetadata,
  type EventVenue,
} from './event-format';
import { TIMEZONE } from './event-time';
import { verifiedCalendarVenues } from './event-venues';
import { slugify } from './slugify';

export interface EventData {
  title: string;
  calendarUid: string;
  calendarOccurrenceId: string;
  date: Date;
  endDate?: Date | undefined;
  // Undefined when the event has no arranged join URL or venue yet.
  location?: EventLocation | undefined;
  rsvpUrl?: string | undefined;
  admissionUrl?: string | undefined;
  admissionLabel?: EventAdmissionLabel | undefined;
  featured: boolean;
  summary: string;
  body?: string | undefined;
  schema?: EventSchemaMetadata | undefined;
}

export interface ParsedEventEntry {
  slug: string;
  data: EventData;
  digestInput: string;
}

interface BuildEventOptions {
  uid: string;
  event: ICAL.Event;
  startDate: Date;
  endDate: Date | undefined;
  recurrenceKey: string;
}

const CONFERENCE_HOST_RE =
  /(meet\.google\.com|zoom\.us|teams\.microsoft\.com|webex\.com|whereby\.com)/i;

const ptDateFmt = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: TIMEZONE,
});

const ptOffsetFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TIMEZONE,
  timeZoneName: 'shortOffset',
});

function ptDateSlug(d: Date): string {
  return ptDateFmt.format(d);
}

/**
 * Convert an `ical.js` time into a JS `Date`, anchoring all-day (`VALUE=DATE`)
 * dates to midnight in `America/Los_Angeles` rather than the host OS timezone
 * so UTC Workers match Pacific Time builds.
 */
export function icalTimeToDate(t: ICAL.Time): Date {
  if (!t.isDate) return t.toJSDate();
  const ymd = `${String(t.year).padStart(4, '0')}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
  // 08:30 UTC is always 00:30 PST or 01:30 PDT (before the 02:00 AM DST switch).
  const probe = new Date(Date.UTC(t.year, t.month - 1, t.day, 8, 30, 0));
  const offsetText =
    ptOffsetFmt.formatToParts(probe).find((part) => part.type === 'timeZoneName')?.value ?? 'GMT-8';
  const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(offsetText);
  const sign = match?.[1] === '+' ? 1 : -1;
  const hours = Number(match?.[2] ?? '8');
  const minutes = Number(match?.[3] ?? '0');
  const offsetMs = sign * (hours * 60 + minutes) * 60_000;
  return new Date(Date.parse(`${ymd}T00:00:00Z`) - offsetMs);
}

function isUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim());
}

function findConferenceUrl(text: string): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    const m = /https?:\/\/\S+/.exec(line);
    if (m && CONFERENCE_HOST_RE.test(m[0])) return m[0];
  }
  return undefined;
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

function stripHtml(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function findRsvpUrl(description: string): string | undefined {
  const lines = decodeEntities(description.replace(/<br\s*\/?>|<\/?p\b[^>]*>/gi, '\n'));
  const m = /^\s*RSVP(?: here)?:\s*(?:<a\b[^>]*\bhref\s*=\s*["'])?(https?:\/\/[^\s"'<>]+)/im.exec(
    lines,
  );
  return m?.[1];
}

function findAdmissionLink(
  description: string,
): { url: string; label: EventAdmissionLabel } | undefined {
  const m = /^\s*(ADMISSION|TICKETS?):\s*(https?:\/\/\S+)/im.exec(description);
  if (!m?.[1] || !m[2]) return undefined;
  return {
    url: m[2],
    label: m[1].toUpperCase().startsWith('TICKET') ? 'Tickets' : 'Admission',
  };
}

function parseGooglePlaceLocation(rawLocation: string): EventVenue {
  const fallback: EventVenue = {
    name: rawLocation,
    addressLocality: 'Las Vegas',
    addressRegion: 'NV',
    addressCountry: 'US',
  };

  const parts = rawLocation
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  const incomplete = Object.hasOwn(verifiedCalendarVenues, rawLocation)
    ? (verifiedCalendarVenues[rawLocation] ?? fallback)
    : fallback;
  if (parts.length < 4) return incomplete;

  const [name, streetAddress, addressLocality, regionPostal = '', country] = parts;
  const regionPostalMatch = /^([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/.exec(regionPostal);
  if (!name || !streetAddress || !addressLocality || !regionPostalMatch) return incomplete;

  return {
    name,
    streetAddress,
    addressLocality,
    addressRegion: regionPostalMatch[1] ?? 'NV',
    postalCode: regionPostalMatch[2],
    addressCountry: country === 'USA' ? 'US' : (country ?? 'US'),
  };
}

const MEET_BOILERPLATE_BOUNDARY_RE = /\n\s*(?:Join with Google Meet:|Video call link:)/i;

function parseDescription(
  rawDescription: string,
  title: string,
): { summary: string; body: string | undefined } {
  const boundary = rawDescription.search(MEET_BOILERPLATE_BOUNDARY_RE);
  const authored = (boundary >= 0 ? rawDescription.slice(0, boundary) : rawDescription).trim();
  if (!authored) return { summary: title, body: undefined };

  const firstP = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(authored);
  if (firstP?.index !== undefined) {
    const summaryText = stripHtml(firstP[1] ?? '') || title;
    const rest = (
      authored.slice(0, firstP.index) + authored.slice(firstP.index + firstP[0].length)
    ).trim();
    return { summary: summaryText, body: rest || undefined };
  }

  const [first = '', ...rest] = authored
    .split(/\r?\n\s*\r?\n|(?:<br\s*\/?>\s*){2,}/i)
    .map((p) => p.trim());
  return {
    summary: stripHtml(first) || title,
    body: rest.filter(Boolean).join('\n\n') || undefined,
  };
}

function deriveLocation(rawLocation: string, description: string): EventLocation | undefined {
  let joinUrl = rawLocation && isUrl(rawLocation) ? rawLocation : undefined;
  const venueName = rawLocation && !joinUrl ? rawLocation : undefined;
  joinUrl ??= findConferenceUrl(description);

  const venue = venueName ? parseGooglePlaceLocation(venueName) : undefined;
  if (joinUrl && venue) return { format: 'hybrid', joinUrl, venue };
  if (joinUrl) return { format: 'virtual', joinUrl };
  if (venue) return { format: 'in-person', venue };
  return undefined;
}

// Cap RRULE expansion at 1 year from evaluation time so infinite recurrences don't loop forever.
const HORIZON_MS = 365 * 24 * 60 * 60 * 1000;

function stringProp(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalEventEndDate(component: ICAL.Component, endDate: unknown): Date | undefined {
  if (!component.getFirstProperty('dtend')) return undefined;
  return endDate instanceof ICAL.Time ? icalTimeToDate(endDate) : undefined;
}

function buildEventEntry(options: BuildEventOptions): ParsedEventEntry | null {
  const { uid, event, startDate, endDate, recurrenceKey } = options;
  const title = stringProp(event.summary);
  if (!title) return null;

  const description = stringProp(event.description);
  const rawLocation = stringProp(event.location);
  const location = deriveLocation(rawLocation, description);
  const slug = `${ptDateSlug(startDate)}-${slugify(title)}`;
  const { summary, body } = parseDescription(description, title);
  const admission = findAdmissionLink(description);
  const status =
    event.component.getFirstPropertyValue('status') === 'CANCELLED'
      ? 'EventCancelled'
      : 'EventScheduled';

  const data: EventData = {
    title,
    calendarUid: uid,
    calendarOccurrenceId:
      event.isRecurring() || event.component.getFirstProperty('recurrence-id')
        ? `${uid}#${recurrenceKey}`
        : uid,
    date: startDate,
    endDate,
    location,
    rsvpUrl: findRsvpUrl(description),
    admissionUrl: admission?.url,
    admissionLabel: admission?.label,
    featured: false,
    summary,
    body,
    schema: {
      schemaType: title.toLowerCase().includes('teach-in') ? 'EducationEvent' : 'Event',
      status,
      isAccessibleForFree: true,
      about: ['Public transit', 'Transit advocacy', 'Southern Nevada'],
      audience: ['Las Vegas Valley residents', 'Transit riders'],
      keywords: ['transit', 'public transportation', 'Las Vegas', 'Southern Nevada'],
    },
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
      status,
    ].join('|'),
  };
}

function nextOccurrence(iter: ReturnType<ICAL.Event['iterator']>): ICAL.Time | null {
  return (iter as { next(): ICAL.Time | null }).next();
}

function expandMasterEvent(
  uid: string,
  masterVe: ICAL.Component,
  exceptions: readonly ICAL.Component[],
  horizonMs: number,
): ParsedEventEntry[] {
  if (!masterVe.getFirstProperty('dtstart')) return [];
  const masterEvent = new ICAL.Event(masterVe);
  for (const exVe of exceptions) masterEvent.relateException(exVe);

  const out: ParsedEventEntry[] = [];
  if (masterEvent.isRecurring()) {
    const iter = masterEvent.iterator();
    for (let nextTime = nextOccurrence(iter); nextTime; nextTime = nextOccurrence(iter)) {
      if (nextTime.toJSDate().getTime() > horizonMs) break;
      const details = masterEvent.getOccurrenceDetails(nextTime);
      const entry = buildEventEntry({
        uid,
        event: details.item,
        startDate: icalTimeToDate(details.startDate),
        endDate: optionalEventEndDate(details.item.component, details.endDate),
        recurrenceKey: nextTime.toString(),
      });
      if (entry) out.push(entry);
    }
    return out;
  }

  const single = buildEventEntry({
    uid,
    event: masterEvent,
    startDate: icalTimeToDate(masterEvent.startDate),
    endDate: optionalEventEndDate(masterVe, masterEvent.endDate),
    recurrenceKey: masterEvent.startDate.toString(),
  });
  if (single) out.push(single);
  return out;
}

function expandOrphanExceptions(uid: string, exVes: readonly ICAL.Component[]): ParsedEventEntry[] {
  const out: ParsedEventEntry[] = [];
  for (const exVe of exVes) {
    if (!exVe.getFirstProperty('dtstart')) continue;
    const event = new ICAL.Event(exVe);
    const startDate = icalTimeToDate(event.startDate);
    const recKey = (event as { recurrenceId?: ICAL.Time }).recurrenceId?.toString();
    const entry = buildEventEntry({
      uid,
      event,
      startDate,
      endDate: optionalEventEndDate(exVe, event.endDate),
      recurrenceKey: recKey ?? startDate.toISOString(),
    });
    if (entry) out.push(entry);
  }
  return out;
}

/**
 * Parse a Google Calendar ICS feed into normalized event entries, resolving
 * RRULE occurrences and RECURRENCE-ID exceptions identically at build and request time.
 */
export function parseEventsFromIcs(
  text: string,
  nowMs: number = Date.now(),
): { entries: ParsedEventEntry[]; upcomingCount: number } {
  const jcal = ICAL.parse(text) as ConstructorParameters<typeof ICAL.Component>[0];
  const vcal = new ICAL.Component(jcal);
  const vevents = vcal.getAllSubcomponents('vevent');

  const mastersByUid = new Map<string, ICAL.Component>();
  const exceptionsByUid = new Map<string, ICAL.Component[]>();
  for (const ve of vevents) {
    const uid = ve.getFirstPropertyValue('uid') as string | undefined;
    if (!uid) continue;
    if (ve.getFirstProperty('recurrence-id')) {
      const list = exceptionsByUid.get(uid) ?? [];
      list.push(ve);
      exceptionsByUid.set(uid, list);
    } else if (!mastersByUid.has(uid)) {
      mastersByUid.set(uid, ve);
    }
  }

  const horizonMs = nowMs + HORIZON_MS;
  const entries: ParsedEventEntry[] = [];
  for (const [uid, masterVe] of mastersByUid) {
    entries.push(...expandMasterEvent(uid, masterVe, exceptionsByUid.get(uid) ?? [], horizonMs));
  }
  for (const [uid, exVes] of exceptionsByUid) {
    if (!mastersByUid.has(uid)) entries.push(...expandOrphanExceptions(uid, exVes));
  }

  entries.sort((a, b) => a.data.date.getTime() - b.data.date.getTime());
  const upcoming = entries.filter(
    (e) => e.data.date.getTime() >= nowMs && e.data.schema?.status !== 'EventCancelled',
  );
  const nearestUpcoming = upcoming.at(0);
  if (nearestUpcoming) nearestUpcoming.data.featured = true;

  return { entries, upcomingCount: upcoming.length };
}
