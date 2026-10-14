/** Keep independent scheduled work moving, and report failures without provider details. */
export async function scheduledStep<T extends object>(
  event: string,
  run: () => Promise<T>,
): Promise<T | null> {
  try {
    const result = await run();
    console.log(JSON.stringify({ event, ...result }));
    return result;
  } catch {
    console.log(JSON.stringify({ event, failed: true }));
    return null;
  }
}
