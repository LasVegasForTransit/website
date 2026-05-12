import { site } from './site';

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
    sameAs: [site.social.instagram, site.social.linkedin, site.social.bluesky],
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
    format: 'virtual' | 'in-person' | 'hybrid';
    venue?: {
      name: string;
      streetAddress?: string;
      addressLocality: string;
      addressRegion: string;
      addressCountry: string;
    };
    joinUrl?: string;
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

  const virtualLoc = event.data.joinUrl && {
    '@type': 'VirtualLocation' as const,
    url: event.data.joinUrl,
  };
  const physicalLoc = event.data.venue && {
    '@type': 'Place' as const,
    name: event.data.venue.name,
    address: {
      '@type': 'PostalAddress' as const,
      ...(event.data.venue.streetAddress && { streetAddress: event.data.venue.streetAddress }),
      addressLocality: event.data.venue.addressLocality,
      addressRegion: event.data.venue.addressRegion,
      addressCountry: event.data.venue.addressCountry,
    },
  };

  switch (event.data.format) {
    case 'virtual':
      return {
        ...base,
        eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode',
        location: virtualLoc,
      };
    case 'in-person':
      return {
        ...base,
        eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
        location: physicalLoc,
      };
    case 'hybrid':
      return {
        ...base,
        eventAttendanceMode: 'https://schema.org/MixedEventAttendanceMode',
        location: [virtualLoc, physicalLoc],
      };
  }
}
