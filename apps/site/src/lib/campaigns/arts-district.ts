export interface ArtsDistrictEvent {
  slug: string;
  title: string;
  month: string;
  year: string;
  summary: string;
  details: string[];
  proposed?: boolean;
  start?: string;
  end?: string;
  dateLabel?: string;
  venue?: string;
  venueUrl?: string;
  // Add the associated standard event page once it is available.
  lvbtEventUrl?: `/events/${string}` | `https://lasvegasfortransit.org/events/${string}`;
}

export const artsDistrictEvents: readonly [ArtsDistrictEvent, ...ArtsDistrictEvent[]] = [
  {
    slug: 'community-listening-session',
    title: 'Community listening session',
    month: 'October',
    year: '2026',
    start: '2026-10-17T13:00:00-07:00',
    end: '2026-10-17T15:00:00-07:00',
    dateLabel: 'Saturday, October 17, 2026 · 1–3 p.m.',
    venue: 'Barter Beer + Mall',
    venueUrl: 'https://maps.app.goo.gl/N2YVJTrV4GtqTSn36',
    summary:
      'Share what’s difficult about living, working, or spending time in the Arts District. We’ll listen to your experiences and work out which problems the campaign should address first.',
    details: [
      'Bring your experiences, questions, and ideas. Tell us about the bus trip that takes too long, the crossing you avoid, or the cost of parking—and how homes, shops, and public spaces meet your everyday needs.',
      'This first gathering is about understanding the problems before deciding on solutions. Whether you live here, work here, make art here, run a business, or represent a community organization, your experience can help us set the campaign’s priorities.',
    ],
  },
  {
    slug: 'routes-and-connections',
    proposed: true,
    title: 'Routes and connections',
    month: 'November',
    year: '2026',
    summary: 'Tell us which trips are difficult and what would make them easier.',
    details: [
      'Bring a trip you’d like to make more easily: getting to work, running an errand, going to school, or meeting someone in the neighborhood. We’ll look at the bus routes, walks, and connections involved.',
      'We’ll discuss which destinations are hard to reach and what would make getting to, from, and around the Arts District easier.',
    ],
  },
  {
    slug: 'neighborhood-priorities',
    proposed: true,
    title: 'Neighborhood priorities',
    month: 'December',
    year: '2026',
    summary:
      'Compare possible improvements to transit, streets, and land use, and help decide what matters most.',
    details: [
      'We’ll bring the problems raised at earlier gatherings into a discussion about possible improvements. Help compare the options and explain which would make the biggest difference in your day-to-day life.',
      'That includes transit and streets, as well as how homes, businesses, and public spaces fit together. Your feedback will help decide what belongs in the neighborhood plan.',
    ],
  },
  {
    slug: 'review-the-plan',
    proposed: true,
    title: 'Review the plan',
    month: 'January',
    year: '2027',
    summary:
      'Look over the draft neighborhood plan and tell us what works, what’s missing, and what should change.',
    details: [
      'Read through the draft plan with us and see how it responds to the problems people raised. Point out what needs more work or what we’ve missed.',
      'We’ll use your feedback to refine the recommendations before sharing them with transportation and development decision-makers.',
    ],
  },
];

export function artsDistrictEventPath(event: Pick<ArtsDistrictEvent, 'slug'>): string {
  return `/campaigns/arts-district/events/${event.slug}/`;
}

export interface ArtsDistrictDocument {
  title: string;
  summary: string;
  url: string;
}

// Add links as gathering summaries, proposals, and the neighborhood plan are published.
export const artsDistrictDocuments: readonly ArtsDistrictDocument[] = [];
