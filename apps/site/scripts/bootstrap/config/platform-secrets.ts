/* eslint-disable max-lines -- one data entry per secret, each with its click-by-click steps; splitting it would scatter the list. */
// Every server-side secret the website and the Organizing Platform need, where
// each one comes from, and where it must be stored. `pnpm bootstrap --phase
// secrets` reads this list: it reports what is missing, asks for each value
// once, and writes it to every target. See
// docs/reference/platform-secrets.md for the same list in prose.
//
// Everything LVBT owns in another service lives under an LVBT organization,
// team or group, never a personal account, so the next maintainer can reach
// it. The steps below say which one for each service.
//
// Write every step list so each copied value is pasted where it goes (this
// prompt, a dashboard field, a file or a browser) before anything else is
// copied; when a value goes to two places, paste it into both first. Each
// list ends with the one copy its own prompt needs.

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

/**
 * A setup step that must be done before a secret can exist, and that
 * bootstrap cannot check for itself. After showing the secret's own steps,
 * bootstrap asks the question and remembers a "yes" in
 * .lvbt/dev-readiness.json, so it never asks again. `steps` is only for a
 * step the secret's own steps do not already cover.
 */
export interface GuidedStep {
  /** Stable key the confirmation is remembered under. */
  id: string;
  title: string;
  url?: string;
  steps?: readonly string[];
  /** Yes/no question asked before the value is. */
  question: string;
}

export interface PlatformSecret {
  name: string;
  /** What the value is for, in one plain sentence. */
  purpose: string;
  use: SecretUse;
  /**
   * When it is fine to leave the value empty for now, and what stays broken
   * until it is set. `future` secrets without one get the generic note; an
   * empty string means the steps already say it.
   */
  skipNote?: string;
  /** The page to open first. Bootstrap offers to open it in the browser. */
  url?: string;
  /** Numbered, click-by-click steps to find or create the value. */
  steps?: readonly string[];
  /** Must be done before a typed value can exist; asked about once. */
  prerequisite?: GuidedStep;
  /**
   * False for values that are not credentials: IDs, domains, public keys and
   * addresses that anyone can see anyway. Bootstrap asks for them in plain
   * view and shows them back so they can be checked. Everything else is
   * asked for with hidden input and never shown. Defaults to true.
   */
  sensitive?: boolean;
  /** Minted by bootstrap instead of asked for. */
  generate?: boolean;
  /**
   * Nothing reads this yet, so bootstrap lists it in its report but never
   * asks for it, and --rotate refuses it. Remove the flag when a feature
   * starts using the value.
   */
  listOnly?: boolean;
  /** Extra step after setting, for values that must also live elsewhere. */
  afterSet?: string;
  /** Which feature needs it, so the report can say what stays blocked. */
  neededFor: string;
  targets: readonly SecretTarget[];
  validate?: (value: string) => string | undefined;
}

export const FUTURE_SKIP_NOTE =
  'Only a feature that is not built yet uses this, so it is fine to leave it empty now. Bootstrap asks again next time.';

/** Whether a value is a credential that must be hidden. */
export function isSensitive(secret: PlatformSecret): boolean {
  return secret.sensitive !== false;
}

/** The "fine to skip?" note bootstrap shows next to a secret's prompt. */
export function skipNoteFor(secret: PlatformSecret): string {
  return secret.skipNote ?? (secret.use === 'future' ? FUTURE_SKIP_NOTE : '');
}

const minLength = (length: number) => (value: string) =>
  value.length < length ? `Expected at least ${length} characters.` : undefined;

const INTAKE_TARGETS = ['pages', 'worker', 'github:worker-candidate'] as const;
const PLATFORM_TARGETS = ['pages', 'worker'] as const;

const STAFF_CONSOLE_SKIP =
  'The staff console is not live yet. You can leave this empty now; bootstrap asks again next time.';

const DISCORD_SKIP =
  'Discord linking and roles are not built yet, so it is fine to leave this empty now; bootstrap asks again next time.';

const GOOGLE_SIGN_IN_SKIP =
  'Staff and volunteer sign-in with Google is not built yet, so it is fine to leave this empty now. Bootstrap asks again next time.';

// Cloudflare and GitHub never show a stored secret again, so a random signing
// key that exists on some targets but not others cannot be copied. The fix
// is a fresh value everywhere.
const regenerateSteps = (name: string, consequence: string): readonly string[] => [
  'You only see this if the value is already stored somewhere, or a target could not be checked. Cloudflare and GitHub never show a stored secret again, so there is nothing to copy.',
  `Leave this prompt empty. If a target could not be checked, fix the sign-in and run bootstrap again. Otherwise run \`pnpm bootstrap --phase secrets --rotate ${name}\` to make a new value and store it everywhere. ${consequence}`,
];

// Part 1 of the LVBT_ACCESS_AUD steps checks this group.
const STAFF_CONSOLE_GROUP: GuidedStep = {
  id: 'staff-google-group',
  title: 'The Staff Google Group (part 1)',
  url: 'https://admin.google.com/ac/groups',
  steps: [
    "Cloudflare Access uses LVBT's existing Staff group, staff@lasvegasfortransit.org — everyone on the team, not a group made for this. At https://admin.google.com, go to Directory → Groups and open Staff.",
    'Check it before relying on it: Members should be the LVBT team only, all @lasvegasfortransit.org, nobody who should not see member data. Under "Access settings", "Who can join the group" should be "Only invited users" and "Allow members outside your organization" should be off. Add yourself if you are not already a member, so "Test" can show the group later.',
    'If the group does not exist: click "Create group". Group name "Staff", Group email "staff", Description "LVBT staff". Create it, then add members the same way.',
  ],
  question: 'Is part 1 done: are you in the Staff group (staff@lasvegasfortransit.org)?',
};

export const PLATFORM_SECRETS: readonly PlatformSecret[] = [
  {
    name: 'LVBT_RESEND_API_KEY',
    purpose:
      'Lets the site send email, such as sign-in codes, confirmations and reminders, from notify.lasvegasfortransit.org through Resend.',
    use: 'live',
    skipNote:
      'Skip only if you cannot finish the Resend setup today: member sign-in and reminder emails do not send until this is set.',
    url: 'https://resend.com/domains',
    steps: [
      'Sign in at https://resend.com/login with your @lasvegasfortransit.org address. LVBT keeps one Resend team: if you are new, ask a maintainer to invite you to it rather than making your own. Only if LVBT has no Resend team at all, sign up at https://resend.com/signup with your @lasvegasfortransit.org address.',
      'On the Domains page, look for notify.lasvegasfortransit.org. If its status says "Verified", skip to the step about the API key. If it is listed but not verified, open it and skip to the step about DNS records.',
      'Otherwise click "Add Domain". Type notify.lasvegasfortransit.org. For Region choose "North Virginia (us-east-1)". Click "Add".',
      'Resend now lists the DNS records the domain needs. The easiest way to add them is to click "Sign in to Cloudflare" on that page, choose the LVBT account ("Las Vegans for Better Transit"), and approve. Resend adds the records for you.',
      'To add them by hand instead, open https://dash.cloudflare.com → lasvegasfortransit.org → DNS → Records and click "Add record" once for each record Resend lists, finishing one record before you start the next: choose its type, copy its name from Resend and paste it into the Name box in Cloudflare, then copy its content (or mail server) from Resend and paste it into the matching box in Cloudflare, set TTL "Auto" and Proxy status "DNS only", and click "Save". Because this is a subdomain the names end in .notify; Cloudflare adds .lasvegasfortransit.org by itself, so do not type that part. Today they are: MX named send.notify with mail server feedback-smtp.us-east-1.amazonses.com and priority 10; TXT named send.notify with content v=spf1 include:amazonses.com ~all; and TXT named resend._domainkey.notify with the long p=... value Resend shows.',
      'Resend also recommends a DMARC record: TXT with content v=DMARC1; p=none;. In the Cloudflare records list, check for a TXT record named _dmarc first. If lasvegasfortransit.org already has one, keep it and skip this record, because it covers notify.lasvegasfortransit.org too. If there is none, add it with the name Resend shows.',
      'Back in Resend, click "Verify DNS Records" and wait until the status says "Verified". That usually takes a few minutes; DNS can take up to 72 hours. If it is still waiting, leave this prompt empty and run bootstrap again later.',
      'Open https://resend.com/api-keys and click "Create API Key". Name: LVBT website. Permission: "Sending access". Domain: notify.lasvegasfortransit.org. Click "Add".',
      'Copy the key and paste it here. It starts with re_ and Resend shows it only once.',
    ],
    neededFor: 'Member sign-in, event reminders',
    targets: PLATFORM_TARGETS,
    validate: (value) => (value.startsWith('re_') ? undefined : 'Expected a key starting re_.'),
  },
  {
    name: 'LVBT_BEEHIIV_API_KEY',
    purpose:
      "Lets the site add new members to LVBT's newsletter in Beehiiv and read changes to their subscription.",
    use: 'live',
    skipNote:
      'Skip only if you cannot sign in to Beehiiv today: joining and newsletter signup fail until this is set.',
    url: 'https://app.beehiiv.com/settings/workspace/api',
    steps: [
      'Sign in to Beehiiv as an Owner or Admin of the LVBT workspace.',
      'Under "API Keys", click "Create New API Key".',
      'Name it "LVBT website" and click "Create New Key".',
      'Copy the key now and paste it here. Beehiiv shows it only once. Then click "I\'ve saved the key".',
    ],
    neededFor: 'Joining, newsletter signup, mailing list sync',
    targets: INTAKE_TARGETS,
    validate: minLength(20),
  },
  {
    name: 'LVBT_BEEHIIV_PUBLICATION_ID',
    purpose: "Tells Beehiiv which publication, LVBT's newsletter, the site's requests are about.",
    use: 'live',
    sensitive: false,
    skipNote:
      'Skip only if you cannot sign in to Beehiiv today: joining and newsletter signup fail until this is set.',
    url: 'https://app.beehiiv.com/settings/workspace/api',
    steps: [
      'On the same Beehiiv API page, find "Publication ID".',
      'Copy it and paste it here. It starts with pub_; for LVBT it is pub_d3178023-f8d5-4e9d-a768-0c4eaa6b7280.',
    ],
    neededFor: 'Joining, newsletter signup, mailing list sync',
    targets: INTAKE_TARGETS,
    validate: (value) => (value.startsWith('pub_') ? undefined : 'Expected an ID starting pub_.'),
  },
  {
    name: 'LVBT_MEMBERSHIP_INTAKE_SECRET',
    purpose:
      "Proves that a membership sign-up came from LVBT's Google Form, so no one else can post sign-ups to the site.",
    use: 'live',
    skipNote:
      'Skip only if you cannot open the Apps Script project today: sign-ups from the Google Form and other connected form tools fail until this is set.',
    url: 'https://script.google.com/home',
    steps: [
      'This must be the value the Google Form already uses. Do not make up a new one, or the form stops working.',
      'Open the Apps Script project attached to the LVBT membership Google Form. From the form, that is the ⋮ menu → "Apps Script".',
      'Click "Project Settings", the gear icon on the left.',
      'Scroll to "Script Properties", copy the value of LVBT_MEMBERSHIP_INTAKE_SECRET, and paste it here.',
    ],
    neededFor: 'The Google Form fallback',
    targets: INTAKE_TARGETS,
    validate: minLength(20),
  },
  {
    name: 'LVBT_NOTION_API_KEY',
    purpose:
      "Lets the site write each new member and each transit news submission into LVBT's Notion workspace for staff follow-up.",
    use: 'live',
    skipNote:
      'Skip only if you cannot reach Notion today: staff do not see new members or transit news submissions in Notion until this is set.',
    url: 'https://www.notion.so/profile/integrations',
    steps: [
      'Sign in to Notion as an owner of the LVBT workspace.',
      'Click the integration connected to the Membership intake database. To check its name, open https://www.notion.so/6bad03ffdebf4072a34a6408d3e7180d → ••• → Connections.',
      'Under "Internal Integration Secret", click "Show", then "Copy", and paste it here. It starts with ntn_.',
    ],
    neededFor: 'Joining (staff follow-up), transit news intake',
    targets: INTAKE_TARGETS,
    validate: minLength(20),
  },
  {
    name: 'LVBT_NOTION_DATA_SOURCE_ID',
    purpose:
      'Tells Notion which table, the Membership intake data source, new members are written to.',
    use: 'live',
    sensitive: false,
    skipNote:
      'Skip only if you cannot reach Notion today: staff do not see new members in Notion until this is set.',
    url: 'https://www.notion.so/6bad03ffdebf4072a34a6408d3e7180d',
    steps: [
      'Open the Membership intake database.',
      'Click ••• → "Copy data source ID" and paste it here. For LVBT it is 6e3df57f-d336-4c0c-a814-a0be68c7f455.',
    ],
    neededFor: 'Joining (staff follow-up)',
    targets: INTAKE_TARGETS,
    validate: minLength(32),
  },
  {
    name: 'LVBT_TRANSIT_NEWS_INTAKE_SECRET',
    purpose: "Proves that a transit news submission came from LVBT's Notion automation.",
    use: 'live',
    skipNote:
      'Skip only if you cannot open the Notion automation today: transit news submissions fail until this is set.',
    generate: true,
    steps: [
      'Open the LVBT transit news automation in Notion and inspect its webhook action.',
      'Copy the value after "Bearer " in its Authorization header and paste that same value here.',
      'If the value is unavailable, leave this empty and run `pnpm bootstrap --phase secrets --rotate LVBT_TRANSIT_NEWS_INTAKE_SECRET`. It makes a new value, stores it on Pages, the Worker and GitHub together, and shows it once so you can paste it into the automation.',
    ],
    afterSet:
      'Paste the same value into the Notion transit news automation webhook header as "Authorization: Bearer <value>".',
    neededFor: 'Transit news intake',
    targets: INTAKE_TARGETS,
  },
  {
    name: 'LVBT_SIGN_IN_SECRET',
    purpose:
      'Scrambles sign-in codes before they are stored, so a copy of the database cannot be used to sign in.',
    use: 'live',
    skipNote: 'Member sign-in does not work until this is set.',
    generate: true,
    steps: regenerateSteps(
      'LVBT_SIGN_IN_SECRET',
      'Anyone waiting for a sign-in code at that moment must ask for a new one.',
    ),
    neededFor: 'Member sign-in',
    targets: PLATFORM_TARGETS,
  },
  {
    name: 'LVBT_LINK_SIGNING_SECRET',
    purpose:
      'Signs one-purpose links, such as "Not you? Remove this email", so no one can forge them.',
    use: 'live',
    skipNote: 'Joining and sign-in links do not work until this is set.',
    generate: true,
    steps: regenerateSteps(
      'LVBT_LINK_SIGNING_SECRET',
      'Links already sent by email stop working, so people use the newest email instead.',
    ),
    neededFor: 'Joining (removal link), member sign-in links',
    targets: PLATFORM_TARGETS,
  },
  {
    name: 'LVBT_GOOGLE_OAUTH_CLIENT_ID',
    purpose:
      'Identifies the website\'s own "Sign in with Google" button to Google, for staff and volunteers.',
    use: 'future',
    sensitive: false,
    skipNote: GOOGLE_SIGN_IN_SKIP,
    url: 'https://console.cloud.google.com/auth/clients?project=lvbt-core',
    steps: [
      'Sign in with an LVBT Workspace admin account and choose the "LVBT Core" project (ID lvbt-core) in the project picker at the top. Every LVBT Google integration lives in that one project; create it with that name only if it does not exist (click "New project", name it LVBT Core, keep the organization lasvegasfortransit.org, click "Create"). Dismiss any "Start your Free Trial" banner: none of this needs billing.',
      'Open https://console.cloud.google.com/auth/overview?project=lvbt-core. If the Clients page says "Google Auth Platform not configured yet", click "Get started" and complete the four steps. App Information: App name "Las Vegans for Better Transit", User support email tech@lasvegasfortransit.org (a shared LVBT address, never a person\'s), then "Next". Audience: "Internal" — every Google sign-in in this project is for @lasvegasfortransit.org accounts, so it needs no Google verification and blocks personal Gmail; it can change later under Audience → "Make external" if members ever get Google sign-in. Click "Next". Contact Information: tech@lasvegasfortransit.org, then "Next". Finish: tick the box agreeing to the Google API Services: User Data Policy, click "Continue", then "Create". Optional: under "Branding", upload the square LVBT logo from the "Marketing & Communications" shared drive as the App logo. Then open "Clients" again.',
      'Open https://console.cloud.google.com/auth/branding?project=lvbt-core. "App logo": if it is empty, upload the square LVBT logo from the "Marketing & Communications" shared drive in Google Drive (a square PNG under 1 MB; 120 by 120 pixels shows best). "Application home page": https://lasvegasfortransit.org. Leave the privacy policy and terms of service links empty; Google requires them only for public apps. Under "Authorized domains", click "Add domain" and enter lasvegasfortransit.org if it is not listed, because Google accepts sign-in addresses only on these domains. Click "Save".',
      'Skip the "Audience" and "Data Access" pages. Signing in uses only the basic email, profile and openid permissions, which need no setup.',
      'Open https://console.cloud.google.com/auth/clients?project=lvbt-core. If a client named "LVBT website" is listed, open it and skip to the last step.',
      'Otherwise click "Create client". Application type: "Web application". Name: LVBT website. Leave "Authorized JavaScript origins" empty; the website signs people in from its server. Under "Authorized redirect URIs", click "Add URI" and enter exactly https://lasvegasfortransit.org/auth/google/callback. Click "Create".',
      'Copy the Client ID and paste it here. It ends with .apps.googleusercontent.com. If you just created the client, keep its dialog open: the next prompt asks for its Client secret, which Google shows only now.',
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
    purpose:
      'Proves to Google that sign-in requests come from the LVBT website and not from someone reusing its client ID.',
    use: 'future',
    skipNote: GOOGLE_SIGN_IN_SKIP,
    url: 'https://console.cloud.google.com/auth/clients?project=lvbt-core',
    steps: [
      'In the dialog from the last step, copy the Client secret and paste it here.',
      'If you closed it: Google shows a secret only once. On the Clients page of the "LVBT Core" project, click the "LVBT website" client, click "Add secret" under Client secrets, then copy the new secret and paste it here.',
    ],
    neededFor: 'Staff and volunteer sign-in',
    targets: PLATFORM_TARGETS,
    validate: minLength(20),
  },
  {
    name: 'LVBT_ACCESS_TEAM_DOMAIN',
    purpose:
      'The address Cloudflare Access signs people in at; the staff console checks that sign-ins come from it.',
    use: 'future',
    sensitive: false,
    skipNote: STAFF_CONSOLE_SKIP,
    url: 'https://one.dash.cloudflare.com/',
    steps: [
      'Sign in to Cloudflare and choose the LVBT account ("Las Vegans for Better Transit"). The page that opens is Cloudflare One (Cloudflare used to call it Zero Trust).',
      'If Cloudflare asks you to set up Cloudflare One first: it asks for a team domain. Type lvbt, so the team domain becomes lvbt.cloudflareaccess.com, and choose the Free plan. The team name it may also ask for is only a label; use "Las Vegans for Better Transit".',
      'On the Overview page, find "Account details". It shows two different things: "Team domain" (lvbt.cloudflareaccess.com) and "Team name" (a label). This value is the team domain.',
      'Do not change the team domain with its pencil icon. Changing it breaks Access sign-in and Google sign-in until every copy of this value and the Google OAuth client are updated to match.',
      'Click the copy icon next to "Team domain" and paste it here: lvbt.cloudflareaccess.com, without https://.',
    ],
    neededFor: 'Staff console',
    targets: PLATFORM_TARGETS,
    validate: (value) =>
      value.endsWith('.cloudflareaccess.com') ? undefined : 'Expected <team>.cloudflareaccess.com.',
  },
  {
    name: 'LVBT_ACCESS_AUD',
    purpose:
      "Tells the staff console which Cloudflare Access application guards it, so it accepts only that application's sign-ins.",
    use: 'future',
    sensitive: false,
    // The first step says when it is fine to skip.
    skipNote: '',
    url: 'https://one.dash.cloudflare.com/',
    prerequisite: STAFF_CONSOLE_GROUP,
    steps: [
      'The staff console is not live yet. You can leave this empty now; bootstrap asks again next time. The value only exists once the Access application below is created. That takes about 20 minutes and needs a Google Workspace super admin. Do the parts in order; each needs the one before it.',
      'Part 1 is the Staff Google Group above. Confirm it before going on.',
      'Part 2, let Google trust LVBT\'s own sign-in apps. At https://admin.google.com, go to Security → Access and data control → API controls. Under "Settings", tick "Trust internal apps" and click "Save". Without it, Google can refuse the Cloudflare sign-in.',
      'Part 3, a Google sign-in client for Cloudflare. Open https://console.cloud.google.com/apis/library/admin.googleapis.com?project=lvbt-core and click "Enable" if it does not already say "API Enabled". Cloudflare uses this Admin SDK API to read group membership.',
      'In another tab, open Cloudflare One → Integrations → Identity providers — not "Cloud & SaaS" just above it: that is a different feature that asks for a service account, so leave it alone. (Press ⌘K or Ctrl+K and search "Identity providers" if the sidebar hides it.) If "Google Workspace" is already listed, skip to the "Test" step below. Otherwise click "Add new identity provider", then "Google Workspace". Name: "Google Workspace". Keep this tab open; the callback URL it shows, https://lvbt.cloudflareaccess.com/cdn-cgi/access/callback, is what the Google client uses next.',
      'In the Google Cloud tab, open https://console.cloud.google.com/auth/clients?project=lvbt-core and click "Create client". Application type "Web application", Name "Cloudflare Access". Under "Authorized JavaScript origins", click "Add URI" and enter https://lvbt.cloudflareaccess.com. Under "Authorized redirect URIs", click "Add URI" and enter https://lvbt.cloudflareaccess.com/cdn-cgi/access/callback. Click "Create". Leave the dialog showing the Client ID and Client secret open.',
      'Back on the Cloudflare tab, copy the Client ID from the Google dialog and paste it into "Client ID" (an older Cloudflare UI calls this "App ID"). Then copy the Client secret and paste it into "Client secret". Google Workspace domain: lasvegasfortransit.org.',
      'Proof Key for Code Exchange (PKCE): leave it on. Enable SCIM: leave it off, along with "Enable user deprovisioning" and "Remove user seat on deprovision", and leave the SCIM identity update behavior as "No action" — Google Workspace only sends SCIM to a handful of apps in its own catalog, and Cloudflare does not document SCIM support for Google Workspace at all; Access re-checks group membership every sign-in instead. Leave the email claim and OIDC Claims fields empty.',
      'Click "Save" (allow the Google prompt with your LVBT admin account if it asks), then click "Test" next to Google Workspace. It should show your LVBT address and list staff@lasvegasfortransit.org among your groups. If the group is missing, re-check part 1 and the Admin SDK API in part 3.',
      'Part 4, the application. In Cloudflare One, open Access controls → Applications. If "LVBT staff console" is listed, click it, open "Configure", and skip to the cookie settings step.',
      'Otherwise click "Create new application" at the top right; an account with no applications yet shows only a prerequisites list, which you have now done. In the dialog, choose "Self-hosted and private", then the "Public DNS" tab (not "Private destinations"), then "Continue with Self-hosted and private".',
      'Under "Destinations", the Subdomain box starts empty — leave it empty and the application puts all of lasvegasfortransit.org behind Google sign-in, not just the staff console. Fill in one public hostname: Subdomain "staff", Domain "lasvegasfortransit.org" from the dropdown, Path empty, and add no other destination ("Add private hostname", "Add private IP" and "Add Workers" all stay unused). If lasvegasfortransit.org is not in the domain list, you are in the wrong Cloudflare account; switch to the LVBT account and start part 4 again. Leave "Allow access through browser-based RDP, SSH, or VNC sessions" off.',
      'Under "Access policies", click "Create new policy". Policy Name "LVBT staff" (any clear name is fine). Action "Allow". Policy session duration "Same as application session duration". Include: "Google Groups" = staff@lasvegasfortransit.org. Click "+ Add require (AND)" and add "Emails ending in" = @lasvegasfortransit.org, as a second check. Leave "Override global multi-factor authentication settings (MFA)" and "Just-in-time access" off — 2-Step Verification belongs in Google, not here (see the Staff group step). Save the policy. If "Google Groups" is not offered, the Google sign-in step above is not finished.',
      'Under "Authentication" (Identity tab), turn off "Accept all available identity providers", choose "Google Workspace" in "Choose available identity providers", and turn on "Apply instant authentication". Leave "Authenticate with Cloudflare One Client" off.',
      'Under "Details", set Name to "LVBT staff console" and Session Duration to "24 hours". Click "Create".',
      'Open the application\'s "Configure" page, then "Additional settings" → "Cookie settings", and turn on "Enable Binding Cookie". Leave "HTTP Only" on and "SameSite" set to "Lax".',
      'Still under "Additional settings", copy "Application Audience (AUD) Tag", a long string of letters and numbers, and paste it here. It is not secret — every Access token carries it — which is why bootstrap shows it.',
    ],
    neededFor: 'Staff console',
    targets: PLATFORM_TARGETS,
    validate: minLength(32),
  },
  {
    name: 'LVBT_DISCORD_APPLICATION_ID',
    purpose:
      "Identifies LVBT's Discord app, LVBT Bot, which will link members' Discord accounts and manage their roles.",
    use: 'future',
    sensitive: false,
    skipNote:
      'Discord linking and roles are not built yet. You can leave this and the next four Discord values empty now; bootstrap asks again next time.',
    url: 'https://discord.com/developers/teams',
    steps: [
      'The app belongs to an LVBT team, not to one person, so the next maintainer can manage it. Open https://discord.com/developers/teams while signed in to Discord.',
      'If "Las Vegans for Better Transit" is under "My Teams", you are already in the team; go to the next step. If the team exists but you are not in it, ask someone in it to invite you from the team\'s page. If there is no team at all, click "New Team", name it "Las Vegans for Better Transit" and click "Create". Every team member has admin rights over the team\'s apps, so add only trusted maintainers. Discord may ask you to turn on two-factor authentication.',
      'Give the team the LVBT logo if its page offers an icon: in Google Drive, open the shared drive "Marketing & Communications", find the square LVBT logo (a PNG at least 512 by 512 pixels), download it and upload it as the team icon. Skip this if you cannot reach that drive.',
      'Open https://discord.com/developers/applications. If an "LVBT Bot" app is listed under the team, click it and go to the last step.',
      'Otherwise click "+ Create" at the top, then "Create blank app" (ignore the game and bot templates). Name: "LVBT Bot". Team: "Las Vegans for Better Transit", not "Personal". Tick the box agreeing to the Discord Developer Terms of Service and Developer Policy, then click "Create". If LVBT already has an app on someone\'s Personal team, move it to the team instead of making a second one.',
      'On the app\'s "General Information" page, under "App Icon", upload the same square LVBT logo from the Marketing & Communications shared drive and click "Save Changes". Discord shows this icon on the bot and on the "Connect Discord" screen.',
      'On the same page, copy the Application ID (a long number) and paste it here.',
    ],
    neededFor: 'Discord linking and roles',
    targets: PLATFORM_TARGETS,
  },
  {
    name: 'LVBT_DISCORD_PUBLIC_KEY',
    purpose: 'Lets the site check that a Discord command request really came from Discord.',
    use: 'future',
    sensitive: false,
    skipNote: DISCORD_SKIP,
    url: 'https://discord.com/developers/applications',
    steps: [
      'Skip this if you skipped the Application ID.',
      'In the LVBT Bot app, on "General Information", copy the Public Key (a long string of letters and numbers) and paste it here.',
    ],
    neededFor: 'Discord link command',
    targets: PLATFORM_TARGETS,
  },
  {
    name: 'LVBT_DISCORD_CLIENT_SECRET',
    purpose: 'Lets the site finish "Connect Discord", when a member links their Discord account.',
    use: 'future',
    skipNote: DISCORD_SKIP,
    url: 'https://discord.com/developers/applications',
    steps: [
      'Skip this if you skipped the Application ID.',
      'In the LVBT Bot app, open "OAuth2" on the left.',
      'Leave "Public Client" off. It is for apps without a server, such as phone apps, that cannot keep the client secret private; the website keeps it on the server.',
      'Under "Redirects", click "Add Redirect", enter https://lasvegasfortransit.org/account/discord/callback and click "Save Changes".',
      'Under "Client Secret", click "Reset Secret", confirm, copy it and paste it here. Discord shows it only once. Resetting it later breaks "Connect Discord" until the new one is stored here.',
    ],
    neededFor: 'Discord linking',
    targets: PLATFORM_TARGETS,
  },
  {
    name: 'LVBT_DISCORD_BOT_TOKEN',
    purpose: 'Lets the website give and remove LVBT-managed roles in the Discord server.',
    use: 'future',
    skipNote: DISCORD_SKIP,
    url: 'https://discord.com/developers/applications',
    steps: [
      'Skip this if you skipped the Application ID.',
      'In the LVBT Bot app, open "Bot" on the left.',
      'Icon: upload the square LVBT logo from the "Marketing & Communications" shared drive (1024 by 1024, PNG). Banner is optional: use the 680 by 240 LVBT banner if the drive has one. Username: "LVBT Bot".',
      'Under "Authorization Flow", turn "Public Bot" off, so only the team can add the bot to a server. Leave "Requires OAuth2 Code Grant" and "Private Channel Obfuscation" off.',
      'Under "Privileged Gateway Intents", turn "Server Members Intent" on (the website uses it to look up who is in the server). Leave "Presence Intent" and "Message Content Intent" off. Click "Save Changes".',
      'The "Bot Permissions" box further down is only a calculator; leave it. The bot gets its one permission when it is installed, in the next step. "App Verification" on the left only matters once a bot is in 100 or more servers; ignore it.',
      'Open "Installation" on the left. Under installation contexts, keep only "Guild Install". Under its default install settings, add the scopes "bot" and "applications.commands" and the permission "Manage Roles", and save.',
      'Copy the install link on that page and paste it into your browser\'s address bar, choose the LVBT server and click "Authorize". You need the "Manage Server" permission in that server.',
      'In Discord, open the LVBT server\'s Server Settings → Roles and drag the "LVBT Bot" role above every role the website gives out. A bot can only give roles below its own.',
      'Back on "Bot", click "Reset Token", confirm, copy the token and paste it here. Discord shows it only once; treat it like a password. Resetting it later stops role changes until the new one is stored here.',
    ],
    neededFor: 'Discord roles',
    targets: PLATFORM_TARGETS,
  },
  {
    name: 'LVBT_DISCORD_GUILD_ID',
    purpose: "Tells the site which Discord server is LVBT's.",
    use: 'future',
    sensitive: false,
    skipNote: DISCORD_SKIP,
    url: 'https://discord.com/channels/@me',
    steps: [
      'Skip this if you skipped the Application ID.',
      'In the Discord app, open User Settings (the gear by your name) → Advanced, and turn on "Developer Mode".',
      'Right-click the LVBT server icon on the left and click "Copy Server ID" (a long number), and paste it here.',
    ],
    neededFor: 'Discord roles',
    targets: PLATFORM_TARGETS,
  },
  {
    name: 'LVBT_GOOGLE_SERVICE_ACCOUNT_KEY',
    purpose:
      'Lets the website create volunteer Workspace accounts and manage Google Group membership, acting as a Workspace admin.',
    use: 'future',
    listOnly: true,
    url: 'https://console.cloud.google.com/iam-admin/serviceaccounts?project=lvbt-core',
    steps: [
      'Skip this: leave it empty. Nothing uses it yet; it is for volunteer management, which is not built.',
      'Do not create a service account key, and do not turn off the "Disable service account key creation" organization policy (iam.disableServiceAccountKeyCreation) to make one. Google enforces it by default because a leaked key file gives full control of whatever it can reach, here LVBT\'s Workspace users and groups.',
      'When volunteer management is built, it will use Workload Identity Federation from a GitHub Actions job, which needs no key file at all. Until then, a Workspace admin adds and removes people in https://admin.google.com by hand.',
    ],
    neededFor: 'Volunteer management',
    targets: PLATFORM_TARGETS,
    validate: (value) =>
      value.trim().startsWith('{') ? undefined : 'Paste the whole JSON key file.',
  },
  {
    name: 'LVBT_GOOGLE_ADMIN_SUBJECT',
    purpose:
      'The Workspace super-admin account the website acts as when it manages volunteer accounts and groups.',
    use: 'future',
    sensitive: false,
    listOnly: true,
    url: 'https://admin.google.com/ac/users',
    steps: [
      'Skip this for now: leave it empty. It pairs with LVBT_GOOGLE_SERVICE_ACCOUNT_KEY, which nothing uses yet.',
      "When volunteer management is built, use the organization's own root super-admin account, not a person's. At LVBT that is root@lasvegasfortransit.org. A person's admin address is the wrong choice: if they leave or lose admin rights, every change the website makes stops working, and the audit log would show the website's changes as theirs.",
    ],
    neededFor: 'Volunteer management',
    targets: PLATFORM_TARGETS,
    validate: (value) =>
      /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim()) ? undefined : 'Expected an email address.',
  },
  {
    name: 'LVBT_GIVEBUTTER_API_KEY',
    purpose: 'Lets the site read donations so staff can see giving next to everything else.',
    use: 'future',
    url: 'https://givebutter.com/dashboard',
    steps: [
      'Sign in to Givebutter as an Admin of the LVBT account.',
      'Go to Settings → Integrations → API Keys.',
      'Click "Create New API Key", name it "LVBT website", copy the key and paste it here. It is shown only once.',
    ],
    neededFor: 'Donor support',
    targets: PLATFORM_TARGETS,
  },
];

/** Steps no secret captures. Bootstrap cannot do these for you. */
export const PLATFORM_MANUAL_STEPS: readonly string[] = [
  'gh auth refresh -h github.com -s read:packages, so installs can read @lasvegasfortransit/analytics from GitHub Packages.',
];
