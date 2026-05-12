// Single source of truth for how an event's `format` is presented in UI.
// EventCard, the detail page, the /go carousel, and any future surface
// (newsletter digest, social-share preview, .ics generator) all import from
// here so adding a new format value or renaming an icon happens once.
//
// Icon names are Iconify identifiers — rendered via `<Icon name={…} />` from
// `astro-icon/components`, backed by the `@iconify-json/mdi` set. No emoji in
// rendered UI; emoji render differently across platforms and don't honor the
// design system's color tokens.
import type { CollectionEntry } from 'astro:content';

export type EventFormat = CollectionEntry<'events'>['data']['format'];
type EventData = CollectionEntry<'events'>['data'];

export const FORMAT_LABEL: Record<EventFormat, string> = {
  virtual: 'Virtual',
  'in-person': 'In person',
  hybrid: 'In person + online',
};

export const FORMAT_ICON_NAME: Record<EventFormat, string> = {
  virtual: 'mdi:video-outline',
  'in-person': 'mdi:map-marker-outline',
  hybrid: 'mdi:account-group-outline',
};

// Composes the "Where" line: bare "Online" for virtual events, the venue
// name for in-person, and both joined for hybrid. While a venue is still
// being secured, the placeholder reads "Venue TBD" rather than a bare
// "TBD" — without that prefix the string is contextless on the event-card
// footer (no preceding "Where" label to anchor it). The schema's
// superRefine guarantees `venue` is present when format is not 'virtual',
// so the nullish fallback below is defensive: it converges the missing-
// venue path on the same "Venue TBD" output rather than throwing.
export function whereLabel(event: EventData): string {
  if (event.format === 'virtual') return 'Online';

  const name = event.venue?.name ?? 'TBD';
  const venuePart = name === 'TBD' ? 'Venue TBD' : name;

  return event.format === 'hybrid' ? `${venuePart} · also online` : venuePart;
}
