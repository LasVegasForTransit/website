# Staff Portal account setup

## Purpose

Volunteers with an LVBT Google account are already on the team. Staff Portal setup connects that
account to their LVBT record; it does not ask them to join the organization again. The product name
is **LVBT Staff Portal**.

## Prepared accounts

An operator-provisioned Workspace identity supplies the person association. Direct Google sign-in
uses its verified Google subject. Access sign-in may connect a verified Access principal to exactly
one explicitly provisioned Workspace identity with the same organization email. It never matches a
personal email or name, invents a Google subject, or replaces an existing or revoked principal link.

After authentication, show **Welcome, Avery**, or **Your account is ready** when no first name is
saved. Explain: **Your account is ready. Continue to the tools for your LVBT work.** Show the
verified LVBT Google account in a bounded card with **Change account**, then **Continue**. Existing
authorized sessions can return directly to their destination.

## Unlinked accounts

Show **Finish setting up** with the Google account card and **Do you have an LVBT member account?**
The choices are **Yes, sign in** and **No, create one**.

Existing account holders can verify their member account email with a code. The final action says
**Verify and connect accounts**. Someone already signed into the member site can use that session
instead: the member site asks them to continue, and the Staff Portal shows both accounts before
**Connect accounts**. The handoff is expiring and bound to the portal browser's pending login and a
live member session; no session token travels in a URL.

New account holders provide their name, prefilled from verified Google claims when available, then
choose **Create account**. Their verified Workspace email is sufficient. Personal email and mailing
preferences are separate later choices. Account creation does not create newsletter consent, voting
membership, committee assignments, or administrator rights. A new team account can use the basic
paper-entry tools; privileged work still requires the established membership and role checks.

## Recovery and security

Changing Google accounts clears the local session, pending link, email challenge and member handoff.
Direct mode requests Google's account selector. Access mode leaves through the application's Access
logout endpoint, so the next identity must be verified by Access again. Provider login and account
selection remain outside the portal's control.

Codes expire and have bounded attempts. Creation is atomic, refuses existing or conflicting
identities, and consumes its pending proof once. Former members, erased people and revoked
principals cannot use setup to bypass restrictions. Account linking never silently merges people.
Erasure, merge and undo must preserve ownership and invalidate pending access.

## Acceptance

Exercise prepared accounts, existing-account codes, new accounts, signed-in member handoffs, account
changes, wrong and expired codes, conflicts, concurrent creation, erasure and revocation in both
authentication modes. Verify destinations with actual role permissions. Review mobile, desktop,
light and dark renderings, and require a passing root `pnpm check` and compiled browser journeys.
Local tests do not establish live provider or deployment acceptance.
