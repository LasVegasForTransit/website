import { readFileSync } from 'node:fs';
import { expect, test } from '../../scripts/deploy/access-browser';
import { eventSchema } from '../../src/lib/structured-data';

type JsonLd = Record<string, unknown>;

const sitemap = readFileSync(new URL('../../dist/sitemap-0.xml', import.meta.url), 'utf8');
const eventPaths = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)]
  .map((match) => new URL(match[1]).pathname)
  .filter((path) => /^\/events\/[^/.]+\/?$/.test(path));
if (eventPaths.length === 0) throw new Error('The built sitemap contains no event pages.');

async function jsonLdBlocks(page: import('@playwright/test').Page): Promise<JsonLd[]> {
  return page
    .locator('script[type="application/ld+json"]')
    .evaluateAll((scripts) =>
      scripts.map((script) => JSON.parse(script.textContent ?? '{}') as JsonLd),
    );
}

async function eventJsonLd(page: import('@playwright/test').Page): Promise<JsonLd> {
  const blocks = await jsonLdBlocks(page);
  const event = blocks.find((block) => {
    const schemaType = block['@type'];
    return typeof schemaType === 'string' && schemaType.endsWith('Event');
  });
  expect(event).toBeTruthy();
  return event!;
}

test.describe('event metadata', () => {
  test('treats RSVP links as registration actions, not ticket offers', () => {
    const event = eventSchema(
      {
        id: '2026-08-13-rsvp-only',
        data: {
          title: 'RSVP-only event',
          summary: 'A free event with a sign-up form.',
          date: new Date('2026-08-14T01:00:00Z'),
          rsvpUrl: 'https://forms.gle/example-rsvp',
        },
      },
      'https://lasvegasfortransit.org/events/2026-08-13-rsvp-only/',
    );

    expect(event.offers).toBeUndefined();
    expect(event.potentialAction).toEqual({
      '@type': 'RegisterAction',
      target: 'https://forms.gle/example-rsvp',
    });
  });

  test('treats admission links as ticket offers', () => {
    const event = eventSchema(
      {
        id: '2026-08-13-admission',
        data: {
          title: 'Admission event',
          summary: 'A free event with an admission link.',
          date: new Date('2026-08-14T01:00:00Z'),
          admissionUrl: 'https://events.example/admission',
          admissionLabel: 'Admission',
        },
      },
      'https://lasvegasfortransit.org/events/2026-08-13-admission/',
    );

    expect(event.potentialAction).toBeUndefined();
    expect(event.offers).toEqual({
      '@type': 'Offer',
      url: 'https://events.example/admission',
      price: 0,
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock',
    });
  });

  test('uses date-specific metadata for recurring event pages', async ({ page }) => {
    await page.goto('/events', { waitUntil: 'domcontentloaded' });

    const eventPaths = [
      ...new Set(
        await page
          .locator('main a[href^="/events/"]')
          .evaluateAll((links) =>
            links
              .map((link) => new URL((link as HTMLAnchorElement).href).pathname)
              .filter((path) => /^\/events\/[^/.]+\/?$/.test(path)),
          ),
      ),
    ];

    // A pair from each recurring series proves the date is in the metadata.
    // Visiting every event here makes this one test depend on the whole calendar.
    const pathsBySeries = new Map<string, string[]>();
    for (const eventPath of eventPaths) {
      const series = eventPath.replace(/^\/events\/\d{4}-\d{2}-\d{2}-/, '');
      const paths = pathsBySeries.get(series) ?? [];
      paths.push(eventPath);
      pathsBySeries.set(series, paths);
    }
    const recurringSeries = [...pathsBySeries.entries()].filter(([, paths]) => paths.length > 1);
    expect(recurringSeries.length).toBeGreaterThan(0);
    for (const [series, paths] of recurringSeries.slice(0, 3)) {
      const titles: string[] = [];
      const headings: string[] = [];
      for (const eventPath of paths.slice(0, 2)) {
        await page.goto(eventPath, { waitUntil: 'domcontentloaded' });
        headings.push((await page.locator('h1').first().innerText()).trim());
        titles.push(await page.title());
      }
      expect(new Set(headings).size, series).toBe(1);
      expect(new Set(titles).size, series).toBe(titles.length);
      for (const title of titles) {
        expect(title, series).toMatch(/[A-Z][a-z]+ \d{1,2}, 20\d{2}/);
      }
    }
  });

  // Each occurrence has its own deadline, independent of the calendar's size.
  for (const eventPath of eventPaths) {
    test(`publishes stable Schema.org event details: ${eventPath}`, async ({ page }) => {
      await page.goto(eventPath, { waitUntil: 'domcontentloaded' });

      const event = await eventJsonLd(page);
      const canonicalPath = eventPath.endsWith('/') ? eventPath : `${eventPath}/`;
      const url = new URL(canonicalPath, 'https://lasvegasfortransit.org').toString();

      expect(event['@context'], eventPath).toBe('https://schema.org');
      expect(event['@id'], eventPath).toBe(`${url}#event`);
      expect(event.url, eventPath).toBe(url);
      expect(event.mainEntityOfPage, eventPath).toBe(url);
      expect(event.inLanguage, eventPath).toBe('en-US');
      expect(event.isAccessibleForFree, eventPath).toBe(true);
      expect(event.image, eventPath).toContain('https://lasvegasfortransit.org/og-default.png');

      const identifier = event.identifier as JsonLd;
      expect(identifier?.['@type'], eventPath).toBe('PropertyValue');
      expect(identifier?.propertyID, eventPath).toBe('lvbt-event-slug');
      expect(identifier?.value, eventPath).toBe(
        eventPath.replace(/^\/events\//, '').replace(/\/$/, ''),
      );

      const organizer = event.organizer as JsonLd;
      expect(organizer?.['@type'], eventPath).toBe('Organization');
      expect(organizer?.['@id'], eventPath).toBe('https://lasvegasfortransit.org/#organization');
      expect(organizer?.name, eventPath).toBe('Las Vegans for Better Transit');
      expect(organizer?.url, eventPath).toBe('https://lasvegasfortransit.org');
    });
  }

  test('keeps virtual events valid Schema.org events', async ({ page }) => {
    await page.goto('/events/2026-07-16-lvbt-general-member-meeting');
    await page.waitForLoadState('networkidle');

    const event = await eventJsonLd(page);
    const location = event.location as JsonLd;

    expect(event.eventAttendanceMode).toBe('https://schema.org/OnlineEventAttendanceMode');
    expect(location?.['@type']).toBe('VirtualLocation');
    expect(location?.url).toMatch(/^https:\/\/meet\.google\.com\//);
  });

  test('parses physical Google Calendar locations into postal addresses', async ({ page }) => {
    await page.goto('/events/2026-07-11-lvbt-s-first-walk-audit');
    await page.waitForLoadState('networkidle');

    const event = await eventJsonLd(page);
    const location = event.location as JsonLd;
    const address = location.address as JsonLd;

    expect(event.eventAttendanceMode).toBe('https://schema.org/OfflineEventAttendanceMode');
    expect(location?.['@type']).toBe('Place');
    expect(location?.name).toBe('7-Eleven');
    expect(address?.['@type']).toBe('PostalAddress');
    expect(address?.streetAddress).toBe('4728 W Craig Rd');
    expect(address?.addressLocality).toBe('North Las Vegas');
    expect(address?.addressRegion).toBe('NV');
    expect(address?.postalCode).toBe('89032');
    expect(address?.addressCountry).toBe('US');
  });
});
