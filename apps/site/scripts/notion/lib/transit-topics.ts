/**
 * Static maps for inferring article metadata from URLs and headlines.
 * Extend these as new publications and topic patterns are encountered.
 */

/** Maps hostname → Publication select value in the Transit News database. */
export const DOMAIN_TO_PUBLICATION: Record<string, string> = {
  'lasvegassun.com': 'Las Vegas Sun',
  'reviewjournal.com': 'Las Vegas Review-Journal',
  'fox5vegas.com': 'Fox5 Vegas',
  'news3lv.com': 'News3LV',
  'nevadacurrent.com': 'Nevada Current',
  'unlvscarletandgray.com': 'UNLV Scarlet and Gray',
  'urbanland.uli.org': 'Urban Land Magazine',
  'nevbex.com': 'NVBEX',
  'masstransitmag.com': 'Mass Transit Magazine',
  'transportation.gov': 'US Dept. of Transportation',
  'rtcsnv.com': 'RTC Southern Nevada',
  'metro-magazine.com': 'Metro Magazine',
  'enr.com': 'Engineering News-Record',
  'thetransportpolitic.com': 'The Transport Politic',
  '8newsnow.com': '8 News Now',
  'ksnv.com': 'News3LV',
  'theguardian.com': 'The Guardian',
  'marylandparkway.com': 'RTC Southern Nevada',
};

/** Topic keyword patterns → Topic multi-select values. */
export const TOPIC_PATTERNS: Array<{ patterns: string[]; topic: string }> = [
  { patterns: ['bus rapid transit', 'brt', 'red line', 'maryland parkway'], topic: 'BRT' },
  { patterns: ['fare', 'fares', 'pass price', 'shortfall', 'budget'], topic: 'Fare' },
  { patterns: ['vegas loop', 'boring company', 'boring co', 'tesla tunnel'], topic: 'Vegas Loop' },
  { patterns: ['monorail'], topic: 'Monorail' },
  { patterns: ['grant', 'fund', 'invest', 'billion', 'million'], topic: 'Funding' },
  {
    patterns: ['pedestrian', 'walkab', 'sidewalk', 'crosswalk', 'cyclist', 'bike lane'],
    topic: 'Pedestrian Safety',
  },
  { patterns: ['opinion', 'op-ed', 'editorial', 'commentary'], topic: 'Opinion' },
  { patterns: ['advocacy', 'advocate', 'activist', 'rally', 'protest'], topic: 'Advocacy' },
  {
    patterns: ['policy', 'vote', 'board', 'commission', 'legislation', 'ordinance'],
    topic: 'Policy',
  },
  { patterns: ['safety', 'accident', 'crash', 'fatali', 'death'], topic: 'Safety' },
  {
    patterns: ['hydrogen', 'electric bus', 'zero emission', 'clean energy', 'fuel cell'],
    topic: 'Clean Energy',
  },
  {
    patterns: ['development', 'real estate', 'zoning', 'tod', 'transit-oriented'],
    topic: 'Development',
  },
];

/** Location keyword patterns → Location select values. */
export const LOCATION_PATTERNS: Array<{ patterns: string[]; location: string }> = [
  { patterns: ['henderson'], location: 'Henderson' },
  { patterns: ['north las vegas'], location: 'North Las Vegas' },
  { patterns: ['boulder city'], location: 'Boulder City' },
  { patterns: ['clark county'], location: 'Clark County' },
  {
    patterns: ['las vegas', 'strip', 'downtown', 'unlv', 'medical district'],
    location: 'Las Vegas',
  },
  { patterns: ['nevada', 'statewide'], location: 'Nevada' },
];

/** Infer publication name from a URL string. Returns undefined if unknown. */
export function inferPublication(url: string): string | undefined {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    for (const [domain, pub] of Object.entries(DOMAIN_TO_PUBLICATION)) {
      if (hostname === domain || hostname.endsWith(`.${domain}`)) return pub;
    }
  } catch {
    // Invalid URL — ignore
  }
  return undefined;
}

/** Infer topic tags from headline + optional body text. Returns deduplicated list. */
export function inferTopics(headline: string, body = ''): string[] {
  const haystack = `${headline} ${body.slice(0, 500)}`.toLowerCase();
  const found = new Set<string>();
  for (const { patterns, topic } of TOPIC_PATTERNS) {
    if (patterns.some((p) => haystack.includes(p))) found.add(topic);
  }
  return [...found];
}

/** Infer location from headline + optional body text. Returns first match or undefined. */
export function inferLocation(headline: string, body = ''): string | undefined {
  const haystack = `${headline} ${body.slice(0, 500)}`.toLowerCase();
  for (const { patterns, location } of LOCATION_PATTERNS) {
    if (patterns.some((p) => haystack.includes(p))) return location;
  }
  return undefined;
}
