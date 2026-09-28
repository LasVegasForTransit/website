export type StrategyPriority = {
  id: string;
  number: string;
  shortTitle: string;
  title: string;
  thesis: string;
  body: string;
  links: {
    href: string;
    label: string;
  }[];
};

export const strategyMeta = {
  title: 'Our strategy',
  description: 'What Las Vegans for Better Transit wants and how we get there.',
  lede: "LVBT's first five years will focus on creating a community of transit advocates and urbanists and taking action to meaningfully improve daily life in the Las Vegas Metropolitan Area.",
} as const;

export const strategyIntro = [
  'Our mission is to advocate for world-class public transportation and supportive land use policies in the Las Vegas metropolitan area through public education, community outreach, and coalition building.',
  'For our first year of operation, we will focus on becoming a reliable community partner and a force worthy of community attention.',
] as const;

export const strategyNorthStar = {
  title: 'World-class transit in Las Vegas',
  body: 'A Las Vegas Valley where residents have access to reliable, safe, and efficient public transportation that helps people get to work, enjoy recreation, and build community.',
  note: 'Light rail is the north star. The work starts now with better buses, better streets, better land use, and enough public demand to make larger investment possible.',
} as const;

export const strategicPriorities: StrategyPriority[] = [
  {
    id: 'regional-transit',
    number: '1',
    shortTitle: 'Transit infrastructure',
    title: 'Meaningfully change regional transit infrastructure',
    thesis: 'Win better service now while building public demand for major investment.',
    body: 'The primary purpose of LVBT is to secure world-class public transportation in the Las Vegas Valley. That means pushing for long-term investment while also advocating for small-scale policy, funding, street, and service changes that improve daily life for people who use transit and people who could use transit.',
    links: [
      { href: '/programs', label: 'Programs' },
      { href: '/roadmap', label: 'Roadmap' },
    ],
  },
  {
    id: 'young-people',
    number: '2',
    shortTitle: 'Young people',
    title: 'Engage with young people',
    thesis: 'Treat students and young workers as the future constituency for transit.',
    body: 'Building public transportation requires long-term thinking and investment in future generations. Students and young workers have the most to gain from world-class transportation, so LVBT has to make better transit feel hopeful, useful, and worth joining.',
    links: [
      { href: '/join', label: 'Join LVBT' },
      { href: '/events', label: 'Events' },
    ],
  },
  {
    id: 'urbanist-community',
    number: '3',
    shortTitle: 'Urbanist community',
    title: 'Build a community of urbanists',
    thesis: 'Create the home for people in Las Vegas who already know the Valley can work better.',
    body: 'Las Vegas does not yet have a strong home for transit advocates and urbanists. Without people, the organization is limited in what it can do, so LVBT has to build the community that can influence the entire Valley.',
    links: [
      { href: '/go', label: 'Get involved' },
      { href: '/newsletter', label: 'Newsletter' },
    ],
  },
  {
    id: 'public-engagement',
    number: '4',
    shortTitle: 'Public engagement',
    title: 'Engage the public',
    thesis:
      'Help people connect better transit to the places and daily routines they already care about.',
    body: 'Most people may not define urbanism, but they know what a good place feels like. LVBT has to help residents reimagine the relationship they have with the city and the way they get around it.',
    links: [
      { href: '/brand', label: 'Brand guide' },
      { href: '/contact', label: 'Contact' },
    ],
  },
  {
    id: 'institutional-relationships',
    number: '5',
    shortTitle: 'Institutional relationships',
    title: 'Maintain relationships with supportive institutional actors',
    thesis:
      'Work with the people and institutions that can help deliver a more connected Las Vegas.',
    body: 'Legislators, public servants, agencies, schools, community organizations, businesses, and labor can all help deliver a more connected Las Vegas. LVBT has to work with institutions while keeping the mission grounded in residents.',
    links: [
      { href: '/contact', label: 'Partner with us' },
      { href: '/about', label: 'About LVBT' },
    ],
  },
];
