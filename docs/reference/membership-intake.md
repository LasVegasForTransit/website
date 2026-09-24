# Membership intake reference

How a sign-up, from any form, becomes a person record. Read this when you're
connecting a new sign-up form, changing what gets stored, or debugging a
submission that didn't go through.

This is the reference for the intake side of the [Organizing
Platform](../explanation/decisions/organizing-platform.md) (the decision
record that fixes how the platform is built — read it first for the overall
architecture). The platform keeps one record per person LVBT knows about, in a
Cloudflare D1 database (see the [glossary](./glossary.md#d1)), and **that
person record is the canonical record of who joined and what they agreed
to** — not a spreadsheet, and not Notion.

> **Before you start.** You'll need: edit access to the membership Google Form
> (and its Apps Script editor) if you're touching the Google Form path, a
> [Beehiiv](./glossary.md#beehiiv) (our newsletter platform) account with an
> API key, a Notion workspace where you can create a connection (for staff
> follow-up, until the staff console replaces it — see
> [below](#staff-follow-up-in-notion)), and access to the LVBT Cloudflare
> account to set Worker secrets. The fastest setup path (`pnpm bootstrap --phase secrets`)
> is described under [Required Cloudflare secrets](#required-cloudflare-secrets).

## How someone joins

Whichever form someone fills in, the same three things happen:

1. They're subscribed to LVBT's newsletter in [Beehiiv](./glossary.md#beehiiv),
   which is what makes them a member today (see [membership
   program](../explanation/membership-program.md)).
2. Their answers are written into their person record — the row for them in
   the platform database, read and written only through the [person
   service](../../platform/storage/person-service.md). See the
   [schema](../../platform/storage/migrations/schema.md) for every column that
   record can hold. A person is matched to an existing record by email
   address, so filling in a second form links to the same person instead of
   creating a duplicate.
3. Staff learn about the new person for follow-up. Today that's a Notion page
   (see [Staff follow-up in Notion](#staff-follow-up-in-notion)); once the
   staff console's follow-up queue ships, staff will work from that queue
   instead.

LVBT's own join form, at `/join/member`, does all three directly — see
[joining LVBT on the website](./newsletter-signup.md) for exactly how. Every
other form reaches the person record through the intake interface below.

## The versioned intake interface

`POST /api/intake/v1` is the one documented, versioned way for an outside form
tool to add a sign-up to the person record. It's versioned so the request and
response shape stays the same until a version 2 exists, which means a form
tool you connect today keeps working without code changes later.

The full contract — headers, request body, every field, every response — is
in [connect a form tool](../guides/connect-a-form-tool.md). Send it there
before wiring up a new tool. In short: you `POST` a JSON body with the
person's email and consent, authenticated with a bearer token (see
[glossary](./glossary.md#bearer-token)), and you get back whether the person
was newly `created` or `linked` to someone LVBT already knew.

## The Google Form: a supported fallback

The membership Google Form still works, as a fallback alongside the website's
own join form. It doesn't call `/api/intake/v1` directly. Instead, an Apps
Script attached to the form (see [glossary](./glossary.md#apps-script)) posts
each submission, in its own older shape, to `/api/membership-intake`. That
handler subscribes the person in Beehiiv itself, then turns the submission
into a version 1 intake submission and writes it to the person record through
the same intake logic every other source uses — so a Google Form sign-up ends
up in exactly the same place a `/api/intake/v1` sign-up does. The Google
Sheet the form writes to is not the record of who joined; it's a convenience
copy of the raw answers, kept in case a submission ever needs to be checked or
re-entered by hand.

### Switching the membership front door

The website's own join form at `/join/member` is LVBT's front door: the
`/join` "Become a member" button and the `/qr` presenter deck's "Join" slide
both point to it, and the QR code encodes
`https://lasvegasfortransit.org/join/member`. How it works is in [joining LVBT
on the website](./newsletter-signup.md).

One setting switches both links to an outside form instead:
`PUBLIC_LVBT_MEMBERSHIP_FORM_URL` (a GitHub Actions variable, read at build
time; see `src/lib/membership.ts`). Leave it unset to use the website's form.
Set it to an outside form's address, such as the Google Form's short link
`https://forms.gle/4N8gRU2wDK6G8BKH8`, and redeploy to send people there. Use
a short link, because the QR encoder caps at 84 bytes.

Any outside form must send its submissions to the versioned intake interface,
as described in [connect a form tool](../guides/connect-a-form-tool.md), so
its members reach Beehiiv and the person record. The Google Form uses the
older address described above, which records its submissions in the person
record too.

## Connecting any other form tool

To connect a form tool other than the Google Form — Jotform, Typeform, or
anything else — send its submissions to `POST /api/intake/v1` directly. Follow
[connect a form tool](../guides/connect-a-form-tool.md) end to end; it covers
the request shape, every response you might get back, and a `curl` command you
can use to test it before wiring up the real form. You do not need to touch
any code to connect a new form tool.

## Required Cloudflare secrets

The fastest path is `pnpm bootstrap --phase secrets` (see [platform
secrets](./platform-secrets.md)). It checks which of these the live site
already has, asks for each missing one once, and stores it on the production
Worker, the Pages fallback and the `worker-candidate` GitHub environment. It never
replaces a value that is already stored. For `LVBT_MEMBERSHIP_INTAKE_SECRET`
it asks for the value the Apps Script already uses, so the form keeps
working.

`pnpm bootstrap --phase env` is only for your own machine: it writes the
Beehiiv keys, your Notion access token and a random intake secret into
`.env.local` for local testing, and never sends them to production. Never
paste that local intake secret into Apps Script.
`LVBT_NOTION_DATA_SOURCE_ID` is created for you by `pnpm setup:notion` (see
[Notion setup](#notion-setup)).

The five runtime secrets:

| Key                             | Purpose                                                                                                                                                                                                                                                                                |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LVBT_MEMBERSHIP_INTAKE_SECRET` | Shared bearer token (a secret string sent in the request's `Authorization: Bearer …` header to prove the caller is allowed; see [glossary](./glossary.md#bearer-token)) used by Apps Script when calling `/api/membership-intake`, and by any other form tool calling `/api/intake/v1` |
| `LVBT_BEEHIIV_API_KEY`          | Beehiiv API key with subscriber write access                                                                                                                                                                                                                                           |
| `LVBT_BEEHIIV_PUBLICATION_ID`   | Beehiiv publication ID, starting with `pub_`                                                                                                                                                                                                                                           |
| `LVBT_NOTION_API_KEY`           | Notion connection access token (starts with `ntn_`) — needed only for staff follow-up; see [Staff follow-up in Notion](#staff-follow-up-in-notion)                                                                                                                                     |
| `LVBT_NOTION_DATA_SOURCE_ID`    | Notion data source ID (a data source is the actual table of rows inside a Notion database; the API writes to its ID, not the database ID — see [glossary](./glossary.md#data-source)) — created by `pnpm setup:notion`; same caveat as above                                           |

Only when the form is set up for the first time does the intake secret need
a new value. Generate one with `openssl rand -hex 32` (`openssl` is a
command-line crypto tool; this prints a random 64-character hex string), put
it in the Apps Script script property, and paste the same value when
`pnpm bootstrap --phase secrets` asks for it. To change an existing value,
update the script property first, then run
`pnpm bootstrap --phase secrets --rotate LVBT_MEMBERSHIP_INTAKE_SECRET` with
the new value.

## Google Forms setup

The form-side wiring (Apps Script, script properties, the installable
trigger) is a one-time task with its own walkthrough — keep using it, because
the Google Form still relies on these exact steps: [Connect the membership
form to the intake pipeline](../guides/connect-the-membership-form.md). The
short version: the form must have **Collect email addresses** on, the script
in `scripts/google-apps/membership-intake.gs` must be installed as an **On
form submit** trigger, and its `LVBT_MEMBERSHIP_INTAKE_SECRET` property must
equal the production Worker secret.

If the endpoint returns a non-2xx response, the script throws. Apps Script
records the failed execution and sends the trigger owner the standard failure
email.

## Staff follow-up in Notion

> **Will be superseded once the staff console's follow-up queue ships.** At
> that point staff will work new sign-ups from the console instead of a Notion
> database, and this section will be marked superseded with a date and a link
> to whatever replaces it. That project hasn't shipped yet — see the [platform
> decision record](../explanation/decisions/organizing-platform.md) for where
> the staff console fits into the platform. **Until then, Notion is still how
> staff follow up with every new person who joins, and the steps below are
> current.**

Two parts: a one-time manual setup the Notion API can't do for you (creating
the connection and sharing a page), then a script that builds the database
with the right schema. `pnpm bootstrap --phase env` prompts for both values
below and saves them in `.env.local` on your machine.

### 1. Connection and parent page (manual)

1. At <https://www.notion.so/my-integrations>, create an internal
   **connection** (authentication method **Access token**) with the **Insert
   content** capability — that is what lets it create the database and pages.
   Copy its access token (starts with `ntn_`) into `LVBT_NOTION_API_KEY`.
2. Create a Notion page to hold the intake database (e.g. "LVBT Ops").
3. Share that page with the connection: open the page → `•••` →
   **Connections** → add your connection.
4. Copy the page's 32-character ID from its URL into
   `LVBT_NOTION_PARENT_PAGE_ID`.

> The new Notion Developer Platform (May 2026) adds an `ntn` CLI and hosted
> Workers, but a server that writes to Notion — the site's compiled API function
> — still authenticates with a connection access token, so these steps don't
> change.

### 2. Provision the database

```sh
pnpm setup:notion
```

This creates a **Membership intake** database under your parent page with the
columns below, reads back its [data source
ID](./glossary.md#data-source) (the ID the endpoint writes to), and writes
`LVBT_NOTION_DATA_SOURCE_ID` into `.env.local`. Re-running reuses the
existing database instead of duplicating it. Store the value in production
with `pnpm bootstrap --phase secrets`, which asks for it if it is missing.

The schema lives in one place — `functions/api/_intake-schema.ts` — which
both the endpoint and the provisioner import, so the columns can't drift from
what the code writes. The endpoint writes these properties:

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

This is the Google Form's endpoint. A new form tool should use
`/api/intake/v1` directly instead — see [Connecting any other form
tool](#connecting-any-other-form-tool).

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

Responses. The **Status** column is the [HTTP status
code](./glossary.md#status-code) (`2xx` = success, `4xx`/`5xx` = failure):

| Status | Body                                                   | Meaning                                                                                         |
| ------ | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `200`  | `{ "success": true, "notion": "created" }`             | Beehiiv accepted it, the person record was updated, and a Notion intake page was created        |
| `200`  | `{ "success": true, "notion": "existing" }`            | Beehiiv accepted it and the person record was updated; a page for this response already existed |
| `400`  | `{ "error": "invalid_body" }`                          | JSON body could not be parsed                                                                   |
| `400`  | `{ "error": "invalid_email" }`                         | Email missing or malformed                                                                      |
| `401`  | `{ "error": "unauthorized" }`                          | Missing or incorrect bearer token                                                               |
| `502`  | `{ "error": "subscription_failed" }`                   | Beehiiv rejected the subscription                                                               |
| `502`  | `{ "error": "notion_sync_failed" }`                    | Notion rejected the page create                                                                 |
| `503`  | `{ "error": "service_unavailable", "missing": [...] }` | Required runtime secret is missing; the missing key names are included                          |
| `500`  | Cloudflare error page (not JSON)                       | An exception escaped the handler                                                                |

The auth check runs before the config check, so only a caller with the
correct bearer token sees the `missing` list. The exception is
`LVBT_MEMBERSHIP_INTAKE_SECRET` itself: without it nobody can authenticate, so
it is always reported.

Writing the person record is best effort and happens after Beehiiv succeeds:
if the database write fails, the response is unaffected, because the person
is already subscribed and the Google Form must not retry and subscribe them
again. A failure there is logged, not returned to the caller.

The endpoint never returns `500` deliberately; if you see one, read the
deployment's **Functions** log in the Cloudflare dashboard or run `wrangler
pages deployment tail`.

## Verification

1. Submit a test response from the live Google Form.
2. Confirm the Apps Script execution succeeded.
3. Confirm Beehiiv shows the subscriber as `active`. Adding a member sends
   them **no email**: no welcome email (`send_welcome_email: false`) and no
   confirmation click (`double_opt_override: 'off'`), because Google's
   "Collect email addresses" setting has already verified the address. Any
   onboarding mail is a Beehiiv automation you set up separately.
4. Confirm a Notion page was created with the expected properties.
5. Confirm the person record has a row for the test address:

   ```sh
   pnpm exec wrangler d1 execute lvbt-platform --remote --command "SELECT id, membership_status FROM people WHERE email = 'you@example.org'"
   ```

For local handler checks:

```sh
pnpm test:unit
pnpm typecheck
```

`test:unit` runs the tests through `node --import tsx` rather than the `tsx`
CLI, which cannot open its local IPC socket in restricted sandboxes.

## Failure handling and recovery

Apps Script treats any non-2xx response as a failed execution and emails the
trigger owner. The status in that email says what went wrong:

- **`503 service_unavailable`**: a Worker secret is missing. Nothing reached
  Beehiiv or Notion, and every submission fails the same way until it is
  fixed. Run `pnpm bootstrap --phase secrets` to set the names in `missing`
  on the production Worker, deploy the resulting Worker version, then replay as below.
- **`401 unauthorized`**: the Apps Script `LVBT_MEMBERSHIP_INTAKE_SECRET`
  property no longer matches the Worker secret.
- **`502`**: Beehiiv or Notion rejected the request; the body says which. If
  Beehiiv succeeded and Notion failed, the person is subscribed and in the
  person record, but has no Notion follow-up page. Replay fixes that too.

Replaying is safe because the request is
[idempotent](./glossary.md#idempotent): Beehiiv treats a re-subscribe as a
no-op (`reactivate_existing: true`) and sends no email, the endpoint looks up
the form's **Response ID** in the Notion data source before creating a page,
and the intake interface remembers the same idempotency key for 30 days — so a
replayed submission changes nothing it already did.

1. Confirm the outage is over: submit a test response and check that the
   execution succeeds.
2. In **Extensions → Apps Script**, select `backfillMembershipIntake` in the
   toolbar and press **Run**. It replays every stored response and logs one
   line per response plus a summary. To replay only part of the history, call
   `backfillIntakeSince(new Date('…'))` from a scratch function instead.
3. Re-run once any `failed` lines in the execution log have been dealt with.

To create Notion pages without touching Beehiiv at all, `pnpm tsx
scripts/notion/backfill-intake.ts <payloads.json>` takes a JSON array of
endpoint-shaped bodies and uses the Notion secrets in `.env.local`. It skips
submissions that already have a page.

The Google Sheet stays useful for the full response if a row ever needs to be
entered by hand, but it is not what LVBT treats as the record of who joined —
the person record is.
