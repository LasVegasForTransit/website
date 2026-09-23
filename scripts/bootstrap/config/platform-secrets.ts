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

/**
 * `live`: a feature on the site uses it today. `future`: only a feature that
 * isn't built yet uses it, so it can wait until that feature is.
 */
export type SecretUse = 'live' | 'future';

export interface PlatformSecret {
  name: string;
  /** What the platform uses it for, in one line. */
  purpose: string;
  use: SecretUse;
  /** The page to open first. Bootstrap offers to open it in the browser. */
  url?: string;
  /** Numbered, click-by-click steps to find or create the value. */
  steps?: readonly string[];
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
    name: 'LVBT_RESEND_API_KEY',
    purpose: 'Sends transactional email: sign-in codes, confirmations and reminders.',
    use: 'live',
    url: 'https://resend.com/domains',
    steps: [
      'Sign in to Resend (create a free account with your LVBT Google account if there is none).',
      'On the Domains page, click "Add Domain", type notify.lasvegasfortransit.org and click "Add".',
      'If Resend offers to set up the records with Cloudflare, accept and approve it in the Cloudflare window. Otherwise add each record it lists at https://dash.cloudflare.com → lasvegasfortransit.org → DNS → Records.',
      'Wait until the domain says "Verified". This usually takes a few minutes.',
      'Open https://resend.com/api-keys and click "Create API Key".',
      'Name it "LVBT website", choose "Sending access" and the domain notify.lasvegasfortransit.org, then click "Add".',
      'Copy the key. It starts with re_ and is shown only once.',
    ],
    neededFor: 'Member sign-in, event reminders',
    targets: PLATFORM_TARGETS,
    validate: (value) => (value.startsWith('re_') ? undefined : 'Expected a key starting re_.'),
  },
  {
    name: 'LVBT_BEEHIIV_API_KEY',
    purpose: 'Subscribes new members to the newsletter and reads subscription changes.',
    use: 'live',
    url: 'https://app.beehiiv.com/settings/workspace/api',
    steps: [
      'Sign in to Beehiiv as a workspace Owner or Admin.',
      'Under "API Keys", click "Create New API Key".',
      'Name it "LVBT website" and click "Create New Key".',
      'Copy the key now. Beehiiv shows it only once. Then click "I\'ve saved the key".',
    ],
    neededFor: 'Joining, newsletter signup, mailing list sync',
    targets: INTAKE_TARGETS,
    validate: minLength(20),
  },
  {
    name: 'LVBT_BEEHIIV_PUBLICATION_ID',
    purpose: 'Names the LVBT publication in Beehiiv API calls.',
    use: 'live',
    url: 'https://app.beehiiv.com/settings/workspace/api',
    steps: [
      'On the same Beehiiv API page, find "Publication ID".',
      'Copy it. For LVBT it is pub_d3178023-f8d5-4e9d-a768-0c4eaa6b7280.',
    ],
    neededFor: 'Joining, newsletter signup, mailing list sync',
    targets: INTAKE_TARGETS,
    validate: (value) => (value.startsWith('pub_') ? undefined : 'Expected an ID starting pub_.'),
  },
  {
    name: 'LVBT_MEMBERSHIP_INTAKE_SECRET',
    purpose: 'Proves a membership intake request came from the Google Form.',
    use: 'live',
    url: 'https://script.google.com/home',
    steps: [
      'Open the Apps Script project attached to the LVBT membership Google Form. From the form, that is the ⋮ menu → "Apps Script".',
      'Click "Project Settings", the gear icon on the left.',
      'Scroll to "Script Properties" and copy the value of LVBT_MEMBERSHIP_INTAKE_SECRET.',
    ],
    neededFor: 'The Google Form fallback',
    targets: INTAKE_TARGETS,
    validate: minLength(20),
  },
  {
    name: 'LVBT_NOTION_API_KEY',
    purpose: 'Writes new members to the Notion intake database for staff follow-up.',
    use: 'live',
    url: 'https://www.notion.so/profile/integrations',
    steps: [
      'Sign in to Notion as an LVBT workspace owner.',
      'Click the integration connected to the Membership intake database. To check its name, open https://www.notion.so/6bad03ffdebf4072a34a6408d3e7180d → ••• → Connections.',
      'Under "Internal Integration Secret", click "Show", then "Copy".',
    ],
    neededFor: 'Joining (staff follow-up), transit news intake',
    targets: INTAKE_TARGETS,
    validate: minLength(20),
  },
  {
    name: 'LVBT_NOTION_DATA_SOURCE_ID',
    purpose: 'Names the Notion intake data source that new members are written to.',
    use: 'live',
    url: 'https://www.notion.so/6bad03ffdebf4072a34a6408d3e7180d',
    steps: [
      'Open the Membership intake database.',
      'Click ••• → "Copy data source ID". For LVBT it is 6e3df57f-d336-4c0c-a814-a0be68c7f455.',
    ],
    neededFor: 'Joining (staff follow-up)',
    targets: INTAKE_TARGETS,
    validate: minLength(32),
  },
  {
    name: 'LVBT_TRANSIT_NEWS_INTAKE_SECRET',
    purpose: 'Proves a transit news submission came from the Notion automation.',
    use: 'live',
    generate: true,
    steps: [
      'Open the LVBT transit news automation in Notion and inspect its webhook action.',
      'Copy the value after "Bearer " in its Authorization header. Enter that same value here.',
      'If the value is unavailable, stop and rotate the secret across Notion, Pages, Worker and GitHub together.',
    ],
    afterSet:
      'Paste the same value into the Notion transit news automation webhook header as "Authorization: Bearer <value>".',
    neededFor: 'Transit news intake',
    targets: INTAKE_TARGETS,
  },
  {
    name: 'LVBT_SIGN_IN_SECRET',
    purpose: 'Keys the one-way hash that sign-in codes are stored under.',
    use: 'live',
    generate: true,
    neededFor: 'Member sign-in',
    targets: PLATFORM_TARGETS,
  },
  {
    name: 'LVBT_LINK_SIGNING_SECRET',
    purpose:
      'Signs one-purpose links, such as "Not you? Remove this email", so they cannot be forged.',
    use: 'live',
    generate: true,
    neededFor: 'Joining (removal link), member sign-in links',
    targets: PLATFORM_TARGETS,
  },
  {
    name: 'LVBT_GOOGLE_OAUTH_CLIENT_ID',
    purpose: 'Lets staff and volunteers sign in with their LVBT Google account.',
    use: 'future',
    url: 'https://console.cloud.google.com/auth/clients',
    steps: [
      'Sign in with an LVBT Workspace admin account and choose the LVBT project at the top of the page (create one named "LVBT website" if there is none).',
      'If Google asks you to configure the consent screen first: App name "Las Vegans for Better Transit", support email your LVBT address, Audience "Internal", then "Create".',
      'Click "Create client". Application type: "Web application". Name: "LVBT website".',
      'Under "Authorized redirect URIs", click "Add URI" and enter https://lasvegasfortransit.org/auth/google/callback. Click "Create".',
      'Copy the Client ID. It ends with .apps.googleusercontent.com. Keep the dialog open for the client secret, which comes next.',
    ],
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
    use: 'future',
    url: 'https://console.cloud.google.com/auth/clients',
    steps: [
      'In the dialog from the last step, copy the Client secret.',
      'If you closed it: click the "LVBT website" client, then "Add secret" under Client secrets, and copy the new one.',
    ],
    neededFor: 'Staff and volunteer sign-in',
    targets: PLATFORM_TARGETS,
    validate: minLength(20),
  },
  {
    name: 'LVBT_ACCESS_TEAM_DOMAIN',
    purpose: 'Names the Cloudflare Access team that guards the staff console.',
    use: 'future',
    url: 'https://one.dash.cloudflare.com/',
    steps: [
      'Open Cloudflare Zero Trust. The first time, it asks for a team name: use "lvbt", and choose the Free plan.',
      'Go to Settings → Custom Pages and find "Team domain".',
      'Copy the domain. It looks like lvbt.cloudflareaccess.com.',
    ],
    neededFor: 'Staff console',
    targets: PLATFORM_TARGETS,
    validate: (value) =>
      value.endsWith('.cloudflareaccess.com') ? undefined : 'Expected <team>.cloudflareaccess.com.',
  },
  {
    name: 'LVBT_ACCESS_AUD',
    purpose: 'Lets the staff console verify that Cloudflare Access signed the request.',
    use: 'future',
    url: 'https://one.dash.cloudflare.com/',
    steps: [
      'In Zero Trust, go to Access → Applications.',
      'Click the staff.lasvegasfortransit.org application. If there is none yet, it is created by the Docket task "Put the staff subdomain behind Cloudflare Access"; skip this value until then.',
      'On the "Overview" tab, copy "Application Audience (AUD) Tag".',
    ],
    neededFor: 'Staff console',
    targets: PLATFORM_TARGETS,
    validate: minLength(32),
  },
  {
    name: 'LVBT_DISCORD_APPLICATION_ID',
    purpose: 'Identifies the LVBT Discord application for linking and commands.',
    use: 'future',
    url: 'https://discord.com/developers/applications',
    steps: [
      'Sign in with the Discord account that owns the LVBT server.',
      'Open the "LVBT" application, or click "New Application", name it "LVBT" and click "Create".',
      'On "General Information", copy the Application ID.',
    ],
    neededFor: 'Discord linking and roles',
    targets: PLATFORM_TARGETS,
  },
  {
    name: 'LVBT_DISCORD_PUBLIC_KEY',
    purpose: 'Verifies that slash-command requests came from Discord.',
    use: 'future',
    url: 'https://discord.com/developers/applications',
    steps: ['In the same application, on "General Information", copy the Public Key.'],
    neededFor: 'Discord link command',
    targets: PLATFORM_TARGETS,
  },
  {
    name: 'LVBT_DISCORD_CLIENT_SECRET',
    purpose: 'Completes the "Connect Discord" sign-in.',
    use: 'future',
    url: 'https://discord.com/developers/applications',
    steps: [
      'In the same application, open "OAuth2" on the left.',
      'Under "Redirects", click "Add Redirect", enter https://lasvegasfortransit.org/account/discord/callback and click "Save Changes".',
      'Under "Client Secret", click "Reset Secret", confirm, and copy it.',
    ],
    neededFor: 'Discord linking',
    targets: PLATFORM_TARGETS,
  },
  {
    name: 'LVBT_DISCORD_BOT_TOKEN',
    purpose: 'Grants and removes LVBT-managed roles in the server.',
    use: 'future',
    url: 'https://discord.com/developers/applications',
    steps: [
      'In the same application, open "Bot" on the left.',
      'Turn on "Server Members Intent" and click "Save Changes".',
      'Click "Reset Token", confirm, and copy the token.',
    ],
    neededFor: 'Discord roles',
    targets: PLATFORM_TARGETS,
  },
  {
    name: 'LVBT_DISCORD_GUILD_ID',
    purpose: 'Names the LVBT Discord server.',
    use: 'future',
    url: 'https://discord.com/channels/@me',
    steps: [
      'In Discord, open User Settings (the gear by your name) → Advanced, and turn on "Developer Mode".',
      'Right-click the LVBT server icon on the left and click "Copy Server ID".',
    ],
    neededFor: 'Discord roles',
    targets: PLATFORM_TARGETS,
  },
  {
    name: 'LVBT_GOOGLE_SERVICE_ACCOUNT_KEY',
    purpose: 'Creates volunteer Workspace accounts and manages Google Group membership.',
    use: 'future',
    url: 'https://console.cloud.google.com/iam-admin/serviceaccounts',
    steps: [
      'Choose the LVBT project at the top of the page.',
      'Turn on the Admin SDK: open https://console.cloud.google.com/apis/library/admin.googleapis.com and click "Enable".',
      'Back on Service Accounts, click "Create service account", name it "lvbt-website-admin", click "Create and continue", skip roles, and click "Done".',
      'Click the new account. On "Details", copy the "Unique ID" (a long number).',
      'Open "Keys" → "Add key" → "Create new key" → JSON → "Create". A .json file downloads.',
      'Open https://admin.google.com/ac/owl/domainwidedelegation → "Add new". Client ID: the Unique ID. OAuth scopes: https://www.googleapis.com/auth/admin.directory.user,https://www.googleapis.com/auth/admin.directory.group. Click "Authorize".',
      'Open the downloaded .json file in a text editor, select all, copy, and paste it here. Then delete the file.',
    ],
    neededFor: 'Volunteer management',
    targets: PLATFORM_TARGETS,
    validate: (value) =>
      value.trim().startsWith('{') ? undefined : 'Paste the whole JSON key file.',
  },
  {
    name: 'LVBT_GOOGLE_ADMIN_SUBJECT',
    purpose: 'The Workspace admin the service account acts as.',
    use: 'future',
    url: 'https://admin.google.com/ac/users',
    steps: [
      'Enter the email address of an LVBT Workspace super admin, such as your own @lasvegasfortransit.org address.',
    ],
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
    use: 'future',
    url: 'https://givebutter.com/dashboard',
    steps: [
      'Sign in to Givebutter as an Admin.',
      'Go to Settings → Integrations → API Keys.',
      'Click "Create New API Key", name it "LVBT website", and copy the key. It is shown only once.',
    ],
    neededFor: 'Donor support',
    targets: PLATFORM_TARGETS,
  },
];

/** Steps no secret captures. Bootstrap cannot do these for you. */
export const PLATFORM_MANUAL_STEPS: readonly string[] = [
  'gh auth refresh -h github.com -s read:packages, so installs can read @lasvegasfortransit/analytics from GitHub Packages.',
];
