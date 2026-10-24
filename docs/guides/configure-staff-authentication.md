# Configure staff authentication

Use this guide when setting up a staff deployment or changing its sign-in provider. Both supported
modes confirm a member's personal email once and apply current membership and role checks on each
protected request. Authentication configuration does not grant administrator or committee roles.

## Prerequisites

Obtain maintainer approval for the target environment, hostname, identity policy and any live
configuration change. Keep production and preview databases, signing secrets and provider audiences
separate. Back up the selected database and apply canonical migrations, including
`0055_staff_sso.sql`, before releasing the new application. Use the normal
[staff release procedure](../reference/staff-release-operations.md); do not deploy directly.

Both modes require `LVBT_SIGN_IN_SECRET`, a private independently generated signing secret, and
`LVBT_RESEND_API_KEY` for membership confirmation emails. Never copy working credentials into source
or a screenshot fixture. The [environment example](../../apps/staff/.env.example) lists bindings.

## Choose a mode and origin

Set `LVBT_STAFF_AUTH_MODE` in the selected deployment configuration:

| Value               | Authentication behavior                                                           |
| ------------------- | --------------------------------------------------------------------------------- |
| `cloudflare-access` | Verify the Access application assertion and continue without another Google flow. |
| `google`            | Start direct Google OAuth without requiring or contacting Access.                 |

An omitted mode defaults to `cloudflare-access` for existing deployments. An empty or unknown mode
refuses requests. A missing or invalid Access assertion never selects Google automatically.

Set `LVBT_STAFF_ORIGIN` to the exact canonical HTTPS origin, such as `https://staff.example.org`,
without a trailing slash, path or credentials. Optional `LVBT_STAFF_PREVIEW_ORIGINS` is a JSON array
of explicitly approved HTTPS origins. Approve each preview's provider callback and policy
separately. Unlisted request origins are refused. With no configured origin, the existing LVBT staff
hosts are retained for compatibility. Authentication supports an independent hostname; migrating the
Workers, D1, assets and service-binding runtime to another host remains separate work.

## Configure Cloudflare Access

1. Protect every approved staff hostname with its intended Access application and organization-user
   policy. Exclude service tokens from human sign-in. Review alternate hostnames and asset routes.
2. Set `LVBT_ACCESS_TEAM_DOMAIN` to the team hostname, without a scheme or path, and
   `LVBT_ACCESS_AUD` to the exact application's audience. Keep preview and production audiences
   separate.
3. Keep the selected mode `cloudflare-access`. Google OAuth client credentials are unnecessary for
   staff authentication in this mode; Google provisioning integrations have their own credentials.
4. Release the reviewed artifact and run `pnpm -C apps/staff preflight --preview` with the approved
   read-only provider credentials as described in the release procedure. Review every failed or
   unverified check before promoting production.
5. With an approved test member, sign in through Access, confirm the membership email if requested,
   and verify the expected staff or paper-only destination. Repeat without an assertion and with an
   unauthorized account; both must be refused without a Google fallback.

Access subjects are stored as provider-scoped authentication links. They are never Google account
IDs. Existing Google-backed application sessions do not automatically establish an SSO link, even
when the email matches. The first visit after switching providers may require membership email
confirmation; later visits reuse the established link.

## Configure direct Google sign-in

1. Set the selected mode to `google` and the canonical origin to the intended HTTPS staff host.
2. Create or select an approved Google OAuth web client. Register every intended callback exactly:
   `<origin>/sign-in/google/callback`, without a trailing slash. Set `LVBT_GOOGLE_OAUTH_CLIENT_ID`
   and `LVBT_GOOGLE_OAUTH_CLIENT_SECRET` through the deployment's credential manager. Require an
   LVBT organization account.
3. Release and inspect the deployment using the normal release procedure. Direct mode does not
   require Access audience, team domain, headers, cookies or Access network connectivity. When
   removing the outer Access policy, first verify that the selected artifact uses direct mode and
   rejects unauthenticated protected pages and mutations.
4. Verify direct Google sign-in, browser-bound callback, membership confirmation, authorized landing
   page, denied account, sign-out and an expired form. Repeat with Access headers absent. A forged
   Access header must not grant a session.

Google state, nonce, PKCE, verified ID tokens and browser-bound callback tickets remain mandatory.
Changing mode preserves members, roles and real Google account IDs; sessions from the other mode
cannot authenticate the new mode. Never copy an Access subject into a Google identity to recover.

## Initialize and manage administrators

For an empty administrator roster, temporarily configure `LVBT_INITIAL_STAFF_ADMIN_WORKSPACE_EMAIL`
with the approved president's organization email. That person signs in using the selected mode and
confirms membership, then submits **Set up staff access**. Verify the designation and its audit
record, then remove the temporary configuration. Existing administrator designations cannot be
replaced through this initial setup.

A confirmed organization authentication link is sufficient for administrator eligibility. A real
Google Workspace identity remains a separate fact for Google provisioning and offboarding. See
[manage staff administrators](manage-staff-administrators.md) for role changes.

## Verify sign-out, revocation and recovery

Signing out ends the application session. In Access mode a signed, principal-bound browser marker
prevents automatic sign-in for up to 30 days, including after SSO credential renewal; **Continue to
Staff** explicitly starts again through a same-origin form. The page does not claim to sign out the
organization's identity provider. Clearing browser storage also clears this local sign-out
preference.

Revoking an SSO link prevents session renewal and membership confirmation from silently restoring
it. Membership withdrawal, profile deletion and current role changes take effect on protected
requests. Erasure retains only the revoked provider identifier needed to prevent rebinding; it
clears pending credentials, email and personal copies in merge history. Merge and undo revoke
sessions and preserve the original principal ownership; conflicting ownership fails closed.

If configuration checks fail, restore the reviewed origin and mode and verify the selected
provider's credentials and callback. Do not enable automatic fallback. If a release must be rolled
back, use the saved reviewed release and account for sessions and links created after it. Prefer a
forward repair for authentication data; do not reverse migrations or restore personal data from
snapshots. Confirm both intended access and a denied account before declaring recovery complete.

## Prepare a volunteer's account

Connect a provisioned Workspace account to the correct person while issuing the account. The saved
identity must include the real Google account ID, its current LVBT Workspace email and the
`created_by_platform` or `staff_confirmed` link method. Do not guess a person from their name or
personal email. Direct Google sign-in uses that Google ID; Access uses its independently verified
principal and this explicit provisioning association. Ambiguous associations require account
recovery rather than automatic linking.

Prepared volunteers see a short welcome and continue to their permitted tools. Unlinked volunteers
can connect an existing member account by email code or their signed-in member session, or create a
team account using their name and verified Google account. Creation does not subscribe them to the
mailing list or grant an administrator role. Team-only accounts have basic paper-entry access.

Apply migration `0056_staff_accounts.sql` to the shared member/staff database before using this
flow. The public website and Staff Portal must use that same database and `LVBT_SIGN_IN_SECRET` for
the member-session handoff. Deploy both applications from a compatible release. If the member site
has a different origin, set `LVBT_MEMBER_ORIGIN` on the Staff Portal to its exact HTTPS origin;
otherwise the canonical public site, or public preview for staff previews, is used. Cookies remain
host-only. Test a signed-in member connection across the actual origins before launch.

If a connection expires, restart it from the Staff Portal. If accounts conflict, inspect their saved
bindings and use the established account recovery procedure; never change an ID to make a login
pass. If a release must be rolled back, preserve the additive tables and roll back both applications
together. Do not delete account bindings or recreate people to recover a deployment.

Changing accounts in direct mode requests Google's account selector. In Access mode it uses the
[documented Access logout endpoint](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/#log-out-as-a-user),
which also revokes that user's Access sessions across applications. Re-authentication and account
selection depend on the configured identity provider; verify this provider behavior separately from
local portal checks.
