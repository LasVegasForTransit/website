// Week Without Driving campaign data. One place for the dates, hashtag,
// giveaway rules, and partner roster that /wwd renders, so the yearly
// update is a few values here rather than a copy-edit of the page. Dates
// come from weekwithoutdriving.org and change every year.
export const wwd = {
  year: 2026,
  // Local (Pacific) start and end of the national week.
  start: new Date('2026-10-01T00:00:00-07:00'),
  end: new Date('2026-10-08T23:59:59-07:00'),
  // ISO dates for structured data (no time component).
  startDate: '2026-10-01',
  endDate: '2026-10-08',
  nationalUrl: 'https://weekwithoutdriving.org/',
  nationalOrganizer: 'America Walks',
  rtcTripPlannerUrl: 'https://www.rtcsnv.com/ways-to-travel/trip-planner/',
  hashtag: '#WeekWithoutDriving',
  maxEntries: 8,
  // Organizations that have committed to take part. Rendered as a roster
  // once non-empty; hidden until then so the page never shows an empty box.
  partners: [] as Array<{ name: string; url?: string }>,
} as const;

export const WWD_DATE_RANGE = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
  timeZone: 'America/Los_Angeles',
}).formatRange(wwd.start, wwd.end);
