# Staff authentication with optional SSO

## Intent

A staff member who has already signed in through the deployment's SSO gateway should enter the staff
app without signing in to Google again. A deployment without that gateway must retain a complete
direct Google sign-in path. Membership confirmation and authorization remain application
responsibilities in both modes.

## Current constraints

The gateway and middleware currently require a Cloudflare Access assertion on every request. The app
then requires a separate Google-backed session, and its initial administrator, membership linking,
and volunteer admission logic assume that this session has a Google Workspace identity. The current
origin checks also recognize Cloudflare-specific hosts.

Cloudflare Access subjects and Google subjects identify different things. The Access subject must
never be stored as a Google account ID. Google directory reconciliation and provisioning must keep
using actual Google identity records.

## Approaches

### Two explicit authentication adapters with shared application identity

Recommended. The deployment chooses `cloudflare-access` or `google`. Each adapter verifies its own
credentials and produces a trusted principal. Shared application code resolves that principal to a
member, creates an application session, and evaluates current permissions. This removes the extra
sign-in and retains a deployment option without an SSO gateway.

### Automatically redirect everyone through direct Google OAuth

This would remove the intermediate button and preserve the existing identity schema, but it would
still perform a second authentication exchange after Access. It does not reuse SSO as requested.

### Fall back to Google whenever the Access assertion is missing

Rejected. Missing or invalid gateway credentials must not silently select a weaker deployment
policy. A provider outage, an unprotected alternate hostname, and a deliberate deployment change are
different conditions.

## Proposed deployment contract

Introduce `LVBT_STAFF_AUTH_MODE=cloudflare-access|google`. Existing deployments retain the Access
mode by default. Invalid values fail closed. Google mode is an explicit operator choice, and it
works without any Access headers, audience, team domain, cookies, or network calls.

Define the staff application's canonical HTTPS origin independently of the hosting provider. Use it
consistently for routing, callback approval, same-origin form checks, and deployment preflight.
Retain explicit additional preview origins; do not permit arbitrary redirect hosts. Changing
authentication mode or origins requires deployment configuration, never a request header.

This change makes authentication portable. Moving the remaining Worker, database, asset, and
service-binding runtime to another host is separate work.

## Trusted principals and persisted links

Represent authentication principals by provider, issuer, and subject, with a verified organization
email and credential expiry. Cloudflare asserts identity only after signature, issuer, audience,
algorithm, required claims, expiry, and organizational domain validation. Direct Google retains its
verified ID-token, state, nonce, PKCE, and browser-binding checks.

Persist a distinct SSO-principal-to-person link, scoped by issuer and subject. Keep Google Workspace
identities unchanged. An Access email match alone must not claim an existing member or Google
identity. Unknown SSO principals complete the existing membership email confirmation before their
link is saved, including when an existing Google-backed application session has the same email.
Ambiguous or conflicting links are refused.

A linked SSO principal proves organizational sign-in for staff and volunteer admission. This fact is
distinct from having a provisionable Google account. Adapt those admission checks without inventing
Google identities or granting administrator or committee roles. Keep Google provisioning and
offboarding checks tied to actual Google account linkage; use a separate organizational
authentication fact for admission. Initial administrator setup must accept the selected mode's
verified organization principal while retaining the approved president-email restriction,
active-membership check, single-use initialization, and audit trail.

Existing Google session and identity records remain valid in direct mode. Switching modes preserves
member records, roles, and Google integration IDs; a previously unbound provider identity may need
one membership confirmation. Do not automatically merge people based on matching addresses.

## Session and navigation behavior

In Access mode, a validated gateway identity starts or resumes the shared app session. Existing
members go directly to the requested authorized page; new identities go to membership confirmation.
No ordinary Access-mode visit shows a second Google sign-in button. Every protected request still
requires a valid matching Access principal and current application authorization.

In Google mode, unauthenticated visitors see the shared sign-in page and use direct Google OAuth.
Successful sign-in enters the same membership and role-routing flow. Missing Access configuration is
irrelevant in this mode. Spoofed Access headers cannot create or strengthen a Google-mode session.

Application sessions record their authentication source and principal binding. Recheck active
membership, deletion, role changes, and principal mismatch before protected actions. Bound session
lifetimes to the verified credential where applicable. Routine session expiry may renew through a
valid Access principal, but a revoked authentication link must block renewal and automatic
re-enrollment through membership confirmation. Preserve same-origin POST protections,
private/no-store responses, noindex headers, CSP, safe return destinations, and JavaScript-free
forms.

Sign-out must end the application session and prevent immediate automatic recreation from an
existing SSO assertion. Use a signed, bounded-lifetime logout marker and an explicit same-origin
POST to continue after sign-out. Only claim that the identity provider is signed out when its logout
flow has actually completed. A POST received without a valid application session must not be
replayed automatically after authentication.

## Rollout and recovery

Add migrations for provider-scoped authentication links and session provenance without replacing
Google identity IDs. Update session revocation, person erasure, merge/undo bookkeeping, and retained
history to include the new records and prevent erased principals from being restored. Merge and undo
revoke affected sessions; links move and restore with their original provider, issuer, and subject
ownership, and conflicting bindings fail closed. Erasure retains only the identifier or tombstone
needed to prevent rebinding, clears email and pending credentials, and removes personal copies from
merge and audit snapshots in line with the existing Google erasure model.

Update staff preflight, release configuration, setup, origin checks, and operating guides for both
modes. Preflight must distinguish missing Access configuration from missing Google OAuth
configuration according to the selected mode. Keep the current deployment explicitly on Access.

Review and test the local implementation before any live configuration change or migration. Back up
the selected database before a later authorized release. Rollback must account for sessions and
links created in the new mode; never repurpose an SSO subject as a Google identity to recover.

## Acceptance

- An Access-authorized existing member enters a permitted page without Google OAuth or a second
  sign-in prompt; a new SSO identity completes membership confirmation once.
- Missing, expired, forged, wrong-issuer, wrong-audience, non-user, or mismatched Access assertions
  are denied in Access mode without falling back to Google.
- Direct Google mode completes sign-in, membership linking, initial administrator setup, normal
  staff and paper-only volunteer access with Access entirely absent.
- Mode switches preserve member roles and genuine Google account IDs without email-only linking.
- Sign-out stays signed out until an explicit new sign-in; deletion, revocation, and provider
  mismatches immediately prevent protected actions in both modes.
- Erasure and merge/undo tests cover the added links and session provenance.
- Both modes have compiled-runtime acceptance, private asset/gateway checks, mobile and desktop
  rendered review, and a passing `pnpm check`.

## References

- [Cloudflare application token and identity claims](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/)
- [Cloudflare identity handoff to origins](https://developers.cloudflare.com/cloudflare-one/tutorials/extend-sso-with-workers/)
