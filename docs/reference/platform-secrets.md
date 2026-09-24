# Platform secrets

This page lists every server-side secret the website and the Organizing Platform use, what each one is for, and where to get it. Read it when you set up a new deployment, rotate a key, or see a `503 service_unavailable` that names a missing secret.

A secret is a value, such as an API key, that lets the site act on LVBT's behalf in another service. Secrets are never committed. They are stored in Cloudflare and GitHub, and the site reads them at request time (see the [glossary](./glossary.md#env-var)).

## Set them with bootstrap

You don't need to set secrets by hand. Run:

```sh
pnpm bootstrap --phase secrets
```

It checks the production Worker, the Pages fallback, and the `worker-candidate` GitHub environment. Missing values are grouped by urgency: live features and features not yet built. Choose how far to go. Two values that no feature reads yet, for volunteer management, are listed under "Not asked for" and never asked for; see [Google service account](#google-service-account).

For each value, the guide shows what it is for, whether it is fine to skip it for now, where bootstrap stores it, and click-by-click steps to find or create it. You paste the value once and bootstrap stores it on every target that is missing it. Random signing keys are generated only when every target is known to be empty. If a shared secret already exists or a target cannot be checked, the guide asks for the existing value instead. Leave a prompt empty to skip that secret; re-run the command later to finish.

Credentials, such as API keys, tokens and signing secrets, are typed into hidden input and never shown. Values that are not credentials, such as IDs, domains and public keys, are typed in plain view so you can see what you pasted, and the report shows them back so you can check them. Cloudflare and GitHub never show a stored value again, so the report shows the value bootstrap last stored from your machine, which it keeps in `.lvbt/dev-readiness.json`; if it has none, it says so. Credentials are never kept there. The "Credential" column below says which is which.

Running the command again is always safe. It never asks for a secret that is already stored, never replaces one, and never generates a new value for a key that exists. When every secret is in place it prints the report and stops.

To only see the report, without changing anything:

```sh
pnpm bootstrap --doctor --phase secrets
```

**Before you start:** sign in to Wrangler (`pnpm exec wrangler login`) and to GitHub (`gh auth login`). You need Cloudflare access to the LVBT account and admin access to the website repository.

## Replace a secret on purpose

To replace a value that is already set, for example after a key leaked or after you reset it in the other service, name it with `--rotate` (see [glossary](./glossary.md#rotate)):

```sh
pnpm bootstrap --phase secrets --rotate LVBT_RESEND_API_KEY
pnpm bootstrap --phase secrets --rotate LVBT_SIGN_IN_SECRET,LVBT_LINK_SIGNING_SECRET
```

Bootstrap first checks that it can read every place the secret is stored, so a shared value is never left different in different places. Then it asks for the new value, or generates one for the random signing keys, and stores it everywhere. The old value stops working as soon as the new one is stored. A misspelled name is refused before anything runs.

## Where each secret lives

| Target                                | What it serves                                        |
| ------------------------------------- | ----------------------------------------------------- |
| Worker `lvbt-website`                 | Production site and candidate versions                |
| Pages project `lvbt-website`          | Emergency rollback at its `pages.dev` address         |
| GitHub environment `worker-candidate` | The workflow that uploads and deploys main candidates |

Pull request previews run on the separate `lvbt-website-preview` Worker without these secrets, so preview API routes answer `503` by design.

The copies in your own `.env.local` are only for your machine. The bootstrap never copies them to production; this phase is the only place production values come from.

## The secrets

The single source of truth is `scripts/bootstrap/config/platform-secrets.ts`. The table below mirrors it.

| Secret                            | Used for                                       | Credential | Needed    | Start here                                                         |
| --------------------------------- | ---------------------------------------------- | ---------- | --------- | ------------------------------------------------------------------ |
| `LVBT_RESEND_API_KEY`             | Member sign-in, event reminders                | Yes        | Now       | <https://resend.com/domains>                                       |
| `LVBT_BEEHIIV_API_KEY`            | Joining, newsletter signup, mailing list sync  | Yes        | Now       | <https://app.beehiiv.com/settings/workspace/api>                   |
| `LVBT_BEEHIIV_PUBLICATION_ID`     | Joining, newsletter signup, mailing list sync  | No         | Now       | <https://app.beehiiv.com/settings/workspace/api>                   |
| `LVBT_MEMBERSHIP_INTAKE_SECRET`   | The Google Form fallback                       | Yes        | Now       | <https://script.google.com/home>                                   |
| `LVBT_NOTION_API_KEY`             | Joining (staff follow-up), transit news intake | Yes        | Now       | <https://www.notion.so/profile/integrations>                       |
| `LVBT_NOTION_DATA_SOURCE_ID`      | Joining (staff follow-up)                      | No         | Now       | <https://www.notion.so/6bad03ffdebf4072a34a6408d3e7180d>           |
| `LVBT_TRANSIT_NEWS_INTAKE_SECRET` | Transit news intake                            | Yes        | Now       | Generated by bootstrap                                             |
| `LVBT_SIGN_IN_SECRET`             | Member sign-in                                 | Yes        | Now       | Generated by bootstrap                                             |
| `LVBT_LINK_SIGNING_SECRET`        | Joining (removal link), member sign-in links   | Yes        | Now       | Generated by bootstrap                                             |
| `LVBT_GOOGLE_OAUTH_CLIENT_ID`     | Staff and volunteer sign-in                    | No         | Later     | <https://console.cloud.google.com/auth/clients>                    |
| `LVBT_GOOGLE_OAUTH_CLIENT_SECRET` | Staff and volunteer sign-in                    | Yes        | Later     | <https://console.cloud.google.com/auth/clients>                    |
| `LVBT_ACCESS_TEAM_DOMAIN`         | Staff console                                  | No         | Later     | <https://one.dash.cloudflare.com/>                                 |
| `LVBT_ACCESS_AUD`                 | Staff console                                  | No         | Later     | <https://one.dash.cloudflare.com/>                                 |
| `LVBT_DISCORD_APPLICATION_ID`     | Discord linking and roles                      | No         | Later     | <https://discord.com/developers/teams>                             |
| `LVBT_DISCORD_PUBLIC_KEY`         | Discord link command                           | No         | Later     | <https://discord.com/developers/applications>                      |
| `LVBT_DISCORD_CLIENT_SECRET`      | Discord linking                                | Yes        | Later     | <https://discord.com/developers/applications>                      |
| `LVBT_DISCORD_BOT_TOKEN`          | Discord roles                                  | Yes        | Later     | <https://discord.com/developers/applications>                      |
| `LVBT_DISCORD_GUILD_ID`           | Discord roles                                  | No         | Later     | <https://discord.com/channels/@me>                                 |
| `LVBT_GOOGLE_SERVICE_ACCOUNT_KEY` | Volunteer management                           | Yes        | Not asked | Leave empty; see [Google service account](#google-service-account) |
| `LVBT_GOOGLE_ADMIN_SUBJECT`       | Volunteer management                           | No         | Not asked | Leave empty; see [Google service account](#google-service-account) |
| `LVBT_GIVEBUTTER_API_KEY`         | Donor support                                  | Yes        | Later     | <https://givebutter.com/dashboard>                                 |

"Now" means a feature on the live site uses it. "Later" means only a feature that isn't built yet does, so it is always fine to skip a "Later" value; bootstrap asks again next time. "Not asked" means nothing reads the value yet, so bootstrap lists it but never asks for it. Skipping a "Now" value leaves the feature in the "Used for" column broken until it is set. Bootstrap shows the click-by-click steps for each value, with the link, and offers to open the page in your browser.

## Set up each service from scratch

The sections below say how to create each value when the service has never been set up for LVBT. Bootstrap shows the same steps when it asks. Where something already exists, use it: the steps say what to look for first, so you never make a second copy. Whenever a step has you copy something, paste it where it goes (the bootstrap prompt, a dashboard field or your browser) before you copy anything else.

Everything LVBT owns in another service belongs to an LVBT organization, team or group, never to a personal account, so the next maintainer can reach it. The name is "Las Vegans for Better Transit" everywhere: the Cloudflare account (the LVBT account), the Resend and Discord teams, and the Cloudflare One team name. Everything on Google Cloud lives in one project, **LVBT Core** (ID `lvbt-core`), under the lasvegasfortransit.org organization; create a project with that name only if it does not exist. Where a service offers an icon, use the square LVBT logo from the "Marketing & Communications" shared drive in Google Drive.

Check the Cloudflare account's own name the first time you open its dashboard: press ⌘K (or Ctrl+K), search "Account Name", and open it. If it still shows an older name (such as "Las Vegas for Better…" — misspelled), correct it to "Las Vegans for Better Transit" and save. This is a display label only; it changes no ID, token or URL, so fixing it never breaks anything already configured.

### Resend: sending email

`LVBT_RESEND_API_KEY` lets the site send email, such as sign-in codes and reminders, from `notify.lasvegasfortransit.org`. It starts with `re_`.

1. Sign in at <https://resend.com/login> with your @lasvegasfortransit.org address. If you are new, ask a maintainer to invite you to the LVBT team. Only if LVBT has no Resend team at all, sign up at <https://resend.com/signup> with your @lasvegasfortransit.org address.
2. On the [Domains page](https://resend.com/domains), look for `notify.lasvegasfortransit.org`. If it says "Verified", skip to step 7.
3. Otherwise click **Add Domain**, type `notify.lasvegasfortransit.org`, choose the region **North Virginia (us-east-1)**, and click **Add**.
4. Resend lists the DNS records the domain needs (see [glossary](./glossary.md#dns)). The easiest way to add them is **Sign in to Cloudflare** on that page: choose the LVBT account ("Las Vegans for Better Transit") and approve.
5. To add them by hand, open the Cloudflare dashboard → `lasvegasfortransit.org` → DNS → Records, and add one record at a time: click **Add record**, choose the type, copy the record's name from Resend and paste it into the Name box, then copy its content (or mail server) and paste it into the matching box, set TTL "Auto" and Proxy status "DNS only", and click **Save** before starting the next record. Use each name exactly as Resend shows it; Cloudflare adds `.lasvegasfortransit.org` by itself. Today the records are an MX record (mail server) named `send.notify` pointing to `feedback-smtp.us-east-1.amazonses.com` with priority `10`, a TXT record (text) named `send.notify` with `v=spf1 include:amazonses.com ~all`, and a TXT record named `resend._domainkey.notify` with the long `p=...` value Resend shows. These are the SPF and DKIM records described in the [glossary](./glossary.md#email-auth).
6. Resend also recommends a DMARC record, a TXT record with `v=DMARC1; p=none;`. If Cloudflare already lists a TXT record named `_dmarc`, keep it and skip this one: it covers the `notify` subdomain too. Otherwise add it with the name Resend shows. Then click **Verify DNS Records** and wait for "Verified". That usually takes minutes; DNS can take up to 72 hours, and you can skip the key and come back.
7. Open <https://resend.com/api-keys>, click **Create API Key**, name it `LVBT website`, choose **Sending access** and the domain `notify.lasvegasfortransit.org`, and click **Add**. Copy the key and paste it at the bootstrap prompt; Resend shows it only once.

### Beehiiv, Apps Script and Notion

These already exist for LVBT, so you copy values rather than create anything.

- `LVBT_BEEHIIV_API_KEY` and `LVBT_BEEHIIV_PUBLICATION_ID` come from the Beehiiv workspace's API page. Create a key named `LVBT website`; the publication ID starts with `pub_`.
- `LVBT_MEMBERSHIP_INTAKE_SECRET` must be the value the Google Form's Apps Script already uses (see [glossary](./glossary.md#apps-script)). Copy it from the script's Project Settings → Script Properties. Never make up a new one or copy the random value in your own `.env.local`; the form would stop working.
- `LVBT_NOTION_API_KEY` is the token of the Notion integration connected to the Membership intake database, and `LVBT_NOTION_DATA_SOURCE_ID` is that database's data source ID (see [glossary](./glossary.md#data-source)).

### Random signing keys

`LVBT_TRANSIT_NEWS_INTAKE_SECRET`, `LVBT_SIGN_IN_SECRET` and `LVBT_LINK_SIGNING_SECRET` are random values bootstrap makes for you the first time, when no target has them yet. Cloudflare and GitHub never show a stored secret again, so if one of these exists in some places and not others, there is nothing to copy. Run `pnpm bootstrap --phase secrets --rotate <NAME>` to make a new value and store it everywhere. For the transit news secret, bootstrap then offers to show the new value once so you can paste it into the Notion automation's `Authorization: Bearer` header. A new sign-in secret means anyone waiting for a code asks for a new one; a new link-signing secret means links already sent by email stop working.

### Google sign-in for the website

`LVBT_GOOGLE_OAUTH_CLIENT_ID` and `LVBT_GOOGLE_OAUTH_CLIENT_SECRET` are for the website's own "Sign in with Google" button. That feature is not built yet, so both are fine to skip.

1. Open <https://console.cloud.google.com/?project=lvbt-core> signed in with an LVBT Workspace admin account, and check that the project picker at the top says **LVBT Core**. Only if that project does not exist, click **New project**, name it `LVBT Core`, keep the organization lasvegasfortransit.org, and click **Create**. Dismiss any "Start your Free Trial" banner: none of this needs billing.
2. Open <https://console.cloud.google.com/auth/overview?project=lvbt-core>. If the Clients page says "Google Auth Platform not configured yet", click **Get started** and complete the four steps: **App Information** — App name `Las Vegans for Better Transit`, User support email `tech@lasvegasfortransit.org` (a shared LVBT address, never a person's), then **Next**; **Audience** — **Internal**, then **Next**; **Contact Information** — `tech@lasvegasfortransit.org`, then **Next**; **Finish** — tick the box agreeing to the Google API Services: User Data Policy, click **Continue**, then **Create**. Optional: under **Branding**, upload the square LVBT logo from the "Marketing & Communications" shared drive as the App logo. Then open **Clients** again. "Internal" means only lasvegasfortransit.org accounts can sign in — every Google sign-in in this project is for the team, members sign in with emailed codes instead — so Google needs no verification of the app, and personal Gmail addresses are blocked. It can change later under Audience → "Make external" if members ever get Google sign-in.
3. Open <https://console.cloud.google.com/auth/branding?project=lvbt-core>. If **App logo** is empty, upload the square LVBT logo (a square image under 1 MB; 120 by 120 pixels shows best). Set **Application home page** to `https://lasvegasfortransit.org`. Leave the privacy policy and terms of service links empty; Google requires them only for public apps. Under **Authorized domains**, click **Add domain** and enter `lasvegasfortransit.org` if it is not listed, because Google accepts sign-in addresses only on these domains. Click **Save**.
4. Skip the **Audience** and **Data Access** pages. Signing in uses only the basic email, profile and openid permissions, which need no setup.
5. Open <https://console.cloud.google.com/auth/clients?project=lvbt-core>. If a client named `LVBT website` exists, open it. Otherwise click **Create client**, choose **Web application**, and name it `LVBT website`. Leave **Authorized JavaScript origins** empty; the website signs people in from its server. Under **Authorized redirect URIs**, click **Add URI** and enter `https://lasvegasfortransit.org/auth/google/callback`. Click **Create**, and keep the dialog that opens.
6. Copy the Client ID (it ends with `.apps.googleusercontent.com`) and paste it at the `LVBT_GOOGLE_OAUTH_CLIENT_ID` prompt.
7. At the next prompt, `LVBT_GOOGLE_OAUTH_CLIENT_SECRET`, copy the Client secret from the same dialog and paste it. Google shows the secret only once; if you closed the dialog, open the client, click **Add secret**, then copy the new secret and paste it.

### Cloudflare One: the Access team domain

`LVBT_ACCESS_TEAM_DOMAIN` is the address Cloudflare Access signs people in at (see [glossary](./glossary.md#cloudflare-access)). For LVBT it is `lvbt.cloudflareaccess.com`. Cloudflare One (formerly Zero Trust) is already set up for the LVBT account, so you only copy it: open <https://one.dash.cloudflare.com/>, choose the LVBT account ("Las Vegans for Better Transit"), and on **Overview → Account details** copy **Team domain**. Next to it, **Team name** ("Las Vegans for Better Transit") is only a label and is not this value.

Do not change the team domain. Changing it breaks Access sign-in and the Google sign-in for Access until every copy of this value and the Google OAuth client's origin and redirect address are updated to match.

Only if Cloudflare ever asks you to set up Cloudflare One from scratch: type `lvbt` as the team domain, type `Las Vegans for Better Transit` if it asks for a team name, and choose the Zero Trust Free plan. It asks for payment details but does not charge for the Free plan.

### The staff console: Google Group, Google sign-in and the Access application

`LVBT_ACCESS_AUD` tells the staff console which Cloudflare Access application guards it, so it accepts only that application's sign-ins. The staff console is not live yet, so it is fine to leave this empty now; bootstrap asks again next time. The value only exists once the Access application in part 4 is created. That takes about 20 minutes and needs a Google Workspace super admin. Do the parts in order; each needs the one before it. After showing these steps, bootstrap asks once whether part 1 is done and remembers a "yes".

**Part 1, the Staff Google Group.** Cloudflare Access uses LVBT's existing Staff group, `staff@lasvegasfortransit.org` — everyone on the team, not a group made for this.

1. At <https://admin.google.com>, go to Directory → Groups and open **Staff**.
2. Check it before relying on it: Members should be the LVBT team only, all @lasvegasfortransit.org, nobody who should not see member data. Under **Access settings**, **Who can join the group** should be **Only invited users**, and **Allow members outside your organization** should be off. Add yourself if you are not already a member, so **Test** can show the group later.
3. If the group does not exist: click **Create group**. Group name `Staff`, Group email `staff`, Description `LVBT staff`. Create it, then add members the same way.

To add someone later, come back to the group's **Members** page and click **Add members**. To remove someone, point to them in the list and click **Remove**, or tick them and click **Remove members**.

**Part 2, let Google trust LVBT's own sign-in apps.** Still in <https://admin.google.com>, go to Security → Access and data control → API controls. Under **Settings**, tick **Trust internal apps** and click **Save**. Without it, Google can refuse the Cloudflare sign-in.

**Part 3, a Google sign-in client for Cloudflare.**

1. Open <https://console.cloud.google.com/apis/library/admin.googleapis.com?project=lvbt-core> and click **Enable** if it does not already say "API Enabled". Cloudflare uses this Admin SDK API to read group membership.
2. In another tab, open Cloudflare One → Integrations → Identity providers — not **Cloud & SaaS** just above it: that is a different feature that asks for a service account, so leave it alone. (Press ⌘K or Ctrl+K and search "Identity providers" if the sidebar hides it.) If "Google Workspace" is already listed, skip to step 5. Otherwise click **Add new identity provider**, then **Google Workspace**. Name: `Google Workspace`. Keep this tab open; it shows the callback URL the Google client uses next.
3. In the Google Cloud tab, open <https://console.cloud.google.com/auth/clients?project=lvbt-core> and click **Create client**. Application type **Web application**, Name `Cloudflare Access`. Under **Authorized JavaScript origins**, click **Add URI** and enter `https://lvbt.cloudflareaccess.com`. Under **Authorized redirect URIs**, click **Add URI** and enter `https://lvbt.cloudflareaccess.com/cdn-cgi/access/callback`. Click **Create**. Leave the dialog showing the Client ID and Client secret open.
4. Back on the Cloudflare tab, copy the Client ID from the Google dialog and paste it into **Client ID** (an older Cloudflare UI calls this **App ID**). Then copy the Client secret and paste it into **Client secret**. Google Workspace domain: `lasvegasfortransit.org`. Leave **Proof Key for Code Exchange (PKCE)** on. Leave **Enable SCIM** off, along with **Enable user deprovisioning** and **Remove user seat on deprovision**, and leave the SCIM identity update behavior as "No action" — Google Workspace only sends SCIM to a handful of apps in its own catalog, and Cloudflare does not document SCIM support for Google Workspace at all; Access re-checks group membership every sign-in instead. Leave the email claim and OIDC Claims fields empty. Click **Save** (allow the Google prompt with your LVBT admin account if it asks).
5. Click **Test** next to Google Workspace. It should show your LVBT address and list `staff@lasvegasfortransit.org` among your groups. If the group is missing, re-check part 1 and the Admin SDK API in step 1.

**Part 4, the application.**

1. In Cloudflare One, open Access controls → Applications. If **LVBT staff console** is listed, click it, open **Configure**, and skip to step 7. Always use exactly that name, so the next person finds it instead of making a second one.
2. Otherwise click **Create new application** at the top right. An account with no applications yet shows only a prerequisites list, which parts 1 to 3 have now done. In the dialog, choose **Self-hosted and private**, then the **Public DNS** tab (not "Private destinations"), then **Continue with Self-hosted and private**.
3. Under **Destinations**, the Subdomain box starts empty — leave it empty and the application puts all of lasvegasfortransit.org behind Google sign-in, not just the staff console. Fill in one public hostname: subdomain `staff`, domain `lasvegasfortransit.org`, path empty, and add no other destination (**Add private hostname**, **Add private IP** and **Add Workers** all stay unused). If lasvegasfortransit.org is not in the domain list, you are in the wrong Cloudflare account; switch to the LVBT account and start part 4 again. Leave **Allow access through browser-based RDP, SSH, or VNC sessions** off.
4. Under **Access policies**, click **Create new policy**. Policy Name `LVBT staff` (any clear name is fine), Action **Allow**, Policy session duration **Same as application session duration**. Include: **Google Groups** = `staff@lasvegasfortransit.org`. Click **+ Add require (AND)** and add **Emails ending in** = `@lasvegasfortransit.org`, as a second check. Leave **Override global multi-factor authentication settings (MFA)** and **Just-in-time access** off — 2-Step Verification belongs in Google (part 1's group), not here. Save the policy. If **Google Groups** is not offered, part 3 is not finished.
5. Skip **Policy tester**.
6. Under **Authentication** (Identity tab), turn off **Accept all available identity providers**, choose **Google Workspace** in **Choose available identity providers**, and turn on **Apply instant authentication**. Leave **Authenticate with Cloudflare One Client** off.
7. Skip **Preview**. Under **Details**, set Name to `LVBT staff console` and Session Duration to **24 hours**. Click **Create**.
8. Open the application's **Configure** page, then **Additional settings** → **Cookie settings**, and turn on **Enable Binding Cookie**. Leave **HTTP Only** on and **SameSite** set to **Lax**.
9. Still under **Additional settings**, copy **Application Audience (AUD) Tag**, a long string of letters and numbers, and paste it at the bootstrap prompt. It is not secret — every Access token carries it — which is why bootstrap shows it back.

Enforce MFA in Google, not Cloudflare: in the Google Admin console, go to Security → Authentication → 2-step verification, tick **Allow users to turn on 2-Step Verification**, and set **Enforcement** to **On** (the whole organization, or at least Staff), with a short enrollment period. Passkeys or security keys are the strongest option. Do not add a Cloudflare "Authentication method" MFA rule to the policy above: Google does not reliably send that signal, and it can lock everyone out.

To remove someone's access, remove them from Staff or suspend their account; that takes effect by their next sign-in, at most 24 hours. To cut them off immediately, also go to Cloudflare One → Team & Resources → Users and revoke their session.

### Discord

The five `LVBT_DISCORD_*` values are for Discord linking and roles, which are not built yet, so it is fine to skip all five; bootstrap asks again next time. The app is called **LVBT Bot**, and it must belong to the LVBT team: an app on a "Personal" team belongs to one account, and nobody else can manage it after that person leaves.

**The team.**

1. Open <https://discord.com/developers/teams> (the **Teams** link at the top right of the Developer Portal). Discord requires two-factor authentication on your account to create or join a team.
2. If **Las Vegans for Better Transit** is under "My Teams", you are in the team. If it exists but you are not in it, ask its owner or an admin to invite you from the team's page. If there is no team at all, click **New Team**, name it `Las Vegans for Better Transit`, and click **Create**.
3. Give the team the LVBT logo if its page offers an icon: the square LVBT logo from the "Marketing & Communications" shared drive, a PNG at least 512 by 512 pixels.
4. Every member of a team has admin rights over the team's apps, so add only trusted maintainers. Discord's team roles are Admin, Developer and Read-only; invite fellow maintainers as **Admin**. Only the team's one owner can delete the team or its apps.

**The app.**

1. Open <https://discord.com/developers/applications>. If an **LVBT Bot** app is listed under the team, open it and skip to step 4.
2. If LVBT's app sits on someone's Personal team, move it instead of making a second one: that person opens it and clicks **Transfer App to Team** at the bottom of **General Information**. This cannot be undone.
3. Otherwise click **+ Create** at the top, then **Create blank app** (ignore the game and bot templates). Name `LVBT Bot`; Team **Las Vegans for Better Transit**, not "Personal"; tick the box agreeing to the Discord Developer Terms of Service and Developer Policy; click **Create**.
4. On **General Information**, under **App Icon**, upload the square LVBT logo and click **Save Changes**. Discord shows this icon on the bot and on the "Connect Discord" screen. Copy the **Application ID** and paste it at the `LVBT_DISCORD_APPLICATION_ID` prompt. At the next prompt, copy the **Public Key** from the same page and paste it. Neither is secret; bootstrap stores them with the others.
5. Open **OAuth2**. Leave **Public Client** off: it is for apps without a server, such as phone apps, that cannot keep a secret. Under **Redirects**, click **Add Redirect**, enter `https://lasvegasfortransit.org/account/discord/callback`, and click **Save Changes**. Under **Client Secret**, click **Reset Secret**, confirm, then copy it and paste it at the `LVBT_DISCORD_CLIENT_SECRET` prompt. It is shown only once.

**The bot.**

1. Open **Bot**. Icon: the square LVBT logo (1024 by 1024, PNG). Banner is optional: the 680 by 240 LVBT banner if the drive has one. Username: `LVBT Bot`.
2. Under **Authorization Flow**, turn **Public Bot** off, so only the team can add the bot to a server. Leave **Requires OAuth2 Code Grant** and **Private Channel Obfuscation** off.
3. Under **Privileged Gateway Intents**, turn **Server Members Intent** on, because the website uses it to look up who is in the server. Leave **Presence Intent** and **Message Content Intent** off. Click **Save Changes**.
4. The **Bot Permissions** box further down is only a calculator; leave it. **App Verification** on the left only matters once a bot is in 100 or more servers; ignore it.
5. Open **Installation**. Under installation contexts, keep only **Guild Install**. Under its default install settings, add the scopes `bot` and `applications.commands` and the permission **Manage Roles**, and save.
6. Copy the install link on that page and paste it into your browser's address bar, choose the LVBT server, and click **Authorize**. You need the "Manage Server" permission in that server.
7. In Discord, open the LVBT server's **Server Settings → Roles** and drag the **LVBT Bot** role above every role the website gives out. A bot can only give roles below its own.
8. Back on **Bot**, click **Reset Token**, confirm, then copy the token and paste it at the `LVBT_DISCORD_BOT_TOKEN` prompt. Treat it like a password; it is shown only once.

**The server ID.** In the Discord app, open User Settings (the gear by your name) → Advanced and turn on **Developer Mode**. Right-click the LVBT server icon, click **Copy Server ID**, and paste it at the `LVBT_DISCORD_GUILD_ID` prompt.

The client secret and the bot token are the two real secrets here. Resetting either later makes the old one stop working, so store the new one with `pnpm bootstrap --phase secrets --rotate LVBT_DISCORD_CLIENT_SECRET` (or `LVBT_DISCORD_BOT_TOKEN`).

### Google service account

`LVBT_GOOGLE_SERVICE_ACCOUNT_KEY` and `LVBT_GOOGLE_ADMIN_SUBJECT` are for volunteer management: letting the website create volunteer Workspace accounts and manage Google Group membership, acting as a Workspace admin. That feature is not built and nothing reads these values, so leave both empty. Bootstrap lists them under "Not asked for" and never asks for them.

Do not create a service account key for them, and do not turn off the "Disable service account key creation" organization policy (`iam.disableServiceAccountKeyCreation`) to make one. Google turns that policy on by default for new organizations, because a key file works like a password that never expires: anyone who gets a copy could manage all of LVBT's Workspace users and groups.

When volunteer management is built, it will sign in to Google with no key file at all, using Workload Identity Federation from a GitHub Actions job; the [platform decision record](../explanation/decisions/organizing-platform.md#8-secrets-live-in-cloudflare-and-are-never-committed) explains how. The service account it will use already exists: `lvbt-website-admin@lvbt-core.iam.gserviceaccount.com` ("LVBT Website Admin") in the LVBT Core project. Until then, a Workspace admin adds and removes volunteer accounts and group members by hand at <https://admin.google.com>.

`LVBT_GOOGLE_ADMIN_SUBJECT` names the Workspace super-admin account the website acts as. It is the organization's own root super-admin account, not a person's; at LVBT that is `root@lasvegasfortransit.org`. There are three reasons not to use a person's admin address. The website keeps working when staff change, instead of breaking the day that person leaves or loses admin rights. The Workspace audit log shows the website's automated changes under the system account, not under a volunteer's name. And if the website's access were ever misused, it could not act as a real person and reach their mailbox and files.

### Givebutter

`LVBT_GIVEBUTTER_API_KEY` lets the site read donations so staff can see giving next to everything else. Donor support is not built yet, so it is fine to skip. Sign in to Givebutter as an Admin of the LVBT account, go to Settings → Integrations → API Keys, click **Create New API Key**, name it `LVBT website`, then copy the key and paste it at the prompt. It is shown only once.
