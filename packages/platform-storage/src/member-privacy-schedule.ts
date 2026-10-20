const zone = 'America/Los_Angeles';
const clock = new Intl.DateTimeFormat('en-US', {
  timeZone: zone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
});
function parts(date: Date) {
  return Object.fromEntries(clock.formatToParts(date).map(({ type, value }) => [type, value]));
}
function pacificThree(year: number, month: number, day: number): Date {
  // Noon UTC is on the requested Pacific day in both DST offsets. Read that
  // day's offset explicitly instead of inheriting the machine's timezone.
  const probe = new Date(Date.UTC(year, month - 1, day, 12));
  const local = parts(probe);
  const offset = Number(local.hour) - 12;
  return new Date(Date.UTC(year, month - 1, day, 3 - offset));
}
/** Start at 03:00 Pacific; unfinished bounded batches may resume all day. */
export function memberPrivacySchedule(now: Date): { day: string; cutoff: string } | null {
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid privacy maintenance time');
  const local = parts(now);
  if (Number(local.hour) < 3) return null;
  const year = Number(local.year),
    month = Number(local.month),
    day = Number(local.day);
  const target = new Date(Date.UTC(year, month - 19, 1));
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return {
    day: `${local.year}-${local.month}-${local.day}`,
    cutoff: pacificThree(
      target.getUTCFullYear(),
      target.getUTCMonth() + 1,
      Math.min(day, last),
    ).toISOString(),
  };
}

/** Find the next daily window without assuming a fixed UTC offset. */
export function nextMemberPrivacyTime(now: Date): Date {
  const local = parts(now);
  const today = pacificThree(Number(local.year), Number(local.month), Number(local.day));
  if (today.getTime() > now.getTime()) return today;
  const tomorrow = new Date(
    Date.UTC(Number(local.year), Number(local.month) - 1, Number(local.day) + 1, 12),
  );
  return pacificThree(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate());
}
