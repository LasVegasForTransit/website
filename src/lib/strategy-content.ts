export type StrategyLink = {
  label: string;
  href: string;
  body: string;
};

export type StrategyItem = {
  title: string;
  body: string;
};

export const strategyMeta = {
  title: 'Our strategy',
  description:
    'How Las Vegans for Better Transit thinks about building the public constituency, partnerships, and policy support needed for better transit in Southern Nevada.',
  lede: "We're trying to do something that still feels borderline impossible in this city: build a real public voice for transit in a region that has been built around cars for half a century. This page is the working theory behind that effort.",
} as const;

export const strategyOpening: StrategyItem[] = [
  {
    title: 'The vision',
    body: 'A Las Vegas Valley where reliable, safe, and efficient public transportation helps people get to work, reach school, buy groceries, enjoy recreation, and build community without needing a car for every trip.',
  },
  {
    title: 'The work',
    body: 'We educate the public, organize people into a durable civic base, and make friends with enough riders, neighbors, students, workers, public servants, and institutions to make better transit politically real.',
  },
];

export const strategyContext: StrategyItem[] = [
  {
    title: 'The Valley starts from a different place',
    body: 'Southern Nevada has no passenger rail and a relatively young civic memory around transit. Many residents have never seen high-quality transit as part of ordinary life, so education has to come before pressure.',
  },
  {
    title: 'Growth is running into limits',
    body: 'The region is approaching the physical and fiscal limits of outward growth. Better transit and more traditional, connected development patterns are not aesthetic preferences; they are practical requirements.',
  },
  {
    title: 'The transit agency is not the obstacle',
    body: 'RTC has plans and professional capacity, but funding and political demand limit what it can deliver. LVBT can build the outside constituency public agencies cannot build for themselves.',
  },
  {
    title: 'The public needs a clearer picture',
    body: 'Transit is too often framed as a narrow service for someone else. We make the case that better buses, safer streets, and future rail are part of affordability, independence, economic development, and public life.',
  },
];

export const strategyFocus: StrategyItem[] = [
  {
    title: 'Make the case for better transit',
    body: 'Talk plainly about what car dependence costs people in time, money, safety, and isolation, and show what better buses, safer streets, and future rail could make possible.',
  },
  {
    title: 'Bring young people in early',
    body: "Students and young workers will live longest with today's choices. The work has to feel hopeful, useful, and worth joining, not like another civic process happening somewhere else.",
  },
  {
    title: 'Build the missing community',
    body: 'Las Vegas does not yet have a strong home for transit advocates and urbanists. We have to build that community ourselves, and keep it useful between campaigns.',
  },
  {
    title: 'Work with institutions without becoming one',
    body: 'Public agencies, schools, civic groups, businesses, labor, and elected officials all matter. LVBT can work with them while still saying the things residents need said out loud.',
  },
  {
    title: 'Stay practical about land use',
    body: 'Transit only works when the places around it work. Zoning, parking, housing, shade, street design, and station areas are part of the transit conversation.',
  },
];

export const powerMoves: StrategyItem[] = [
  {
    title: 'Make transit legible',
    body: 'Explain how the system works, what is at stake, who decides, and how ordinary residents can intervene.',
  },
  {
    title: 'Turn interest into membership',
    body: 'Build a base large enough that public officials, agencies, reporters, and partners can see organized demand for transit.',
  },
  {
    title: 'Show up consistently',
    body: 'Attend meetings, submit comments, brief partners, and stay present long enough that LVBT becomes a reliable civic actor.',
  },
  {
    title: 'Connect transit to land use',
    body: 'Advocate for zoning, parking, housing, and street-design choices that make transit useful beyond the bus stop.',
  },
  {
    title: 'Fill gaps agencies cannot fill',
    body: 'Name the vision, build public support, and create political cover for staff and elected officials who need a visible constituency behind them.',
  },
];

export const strategyValues: StrategyItem[] = [
  {
    title: 'Community and cooperation',
    body: 'We prefer durable wins built with people over performative fights that leave the region harder to organize.',
  },
  {
    title: 'Authenticity',
    body: 'The work is strongest when volunteers, partners, and members can bring real talents and convictions to the table.',
  },
  {
    title: 'Courage',
    body: "Advocating for transit in one of the country's most car-dependent regions requires taking public stands before success is guaranteed.",
  },
  {
    title: 'Empowerment',
    body: 'We help residents understand the systems around them and give them practical ways to act on that understanding.',
  },
  {
    title: 'Sustainability',
    body: 'We build processes, relationships, and public knowledge that can keep working after a single campaign, meeting, or legislative session ends.',
  },
];

export const strategyBoundaries: StrategyItem[] = [
  {
    title: 'Not a transit agency',
    body: 'We do not run buses or write service plans. We organize public demand for better service, funding, streets, and land use.',
  },
  {
    title: 'Not anti-car',
    body: 'Many supporters drive and will continue to. The point is choice: a Valley where driving is not the only practical option.',
  },
  {
    title: 'Not partisan',
    body: 'Transit, safety, housing, affordability, and economic opportunity cut across party lines in Nevada.',
  },
  {
    title: 'Not here for one session',
    body: 'The 2027 Legislature matters, but the work has to continue through future budgets, plans, elections, and public decisions.',
  },
];

export const strategyLinks: StrategyLink[] = [
  {
    label: 'About LVBT',
    href: '/about',
    body: 'Mission, tax status, and how the organization is set up.',
  },
  {
    label: 'Programs',
    href: '/programs',
    body: 'The recurring areas of work that carry the strategy forward.',
  },
  {
    label: 'Events',
    href: '/events',
    body: 'Meetings, walks, talks, and public actions where the work becomes visible.',
  },
  {
    label: 'Get involved',
    href: '/go',
    body: 'Newsletter, membership, volunteer interest, and other ways to plug in.',
  },
  {
    label: 'Letters',
    href: '/letters',
    body: 'Longer notes from leadership as the organization grows.',
  },
  {
    label: 'Contact',
    href: '/contact',
    body: 'General, press, partnership, and volunteer conversations.',
  },
];
