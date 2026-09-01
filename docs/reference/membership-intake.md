# Membership intake automation

How Google Forms submissions become newsletter subscribers and Notion intake records. Read this when you're setting up the intake pipeline, changing what gets stored, or debugging a submission that didn't go through.

> **Before you start.** You'll need: edit access to the membership Google Form (and its Apps Script editor), a [Beehiiv](./glossary.md#beehiiv) (our newsletter platform) account with an API key, a Notion workspace where you can create a connection, and access to the Cloudflare Pages project to set secrets. The fastest setup path (`pnpm bootstrap --phase env`) is described under [Required Cloudflare Pages secrets](#required-cloudflare-pages-secrets).

## System boundary

```
Google Form
  -> installable Apps Script form-submit trigger
  -> POST /api/membership-intake
  -> Beehiiv subscription
  -> Notion intake page
```

Apps Script is Google's built-in JavaScript automation attached to a Form or Sheet; here a _form-submit trigger_ runs our script every time someone submits the form, and it POSTs the answers to our endpoint.

For v1, the Google Form response sheet remains the canonical full-response record. The Cloudflare Pages Function is the owned pipeline boundary: it validates the request, subscribes the person in Beehiiv, and creates an operational Notion page for follow-up.

## Where the form is surfaced

The Google Form is the canonical front door for new members. The site links to it from the `/join` "Become a member" CTA and the `/qr` presenter deck's "Join" slide. The public link is configured once, as the `forms.gle` short link, in `PUBLIC_LVBT_MEMBERSHIP_FORM_URL` (see `.env.example` and `src/lib/site.ts`). The short link is used because the QR encoder caps at 84 bytes; it resolves to the canonical `https://docs.google.com/forms/d/e/1FAIpQLSfE28qUHn9A_cYpEtz4OV9NvQLkhlVVwaMvho_fCS_SI34CwQ/viewform`. If the var is unset, `/join` falls back to the general-interest email and the QR "Join" slide is omitted.

The inline newsletter box (`NewsletterEmbed` → `/api/subscribe`) is a separate, lighter path for email-only updates and is not part of membership intake — see [newsletter-signup.md](./newsletter-signup.md).

## Required Cloudflare Pages secrets

The fastest path is `pnpm bootstrap --phase env`: it prompts for the Beehiiv keys and your Notion access token, mints `LVBT_MEMBERSHIP_INTAKE_SECRET` (and echoes it so you can paste the same value into Apps Script), and writes everything to `.env.local`. The remaining secret, `LVBT_NOTION_DATA_SOURCE_ID`, is created for you by `pnpm setup:notion` (see [Notion setup](#notion-setup)). Then `pnpm bootstrap --phase deploy` pushes all five to Cloudflare Pages as **Production** secrets; the **Preview** environment still needs them set by hand in the dashboard.

The five runtime secrets:

| Key                             | Purpose                                                                                                                                                                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LVBT_MEMBERSHIP_INTAKE_SECRET` | Shared bearer token (a secret string sent in the request's `Authorization: Bearer …` header to prove the caller is allowed; see [glossary](./glossary.md#bearer-token)) used by Apps Script when calling the intake endpoint |
| `LVBT_BEEHIIV_API_KEY`          | Beehiiv API key with subscriber write access                                                                                                                                                                                 |
| `LVBT_BEEHIIV_PUBLICATION_ID`   | Beehiiv publication ID, starting with `pub_`                                                                                                                                                                                 |
| `LVBT_NOTION_API_KEY`           | Notion connection access token (starts with `ntn_`)                                                                                                                                                                          |
| `LVBT_NOTION_DATA_SOURCE_ID`    | Notion data source ID (a data source is the actual table of rows inside a Notion database; the API writes to its ID, not the database ID — see [glossary](./glossary.md#data-source)) — created by `pnpm setup:notion`       |

To set the intake secret without bootstrap, generate one with `openssl rand -hex 32` (`openssl` is a command-line crypto tool; this prints a random 64-character hex string to use as the secret) and use the same value in both Cloudflare Pages and the Apps Script script property.

## Notion setup

Two parts: a one-time manual setup the Notion API can't do for you (creating the connection and sharing a page), then a script that builds the database with the right schema. `pnpm bootstrap --phase env` prompts for both values below.

### 1. Connection and parent page (manual)

1. At <https://www.notion.so/my-integrations>, create an internal **connection** (authentication method **Access token**) with the **Insert content** capability — that is what lets it create the database and pages. Copy its access token (starts with `ntn_`) into `LVBT_NOTION_API_KEY`.
2. Create a Notion page to hold the intake database (e.g. "LVBT Ops").
3. Share that page with the connection: open the page → `•••` → **Connections** → add your connection.
4. Copy the page's 32-character ID from its URL into `LVBT_NOTION_PARENT_PAGE_ID`.

> The new Notion Developer Platform (May 2026) adds an `ntn` CLI and hosted Workers, but a server that writes to Notion — our Cloudflare Pages Function — still authenticates with a connection access token, so these steps don't change.

### 2. Provision the database

```sh
pnpm setup:notion
```

This creates a **Membership intake** database under your parent page with the columns below, reads back its [data source ID](./glossary.md#data-source) (the ID the endpoint writes to), and writes `LVBT_NOTION_DATA_SOURCE_ID` into `.env.local`. Re-running reuses the existing database instead of duplicating it. Push the value to production with `pnpm bootstrap --phase deploy`.

The schema lives in one place — `functions/api/_intake-schema.ts` — which both the endpoint and the provisioner import, so the columns can't drift from what the code writes. The endpoint writes these properties:

| Property name  | Type  | Value                                          |
| -------------- | ----- | ---------------------------------------------- |
| `Name`         | Title | "Preferred name" answer, falling back to email |
| `Email`        | Email | Normalized lowercase email                     |
| `Discord`      | Text  | "Discord username" answer (may be blank)       |
| `Source`       | Text  | Google Form title or supplied source label     |
| `Submitted at` | Date  | Form submission timestamp                      |
| `Raw response` | URL   | Response spreadsheet URL                       |
| `Response ID`  | Text  | Google Forms response ID                       |

The raw answers are added to the Notion page body for staff context. The Google Sheet is still the source of truth for the complete response.

## Google Forms setup

The form-side wiring (Apps Script, script properties, the installable trigger) is a one-time task with its own walkthrough: [Connect the membership form to the intake pipeline](../guides/connect-the-membership-form.md). The short version: the form must have **Collect email addresses** on, the script in `scripts/google-apps/membership-intake.gs` must be installed as an **On form submit** trigger, and its `LVBT_MEMBERSHIP_INTAKE_SECRET` property must equal the Pages secret.

If the endpoint returns a non-2xx response, the script throws. Apps Script records the failed execution and sends the trigger owner the standard failure email.

## Endpoint contract

`POST /api/membership-intake`

Required headers:

```http
Content-Type: application/json
Authorization: Bearer <LVBT_MEMBERSHIP_INTAKE_SECRET>
```

Expected body:

```json
{
  "email": "rider@example.com",
  "name": "Test Rider",
  "discord": "testrider#0001",
  "sourceForm": "Membership Sign-Up",
  "submittedAt": "2026-06-15T18:00:00.000Z",
  "rawResponseUrl": "https://docs.google.com/spreadsheets/d/...",
  "responseId": "form-response-id",
  "answers": {
    "What is your preferred name?": "Test Rider",
    "What's your Discord username?": "testrider#0001"
  }
}
```

Responses. The **Status** column is the [HTTP status code](./glossary.md#status-code) (`2xx` = success, `4xx`/`5xx` = failure):

| Status | Body                                                   | Meaning                                                                |
| ------ | ------------------------------------------------------ | ---------------------------------------------------------------------- |
| `200`  | `{ "success": true, "notion": "created" }`             | Beehiiv accepted it and a Notion intake page was created               |
| `200`  | `{ "success": true, "notion": "existing" }`            | Beehiiv accepted it; a page for this response already existed          |
| `400`  | `{ "error": "invalid_body" }`                          | JSON body could not be parsed                                          |
| `400`  | `{ "error": "invalid_email" }`                         | Email missing or malformed                                             |
| `401`  | `{ "error": "unauthorized" }`                          | Missing or incorrect bearer token                                      |
| `502`  | `{ "error": "subscription_failed" }`                   | Beehiiv rejected the subscription                                      |
| `502`  | `{ "error": "notion_sync_failed" }`                    | Notion rejected the page create                                        |
| `503`  | `{ "error": "service_unavailable", "missing": [...] }` | Required runtime secret is missing; the missing key names are included |
| `500`  | Cloudflare error page (not JSON)                       | An exception escaped the handler                                       |

The auth check runs before the config check, so only a caller with the correct bearer token sees the `missing` list. The exception is `LVBT_MEMBERSHIP_INTAKE_SECRET` itself: without it nobody can authenticate, so it is always reported.

The endpoint never returns `500` deliberately; if you see one, read the deployment's **Functions** log in the Cloudflare dashboard or run `wrangler pages deployment tail`.

## Verification

1. Submit a test response from the live Google Form.
2. Confirm the Apps Script execution succeeded.
3. Confirm Beehiiv shows the subscriber as `active`. Adding a member sends them **no email**: no welcome email (`send_welcome_email: false`) and no confirmation click (`double_opt_override: 'off'`), because Google's "Collect email addresses" setting has already verified the address. Any onboarding mail is a Beehiiv automation you set up separately.
4. Confirm a Notion page was created with the expected properties.
5. Confirm the complete response remains available in the Google Sheet.

For local handler checks:

```sh
pnpm test:unit
pnpm typecheck
```

`test:unit` runs the tests through `node --import tsx` rather than the `tsx` CLI, which cannot open its local IPC socket in restricted sandboxes.

## Failure handling and recovery

Apps Script treats any non-2xx response as a failed execution and emails the trigger owner. The status in that email says what went wrong:

- **`503 service_unavailable`**: a Pages secret is missing. Nothing reached Beehiiv or Notion, and every submission fails the same way until it is fixed. Set the secrets named in `missing` on the **Production** environment of the Pages project that `Deploy production` targets (its account is `CLOUDFLARE_ACCOUNT_ID` in the repo's `production` GitHub environment), redeploy so they bind, then replay as below.
- **`401 unauthorized`**: the Apps Script `LVBT_MEMBERSHIP_INTAKE_SECRET` property no longer matches the Pages secret.
- **`502`**: Beehiiv or Notion rejected the request; the body says which. If Beehiiv succeeded and Notion failed, the person is subscribed but has no intake page. Replay fixes that too.

Replaying is safe because the request is [idempotent](./glossary.md#idempotent): Beehiiv treats a re-subscribe as a no-op (`reactivate_existing: true`) and sends no email, and the endpoint looks up the form's **Response ID** in the Notion data source before creating a page, so a replayed submission answers `"notion": "existing"` instead of creating a duplicate.

1. Confirm the outage is over: submit a test response and check that the execution succeeds.
2. In **Extensions → Apps Script**, select `backfillMembershipIntake` in the toolbar and press **Run**. It replays every stored response and logs one line per response plus a summary. To replay only part of the history, call `backfillIntakeSince(new Date('…'))` from a scratch function instead.
3. Re-run once any `failed` lines in the execution log have been dealt with.

To create Notion pages without touching Beehiiv at all, `pnpm tsx scripts/notion/backfill-intake.ts <payloads.json>` takes a JSON array of endpoint-shaped bodies and uses the Notion secrets in `.env.local`. It skips submissions that already have a page.

The Google Sheet stays canonical for the full response if a row ever needs to be entered by hand.
