# Membership intake automation

How Google Forms submissions become newsletter subscribers and Notion intake records.

## System boundary

```
Google Form
  -> installable Apps Script form-submit trigger
  -> POST /api/membership-intake
  -> Beehiiv subscription
  -> Notion intake page
```

For v1, the Google Form response sheet remains the canonical full-response record. The Cloudflare Pages Function is the owned pipeline boundary: it validates the request, subscribes the person in Beehiiv, and creates an operational Notion page for follow-up.

## Where the form is surfaced

The Google Form is the canonical front door for new members. The site links to it from the `/join` "Become a member" CTA and the `/qr` presenter deck's "Join" slide. The public link is configured once, as the `forms.gle` short link, in `PUBLIC_LVBT_MEMBERSHIP_FORM_URL` (see `.env.example` and `src/lib/site.ts`). The short link is used because the QR encoder caps at 84 bytes; it resolves to the canonical `https://docs.google.com/forms/d/e/1FAIpQLSfE28qUHn9A_cYpEtz4OV9NvQLkhlVVwaMvho_fCS_SI34CwQ/viewform`. If the var is unset, `/join` falls back to the general-interest email and the QR "Join" slide is omitted.

The inline newsletter box (`NewsletterEmbed` → `/api/subscribe`) is a separate, lighter path for email-only updates and is not part of membership intake — see [newsletter-signup.md](./newsletter-signup.md).

## Required Cloudflare Pages secrets

The fastest path is `pnpm bootstrap --phase env`: it prompts for the Beehiiv and Notion values, mints `LVBT_MEMBERSHIP_INTAKE_SECRET` for you (and echoes it so you can paste the same value into Apps Script), and writes everything to `.env.local`. A later `pnpm bootstrap --phase deploy` pushes them to Cloudflare Pages as **Production** secrets. The **Preview** environment still needs them set by hand in the dashboard.

The five secrets:

| Key                             | Purpose                                                                  |
| ------------------------------- | ------------------------------------------------------------------------ |
| `LVBT_MEMBERSHIP_INTAKE_SECRET` | Shared bearer token used by Apps Script when calling the intake endpoint |
| `LVBT_BEEHIIV_API_KEY`          | Beehiiv API key with subscriber write access                             |
| `LVBT_BEEHIIV_PUBLICATION_ID`   | Beehiiv publication ID, starting with `pub_`                             |
| `LVBT_NOTION_API_KEY`           | Internal Notion integration secret                                       |
| `LVBT_NOTION_DATA_SOURCE_ID`    | Notion **data source** ID for the intake table (see note below)          |

To set the intake secret without bootstrap, generate one with `openssl rand -hex 32` and use the same value in both Cloudflare Pages and the Apps Script script property.

## Notion setup

Create a Notion database for membership intake and share it with the internal integration. The integration needs Insert Content access.

The endpoint creates pages under a **data source**, not a database directly (the post-2025-09 Notion API splits the two). Copy the data source ID — not the database ID — into `LVBT_NOTION_DATA_SOURCE_ID`. Retrieve it by calling the API's retrieve-a-database endpoint, or from the database's `•••` menu under Manage data sources; for a single-source database it is distinct from the database ID you see in the page URL.

The endpoint writes these properties:

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

Responses:

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
3. Confirm Beehiiv shows the subscriber as `validating`.
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

Prefer manual Notion entry over re-running the execution. A re-run re-POSTs the whole payload: Beehiiv is idempotent (`reactivate_existing: true`), but Notion has no dedupe and would create a **second** page for the same person.
