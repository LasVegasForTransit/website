import type { EventLocation } from './event-format';
import { formatEventTime, isHappeningNow, TIMEZONE } from './event-time';
import { canonicalUrl, displayUrl, paths } from './paths';

export interface ProgramEvent {
  id: string;
  data: {
    calendarUid: string;
    discussionTopic?: string | undefined;
    date: Date;
    endDate?: Date | undefined;
    location?: EventLocation | undefined;
    schema?: { status?: string | undefined } | undefined;
  };
}

export interface ProgramParticipation {
  participationUrl?: string | undefined;
  participationLabel?: string | undefined;
  calendarSeriesUid?: string | undefined;
  eventNoun?: string | undefined;
  cadence?: string | undefined;
  venue?:
    { name: string; address: string; mapUrl: string; status: 'proposed' | 'confirmed' } | undefined;
}

export function programParticipationAction(
  program: ProgramParticipation,
  event: ProgramEvent | undefined,
  now: Date = new Date(),
) {
  if (program.participationUrl) {
    return {
      href: program.participationUrl,
      label: program.participationLabel ?? `Visit ${new URL(program.participationUrl).hostname}`,
      external: true,
    };
  }
  if (!event) {
    return program.calendarSeriesUid
      ? { href: paths.events, label: 'Events calendar', external: false }
      : undefined;
  }

  const ongoing = isHappeningNow(event.data, now);
  const upcoming = event.data.date > now;
  return {
    href: `/events/${event.id}/`,
    label: ongoing || upcoming ? 'RSVP' : `View last ${program.eventNoun ?? 'event'}`,
    external: false,
  };
}

interface PanelVenue {
  name: string;
  address?: string | undefined;
  mapUrl?: string | undefined;
  tentative?: boolean;
}

function occurrenceVenue(location?: EventLocation): PanelVenue {
  if (!location) return { name: 'Location to be announced' };
  if (location.format === 'virtual') return { name: 'Online', mapUrl: location.joinUrl };
  const { venue } = location;
  const address = [
    venue.streetAddress,
    venue.addressLocality,
    [venue.addressRegion, venue.postalCode].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .join(', ');
  return {
    name: location.format === 'hybrid' ? `${venue.name} · also online` : venue.name,
    address,
    mapUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${venue.name}, ${address}`)}`,
  };
}

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  timeZone: TIMEZONE,
});

// The server and browser use the same presentation so all details roll together.
export function programEventPanel(
  program: ProgramParticipation,
  event: ProgramEvent | undefined,
  now: Date = new Date(),
) {
  const noun = program.eventNoun ?? 'event';
  const heading = !event
    ? program.cadence
      ? 'Schedule'
      : 'Events'
    : isHappeningNow(event.data, now)
      ? 'Happening now'
      : event.data.date > now
        ? `Next ${noun}`
        : `Last ${noun}`;
  return {
    heading,
    eventHref: event ? `/events/${event.id}/` : undefined,
    dateIso: event?.data.date.toISOString(),
    dateLabel: event ? dateFormatter.format(event.data.date) : undefined,
    timeLabel: event ? formatEventTime(event.data.date) : undefined,
    schedule: program.cadence ?? 'No event scheduled',
    venue: event
      ? occurrenceVenue(event.data.location)
      : program.venue
        ? { ...program.venue, tentative: program.venue.status === 'proposed' }
        : undefined,
    action: programParticipationAction(program, event, now),
  };
}

const featureDateFormatter = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  timeZone: TIMEZONE,
});
const featureTimeFormatter = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZone: TIMEZONE,
});

/** Occurrence copy never carries forward into the following month's feature. */
export function programEventFeature(
  program: ProgramParticipation,
  event: ProgramEvent | undefined,
  now: Date = new Date(),
) {
  const panel = programEventPanel(program, event, now);
  const dateLabel = event ? featureDateFormatter.format(event.data.date) : undefined;
  return {
    ...panel,
    headline: event?.data.discussionTopic ?? dateLabel ?? panel.schedule,
    printUrl: panel.action ? displayUrl(canonicalUrl(panel.action.href)) : undefined,
    dateLabel: event?.data.discussionTopic ? dateLabel : undefined,
    timeLabel: event
      ? featureTimeFormatter.format(event.data.date).replace('AM', 'a.m.').replace('PM', 'p.m.')
      : undefined,
  };
}

/** Both event layouts embed the same limited series data for their browser refresh. */
export function programEventPayload(
  program: ProgramParticipation,
  events: readonly ProgramEvent[],
): string {
  return JSON.stringify({
    program: {
      calendarSeriesUid: program.calendarSeriesUid,
      eventNoun: program.eventNoun,
      cadence: program.cadence,
      venue: program.venue,
      participationUrl: program.participationUrl,
      participationLabel: program.participationLabel,
    },
    events: events
      .filter(({ data }) => data.calendarUid === program.calendarSeriesUid)
      .map(({ id, data }) => ({
        id,
        data: {
          calendarUid: data.calendarUid,
          discussionTopic: data.discussionTopic,
          date: data.date.toISOString(),
          endDate: data.endDate?.toISOString(),
          location: data.location,
          schema: { status: data.schema?.status },
        },
      })),
  }).replace(/</g, '\\u003c');
}

export function selectProgramEvent<T extends ProgramEvent>(
  events: readonly T[],
  calendarSeriesUid: string | undefined,
  now: Date = new Date(),
): T | undefined {
  if (!calendarSeriesUid) return undefined;

  const occurrences = events
    .filter(
      (event) =>
        event.data.calendarUid === calendarSeriesUid &&
        event.data.schema?.status !== 'EventCancelled',
    )
    .sort((a, b) => a.data.date.getTime() - b.data.date.getTime());

  return (
    occurrences.find((event) => isHappeningNow(event.data, now)) ??
    occurrences.find((event) => event.data.date > now) ??
    occurrences.at(-1)
  );
}
