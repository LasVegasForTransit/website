// Temporal helpers for the event surfaces — relative-date labels, "live
// now" detection, and the "today" boundary check. Centralised here so
// EventCard, the detail page, the /go carousel, and any future surface
// share the same definitions of "soon" and "in progress".
//
// All comparisons run in America/Los_Angeles. The Valley is in PT, the
// audience is local, and a visitor opening the page from another zone
// still expects "Today" to mean the event's local day — not theirs.
import type { CollectionEntry } from 'astro:content';

type EventData = CollectionEntry<'events'>['data'];

const TIMEZONE = 'America/Los_Angeles';
const DAY_MS = 24 * 60 * 60 * 1000;
// Fallback duration when an event omits endDate. Matches the implicit
// "about an hour" of the general-meeting template; revisit if the
// content model grows multi-hour events without explicit endDates.
const ASSUMED_DURATION_MS = 60 * 60 * 1000;

// YYYY-MM-DD in PT for a given Date. Used to compare two moments as
// "same day" without DST off-by-one surprises — Intl.DateTimeFormat
// resolves the timezone for us.
function ymdInZone(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function isToday(date: Date, now: Date = new Date()): boolean {
  return ymdInZone(date) === ymdInZone(now);
}

// True if the event has started and hasn't ended. Uses endDate when
// present; falls back to a one-hour window when absent so a meeting
// without an explicit endDate still surfaces "Live now" while in
// progress instead of jumping straight to "ended".
export function isHappeningNow(event: EventData, now: Date = new Date()): boolean {
  if (event.date > now) return false;
  const end = event.endDate ?? new Date(event.date.getTime() + ASSUMED_DURATION_MS);
  return end >= now;
}

// Discriminated union so consumers can branch on the kind for styling
// (badges for live/today, inline copy for the softer cases) without
// re-deriving from the text.
export type RelativeLabel =
  | { kind: 'live'; text: 'Live now' }
  | { kind: 'today'; text: 'Today' }
  | { kind: 'tomorrow'; text: 'Tomorrow' }
  | { kind: 'days'; text: string } // "In N days", 2 ≤ N ≤ 7
  | { kind: 'week'; text: 'Next week' } // 8–14 days out
  | null;

export function relativeLabel(event: EventData, now: Date = new Date()): RelativeLabel {
  if (isHappeningNow(event, now)) return { kind: 'live', text: 'Live now' };
  if (event.date < now) return null; // past events: absolute date suffices

  if (isToday(event.date, now)) return { kind: 'today', text: 'Today' };

  // Round to nearest day after normalising both moments to their PT
  // midnight — guards against the off-by-one when "tomorrow" in PT is
  // less than 24h away from "now" measured in wall clock.
  const eventDay = new Date(`${ymdInZone(event.date)}T00:00:00Z`);
  const todayDay = new Date(`${ymdInZone(now)}T00:00:00Z`);
  const diffDays = Math.round((eventDay.getTime() - todayDay.getTime()) / DAY_MS);

  if (diffDays === 1) return { kind: 'tomorrow', text: 'Tomorrow' };
  if (diffDays > 1 && diffDays <= 7) return { kind: 'days', text: `In ${diffDays} days` };
  if (diffDays > 7 && diffDays <= 14) return { kind: 'week', text: 'Next week' };
  return null;
}
