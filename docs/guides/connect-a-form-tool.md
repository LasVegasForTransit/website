# Connect a form tool to LVBT's member list

This guide shows how to connect any outside form tool, such as a Google Form, Jotform or Typeform, so that the people who fill it in become LVBT members, just as they would through the website's join form. Follow it when LVBT starts using a new sign-up form, or when the website's own form is ever replaced.

The form tool sends each submission to LVBT's **intake interface**: a web address that accepts a sign-up as JSON (a plain-text data format) and adds the person to LVBT's person record. It is versioned, so the format below stays the same until a version 2 exists.

> **Before you start.** You'll need the intake token, which is the value of `LVBT_MEMBERSHIP_INTAKE_SECRET`. Ask an LVBT admin for it, or find it in the Google Form's Apps Script under Project Settings → Script Properties. Treat it like a password: anyone with it can add sign-ups.

## What to send

Send a `POST` request to `https://lasvegasfortransit.org/api/intake/v1` with two headers and a JSON body:

```
Authorization: Bearer <intake token>
Content-Type: application/json
```

```json
{
  "idempotencyKey": "jotform-2026-10-05-8f3a",
  "source": "external_form",
  "submittedAt": "2026-10-05T18:22:10Z",
  "person": {
    "givenName": "Ana",
    "familyName": "Reyes",
    "email": "ana@example.org",
    "phone": "+17025550100",
    "zip": "89104"
  },
  "consent": { "newsletter": true, "wordingVersion": "jotform-2026-10" },
  "interests": ["events"],
  "heardFrom": "A friend"
}
```

| Field                                   | Required | What it is                                                                                                                                                                                                       |
| --------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `idempotencyKey`                        | Yes      | A value unique to this one submission, such as the form tool's response ID. If the same key arrives again within 30 days, LVBT answers as it did the first time and changes nothing, so retrying is always safe. |
| `source`                                | Yes      | `google_form`, `external_form` for any other tool, or `join_form`.                                                                                                                                               |
| `submittedAt`                           | Yes      | When the person submitted the form, as a date and time like `2026-10-05T18:22:10Z`.                                                                                                                              |
| `person.email`                          | Yes      | Their email address.                                                                                                                                                                                             |
| `person.givenName`, `person.familyName` | No       | Their first and last name.                                                                                                                                                                                       |
| `person.phone`                          | No       | A US phone number with its area code.                                                                                                                                                                            |
| `person.zip`                            | No       | A 5-digit ZIP code.                                                                                                                                                                                              |
| `consent.newsletter`                    | No       | `true` only if the form asked them to join LVBT's mailing list and they said yes. This is what makes them a member: LVBT then subscribes them to the newsletter.                                                 |
| `consent.wordingVersion`                | No       | A short name for the exact consent sentence your form shows, such as `jotform-2026-10`. Change it whenever you change that sentence, so LVBT can always show what someone agreed to.                             |
| `interests`, `heardFrom`                | No       | Anything else worth keeping: a list of interests, and how they heard about LVBT.                                                                                                                                 |

Never send a street address. LVBT doesn't store them; the website's join form turns an address into a census block and throws it away.

## What you get back

| Status | Body                                                                        | Meaning                                                                                                                                    |
| ------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 200    | `{ "action": "created" }`                                                   | A new person was added.                                                                                                                    |
| 200    | `{ "action": "linked" }`                                                    | The submission matched someone LVBT already knew, by email address, and was added to their record.                                         |
| 400    | `{ "error": "invalid_fields", "fields": ["person.email"], "message": "…" }` | Some fields are missing or malformed. `fields` names them; the values you sent are never repeated back.                                    |
| 401    | `{ "error": "unauthorized", "message": "…" }`                               | The token is missing or wrong. Nothing was saved.                                                                                          |
| 503    | `{ "error": "not_configured" \| "unavailable", "message": "…" }`            | The site isn't set up, or the newsletter service didn't answer. Send the same submission again later; the idempotency key makes that safe. |

The answer never says anything about any other person, so the interface can't be used to find out who is on LVBT's list.

## Test it with curl

`curl` is a command-line tool for sending web requests. Replace `<intake token>` and run this on your computer. Use your own email address, because this adds a real member and subscribes you to the newsletter:

```sh
curl -sS https://lasvegasfortransit.org/api/intake/v1 \
  -H "Authorization: Bearer <intake token>" \
  -H "Content-Type: application/json" \
  -d '{"idempotencyKey":"test-'"$(date +%s)"'","source":"external_form","submittedAt":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'","person":{"email":"you@example.org"},"consent":{"newsletter":true,"wordingVersion":"test"}}'
```

You should see `{"action":"created"}`. Sending a request with the same `idempotencyKey` again returns that same answer; the command above makes a new key each time, so running it again says `linked`. Unsubscribe from the welcome email afterwards if you don't want to stay on the list.

## Worked example: the Google Form

The LVBT Google Form uses an Apps Script that runs on every submission and posts to the older address, `/api/membership-intake`, in its own format. That address still works: it subscribes the person, adds a row to the Notion intake database for staff follow-up, and records them in the person record as a `google_form` submission with the consent wording `gform-2026-06`. The script is in `scripts/google-apps/membership-intake.gs`, and [connect the membership form](./connect-the-membership-form.md) explains how to install it.

A new form tool should use `/api/intake/v1` directly, as above.

To send people to an outside form instead of the website's own join form, see "Switching the membership front door" in [membership intake](../reference/membership-intake.md).
