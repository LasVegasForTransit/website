import {
  D1QuotaExceeded,
  isD1QuotaExceeded,
} from '@lasvegasfortransit/platform-storage/query-budget';

/** Keep independent scheduled work moving, and report failures without provider details. */
export async function scheduledStep<T extends object>(
  event: string,
  run: () => Promise<T>,
): Promise<T | null> {
  try {
    const result = await run();
    console.log(JSON.stringify({ event, ...result }));
    return result;
  } catch (error) {
    const quota = isD1QuotaExceeded(error);
    console.log(JSON.stringify({ event, failed: true, ...(quota ? { failure: 'd1_quota' } : {}) }));
    if (quota) throw new D1QuotaExceeded();
    return null;
  }
}
