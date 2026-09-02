type EnvLike = Record<string, string | undefined>;

const env: EnvLike = (import.meta as unknown as { env?: EnvLike }).env ?? {};

// Deployment config — social profiles, the Discord invite, and the donation
// URL — comes exclusively from PUBLIC_LVBT_* env vars (`.env.local` in dev,
// the Cloudflare Pages dashboard in prod). There are deliberately NO fallback
// literals: an unset var resolves to `undefined`, consumers skip rendering
// that link rather than ship a stale URL. See .env.example for the full list.
function urlFromEnv(key: string): string | undefined {
  const value = env[key];
  if (value && value.trim()) return value;
  return undefined;
}

export const site = {
  name: 'Las Vegans for Better Transit',
  shortName: 'LVBT',
  tagline: 'Better transit, safer streets, a Vegas that works for everyone.',
  // Shared between BaseLayout's default meta description and the Organization
  // JSON-LD (src/lib/structured-data.ts) — one description, not two copies
  // that can drift.
  description:
    'Las Vegans for Better Transit is the grassroots advocacy group fighting for world-class public transit and supportive land use in the Las Vegas Valley.',
  // Shared between the /join/[role] page's visible "About" intro and
  // jobPostingSchema's JSON-LD description (src/lib/structured-data.ts) — same
  // reasoning as `description` above. Not the same statement as
  // src/content/docs/mission.mdx's opening sentence, which is worded
  // differently for its own purpose; reconciling those two is an editorial
  // call, not a duplication fix.
  orgIntro:
    'We advocate for world-class public transportation and the land use that makes it work through public education, community outreach, and coalition building.',
  url: 'https://lasvegasfortransit.org',
  email: {
    general: 'hello@lasvegasfortransit.org',
    press: 'press@lasvegasfortransit.org',
    partners: 'partners@lasvegasfortransit.org',
  },
  social: {
    instagram: urlFromEnv('PUBLIC_LVBT_INSTAGRAM'),
    linkedin: urlFromEnv('PUBLIC_LVBT_LINKEDIN'),
    bluesky: urlFromEnv('PUBLIC_LVBT_BLUESKY'),
    discord: urlFromEnv('PUBLIC_LVBT_DISCORD'),
  },
  donate: {
    label: 'Donate',
    url: urlFromEnv('PUBLIC_LVBT_DONATE_URL'),
  },
  // Candid nonprofit profile — the third-party transparency record linked from
  // the About page. This is stable public organization metadata, not deploy
  // configuration.
  transparency: {
    candidUrl: 'https://app.candid.org/profile/16646908/las-vegans-for-better-transit-42-1995935',
  },
  // Membership intake Google Form — the canonical front door for new members
  // (feeds the Beehiiv + Notion pipeline via its Apps Script submit trigger).
  // Stored as the forms.gle short link so the same value drives the /join CTA
  // and the QR presenter slide, whose encoder caps at 84 bytes.
  membership: {
    formUrl: urlFromEnv('PUBLIC_LVBT_MEMBERSHIP_FORM_URL'),
  },
  // Newsletter. Published on Beehiiv; the site links out to it rather than
  // hosting issues. `url` is the public Beehiiv home (archive + subscribe);
  // `feedUrl` is the RSS feed pulled at build to list recent issues on
  // /newsletter. Both come from PUBLIC_LVBT_* env vars (like the socials);
  // when unset, the loader emits no issues and the page hides the Beehiiv
  // links. See src/lib/newsletter-loader.ts.
  newsletter: {
    url: urlFromEnv('PUBLIC_LVBT_NEWSLETTER_URL'),
    feedUrl: urlFromEnv('PUBLIC_LVBT_NEWSLETTER_FEED_URL'),
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
    address: 'North\u00A0Las\u00A0Vegas, Nevada',
    ein: '42-1995935',
    founded: 'April 17, 2026',
    founder: 'Willie Chalmers III',
  },
} as const;

// Hidden until ready:
// - /vision — mid-redesign. Restore by adding back to the array and undoing
//   the omissions in Footer, index.astro, about.mdx, sitemap.astro, the
//   llms-*.txt sources, astro.config.mjs, and vision.astro's `noindex` flag.
export const navMain = [
  { href: '/about', label: 'About' },
  { href: '/programs', label: 'Programs' },
  { href: '/projects', label: 'Projects' },
  { href: '/events', label: 'Events' },
  { href: '/join', label: 'Join' },
  { href: '/contact', label: 'Contact' },
] as const;
