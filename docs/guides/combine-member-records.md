# Combine duplicate member records

Use this procedure when an LVBT administrator has confirmed that two entries belong to the same
person. Shared contact information alone is not confirmation: relatives can share an email address
or phone. If the entries are different people, keep them separate instead.

## Before you start

Sign in to the staff portal with an active LVBT membership and current administrator access. Compare
the entries with the person or a reliable existing record. When combining entries, write a brief
reason that explains the decision without adding sensitive personal details.

## Combine the entries

1. Open **Members**, expand **Member records**, and choose **Check for duplicate members**.
2. Open the possible match and compare **New entry** with **Already on our list**.
3. For different people, choose **Keep separate**. LVBT records your decision and who made it. The
   same pair will not be proposed again for the same reason.
4. For the same person, open **Combine if they are the same person**. The earlier-created record is
   kept automatically. Its existing details take precedence; missing details and both histories are
   combined. Enter the reason and select **Combine entries**.
5. Confirm **Entries combined**, open the member's current profile, and review their contact details
   and committees. Correct a detail through **Edit details** when the member confirms a different
   value. An old profile link leads to the current member profile.

Conflicting email addresses, linked accounts or current committee assignments can prevent a safe
combination. Stop and review those conflicts; do not remove accounts or assignments just to force
the operation through. Already-combined entries cannot be combined again to form a loop.

The combined-away profile keeps its identifier with personal fields cleared. The private merge
record preserves original fields and sources needed for undo. Sessions and pending sign-in codes for
both entries are invalidated, and the staff member and time are recorded. The database changes
together or rolls back together. Provider access updates remain separate work; a successful
combination does not prove that Discord or Google has finished updating.

## Undo a mistaken combination

1. Open the combination's **Entries combined** page. Check the two entries and original reason.
2. Enter **Reason for undoing**, then select **Undo combination**.
3. Confirm **Combination undone**. Review both restored profiles before making further changes.

Undo restores original row ownership and saved profile fields. Activity or accounts added to the
surviving person afterward remain there. Later withdrawals continue to take precedence; undo does
not invent consent, recreate a disconnected account, or restore erased personal data.

If a surviving entry was combined again, undo the later combination first. Then return to the
earlier combination. This order keeps each operation's original history intact. An entry whose
personal data has been erased cannot be restored through undo.

## When an operation is refused

- **Already combined:** open the current profile rather than attempting another combination.
- **A later combination exists:** undo that later operation first, then return to this one.
- **Details, accounts or access changed:** review the current entries. Undo refuses unsafe changes
  rather than overwriting them. Do not edit the saved merge record or bypass database guards.
- **Access denied or the form expired:** sign in again or reopen the current page. Existing sessions
  are intentionally ended by a completed combination or undo.

An operation identifier is bound to its requester and exact request. A retry of the same authorized
request returns its existing result; a different request cannot reuse that receipt. If the result is
unclear, inspect the current combination and profiles before submitting a new decision.
