import { site } from './site';
import { TIMEZONE } from './event-time';
import type {
  EventLocation,
  EventOffer,
  EventSchemaMetadata,
  EventSchemaPersonOrOrg,
  EventVenue,
} from './event-format';

type JsonLd = Record<string, unknown>;

// Every schema builder below that represents LVBT itself (as publisher,
// organizer, or hiring organization) points at this same logo file — one
// URL construction and one ImageObject shape, not a bare string in some
// builders and an ImageObject in others.
const logoUrl = new URL('/logo.png', site.url).toString();
const logoImageObject = { '@type': 'ImageObject', url: logoUrl };
const defaultEventImage = new URL('/og-default.png', site.url).toString();

export function organizationSchema(): JsonLd {
  const orgAddress = {
    '@type': 'PostalAddress',
    addressLocality: 'North Las Vegas',
    addressRegion: 'NV',
    addressCountry: 'US',
  };

  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${site.url}/#organization`,
    name: site.name,
    alternateName: site.shortName,
    description: site.description,
    slogan: site.tagline,
    url: site.url,
    logo: logoUrl,
    email: site.email.general,
    // EIN is the US Tax ID — schema.org's documented use for `taxID`.
    taxID: site.org.ein,
    // https://schema.org/Nonprofit501c3 — matches the "501(c)(3)" tax status
    // shown in the About page's imprint.
    nonprofitStatus: 'https://schema.org/Nonprofit501c3',
    naics: '813319', // Social change advocacy organizations
    address: orgAddress,
    foundingLocation: { '@type': 'Place', address: orgAddress },
    areaServed: { '@type': 'Place', name: 'Las Vegas Valley' },
    founder: { '@type': 'Person', name: site.org.founder },
    contactPoint: [
      { '@type': 'ContactPoint', email: site.email.general, contactType: 'general inquiries' },
      { '@type': 'ContactPoint', email: site.email.press, contactType: 'media relations' },
    ],
    sameAs: [site.social.instagram, site.social.linkedin, site.social.bluesky].filter(Boolean),
    foundingDate: '2026-04-17',
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
    admissionUrl?: string;
    admissionLabel?: string;
    image?: string;
    schema?: EventSchemaMetadata;
  };
  id: string;
}

function compactObject<T extends Record<string, unknown>>(obj: T): JsonLd {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => {
      if (value === undefined || value === null) return false;
      if (Array.isArray(value) && value.length === 0) return false;
      return value !== '';
    }),
  );
}

function absoluteUrl(pathOrUrl: string): string {
  return new URL(pathOrUrl, site.url).toString();
}

const SCHEMA_DATETIME_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZoneName: 'longOffset',
});

function schemaDateTime(date: Date): string {
  const parts = SCHEMA_DATETIME_FORMATTER.formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const offset = value('timeZoneName').replace('GMT', '') || 'Z';
  return `${value('year')}-${value('month')}-${value('day')}T${value('hour')}:${value(
    'minute',
  )}:${value('second')}${offset}`;
}

function schemaDuration(start: Date, end?: Date): string | undefined {
  if (!end) return undefined;
  const totalSeconds = Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
  if (totalSeconds === 0) return undefined;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `PT${hours ? `${hours}H` : ''}${minutes ? `${minutes}M` : ''}${
    seconds ? `${seconds}S` : ''
  }`;
}

function personOrOrgSchema(entry: EventSchemaPersonOrOrg): JsonLd {
  return compactObject({
    '@type': entry.type ?? 'Person',
    name: entry.name,
    url: entry.url,
  });
}

function offerSchema(offer: EventOffer): JsonLd {
  return compactObject({
    '@type': 'Offer',
    url: offer.url,
    price: offer.price ?? 0,
    priceCurrency: offer.priceCurrency ?? 'USD',
    availability: offer.availability
      ? `https://schema.org/${offer.availability}`
      : 'https://schema.org/InStock',
    validFrom: offer.validFrom ? schemaDateTime(offer.validFrom) : undefined,
  });
}

export function eventSchema(event: EventLike, canonicalUrl: string): JsonLd {
  const schema = event.data.schema;
  const images = [
    ...(schema?.images ?? []),
    ...(event.data.image ? [event.data.image] : []),
    defaultEventImage,
  ].map(absoluteUrl);

  const offer =
    schema?.offer ?? (event.data.admissionUrl ? { url: event.data.admissionUrl } : undefined);

  const base: JsonLd = {
    '@context': 'https://schema.org',
    '@type': schema?.schemaType ?? 'Event',
    '@id': `${canonicalUrl}#event`,
    name: event.data.title,
    description: event.data.summary,
    startDate: schemaDateTime(event.data.date),
    ...(event.data.endDate && { endDate: schemaDateTime(event.data.endDate) }),
    duration: schemaDuration(event.data.date, event.data.endDate),
    eventStatus: `https://schema.org/${schema?.status ?? 'EventScheduled'}`,
    previousStartDate: schema?.previousStartDate
      ? schemaDateTime(schema.previousStartDate)
      : undefined,
    doorTime: schema?.doorTime ? schemaDateTime(schema.doorTime) : undefined,
    inLanguage: 'en-US',
    identifier: {
      '@type': 'PropertyValue',
      propertyID: 'lvbt-event-slug',
      value: event.id,
    },
    organizer: {
      '@type': 'Organization',
      '@id': `${site.url}/#organization`,
      name: site.name,
      url: site.url,
    },
    url: canonicalUrl,
    mainEntityOfPage: canonicalUrl,
    image: [...new Set(images)],
    isAccessibleForFree: schema?.isAccessibleForFree ?? true,
    keywords: schema?.keywords,
    about: schema?.about?.map((name) => ({ '@type': 'Thing', name })),
    audience: schema?.audience?.map((audienceType) => ({ '@type': 'Audience', audienceType })),
    performer: schema?.performer?.map(personOrOrgSchema),
    contributor: schema?.contributor?.map(personOrOrgSchema),
    sponsor: schema?.sponsor?.map(personOrOrgSchema),
    funder: schema?.funder?.map(personOrOrgSchema),
    maximumAttendeeCapacity: schema?.maximumAttendeeCapacity,
    remainingAttendeeCapacity: schema?.remainingAttendeeCapacity,
    ...(event.data.rsvpUrl && {
      potentialAction: {
        '@type': 'RegisterAction',
        target: event.data.rsvpUrl,
      },
    }),
    ...(offer && { offers: offerSchema(offer) }),
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
    ...(venue.url && { url: venue.url }),
    ...(venue.sameAs && { sameAs: venue.sameAs }),
    ...(venue.latitude !== undefined &&
      venue.longitude !== undefined && {
        geo: {
          '@type': 'GeoCoordinates',
          latitude: venue.latitude,
          longitude: venue.longitude,
        },
      }),
    address: {
      '@type': 'PostalAddress' as const,
      ...(venue.streetAddress && { streetAddress: venue.streetAddress }),
      addressLocality: venue.addressLocality,
      addressRegion: venue.addressRegion,
      ...(venue.postalCode && { postalCode: venue.postalCode }),
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

// Mirror of the letters Zod schema in src/content.config.ts. Kept narrow for
// the same reason as EventLike above — no astro:content import here.
interface LetterLike {
  data: {
    title: string;
    summary: string;
    date: Date;
    author: string;
    authorTitle: string;
  };
  id: string;
}

export function letterSchema(letter: LetterLike, canonicalUrl: string): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: letter.data.title,
    description: letter.data.summary,
    datePublished: letter.data.date.toISOString(),
    url: canonicalUrl,
    mainEntityOfPage: canonicalUrl,
    inLanguage: 'en-US',
    author: {
      '@type': 'Person',
      name: letter.data.author,
      jobTitle: letter.data.authorTitle,
    },
    publisher: {
      '@type': 'Organization',
      name: site.name,
      logo: logoImageObject,
    },
  };
}

// Mirror of the roles Zod schema in src/content.config.ts — same reasoning
// as EventLike/LetterLike above.
interface RoleLike {
  data: {
    title: string;
    summary: string;
    commitment: string;
    team?: string;
    datePosted: Date;
  };
}

// All roles are unpaid, remote-first volunteer positions open to Nevada
// residents — see the Technical Lead posting ("remote-first organization")
// and the org's Las Vegas Valley-specific mission. `description` is built
// from the structured fields already on the entry (org context + summary +
// commitment/team) rather than the full MDX body: rendering that body to an
// HTML string would require Astro's Container API, which is still
// `experimental_`-prefixed — not a tradeoff worth making for 4 low-traffic
// posting pages.
//
// TODO: once `experimental_AstroContainer` (astro/container) graduates to a
// stable export, render the role's full MDX `Content` to an HTML string with
// it and use that as `description` instead — it's what Google's JobPosting
// guide actually wants ("complete HTML representation including
// responsibilities, qualifications, skills, hours, education, experience"),
// which the current summary/commitment-only version only partially covers.
export function jobPostingSchema(role: RoleLike, canonicalUrl: string): JsonLd {
  const description = [
    `<p>${site.orgIntro}</p>`,
    `<p>${role.data.summary}</p>`,
    `<p>Time commitment: ${role.data.commitment}.${role.data.team ? ` Team: ${role.data.team}.` : ''}</p>`,
  ].join('');

  return {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: role.data.title,
    description,
    datePosted: role.data.datePosted.toISOString(),
    employmentType: 'VOLUNTEER',
    url: canonicalUrl,
    hiringOrganization: {
      '@type': 'Organization',
      name: site.name,
      sameAs: site.url,
      logo: logoImageObject,
    },
    jobLocationType: 'TELECOMMUTE',
    applicantLocationRequirements: { '@type': 'State', name: 'Nevada' },
  };
}

// Per Google's breadcrumb structured-data guide, the last item (the current
// page) omits `item` — a self-referencing URL there is redundant. Pass `url`
// for every entry except the final one.
export function breadcrumbSchema(items: Array<{ name: string; url?: string }>): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      ...(item.url && { item: item.url }),
    })),
  };
}
