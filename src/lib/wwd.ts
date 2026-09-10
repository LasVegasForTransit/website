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

// Links out to the national campaign and local tools, grouped by who they
// are for. Rendered as the /wwd "Resources" section. URLs checked against
// weekwithoutdriving.org on 2026-09-10.
export type ResourceAudience = 'participants' | 'organizations';

export const wwdResources: Array<{
  audience: ResourceAudience;
  title: string;
  blurb: string;
  url: string;
  linkLabel: string;
}> = [
  {
    audience: 'participants',
    title: 'What Week Without Driving is',
    blurb:
      'The national campaign in its own words: who it is for and what a week without driving is meant to show.',
    url: 'https://weekwithoutdriving.org/about/',
    linkLabel: 'weekwithoutdriving.org/about',
  },
  {
    audience: 'participants',
    title: 'How to participate',
    blurb: 'The campaign’s guide to the week, with reflection questions to answer as you go.',
    url: 'https://weekwithoutdriving.org/participate/',
    linkLabel: 'weekwithoutdriving.org/participate',
  },
  {
    audience: 'participants',
    title: 'Join the national list',
    blurb: 'Sign up with the national campaign for its tools and templates.',
    url: 'https://weekwithoutdriving.org/join/',
    linkLabel: 'weekwithoutdriving.org/join',
  },
  {
    audience: 'participants',
    title: 'Follow the national campaign',
    blurb: 'Week Without Driving on Instagram. Tag them alongside us.',
    url: 'https://www.instagram.com/weekwithoutdriving/',
    linkLabel: '@weekwithoutdriving',
  },
  {
    audience: 'participants',
    title: 'Plan a bus trip',
    blurb: 'The RTC trip planner for routes, times, and the bus after the one you want.',
    url: 'https://www.rtcsnv.com/ways-to-travel/trip-planner/',
    linkLabel: 'RTC trip planner',
  },
  {
    audience: 'organizations',
    title: 'Tools to organize',
    blurb: 'Recorded webinars and monthly office hours for people running the week locally.',
    url: 'https://weekwithoutdriving.org/organize/',
    linkLabel: 'weekwithoutdriving.org/organize',
  },
  {
    audience: 'organizations',
    title: 'Resource Center',
    blurb: 'Toolkits, templates, and how-to guides from the national campaign, free to use.',
    url: 'https://weekwithoutdriving.org/resource/',
    linkLabel: 'weekwithoutdriving.org/resource',
  },
  {
    audience: 'organizations',
    title: '2026 media advisory',
    blurb: 'The national announcement for this year’s week, for press and partner communications.',
    url: 'https://weekwithoutdriving.org/2026/week-without-driving-2026/',
    linkLabel: 'Read the advisory',
  },
  {
    audience: 'organizations',
    title: 'Nondrivers Alliance',
    blurb: 'The coalition behind the week, organizing people who cannot or do not drive.',
    url: 'https://nondrivers.org/',
    linkLabel: 'nondrivers.org',
  },
];

export const WWD_DATE_RANGE = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
  timeZone: 'America/Los_Angeles',
}).formatRange(wwd.start, wwd.end);
