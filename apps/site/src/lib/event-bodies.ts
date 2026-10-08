interface EventBody {
  id: string;
  data: { calendarOccurrenceId?: string | undefined };
}

/** Prefer immutable calendar identity; filename matching is for legacy fragments. */
export function selectEventBody<T extends EventBody>(
  bodies: readonly T[],
  event: { id: string; data: { calendarOccurrenceId: string } },
): T | undefined {
  return (
    bodies.find((body) => body.data.calendarOccurrenceId === event.data.calendarOccurrenceId) ??
    bodies.find((body) => !body.data.calendarOccurrenceId && body.id === event.id)
  );
}
