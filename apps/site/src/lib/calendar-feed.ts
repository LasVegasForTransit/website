import type { AstroIntegrationLogger } from 'astro';

/**
 * Downloads the calendar feed. CI builds what we deploy, so an unreachable
 * feed fails there. Elsewhere (offline laptops, sandboxes without Google
 * access) it returns null so the build keeps the events already stored.
 */
export async function fetchCalendarFeed(
  url: string,
  logger: Pick<AstroIntegrationLogger, 'warn'>,
): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok)
      throw new Error(`Failed to fetch calendar ICS feed: ${res.status} ${res.statusText}`);
    return await res.text();
  } catch (error) {
    if (process.env.CI) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    logger.warn(`Skipping calendar refresh outside CI: ${reason}`);
    return null;
  }
}
