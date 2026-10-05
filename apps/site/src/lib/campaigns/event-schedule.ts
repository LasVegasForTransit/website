import { TIMEZONE } from '../event-time';

export interface CampaignEventTiming {
  start?: string;
  end?: string;
  proposed?: boolean;
}

const localDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function groupCampaignEvents<T extends CampaignEventTiming>(
  events: readonly T[],
  now = new Date(),
): { upcoming: T[]; proposed: T[]; past: T[] } {
  const upcoming: T[] = [];
  const proposed: T[] = [];
  const past: T[] = [];
  for (const event of events) {
    const start = event.start ? new Date(event.start) : undefined;
    if (event.proposed || !start || Number.isNaN(start.getTime())) {
      proposed.push(event);
      continue;
    }
    const ended = now.getTime() >= (campaignEventCutoff(event) ?? Infinity);
    (ended ? past : upcoming).push(event);
  }
  upcoming.sort((a, b) => Date.parse(a.start ?? '') - Date.parse(b.start ?? ''));
  past.sort((a, b) => Date.parse(b.start ?? '') - Date.parse(a.start ?? ''));
  return { upcoming, proposed, past };
}

// Calculate once during the build. Browser cards only need this timestamp.
// With no published end time, use the end of the event's Las Vegas day.
export function campaignEventCutoff(event: CampaignEventTiming): number | undefined {
  const start = Date.parse(event.start ?? '');
  if (!Number.isFinite(start)) return undefined;
  const end = Date.parse(event.end ?? '');
  if (Number.isFinite(end)) return end;
  const day = localDay.format(new Date(start));
  let low = start;
  let high = start + 48 * 60 * 60 * 1000;
  // Find the first instant in the next local day, including DST boundaries.
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (localDay.format(new Date(middle)) === day) low = middle;
    else high = middle;
  }
  return high;
}

export function campaignDateParts(start: string) {
  const date = new Date(start);
  const format = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-US', { ...options, timeZone: TIMEZONE }).format(date);
  return {
    day: format({ day: 'numeric' }),
    month: format({ month: 'short' }),
    year: format({ year: 'numeric' }),
  };
}
