import type { CollectionEntry } from 'astro:content';
import { TIMEZONE, formatEventTime } from './event-time';
import { site } from './site';
import { truncate } from './truncate';

type EventEntry = CollectionEntry<'events'>;

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  timeZone: TIMEZONE,
});

const metaTitleDateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: TIMEZONE,
});

function eventDateLabel(event: EventEntry): string {
  return dateFormatter.format(event.data.date);
}

function eventMetaDateLabel(event: EventEntry): string {
  return metaTitleDateFormatter.format(event.data.date);
}

export function eventMetaTitle(event: EventEntry): string {
  const date = eventMetaDateLabel(event);
  const titleBudget = 34 - date.length - 2;
  const title = truncate(event.data.title, titleBudget, {
    ellipsis: '...',
    reserveEllipsisWidth: true,
    normalizeWhitespace: true,
  });
  return `${date}: ${title}`;
}

export function eventMetaDescription(event: EventEntry): string {
  const summary = event.data.summary.trim();
  if (summary.length >= 70) return summary;

  const when = `${eventDateLabel(event)} at ${formatEventTime(event.data.date)}`;
  const context = `Join ${site.shortName} on ${when} for ${event.data.title}.`;
  return summary ? `${context} ${summary}` : context;
}
