# Newsletter publishing

<a id="newsletter-operations"></a>

Newsletter editors use Beehiiv to publish LVBT Updates. Contributors use this reference to
distinguish issue publishing from the website's signup and delivery code. The repository fetches
published issues from Beehiiv's RSS feed, a list of recent posts, and links to them from
`/newsletter`.

The [earlier Ghost proposal](../explanation/decisions/newsletter-platform.md) is a historical
decision record. Use the Beehiiv instructions here for current publishing.

For the current implementation, use these references:

- [Joining LVBT](./newsletter-signup.md) explains how the website saves consent and queues delivery.
- [Scheduled newsletter processing](./staff-newsletter-operations.md#scheduled-newsletter-processing)
  explains Beehiiv configuration, polling, rollout limits and failure recovery.
- [Newsletter follow-up](./staff-newsletter-operations.md#resolve-newsletter-follow-up) explains how
  staff resolve differences between the mailing list and a member record.
- [Content collections](./content-collections.md#newsletter-issue) explains how published issues
  appear on the website.

Before sending an issue, you need authorized access to the LVBT Updates publication and permission
to send to its audience. Website repository access does not grant either permission. Confirm the
publication and recipients in Beehiiv before sending.

## Surface

Beehiiv hosts the published newsletter. `PUBLIC_LVBT_NEWSLETTER_FEED_URL` selects the feed used at
build time; `PUBLIC_LVBT_NEWSLETTER_URL` selects the newsletter home link. Both settings are listed
in [`apps/site/.env.example`](../../apps/site/.env.example). A new issue appears on the public
website after a refreshed build is promoted.

## Authoring/send workflow

Write and review the issue in the selected Beehiiv publication. Use the pre-send checklist below
before an authorized sender publishes or sends it. Confirm that a linked website article is live on
the public hostname; a preview link is not a published article.

Publishing a website post does not send an email. Send the reviewed issue through Beehiiv.

## Domain authentication (one-time setup)

A maintainer must configure the records shown by the selected sending provider. Domain Name System
(DNS) records identify the servers and keys allowed to send mail for LVBT. SPF lists allowed sending
servers, DKIM signs messages, and DMARC tells receivers how to handle messages that fail checks. See
[email authentication](./glossary.md#email-auth).

Inspect the existing Beehiiv setup and obtain authorization before changing records. The website's
separate Resend sending domain has its own
[setup procedure](./platform-secrets.md#resend-sending-email).

## CAN-SPAM compliance

CAN-SPAM is a United States email law. This reference is not a legal determination of which
requirements apply to a particular LVBT message. An authorized sender must use the organization's
approved sender identity, mailing address and unsubscribe footer. Verify those fields in the test
message; do not assume a template includes them after an edit.

## Subscriber data

Use the membership database to establish the person's consent and membership. Beehiiv's current
subscription status describes delivery and can require staff review; it does not establish the
original date or wording of a person's choice.

Use the approved [member export](../guides/export-a-member-record.md) and
[data retention](../guides/operate-member-data-retention.md) procedures for privacy requests. Keep
exports, contact details and provider credentials private.

## Subscribe form on the main site

The join form and newsletter box submit to `POST /join/member/`. They save a member record and
newsletter consent, then queue delivery. See [Joining LVBT](./newsletter-signup.md) for the request
flow and verification.

## Cost ladder

Keep the current Beehiiv Free-plan constraint for scheduled membership processing. An integration
failure does not authorize a paid upgrade. A platform or plan change needs a separate maintainer
decision and a migration plan that preserves consent and unsubscribe history.

## Pre-send checklist

The authorized sender checks the actual test message before sending:

- [ ] The selected publication and recipients match the approved audience.
- [ ] The subject accurately describes the issue, and the introduction explains its purpose.
- [ ] Every link opens the intended public page, including links imported from a feed.
- [ ] Images load from permanent public addresses.
- [ ] The sender identity, unsubscribe link and approved mailing address appear.
- [ ] The test reads correctly on a phone and a desktop, including a Gmail inbox.
- [ ] Every linked website article is public and has no preview indexing restriction.

Gmail's Promotions tab does not by itself mean delivery failed. Check the received message and
provider status separately.

## Common failure modes

If the website omits an issue, check whether Beehiiv published it, whether the configured feed
contains it and whether a refreshed release reached production. A feed change cannot update an
already built page.

If a new member is missing from Beehiiv, inspect the saved member record and scheduled delivery
status using [newsletter operations](./staff-newsletter-operations.md). Do not submit another signup
with a new consent time to hide a failed delivery.

If messages fail to arrive, inspect the selected publication's delivery status and sending-domain
checks. Do not reactivate an unsubscribed address without a newer valid signup. If a test renders
badly, correct the issue before sending it to the list.

<a id="future--out-of-scope"></a>

## Related

- [Comms strategy](../explanation/comms-strategy.md) explains the editorial goals.
- [Newsletter platform decision](../explanation/decisions/newsletter-platform.md) records the
  earlier Ghost proposal.
- [Staff publishing decision](../explanation/decisions/staff-publishing.md) covers website editing.
