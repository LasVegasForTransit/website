// Every server-side secret the website and the Organizing Platform need, where
// each one comes from, and where it must be stored. `pnpm bootstrap --phase
// secrets` reads this list: it reports what is missing, asks for each value
// once, and writes it to every target. See
// docs/reference/platform-secrets.md for the same list in prose.

export type SecretTarget =
  // The production Worker that serves lasvegasfortransit.org after cutover.
  | 'worker'
  // The Cloudflare Pages project that serves production until cutover.
  | 'pages'
  // The GitHub environment the main-branch Worker candidate uploads from.
  | 'github:worker-candidate';

export interface PlatformSecret {
  name: string;
  /** What the platform uses it for, in one line. */
  purpose: string;
  /** Where a person finds or creates the value. Omitted when generated. */
  source?: string;
  /** Minted by bootstrap instead of asked for. */
  generate?: boolean;
  /** Extra step after setting, for values that must also live elsewhere. */
  afterSet?: string;
  /** Which feature needs it, so the report can say what stays blocked. */
  neededFor: string;
  targets: readonly SecretTarget[];
  validate?: (value: string) => string | undefined;
}

const minLength = (length: number) => (value: string) =>
  value.length < length ? `Expected at least ${length} characters.` : undefined;

const INTAKE_TARGETS = ['pages', 'worker', 'github:worker-candidate'] as const;
const PLATFORM_TARGETS = ['pages', 'worker'] as const;

export const PLATFORM_SECRETS: readonly PlatformSecret[] = [
  {
    name: 'LVBT_BEEHIIV_API_KEY',
    purpose: 'Subscribes new members to the newsletter and reads subscription changes.',
    source: 'Beehiiv → Settings → Integrations → API → create a key.',
    neededFor: 'Joining, newsletter signup, mailing list sync',
    targets: INTAKE_TARGETS,
    validate: minLength(20),
  },
  {
    name: 'LVBT_BEEHIIV_PUBLICATION_ID',
    purpose: 'Names the LVBT publication in Beehiiv API calls.',
    source: 'Beehiiv → Settings → Integrations → API, the ID that starts with pub_.',
    neededFor: 'Joining, newsletter signup, mailing list sync',
    targets: INTAKE_TARGETS,
    validate: (value) => (value.startsWith('pub_') ? undefined : 'Expected an ID starting pub_.'),
  },
  {
    name: 'LVBT_MEMBERSHIP_INTAKE_SECRET',
    purpose: 'Proves a membership intake request came from the Google Form.',
    source:
      'The Google Form → Extensions → Apps Script → Project Settings → Script Properties → LVBT_MEMBERSHIP_INTAKE_SECRET.',
    neededFor: 'The Google Form fallback',
    targets: INTAKE_TARGETS,
    validate: minLength(20),
  },
  {
    name: 'LVBT_NOTION_API_KEY',
    purpose: 'Writes new members to the Notion intake database for staff follow-up.',
    source: 'notion.so/profile/integrations → the LVBT intake connection → Configuration → token.',
    neededFor: 'Joining (staff follow-up), transit news intake',
    targets: INTAKE_TARGETS,
    validate: minLength(20),
  },
  {
    name: 'LVBT_NOTION_DATA_SOURCE_ID',
    purpose: 'Names the Notion intake data source that new members are written to.',
    source: 'The membership intake database in Notion → ••• → Copy data source ID.',
    neededFor: 'Joining (staff follow-up)',
    targets: INTAKE_TARGETS,
    validate: minLength(32),
  },
  {
    name: 'LVBT_TRANSIT_NEWS_INTAKE_SECRET',
    purpose: 'Proves a transit news submission came from the Notion automation.',
    generate: true,
    afterSet:
      'Paste the same value into the Notion transit news automation webhook header as "Authorization: Bearer <value>".',
    neededFor: 'Transit news intake',
    targets: INTAKE_TARGETS,
  },
  {
    name: 'LVBT_SIGN_IN_SECRET',
    purpose: 'Keys the one-way hash that sign-in codes are stored under.',
    generate: true,
    neededFor: 'Member sign-in',
    targets: PLATFORM_TARGETS,
  },
  {
    name: 'LVBT_LINK_SIGNING_SECRET',
    purpose:
      'Signs one-purpose links, such as "Not you? Remove this email", so they cannot be forged.',
    generate: true,
    neededFor: 'Joining (removal link), member sign-in links',
    targets: PLATFORM_TARGETS,
  },
  {
    name: 'LVBT_RESEND_API_KEY',
    purpose: 'Sends transactional email: sign-in codes, confirmations and reminders.',
    source:
      'resend.com → Domains → add notify.lasvegasfortransit.org (Auto configure with Cloudflare) → API Keys → create a key with Sending access for that domain.',
    neededFor: 'Member sign-in, event reminders',
    targets: PLATFORM_TARGETS,
    validate: (value) => (value.startsWith('re_') ? undefined : 'Expected a key starting re_.'),
  },
  {
    name: 'LVBT_GOOGLE_OAUTH_CLIENT_ID',
    purpose: 'Lets staff and volunteers sign in with their LVBT Google account.',
    source:
      'console.cloud.google.com → APIs & Services → Credentials → OAuth client (Web). Consent screen: Internal. Redirect URI: https://lasvegasfortransit.org/auth/google/callback.',
    neededFor: 'Staff and volunteer sign-in',
    targets: PLATFORM_TARGETS,
    validate: (value) =>
      value.endsWith('.apps.googleusercontent.com')
        ? undefined
        : 'Expected an ID ending .apps.googleusercontent.com.',
  },
  {
    name: 'LVBT_GOOGLE_OAUTH_CLIENT_SECRET',
    purpose: 'Pairs with the Google OAuth client ID.',
    source: 'The same OAuth client → Client secret.',
    neededFor: 'Staff and volunteer sign-in',
    targets: PLATFORM_TARGETS,
    validate: minLength(20),
  },
  {
    name: 'LVBT_ACCESS_TEAM_DOMAIN',
    purpose: 'Names the Cloudflare Access team that guards the staff console.',
    source:
      'Cloudflare Zero Trust → Settings → Team domain, for example lvbt.cloudflareaccess.com.',
    neededFor: 'Staff console',
    targets: PLATFORM_TARGETS,
    validate: (value) =>
      value.endsWith('.cloudflareaccess.com') ? undefined : 'Expected <team>.cloudflareaccess.com.',
  },
  {
    name: 'LVBT_ACCESS_AUD',
    purpose: 'Lets the staff console verify that Cloudflare Access signed the request.',
    source:
      'Cloudflare Zero Trust → Access → Applications → staff.lasvegasfortransit.org → Overview → Application Audience (AUD) Tag.',
    neededFor: 'Staff console',
    targets: PLATFORM_TARGETS,
    validate: minLength(32),
  },
  {
    name: 'LVBT_DISCORD_APPLICATION_ID',
    purpose: 'Identifies the LVBT Discord application for linking and commands.',
    source: 'discord.com/developers → the LVBT application → General Information → Application ID.',
    neededFor: 'Discord linking and roles',
    targets: PLATFORM_TARGETS,
  },
  {
    name: 'LVBT_DISCORD_PUBLIC_KEY',
    purpose: 'Verifies that slash-command requests came from Discord.',
    source: 'The same application → General Information → Public Key.',
    neededFor: 'Discord link command',
    targets: PLATFORM_TARGETS,
  },
  {
    name: 'LVBT_DISCORD_CLIENT_SECRET',
    purpose: 'Completes the "Connect Discord" sign-in.',
    source:
      'The same application → OAuth2 → Client Secret. Add the redirect https://lasvegasfortransit.org/account/discord/callback.',
    neededFor: 'Discord linking',
    targets: PLATFORM_TARGETS,
  },
  {
    name: 'LVBT_DISCORD_BOT_TOKEN',
    purpose: 'Grants and removes LVBT-managed roles in the server.',
    source: 'The same application → Bot → Reset Token. Turn on Server Members Intent on that page.',
    neededFor: 'Discord roles',
    targets: PLATFORM_TARGETS,
  },
  {
    name: 'LVBT_DISCORD_GUILD_ID',
    purpose: 'Names the LVBT Discord server.',
    source:
      'Discord → Settings → Advanced → Developer Mode on, then right-click the server → Copy Server ID.',
    neededFor: 'Discord roles',
    targets: PLATFORM_TARGETS,
  },
  {
    name: 'LVBT_GOOGLE_SERVICE_ACCOUNT_KEY',
    purpose: 'Creates volunteer Workspace accounts and manages Google Group membership.',
    source:
      'console.cloud.google.com → IAM → Service Accounts → create one → Keys → JSON. Then admin.google.com → Security → API controls → Domain-wide delegation, with the admin.directory.user and admin.directory.group scopes. Paste the whole JSON.',
    neededFor: 'Volunteer management',
    targets: PLATFORM_TARGETS,
    validate: (value) =>
      value.trim().startsWith('{') ? undefined : 'Paste the whole JSON key file.',
  },
  {
    name: 'LVBT_GOOGLE_ADMIN_SUBJECT',
    purpose: 'The Workspace admin the service account acts as.',
    source: 'An LVBT Workspace super admin email address.',
    neededFor: 'Volunteer management',
    targets: PLATFORM_TARGETS,
    validate: (value) =>
      value.endsWith('@lasvegasfortransit.org')
        ? undefined
        : 'Expected an @lasvegasfortransit.org address.',
  },
  {
    name: 'LVBT_GIVEBUTTER_API_KEY',
    purpose: 'Reads donations so staff see giving alongside everything else.',
    source: 'Givebutter → Settings → Integrations → API → create a key.',
    neededFor: 'Donor support',
    targets: PLATFORM_TARGETS,
  },
];

/** Steps no secret captures. Bootstrap cannot do these for you. */
export const PLATFORM_MANUAL_STEPS: readonly string[] = [
  'gh auth refresh -h github.com -s read:packages, so installs can read @lasvegasfortransit/analytics from GitHub Packages.',
];
