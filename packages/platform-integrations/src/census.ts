// Turn a one-line address into a 2020 census block, once, without keeping
// the address. The address exists only in this function's memory: it is
// never stored, logged or reported. If anything fails, the log says
// "address" instead of the address itself.
//
// Confirmed request (US Census Geocoder, geographies by one-line address):
//   GET https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress
//     ?address=<one line>&benchmark=Public_AR_Current&vintage=Census2020_Current
//     &layers=Census Blocks,Incorporated Places,Census Designated Places&format=json
// The response's addressMatches[0].geographies["Census Blocks"][0].GEOID is the
// 15-digit block; "Incorporated Places" and "Census Designated Places" name
// the city or unincorporated place.

export type GeocodeResult =
  | { kind: 'match'; censusBlock: string; vintage: '2020'; zip: string | null; places: string[] }
  | { kind: 'no_match' }
  | { kind: 'unavailable' };

const ENDPOINT = 'https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress';
const TIMEOUT_MS = 5000;

interface Geography {
  GEOID?: string;
  NAME?: string;
}

export interface CensusResponse {
  result?: {
    addressMatches?: {
      addressComponents?: { zip?: string };
      geographies?: Record<string, Geography[] | undefined>;
    }[];
  };
}

function geocodeUrl(address: string): URL {
  const url = new URL(ENDPOINT);
  url.searchParams.set('address', address);
  url.searchParams.set('benchmark', 'Public_AR_Current');
  url.searchParams.set('vintage', 'Census2020_Current');
  url.searchParams.set('layers', 'Census Blocks,Incorporated Places,Census Designated Places');
  url.searchParams.set('format', 'json');
  return url;
}

/** Read the Geocoder's answer. Exported for tests. */
export function parseGeocodeResponse(body: CensusResponse): GeocodeResult {
  const match = body.result?.addressMatches?.[0];
  const geographies = match?.geographies ?? {};
  const block = geographies['Census Blocks']?.[0]?.GEOID;
  if (!block || !/^\d{15}$/.test(block)) return { kind: 'no_match' };
  const places = [
    ...(geographies['Incorporated Places'] ?? []),
    ...(geographies['Census Designated Places'] ?? []),
  ].flatMap((place) => (place.NAME ? [place.NAME] : []));
  const zip = match?.addressComponents?.zip ?? '';
  return {
    kind: 'match',
    censusBlock: block,
    vintage: '2020',
    zip: /^\d{5}$/.test(zip) ? zip : null,
    places,
  };
}

export async function geocodeToBlock(
  address: string,
  fetcher: typeof fetch = fetch,
): Promise<GeocodeResult> {
  try {
    const response = await fetcher(geocodeUrl(address), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error(`Census Geocoder returned ${response.status} for an address`);
      return { kind: 'unavailable' };
    }
    return parseGeocodeResponse(await response.json());
  } catch {
    console.error('Census Geocoder request failed for an address');
    return { kind: 'unavailable' };
  }
}
