// LVBT's regions: well-defined parts of the valley that members organize in.
// Each region is a group of official places, never a line drawn by hand.
// The definitive list is in the Civic Mobilization task "Work out each
// member's official place and LVBT region".

export const REGIONS = [
  { id: 'downtown', name: 'Downtown' },
  { id: 'east_las_vegas', name: 'East Las Vegas' },
  { id: 'north_las_vegas', name: 'North Las Vegas' },
  { id: 'northwest', name: 'Northwest' },
  { id: 'summerlin', name: 'Summerlin' },
  { id: 'central_west_las_vegas', name: 'Central / West Las Vegas' },
  { id: 'paradise_strip', name: 'Paradise & the Strip' },
  { id: 'southwest', name: 'Southwest' },
  { id: 'henderson_boulder_city', name: 'Henderson & Boulder City' },
  { id: 'outside_valley', name: 'Outside the valley' },
] as const;

export type RegionId = (typeof REGIONS)[number]['id'];

/** How a person's region was set, highest priority first. */
export type RegionSource = 'staff' | 'address' | 'member_choice' | 'zip';

const SOURCE_RANK: Record<RegionSource, number> = {
  staff: 4,
  address: 3,
  member_choice: 2,
  zip: 1,
};

export function isRegionId(value: string): value is RegionId {
  return REGIONS.some((region) => region.id === value);
}

export function regionName(id: string | null | undefined): string | null {
  return REGIONS.find((region) => region.id === id)?.name ?? null;
}

/**
 * Whether a region from `incoming` may replace one from `current`. A staff
 * correction wins until the person changes their own area, so a member's own
 * choice or address replaces a staff value, but a ZIP guess never does.
 */
export function mayReplaceRegion(current: RegionSource | null, incoming: RegionSource): boolean {
  if (current === null) return true;
  if (current === 'staff') return incoming === 'address' || incoming === 'member_choice';
  return SOURCE_RANK[incoming] >= SOURCE_RANK[current];
}

// Census places and the region each belongs to. City of Las Vegas addresses
// are absent on purpose: the city spans several regions, and which one
// depends on its 2050 Master Plan planning area, which the Census Geocoder
// does not return. Those members pick their region instead.
const PLACE_REGIONS: Partial<Record<string, RegionId>> = {
  'North Las Vegas city': 'north_las_vegas',
  'Henderson city': 'henderson_boulder_city',
  'Boulder City city': 'henderson_boulder_city',
  'Paradise CDP': 'paradise_strip',
  'Winchester CDP': 'paradise_strip',
  'Spring Valley CDP': 'southwest',
  'Enterprise CDP': 'southwest',
  'Sunrise Manor CDP': 'east_las_vegas',
  'Whitney CDP': 'east_las_vegas',
  'Summerlin South CDP': 'summerlin',
};

const LAS_VEGAS_CITY = 'Las Vegas city';
const CLARK_COUNTY_PREFIX = '32003';

/**
 * The region for a geocoded location, or null when it can't be told from the
 * place alone. `places` are Census place names such as "Paradise CDP".
 * A Clark County block in no mapped place, and not in Las Vegas, is outside
 * the valley.
 */
export function regionForPlaces(censusBlock: string, places: readonly string[]): RegionId | null {
  for (const place of places) {
    const region = PLACE_REGIONS[place];
    if (region) return region;
  }
  if (places.includes(LAS_VEGAS_CITY)) return null;
  if (censusBlock.startsWith(CLARK_COUNTY_PREFIX)) return 'outside_valley';
  return null;
}
