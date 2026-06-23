// Single source of truth for an event's location/attendance shape and how it's
// presented. The content schema builds its `location` field from the union
// here, and EventCard, the detail page, the /go carousel, structured data, and
// the .ics generator all import the inferred types and helpers — so the shape
// is defined once.
//
// Icon names are Iconify identifiers — rendered via `<Icon name={…} />` from
// `astro-icon/components`, backed by the `@iconify-json/mdi` set. No emoji in
// rendered UI; emoji render differently across platforms and don't honor the
// design system's color tokens.
import { z } from 'zod';

// The three ways to attend an event. `format` is the discriminant of the
// location union below — never a standalone field.
export const EVENT_FORMATS = ['virtual', 'in-person', 'hybrid'] as const;
export type EventFormat = (typeof EVENT_FORMATS)[number];

const venueSchema = z.object({
  name: z.string(),
  streetAddress: z.string().optional(),
  addressLocality: z.string().default('Las Vegas'),
  addressRegion: z.string().default('NV'),
  addressCountry: z.string().default('US'),
});

// How to attend, as a discriminated union: `format` selects which fields are
// present — a join URL for virtual, a venue for in-person, both for hybrid.
// An event whose details aren't arranged yet simply has *no* location (the
// field is optional on the schema); "to be announced" is the absence of this
// union, not a member of it.
export const eventLocationSchema = z.discriminatedUnion('format', [
  z.object({ format: z.literal('virtual'), joinUrl: z.url() }),
  z.object({ format: z.literal('in-person'), venue: venueSchema }),
  z.object({ format: z.literal('hybrid'), joinUrl: z.url(), venue: venueSchema }),
]);

export type EventVenue = z.infer<typeof venueSchema>;
export type EventLocation = z.infer<typeof eventLocationSchema>;

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

// Presentation for an event with no location yet — real and dated, but how to
// attend is pending. The absence of a location, not a fourth format.
export const PENDING_FORMAT_LABEL = 'Details to come';
export const PENDING_FORMAT_ICON_NAME = 'mdi:dots-horizontal-circle-outline';

// Composes the "Where" line. No location → pending. Virtual → "Online".
// in-person/hybrid always carry a venue (guaranteed by the union), so there's
// no missing-venue fallback to handle.
export function whereLabel(location?: EventLocation): string {
  if (!location) return 'Location to be announced';
  if (location.format === 'virtual') return 'Online';
  return location.format === 'hybrid'
    ? `${location.venue.name} · also online`
    : location.venue.name;
}
