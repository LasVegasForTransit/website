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
    const end = event.end ? new Date(event.end) : undefined;
    // An unknown end time does not imply a duration. Keep the gathering
    // upcoming through its local day instead of archiving it at its start.
    const ended =
      end && !Number.isNaN(end.getTime())
        ? now >= end
        : localDay.format(now) > localDay.format(start);
    (ended ? past : upcoming).push(event);
  }
  upcoming.sort((a, b) => Date.parse(a.start ?? '') - Date.parse(b.start ?? ''));
  past.sort((a, b) => Date.parse(b.start ?? '') - Date.parse(a.start ?? ''));
  return { upcoming, proposed, past };
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
