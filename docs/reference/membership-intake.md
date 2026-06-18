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

1. Open the membership Google Form. In its settings, confirm **Collect email addresses** is on — the email is read via `getRespondentEmail()`, not a form question, so without this the pipeline has no email to subscribe.
2. Open Extensions -> Apps Script.
3. Paste `scripts/google-apps/membership-intake.gs` into the Apps Script editor.
4. Edit `FIELD_TITLES` so the values exactly match the form's question titles. The defaults match the current "Membership Sign-Up" form: name is `What is your preferred name?` and discord is `What's your Discord username?`. (Email is not listed here — it comes from the collected-email setting above.)
5. In Apps Script, open Project Settings -> Script properties and set:

   | Property                        | Value                                                  |
   | ------------------------------- | ------------------------------------------------------ |
   | `LVBT_MEMBERSHIP_INTAKE_URL`    | `https://lasvegasfortransit.org/api/membership-intake` |
   | `LVBT_MEMBERSHIP_INTAKE_SECRET` | same value as the Cloudflare Pages secret              |

6. Open Triggers -> Add Trigger.
7. Choose `onMembershipFormSubmit`.
8. Event source: From form.
9. Event type: On form submit.
10. Save and authorize the script.

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

| Status | Body                                 | Meaning                             |
| ------ | ------------------------------------ | ----------------------------------- |
| `200`  | `{ "success": true }`                | Beehiiv and Notion both accepted it |
| `400`  | `{ "error": "invalid_body" }`        | JSON body could not be parsed       |
| `400`  | `{ "error": "invalid_email" }`       | Email missing or malformed          |
| `401`  | `{ "error": "unauthorized" }`        | Missing or incorrect bearer token   |
| `502`  | `{ "error": "subscription_failed" }` | Beehiiv rejected the subscription   |
| `502`  | `{ "error": "notion_sync_failed" }`  | Notion rejected the page create     |
| `503`  | `{ "error": "service_unavailable" }` | Required runtime secret is missing  |

## Verification

1. Submit a test response from the live Google Form.
2. Confirm the Apps Script execution succeeded.
3. Confirm Beehiiv shows the subscriber as `validating` (its status for someone who's been sent the confirmation email but hasn't clicked it yet — the [double opt-in](./glossary.md#double-opt-in) step; this is the expected success state, not an error).
4. Confirm a Notion page was created with the expected properties.
5. Confirm the complete response remains available in the Google Sheet.

For local handler checks:

```sh
node --import tsx --test tests/membership-intake.test.ts
pnpm typecheck
```

Use `node --import tsx`, not `pnpm exec tsx`, in restricted sandboxes where the `tsx` CLI cannot open its local IPC socket.

## Failure handling and recovery

The endpoint subscribes the person in Beehiiv first, then creates the Notion page. The two steps are not transactional, so one partial-failure mode is worth knowing:

- **Beehiiv succeeds, Notion fails.** The person is already a (pending) subscriber, but no intake page exists. The endpoint returns `502 notion_sync_failed`, the Apps Script execution throws, and the trigger owner gets Apps Script's standard failure email.

Recover from the Google Sheet, which stays canonical for the full response:

1. Open the failed execution in Apps Script (**Extensions → Apps Script → Executions**) to confirm which submission failed.
2. Create the Notion intake page by hand from the matching Sheet row.

Prefer manual Notion entry over re-running the execution. A re-run re-POSTs the whole payload: the Beehiiv step is idempotent (safe to run more than once — re-subscribing the same person changes nothing; see [glossary](./glossary.md#idempotent), here via `reactivate_existing: true`), but Notion has no dedupe and would create a **second** page for the same person.
