import { type MetadataClient, object } from './preflight-api';
import { check, type Check } from './preflight-config';
export async function inspectJobsExposure(
  client: MetadataClient,
  worker: string,
): Promise<Check[]> {
  const subdomain = object(
    await client.get(`/workers/scripts/${encodeURIComponent(worker)}/subdomain`),
  );
  const domains = await client.list('/workers/domains');
  const zones = await client.zones();
  let routed = false;
  for (const zone of zones) {
    if (typeof zone.id !== 'string') throw new Error('Invalid zone');
    if ((await client.zoneRoutes(zone.id)).some((route) => route.script === worker)) routed = true;
  }
  return [
    check(
      'jobs.exposure',
      subdomain.enabled === false &&
        subdomain.previews_enabled === false &&
        !domains.some((domain) => domain.service === worker) &&
        !routed,
      'Jobs must have no workers.dev URL, preview URL, custom domain or route in inventoried zones; complete account-zone coverage requires maintainer verification.',
    ),
  ];
}
