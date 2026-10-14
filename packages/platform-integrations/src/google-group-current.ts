import { GoogleGroupsFailure, type GoogleGroupListInput } from './google-groups-types';

export async function checkGoogleGroupCurrent(
  input: Pick<GoogleGroupListInput, 'isCurrent'>,
  deadline: number,
  now: () => number,
): Promise<void> {
  const remaining = deadline - now();
  if (!Number.isFinite(remaining) || remaining <= 0)
    throw new GoogleGroupsFailure('provider_unavailable');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const current: unknown = await Promise.race([
      input.isCurrent(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new GoogleGroupsFailure('provider_unavailable')),
          remaining,
        );
      }),
    ]);
    if (current !== true) throw new GoogleGroupsFailure('stale_operation');
    if (now() >= deadline) throw new GoogleGroupsFailure('provider_unavailable');
  } finally {
    clearTimeout(timer);
  }
}
