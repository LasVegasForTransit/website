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
> configured [scheduled jobs](../../apps/jobs/README.md). Neither intake endpoint needs a Notion
> connection. See [Required Cloudflare secrets](#required-cloudflare-secrets).

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
   Staff can also review uncertain matches and imported signup evidence. The original Google Form
   endpoint also uses this canonical record and creates no Notion pages. Preserve the form's
   response sheet for its full original answers. Complete the
   [Notion retirement procedure](#staff-follow-up-in-notion) and
   [staff acceptance checklist](./staff-portal-acceptance.md) before treating the old process as
   retired.

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
writes it to the person record without contacting Notion, through the same intake logic every other
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
the production Worker. Intake secrets are not required by the GitHub release environments. It never
replaces a value that is already stored. For `LVBT_MEMBERSHIP_INTAKE_SECRET` it asks for the value
the Apps Script already uses, so the form keeps working.

`pnpm bootstrap` seeds `apps/site/.env.local` only when the file is missing. Add test Beehiiv keys
and a local intake secret there only when your task needs them. Those values stay on your machine
and are never sent to production. Never paste that local intake secret into Apps Script. Notion
credentials are unnecessary for intake; preserve any shared key used by press or transit-news work.

Intake runtime bindings:

| Key                             | Purpose                                                                                                                                                                                                                                                                                |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LVBT_MEMBERSHIP_INTAKE_SECRET` | Shared bearer token (a secret string sent in the request's `Authorization: Bearer …` header to prove the caller is allowed; see [glossary](./glossary.md#bearer-token)) used by Apps Script when calling `/api/membership-intake`, and by any other form tool calling `/api/intake/v1` |
| `PLATFORM_DB`                   | Canonical membership database; required before a submission can be accepted                                                                                                                                                                                                            |

Newsletter credentials belong to the [scheduled membership Worker](../../apps/jobs/README.md).
Neither intake endpoint calls Beehiiv or Notion. A successful intake response means canonical
processing completed; newsletter delivery and a personal welcome remain separate work.

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

The Welcome queue replaces the old Notion intake process. `/api/membership-intake` keeps the
original Google Form request format and bearer token, but writes only to the canonical platform. A
successful response is `200 {"success":true}`. The existing Apps Script checks only HTTP status, so
its URL, secret and trigger stay in place. The handler neither reads nor writes Notion, even if old
Notion credentials remain installed. The same release stops membership Notion writes from the
website join form and newsletter box. Their canonical records, queued newsletter work and existing
welcome email remain in place.

Complete the production transition in this order:

1. Select and promote a reviewed website release containing the canonical-only intake handler using
   the normal saved-release procedure. Confirm the staff Welcome queue uses the intended database.
   Keep the form's trigger and original source responses; do not delete the old Notion database.
2. Submit an approved original Google Form response. Confirm its Apps Script execution succeeds,
   then find the canonical member profile and verify the original consent time and Google Form
   attribution. An affirmative newsletter answer creates membership and queued delivery; a blank or
   negative answer must not manufacture consent or a welcome-queue entry.
3. Open **Welcome** as a staff administrator and confirm the eligible new member appears once. Claim
   the entry and verify contact details against the approved response. Release it if the test does
   not include a real personal welcome. Check newsletter delivery separately.
4. Independently inspect the old Notion intake and confirm this response created no page. Replay the
   same original response and verify it creates no duplicate canonical join or Notion page. Preserve
   its original response ID, answers and submission time. Also verify approved website-join and
   newsletter-box fixtures reach their canonical records and welcome email without creating Notion
   pages. Save concise verification in the private launch record; local tests do not establish this
   hosted result.
5. Only after that verification, the president adds a note at the top of the existing Notion intake
   database with the actual cutover date and the Welcome queue link. The note must say that the
   database is retired and new-member follow-up takes place in the Welcome queue.
6. The president makes the old database read-only through its sharing controls and verifies that
   staff can still read historical entries. Remove the old intake writer's ability to add pages to
   that database. Preserve the shared Notion connection needed for press and transit news; do not
   revoke its token as a substitute for retiring membership intake.

The historical source ID may still be needed for an explicitly authorized roster export. It is not
an intake runtime requirement. Historical provisioning and backfill scripts must not be run as part
of normal signup or recovery because they create Notion pages.

### Rollback of the transition

If canonical intake fails, keep the original responses and inspect the canonical record before
retrying: a failed receipt may follow an accepted write. Repair storage or restore a reviewed
canonical-only website release through the saved-release recovery procedure, then replay the same
response. Do not alter consent timestamps, remove accepted member records or disable the form's
trigger to hide an error.

A release predating this change creates Notion pages and requires its former Notion configuration.
Do not activate it against a retired, read-only intake database as an ordinary rollback. If the
organization deliberately resumes that older process, coordinate the database's write permissions,
staff instructions and retirement note before activating that release, then verify both canonical
intake and follow-up again. Keep all existing canonical records and Notion history.

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

| Status | Body                                                   | Meaning                                                                                                               |
| ------ | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `200`  | `{ "success": true }`                                  | Canonical processing completed and any accepted newsletter consent was queued for delivery; no Notion page is created |
| `400`  | `{ "error": "invalid_body" }`                          | JSON body could not be parsed                                                                                         |
| `400`  | `{ "error": "invalid_email" }`                         | Email missing or malformed                                                                                            |
| `401`  | `{ "error": "unauthorized" }`                          | Missing or incorrect bearer token                                                                                     |
| `503`  | `{ "error": "service_unavailable", "missing": [...] }` | A required binding is missing; its name is included for authenticated callers                                         |
| `503`  | `{ "error": "service_unavailable" }`                   | The canonical record could not be saved; retry the same response                                                      |
| `500`  | Cloudflare error page (not JSON)                       | An exception escaped the handler                                                                                      |

The auth check runs before the config check, so only a caller with the correct bearer token sees the
`missing` list. The exception is `LVBT_MEMBERSHIP_INTAKE_SECRET` itself: without it nobody can
authenticate, so it is always reported.

Writing the person record is required before success. A database failure returns `503`; the handler
never falls back to Notion. Newsletter delivery is durable work saved with accepted consent; replays
use the original consent time and cannot reactivate a later withdrawal. Idempotency receipts store
hashed source keys and the original response without retaining contact details.

The endpoint never returns `500` deliberately; if you see one, read the deployment's **Functions**
log in the Cloudflare dashboard.

## Verification

1. Use an approved test response in the intended environment. Submit it through the Google Form.
2. Confirm the Apps Script execution succeeded.
3. Confirm the canonical profile records the original consent time only for an affirmative answer.
   With scheduled newsletter work configured, verify delivery separately in Beehiiv. A blank or
   negative answer must not create newsletter consent or an LVBT join event.
4. Confirm the eligible member appears in the staff Welcome queue and no Notion page was created.
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

- **`503 service_unavailable`**: the intake secret or canonical database is missing, or canonical
  processing failed. A failed receipt may follow a saved person or consent, so inspect the canonical
  record before retrying. Repair the named binding or storage problem in the intended environment,
  then replay the original response. Notion credentials do not repair this path.
- **`401 unauthorized`**: the Apps Script `LVBT_MEMBERSHIP_INTAKE_SECRET` property no longer matches
  the Worker secret.

Replaying the same response is [idempotent](./glossary.md#idempotent): the intake interface
remembers its source and idempotency key for 30 days. The Google Form adapter derives the key from
the original **Response ID**, with an email-and-original-time fallback when that ID is absent.
Preserve the original answers, response identifier and submission time. Accepted consent queues
durable newsletter work; retrying must not manufacture a new choice or reverse a newer withdrawal.
Check delivery through the
[newsletter operations procedure](./staff-portal-operations.md#scheduled-newsletter-processing).

1. Confirm the outage is over: submit a test response and check that the execution succeeds.
2. In **Extensions → Apps Script**, select `backfillMembershipIntake` in the toolbar and press
   **Run**. It replays every stored response and logs one line per response plus a summary. To
   replay only part of the history, call `backfillIntakeSince(new Date('…'))` from a scratch
   function instead.
3. Re-run once any `failed` lines in the execution log have been dealt with.

The Google Sheet stays useful for the full response if a row ever needs to be entered by hand, but
it is not what LVBT treats as the record of who joined — the person record is.
