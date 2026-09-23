# Joining LVBT on the website

This page explains how someone becomes an LVBT member on lasvegasfortransit.org, through the join form at `/join/member` or the newsletter box shown across the site. Read it before changing either form, or when a new member says something went wrong.

For now, being on LVBT's mailing list is what makes someone a member. Both forms subscribe the person in [Beehiiv](./glossary.md#beehiiv) (the newsletter platform) and record them, with evidence of their consent, in the platform database. The Google Form still works as a fallback; see [membership intake](./membership-intake.md).

## How it works

```
/join/member (join form)  ─┐
newsletter box            ─┴─> POST /join/member/
                                 1. discard if the hidden honeypot field is filled
                                 2. refuse the 11th join from one connection in an hour
                                 3. check the fields
                                 4. an address? turn it into a census block, then forget it
                                 5. subscribe in Beehiiv
                                 6. record the person, their consent and "joined" in the database
                                 7. set their region from the address, if it shows one
                                 8. send the confirmation email and add a Notion row for staff
                               -> /join/member/region/   when their region is still unknown
                               -> /join/member/welcome/  "You're in."
```

- **Pages:** `src/pages/join/member/index.astro`, `region.astro` and `welcome.astro`, and `src/pages/join/remove/index.astro`. They are built once, like every other page.
- **Handlers:** `functions/join/`. Each handler fetches its built page and fills in the parts that change per visitor: a one-time form token, the visitor's input and errors after a failed submit, their name on the welcome page. It uses Cloudflare's HTMLRewriter, so the visitor gets finished HTML in one request and everything works with JavaScript turned off.
- **Joining logic:** `platform/join.ts`, with the person record in `platform/storage/`. See the [schema](../../platform/storage/migrations/schema.md) and the [person service](../../platform/storage/person-service.md).
- **Text:** every word comes from the [message catalog](../../platform/messages/README.md).
- **Newsletter box:** `src/components/NewsletterEmbed.astro` posts to the same handler with the consent wording `newsletter-box-v1`. Its small script, `public/scripts/newsletter-subscribe.js`, shows the result in place; without the script the box posts normally and lands on the welcome page.

## What is stored, and what isn't

The person's email address, any name, phone number and ZIP code they typed, and their interests. Their consent is recorded with the exact wording version (`join-form-v1` or `newsletter-box-v1`), so LVBT can always show what someone agreed to.

A street address is never stored. It is sent once to the free [US Census Geocoder](https://geocoding.geo.census.gov/geocoder/), which returns the census block the address falls in, and then forgotten. Only the 15-digit block code, its census year and the ZIP code are kept. Logs say "an address" rather than the address.

The caller's IP address is never stored either: the hourly limit counts a keyed hash of it.

## Regions

When the Geocoder places an address in Henderson, North Las Vegas, Boulder City or one of Clark County's unincorporated places, the region is set exactly. Addresses inside the City of Las Vegas span several regions, so those members, and members who gave no address, choose their region on the next step, or "I'd rather not say". ZIP codes will set a region once the ZIP crosswalk is loaded into the `zip_regions` table.

## Confirmation email and removal link

The confirmation email is sent through Resend when `LVBT_RESEND_API_KEY` is set (see [platform secrets](./platform-secrets.md)). Until then, Beehiiv's own welcome email confirms the subscription instead.

The email's "Not you? Remove this email" link is signed and lasts 30 days. Opening it only shows a button, because email security scanners open links automatically. Pressing the button withdraws the newsletter consent, unsubscribes the address in Beehiiv, and deletes the person if joining was the only thing they ever did with LVBT.

## Verify it works

1. Join at `https://lasvegasfortransit.org/join/member` with a test address you control.
2. The welcome page says "You're in." and names your address.
3. In Beehiiv → Subscribers, the address shows as `active`.
4. Check the database:

   ```sh
   pnpm exec wrangler d1 execute lvbt-platform --remote --command "SELECT id, membership_status, region_id FROM people ORDER BY created_at DESC LIMIT 5"
   ```

5. Open the removal link from the email and press the button, so the test member is removed again.

## Troubleshooting

| Symptom                                      | Cause                                                                | Fix                                                                                                                       |
| -------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| "We couldn't finish joining you just now"    | Beehiiv refused the subscription, or its secrets are missing         | Check the Cloudflare Pages function logs for "Beehiiv subscribe failed" and run `pnpm bootstrap --doctor --phase secrets` |
| Every join shows that message                | The `PLATFORM_DB` binding or `LVBT_LINK_SIGNING_SECRET` is missing   | The logs say which; the binding is set on the Pages project, the secret through `pnpm bootstrap --phase secrets`          |
| No confirmation email                        | `LVBT_RESEND_API_KEY` isn't set, or the Resend domain isn't verified | Set the key; until then Beehiiv's welcome email is sent instead                                                           |
| The region step says it has expired          | More than an hour passed, or cookies are blocked                     | The person is already a member; they can set their region later from their account                                        |
| A join returns a server error after a deploy | A migration wasn't applied                                           | Run the migrations in the [schema](../../platform/storage/migrations/schema.md)                                           |

## Related

- [Membership intake automation](./membership-intake.md): the Google Form fallback and how to switch the front door
- [Platform secrets](./platform-secrets.md)
- [Newsletter operations](./newsletter-ops.md)
