import { site } from './site';

type JsonLd = Record<string, unknown>;

export function organizationSchema(): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: site.name,
    alternateName: site.shortName,
    url: site.url,
    logo: new URL('/og-default.png', site.url).toString(),
    email: site.email.general,
    sameAs: [site.social.instagram, site.social.bluesky],
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

interface EventLike {
  data: {
    title: string;
    summary: string;
    date: Date;
    endDate?: Date;
    location: string;
    rsvpUrl?: string;
  };
  id: string;
}

export function eventSchema(event: EventLike, canonicalUrl: string): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: event.data.title,
    description: event.data.summary,
    startDate: event.data.date.toISOString(),
    ...(event.data.endDate && { endDate: event.data.endDate.toISOString() }),
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: {
      '@type': 'Place',
      name: event.data.location,
      address: {
        '@type': 'PostalAddress',
        addressLocality: 'Las Vegas',
        addressRegion: 'NV',
        addressCountry: 'US',
      },
    },
    organizer: { '@type': 'Organization', name: site.name, url: site.url },
    url: canonicalUrl,
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
}
