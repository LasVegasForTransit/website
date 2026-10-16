# Membership intake reference

How a sign-up, from any form, becomes a person record. Read this when you're connecting a new
sign-up form, changing what gets stored, or debugging a submission that didn't go through.

This is the reference for the intake side of the
[Organizing Platform](../explanation/decisions/organizing-platform.md) (the decision record that
fixes how the platform is built — read it first for the overall architecture). The platform keeps
one record per person LVBT knows about, in a Cloudflare D1 database (see the
[glossary](./glossary.md#d1)), and **that person record is the canonical record of who joined and
what they agreed to** — not a spreadsheet, and not Notion.

> **Before you start.** You'll need: edit access to the membership Google Form (and its Apps Script
> editor) if you're touching the Google Form path, the intake token, and access to the LVBT
> Cloudflare account for an authorized configuration change. Newsletter delivery needs separately
> configured [scheduled jobs](../../apps/jobs/README.md). The older Google Form endpoint also needs
> its existing Notion connection while that compatibility path remains in use; the versioned
> interface does not. See [Required Cloudflare secrets](#required-cloudflare-secrets).

## How someone joins

Whichever form someone fills in, the same three things happen:

1. Their answers and any explicit newsletter consent are written into their person record — the row
   for them in the platform database, read and written only through the
   [person service](../../packages/platform-storage/src/person-service.md). See the
   [schema](../../packages/platform-storage/migrations/schema.md) for every column that record can
   hold. A linked account or a matching verified email links to the existing person. Website,
   newsletter, Google Form, external-form and member submissions also link a matching self-reported
   email without prior verification. Other unverified email collisions, matching phone numbers and
   matching full names with the same ZIP code are queued for staff review.
2. Newsletter consent makes them a member and queues delivery in [Beehiiv](./glossary.md#beehiiv).
   Consent retains the original submission time, so an older replay cannot reverse a newer
   withdrawal. A provider outage does not discard the accepted membership record. A form without
   consent remains a form response rather than a membership join.
3. The staff console's **Welcome** queue lets staff claim and record follow-up for new members.
   Staff can also review uncertain matches and original signup answers. The older Google Form
   endpoint still creates a Notion page for compatibility (see
   [Staff follow-up in Notion](#staff-follow-up-in-notion)). That page is not the canonical member
   record. A deployed staff console and an accepted switch of the follow-up process are separate
   from the availability of this code; use the
   [staff acceptance checklist](./staff-portal-acceptance.md) before retiring the old process.

LVBT's own join form, at `/join/member`, writes the canonical record and queues newsletter delivery
without creating a Notion page — see [joining LVBT on the website](./newsletter-signup.md) for
exactly how. Every other form reaches the person record through the intake interface below.

## The versioned intake interface

`POST /api/intake/v1` is the one documented, versioned way for an outside form tool to add a sign-up
to the person record. It's versioned so the request and response shape stays the same until a
version 2 exists, which means a form tool you connect today keeps working without code changes
later.

The full contract — headers, request body, every field, every response — is in
[connect a form tool](../guides/connect-a-form-tool.md). Send it there before wiring up a new tool.
In short: you `POST` a JSON body with the person's email and consent, authenticated with a bearer
token (see [glossary](./glossary.md#bearer-token)), and you get back whether the person was newly
`created`, `linked` to someone LVBT already knew, or `created_and_queued` for match review.

## The Google Form: a supported fallback

The membership Google Form still works, as a fallback alongside the website's own join form. It
doesn't call `/api/intake/v1` directly. Instead, an Apps Script attached to the form (see
[glossary](./glossary.md#apps-script)) posts each submission, in its own older shape, to
`/api/membership-intake`. That handler turns the submission into a version 1 intake submission and
writes it to the person record before contacting Notion, through the same intake logic every other
source uses — so a Google Form sign-up ends up in exactly the same place a `/api/intake/v1` sign-up
does. The Google Sheet the form writes to is not the record of who joined; it's a convenience copy
of the raw answers, kept in case a submission ever needs to be checked or re-entered by hand.

The answer “Yes” to “Finishing this form will sign you up for our email newsletter. Is this okay?”
and a valid original submission time are required to record newsletter consent. A blank or negative
answer, or an unknown submission time, does not record new newsletter consent or a membership join.
It does not cancel an existing membership. The existing Apps Script includes these answers and the
response timestamp; it does not need newsletter credentials.

### Switching the membership front door

The website's own join form at `/join/member` is LVBT's front door: the `/join` "Become a member"
button and the `/qr` presenter deck's "Join" slide both point to it, and the QR code encodes
`https://lasvegasfortransit.org/join/member`. How it works is in
[joining LVBT on the website](./newsletter-signup.md).

One setting switches both links to an outside form instead: `PUBLIC_LVBT_MEMBERSHIP_FORM_URL` (a
GitHub Actions variable, read at build time; see `apps/site/src/lib/membership.ts`). Leave it unset
to use the website's form. Set it to an outside form's address, such as the Google Form's short link
`https://forms.gle/4N8gRU2wDK6G8BKH8`, and redeploy to send people there. Use a short link, because
the QR encoder caps at 84 bytes.

Any outside form must send its submissions to the versioned intake interface, as described in
[connect a form tool](../guides/connect-a-form-tool.md), so its members reach Beehiiv and the person
record. The Google Form uses the older address described above, which records its submissions in the
person record too.

## Connecting any other form tool

To connect a form tool other than the Google Form — Jotform, Typeform, or anything else — send its
submissions to `POST /api/intake/v1` directly. Follow
[connect a form tool](../guides/connect-a-form-tool.md) end to end; it covers the request shape,
every response you might get back, and a `curl` command you can use to test it before wiring up the
real form. You do not need to touch any code to connect a new form tool.

## Required Cloudflare secrets

The fastest path is `pnpm bootstrap --production` (see [platform secrets](./platform-secrets.md)).
It checks which of these the live site already has, asks for each missing one once, and stores it on
the production Worker and the `worker-candidate` GitHub environment. It never replaces a value that
is already stored. For `LVBT_MEMBERSHIP_INTAKE_SECRET` it asks for the value the Apps Script already
uses, so the form keeps working.

`pnpm bootstrap` seeds `apps/site/.env.local` only when the file is missing. Add test Beehiiv keys,
your test Notion access token, and a local intake secret there only when your task needs them. Those
values stay on your machine and are never sent to production. Never paste that local intake secret
into Apps Script. `LVBT_NOTION_DATA_SOURCE_ID` is created for you by
`pnpm -C apps/site setup:notion` (see [Staff follow-up in Notion](#staff-follow-up-in-notion)).

Intake runtime bindings:

| Key                             | Purpose                                                                                                                                                                                                                                                                                |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LVBT_MEMBERSHIP_INTAKE_SECRET` | Shared bearer token (a secret string sent in the request's `Authorization: Bearer …` header to prove the caller is allowed; see [glossary](./glossary.md#bearer-token)) used by Apps Script when calling `/api/membership-intake`, and by any other form tool calling `/api/intake/v1` |
| `PLATFORM_DB`                   | Canonical membership database; required before a submission can be accepted                                                                                                                                                                                                            |
| `LVBT_NOTION_API_KEY`           | Notion connection access token (starts with `ntn_`) — needed only for staff follow-up; see [Staff follow-up in Notion](#staff-follow-up-in-notion)                                                                                                                                     |
| `LVBT_NOTION_DATA_SOURCE_ID`    | Notion data source ID (a data source is the actual table of rows inside a Notion database; the API writes to its ID, not the database ID — see [glossary](./glossary.md#data-source)) — created by `pnpm -C apps/site setup:notion`; same caveat as above                              |

Newsletter credentials belong to the [scheduled membership Worker](../../apps/jobs/README.md).
Neither intake endpoint calls Beehiiv directly. Notion failure is reported after the canonical
record has been saved; retrying the same source response resumes follow-up safely.

Only when the form is set up for the first time does the intake secret need a new value. Generate
one with `openssl rand -hex 32` (`openssl` is a command-line crypto tool; this prints a random
64-character hex string), put it in the Apps Script script property, and paste the same value when
`pnpm bootstrap --production` asks for it. To change an existing value, update the script property
first, then run `pnpm bootstrap --production --rotate LVBT_MEMBERSHIP_INTAKE_SECRET` with the new
value.

## Google Forms setup

The form-side wiring (Apps Script, script properties, the installable trigger) is a one-time task
with its own walkthrough — keep using it, because the Google Form still relies on these exact steps:
[Connect the membership form to the intake pipeline](../guides/connect-the-membership-form.md). The
short version: the form must have **Collect email addresses** on, the script in
`apps/site/scripts/google-apps/membership-intake.gs` must be installed as an **On form submit**
trigger, and its `LVBT_MEMBERSHIP_INTAKE_SECRET` property must equal the production Worker secret.

If the endpoint returns a non-2xx response, the script throws. Apps Script records the failed
execution and sends the trigger owner the standard failure email.

## Staff follow-up in Notion

> **Superseded on 2026-10-16.** The staff console's Welcome queue provides member follow-up in the
> canonical platform. See the
> [platform decision record](../explanation/decisions/organizing-platform.md) and
> [staff acceptance checklist](./staff-portal-acceptance.md) for the transition requirements.

The setup below records the older Notion process. Keep its connection working while the Google
Form's `/api/membership-intake` compatibility endpoint is still in use: that endpoint saves the
canonical record first and then creates or finds a Notion page. `/api/intake/v1` and the website's
join form do not need Notion. Do not treat the presence of the Welcome queue in source as proof that
production follow-up has switched or that the old endpoint has been retired.

Two parts: a one-time manual setup the Notion API can't do for you (creating the connection and
sharing a page), then a script that builds the database with the right schema. Run `pnpm bootstrap`
to create your local environment file, then add the two values below to `apps/site/.env.local` on
your machine when working on this integration.

### 1. Connection and parent page (manual)

1. At <https://www.notion.so/my-integrations>, create an internal **connection** (authentication
   method **Access token**) with the **Insert content** capability — that is what lets it create the
   database and pages. Copy its access token (starts with `ntn_`) into `LVBT_NOTION_API_KEY`.
2. Create a Notion page to hold the intake database (e.g. "LVBT Ops").
3. Share that page with the connection: open the page → `•••` → **Connections** → add your
   connection.
4. Copy the page's 32-character ID from its URL into `LVBT_NOTION_PARENT_PAGE_ID`.

> The new Notion Developer Platform (May 2026) adds an `ntn` CLI and hosted Workers, but a server
> that writes to Notion — the site's compiled API function — still authenticates with a connection
> access token, so these steps don't change.

### 2. Provision the database

```sh
pnpm -C apps/site setup:notion
```

This creates a **Membership intake** database under your parent page with the columns below, reads
back its [data source ID](./glossary.md#data-source) (the ID the endpoint writes to), and writes
`LVBT_NOTION_DATA_SOURCE_ID` into `apps/site/.env.local`. Re-running reuses the existing database
instead of duplicating it. Store the value in production with `pnpm bootstrap --production`, which
asks for it if it is missing.

The schema lives in one place — `apps/site/functions/api/_intake-schema.ts` — which both the
endpoint and the provisioner import, so the columns can't drift from what the code writes. The
endpoint writes these properties:

| Property name  | Type  | Value                                          |
| -------------- | ----- | ---------------------------------------------- |
| `Name`         | Title | "Preferred name" answer, falling back to email |
| `Email`        | Email | Normalized lowercase email                     |
| `Discord`      | Text  | "Discord username" answer (may be blank)       |
| `Source`       | Text  | Google Form title or supplied source label     |
| `Submitted at` | Date  | Form submission timestamp                      |
| `Raw response` | URL   | Response spreadsheet URL                       |
| `Response ID`  | Text  | Google Forms response ID                       |

The raw answers are added to the Notion page body for staff context.

## Endpoint contract: `/api/membership-intake`

This is the Google Form's endpoint. A new form tool should use `/api/intake/v1` directly instead —
see [Connecting any other form tool](#connecting-any-other-form-tool).

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
    "What's your Discord username?": "testrider#0001",
    "Finishing this form will sign you up for our email newsletter. Is this okay?": "Yes"
  }
}
```

Responses. The **Status** column is the [HTTP status code](./glossary.md#status-code) (`2xx` =
success, `4xx`/`5xx` = failure):

| Status | Body                                                   | Meaning                                                                                                                        |
| ------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `200`  | `{ "success": true, "notion": "created" }`             | The person record was processed, any accepted newsletter consent was queued for delivery, and a Notion intake page was created |
| `200`  | `{ "success": true, "notion": "existing" }`            | The person record was processed; a Notion page for this response already existed                                               |
| `400`  | `{ "error": "invalid_body" }`                          | JSON body could not be parsed                                                                                                  |
| `400`  | `{ "error": "invalid_email" }`                         | Email missing or malformed                                                                                                     |
| `401`  | `{ "error": "unauthorized" }`                          | Missing or incorrect bearer token                                                                                              |
| `502`  | `{ "error": "notion_sync_failed" }`                    | Notion rejected the page create                                                                                                |
| `503`  | `{ "error": "service_unavailable", "missing": [...] }` | A required binding is missing; its name is included for authenticated callers                                                  |
| `503`  | `{ "error": "service_unavailable" }`                   | The canonical record could not be saved; retry the same response                                                               |
| `500`  | Cloudflare error page (not JSON)                       | An exception escaped the handler                                                                                               |

The auth check runs before the config check, so only a caller with the correct bearer token sees the
`missing` list. The exception is `LVBT_MEMBERSHIP_INTAKE_SECRET` itself: without it nobody can
authenticate, so it is always reported.

Writing the person record is required and precedes Notion follow-up. A database failure returns
`503` before contacting Notion. Newsletter delivery is durable work saved with accepted consent;
replays use the original consent time and cannot reactivate a later withdrawal. Idempotency receipts
store hashed source keys and the original response without retaining contact details.

The endpoint never returns `500` deliberately; if you see one, read the deployment's **Functions**
log in the Cloudflare dashboard.

## Verification

1. Use an approved test response in the intended environment. Submit it through the Google Form.
2. Confirm the Apps Script execution succeeded.
3. Confirm the canonical profile records the original consent time only for an affirmative answer.
   With scheduled newsletter work configured, verify delivery separately in Beehiiv. A blank or
   negative answer must not create newsletter consent or an LVBT join event.
4. Confirm a Notion page was created with the expected properties.
5. Confirm the person record has a row for the test address:

   ```sh
   pnpm -C apps/site exec wrangler d1 execute lvbt-platform --remote --command "SELECT id, membership_status FROM people WHERE email = 'you@example.org'"
   ```

For local handler and compiled runtime checks:

```sh
pnpm check
pnpm -C apps/site test:intake
```

The intake runtime check runs the built Worker against an isolated local database and provider
fixtures.

## Failure handling and recovery

Apps Script treats any non-2xx response as a failed execution and emails the trigger owner. The
status in that email says what went wrong:

- **`503 service_unavailable`**: a required binding is missing or the canonical write failed. A
  missing Notion setting is checked after the person record is saved, so a failed response does not
  prove that nothing was accepted. Check the named setting and canonical record in the intended
  environment, then follow [platform secrets](./platform-secrets.md) for an authorized repair and
  replay the original response.
- **`401 unauthorized`**: the Apps Script `LVBT_MEMBERSHIP_INTAKE_SECRET` property no longer matches
  the Worker secret.
- **`502 notion_sync_failed`**: the canonical record was saved, but Notion follow-up failed. Repair
  the Notion connection and replay the same response. Verify newsletter delivery separately; the
  intake endpoint never calls Beehiiv directly.

Replaying the same response is [idempotent](./glossary.md#idempotent): the intake interface
remembers its source and idempotency key for 30 days, and the compatibility endpoint looks up the
form's **Response ID** before creating a Notion page. Preserve the original answers, response
identifier and submission time. Accepted consent queues durable newsletter work; retrying must not
manufacture a new choice or reverse a newer withdrawal. Check delivery through the
[newsletter operations procedure](./staff-portal-operations.md#scheduled-newsletter-processing).

1. Confirm the outage is over: submit a test response and check that the execution succeeds.
2. In **Extensions → Apps Script**, select `backfillMembershipIntake` in the toolbar and press
   **Run**. It replays every stored response and logs one line per response plus a summary. To
   replay only part of the history, call `backfillIntakeSince(new Date('…'))` from a scratch
   function instead.
3. Re-run once any `failed` lines in the execution log have been dealt with.

To create Notion pages without touching Beehiiv at all,
`pnpm -C apps/site exec tsx scripts/notion/backfill-intake.ts <payloads.json>` takes a JSON array of
endpoint-shaped bodies and uses the Notion secrets in `apps/site/.env.local`. It skips submissions
that already have a page.

The Google Sheet stays useful for the full response if a row ever needs to be entered by hand, but
it is not what LVBT treats as the record of who joined — the person record is.
