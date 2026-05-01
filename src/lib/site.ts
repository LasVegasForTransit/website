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
    bluesky: pick('PUBLIC_LVBT_BLUESKY', 'https://bsky.app/profile/lasvegasfortransit.org'),
  },
  donate: {
    label: 'Donate',
    url: pick('PUBLIC_LVBT_DONATE_URL', 'https://givebutter.com/lvbt'),
  },
  newsletter: {
    provider: 'beehiiv' as const,
    embedUrl: pick('PUBLIC_LVBT_BEEHIIV_EMBED_URL', 'https://embeds.beehiiv.com/PLACEHOLDER'),
  },
  org: {
    legalName: 'Las Vegans for Better Transit',
    // TODO: update to full PO box mailing address once secured.
    address: 'Las\u00A0Vegas, Nevada',
    ein: '42-1995935',
    founded: 'April 17, 2026',
  },
} as const;

export const navMain = [
  { href: '/about', label: 'About' },
  { href: '/vision', label: 'Vision' },
  { href: '/projects', label: 'Projects' },
  { href: '/events', label: 'Events' },
  { href: '/join', label: 'Get involved' },
  { href: '/contact', label: 'Contact' },
] as const;
