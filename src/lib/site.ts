type EnvLike = Record<string, string | undefined>;

const env: EnvLike = (import.meta as unknown as { env?: EnvLike }).env ?? {};

function pick(key: string, fallback: string): string {
  const value = env[key];
  return value && value.trim() ? value : fallback;
}

export const site = {
  name: 'Las Vegans for Better Transit',
  shortName: 'LVBT',
  tagline: 'Better transit, safer streets, a Vegas that works for everyone.',
  url: 'https://lasvegasfortransit.org',
  email: {
    general: 'hello@lasvegasfortransit.org',
    press: 'press@lasvegasfortransit.org',
    partners: 'partners@lasvegasfortransit.org',
  },
  social: {
    instagram: pick('PUBLIC_LVBT_INSTAGRAM', 'https://instagram.com/lasvegasfortransit'),
    linkedin: pick('PUBLIC_LVBT_LINKEDIN', 'https://www.linkedin.com/company/lasvegasfortransit/'),
    bluesky: pick('PUBLIC_LVBT_BLUESKY', 'https://bsky.app/profile/lasvegasfortransit.org'),
  },
  donate: {
    label: 'Donate',
    url: pick('PUBLIC_LVBT_DONATE_URL', 'https://givebutter.com/lvbt'),
  },
  // Public Google Calendar. Canonical source for event metadata (when /
  // where / how to join). The site rebuilds against this calendar on a
  // schedule; see docs/explanation/events-pipeline.md. `url` is the
  // human-facing embed view; `icsUrl` is the machine-readable feed the
  // build pulls.
  calendar: {
    url: 'https://calendar.google.com/calendar/embed?src=c_dd8ea3396a62c41b5ae5fd659d7901cd11b45bc470832cacdf79b00884bf671b%40group.calendar.google.com&ctz=America%2FLos_Angeles',
    icsUrl:
      'https://calendar.google.com/calendar/ical/c_dd8ea3396a62c41b5ae5fd659d7901cd11b45bc470832cacdf79b00884bf671b%40group.calendar.google.com/public/basic.ics',
  },
  org: {
    legalName: 'Las Vegans for Better Transit',
    // TODO: update to full PO box mailing address once secured.
    address: 'Las\u00A0Vegas, Nevada',
    ein: '42-1995935',
    founded: 'April 17, 2026',
  },
} as const;

// Hidden until ready:
// - /vision — mid-redesign. Restore by adding back to the array and undoing
//   the omissions in Footer, index.astro, about.mdx, sitemap.astro, the
//   llms-*.txt sources, astro.config.mjs, and vision.astro's `noindex` flag.
export const navMain = [
  { href: '/about', label: 'About' },
  { href: '/projects', label: 'Projects' },
  { href: '/events', label: 'Events' },
  { href: '/contact', label: 'Contact' },
] as const;
