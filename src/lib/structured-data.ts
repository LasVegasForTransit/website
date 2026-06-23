import { site } from './site';
import type { EventLocation, EventVenue } from './event-format';

type JsonLd = Record<string, unknown>;

export function organizationSchema(): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: site.name,
    alternateName: site.shortName,
    url: site.url,
    logo: new URL('/logo.png', site.url).toString(),
    email: site.email.general,
    sameAs: [site.social.instagram, site.social.linkedin, site.social.bluesky].filter(Boolean),
    foundingDate: '2026-04-17',
    foundingLocation: {
      '@type': 'Place',
      address: { '@type': 'PostalAddress', addressRegion: 'NV', addressCountry: 'US' },
    },
  };
}

export function websiteSchema(): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: site.name,
    url: site.url,
    inLanguage: 'en-US',
    publisher: { '@type': 'Organization', name: site.name },
  };
}

// Mirror of the events Zod schema in src/content.config.ts. Kept narrow so this
// helper doesn't import from astro:content (which would create a circular dep
// between the content config and the structured-data utility).
interface EventLike {
  data: {
    title: string;
    summary: string;
    date: Date;
    endDate?: Date;
    location?: EventLocation;
    rsvpUrl?: string;
    image?: string;
  };
  id: string;
}

export function eventSchema(event: EventLike, canonicalUrl: string): JsonLd {
  const base: JsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: event.data.title,
    description: event.data.summary,
    startDate: event.data.date.toISOString(),
    ...(event.data.endDate && { endDate: event.data.endDate.toISOString() }),
    eventStatus: 'https://schema.org/EventScheduled',
    organizer: { '@type': 'Organization', name: site.name, url: site.url },
    url: canonicalUrl,
    ...(event.data.image && { image: new URL(event.data.image, site.url).toString() }),
    ...(event.data.rsvpUrl && {
      offers: {
        '@type': 'Offer',
        url: event.data.rsvpUrl,
        price: '0',
        priceCurrency: 'USD',
        availability: 'https://schema.org/InStock',
      },
    }),
  };

  const loc = event.data.location;
  // No location yet (details pending) — emit the event without a `location` or
  // `eventAttendanceMode` rather than a placeholder. Valid JSON-LD; the markup
  // fills in once the calendar event has a venue or join URL.
  if (!loc) return base;

  const virtualLocation = (url: string) => ({ '@type': 'VirtualLocation' as const, url });
  const placeLocation = (venue: EventVenue) => ({
    '@type': 'Place' as const,
    name: venue.name,
    address: {
      '@type': 'PostalAddress' as const,
      ...(venue.streetAddress && { streetAddress: venue.streetAddress }),
      addressLocality: venue.addressLocality,
      addressRegion: venue.addressRegion,
      addressCountry: venue.addressCountry,
    },
  });

  switch (loc.format) {
    case 'virtual':
      return {
        ...base,
        eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode',
        location: virtualLocation(loc.joinUrl),
      };
    case 'in-person':
      return {
        ...base,
        eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
        location: placeLocation(loc.venue),
      };
    case 'hybrid':
      return {
        ...base,
        eventAttendanceMode: 'https://schema.org/MixedEventAttendanceMode',
        location: [virtualLocation(loc.joinUrl), placeLocation(loc.venue)],
      };
  }
}
