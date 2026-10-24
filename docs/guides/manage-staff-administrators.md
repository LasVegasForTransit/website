# Manage staff administrators

Use the staff portal to give or remove administrator access. Administrators can read and change all
member records and manage other administrators, so use this role only for people approved for that
responsibility.

## Before you start

- Sign in as an existing administrator at the intended staff portal. Production is
  `https://staff.lasvegasfortransit.org`; isolated tests use
  `https://staff-preview.lasvegasfortransit.org`.
- Confirm the person is a current LVBT member and has their own approved organization account. A
  personal Google account is insufficient for the direct Google mode.
- For the existing Access deployment, confirm their approved entry in
  `console-users@lasvegasfortransit.org`, the Google Group that permits entry through the portal's
  outer sign-in gate. The president maintains this group until its management is automated. Follow
  [maintainer setup](../reference/staff-portal-operations.md#maintainer-setup) for the existing
  Google and Cloudflare configuration.
- Have them sign in once through the deployment’s selected authentication mode and complete
  membership confirmation if requested. This connects their existing member record. It does not make
  them an administrator; they may still see an access-denied page until you finish the grant.

Use synthetic members in preview for testing. Never grant a real person access merely to test the
controls, share an administrator's account, or restore the one-time first-administrator setting for
routine access changes.

## Add an administrator

1. Open **Members**, expand **Member records**, then choose **Staff administrators**.
2. Under **Add administrator**, search by the person's name or membership email.
3. Check the result's name and email. If the person has not confirmed their organization account and
   membership, have them finish the sign-in described above, then search again. If they are not a
   current member, resolve the membership record first; this screen must not create membership for
   them.
4. Open the person's administrator confirmation. Read the access they will receive, then confirm the
   grant. **Cancel** returns without changing their access.
5. Confirm they appear in the administrator list. Have them sign in with their own account and open
   **Members → Member records → Staff administrators** to verify their access.

If the request says the record changed, reopen the confirmation and review the latest details. Do
not keep submitting an expired form or use a database edit to bypass the check.

## Remove an administrator

1. Open **Members → Member records → Staff administrators** and find the correct person.
2. Open their removal confirmation. Check their name and email, then confirm the removal.
3. Confirm they no longer appear in the administrator list. Their broad administrator permission is
   removed; their member record, Google account and applicable committee permissions remain.
4. If they are leaving all staff work, separately review their Google Group and committee access
   through the approved account-offboarding procedure. Removing the administrator designation alone
   does not remove those other responsibilities.

The final active administrator cannot be removed. An old designation on a former member does not
provide a replacement. Add another approved current administrator and verify their sign-in first.
When you remove your own designation while another active administrator remains, the portal signs
you out and confirms the change. Sign in again only to use any other permissions you retain.

## Check or recover a change

The portal records who made each change. For a maintainer's audit, inspect the selected
environment's `staff_admin.manage` entries in the access audit log without publishing personal
details.

If the page closes or the response is lost, reopen **Staff administrators** and check the current
list before acting again. Do not assume an error means the change failed. To reverse an accidental
grant, use the normal removal confirmation; to reverse a removal, grant access again after checking
the person's current membership and organization authentication.

For local acceptance after building the applications, run:

```sh
pnpm -C apps/staff exec node --import tsx tests/e2e/staff-administrators.spec.ts
```

The synthetic fixture covers permissions, confirmation, cancellation, stale and repeated requests,
the final active administrator, audit records and phone layouts. It does not prove a real staff
member's Google Group entry or hosted sign-in; verify those separately with the approved person.
