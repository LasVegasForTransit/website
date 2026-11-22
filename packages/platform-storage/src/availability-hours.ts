// When a member is usually free: one-hour slots like `mon-18` (Monday, 6 PM to 7 PM).
/** Days of the week, Monday first, as stored in hour slots like `mon-18`. */
export const AVAILABLE_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type AvailableDay = (typeof AVAILABLE_DAYS)[number];
/** Hours a one-hour slot can start: 7 AM through 9 PM, so the last slot ends at 10 PM. */
export const AVAILABLE_HOURS: readonly number[] = Array.from({ length: 15 }, (_, i) => 7 + i);
/** "mon-18" means free Monday from 6 PM to 7 PM. */
export function hourSlot(day: AvailableDay, hour: number): string {
  return `${day}-${hour}`;
}
/** Every slot, in week order. */
export const AVAILABLE_SLOTS: readonly string[] = AVAILABLE_DAYS.flatMap((day) =>
  AVAILABLE_HOURS.map((hour) => hourSlot(day, hour)),
);
export function isHourSlot(value: string): boolean {
  return AVAILABLE_SLOTS.includes(value);
}
const HOUR = new Intl.DateTimeFormat('en-US', { hour: 'numeric', timeZone: 'UTC' });
/** 18 → "6 PM", 22 → "10 PM". */
export function hourLabel(hour: number): string {
  return HOUR.format(Date.UTC(2000, 0, 1, hour));
}
export interface AvailableRange {
  day: AvailableDay;
  /** Hour the range starts, 7 to 21. */
  start: number;
  /** Hour the range ends, exclusive, 8 to 22. */
  end: number;
}
/** Joins neighbouring hour slots into ranges, in week order. */
export function availableRanges(slots: readonly string[]): AvailableRange[] {
  const chosen = new Set(slots);
  const ranges: AvailableRange[] = [];
  for (const day of AVAILABLE_DAYS) {
    let open: AvailableRange | null = null;
    for (const hour of AVAILABLE_HOURS) {
      if (!chosen.has(hourSlot(day, hour))) {
        open = null;
      } else if (open) {
        open.end = hour + 1;
      } else {
        open = { day, start: hour, end: hour + 1 };
        ranges.push(open);
      }
    }
  }
  return ranges;
}
