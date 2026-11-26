# Join experience: final UX screenshot account

**Review build:** October 1, 2026 · local production build of the website, recaptured after the
container, breadcrumb, full role posting, and defined assignment revisions · desktop 1440 × 900 and
mobile 390 × 844. The captures are in [`join-ux-screenshots/`](./join-ux-screenshots/) and can be
reproduced with `pnpm -C apps/site exec tsx scripts/capture-join-ux.ts` while the built site is
available at `http://127.0.0.1:4330`.

**Publication state:** Design review only. The project request, committee invitations, member
suggestion, and role treatment are sample content for this review. They are not approved openings.
The forms simulate confirmation; no interest, résumé, application, or inquiry is stored or sent.
Nothing in this review has been deployed. The live `/join` page still uses its current content.

## The experience in order

1. A public visitor sees a short membership invitation, then three clearly distinct paths: requests
   for contributors, volunteer leadership positions, and committees or teams. The visitor can read a
   request and offer help without becoming a member.
2. The contributor request describes the project, names three defined assignments, and opens a short
   dialog. Public visitors enter contact information. Signed-in members see account details that
   cannot be changed in the dialog, with the account link embedded in the note above them. In both
   cases a résumé is optional, followed by a request-specific choice and optional context. Staff
   follow-up is the intended next step. Public confirmation offers membership separately.
3. A member can also start from a member home and answer three short prompts about interest and
   time. The result links to a full opportunity, where the member can decide whether to respond.
4. A leadership posting shows its complete published content before the application dialog.
   Committee and team cards lead to their own descriptions and inquiries. They do not route through
   a contributor application.

## Public joining and contributor request

| Capture                                                                                       | What to review                                                                                    |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [01 · Public Join, desktop](./join-ux-screenshots/01-public-join-desktop.png)                 | Short introduction; three separate opportunity types; compact committee cards.                    |
| [02 · Public Join, mobile](./join-ux-screenshots/02-public-join-mobile.png)                   | Stacked sections and full-width committee cards; membership remains the first action.             |
| [11 · Request, desktop](./join-ux-screenshots/11-contributor-request-desktop.png)             | Direct invitation, project link, three pieces of work, and personal follow-up.                    |
| [12 · Request, mobile](./join-ux-screenshots/12-contributor-request-mobile.png)               | Same reading order and action on a narrow screen.                                                 |
| [13 · Public form, desktop](./join-ux-screenshots/13-public-form-desktop.png)                 | Membership is optional; name, email, phone, résumé, and project choices are visible.              |
| [14 · Public form choices, desktop](./join-ux-screenshots/14-public-form-choices-desktop.png) | Request-specific choices, shared “Not sure yet,” optional context, submit action.                 |
| [15 · Public form, mobile](./join-ux-screenshots/15-public-form-mobile.png)                   | Stacked contact fields and résumé control.                                                        |
| [16 · Public form choices, mobile](./join-ux-screenshots/16-public-form-choices-mobile.png)   | One-column choices and visible context hint.                                                      |
| [17 · Validation](./join-ux-screenshots/17-public-validation.png)                             | Inline email and phone errors before submission. An unselected project choice gets its own error. |
| [18 · Public confirmation](./join-ux-screenshots/18-public-confirmation.png)                  | Staff follow-up first; optional free membership link afterward.                                   |
| [31 · Public confirmation, mobile](./join-ux-screenshots/31-public-confirmation-mobile.png)   | Compact confirmation on a phone, with membership offered separately.                              |

The résumé control follows contact details and precedes the project choices. A real submission must
validate again on the server, store the response, and notify the designated LVBT staff owner. The
visitor must not be enrolled as a member or assigned work by this form.

## Signed-in member path

| Capture                                                                                     | What to review                                                                                       |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [03 · Member home, desktop](./join-ux-screenshots/03-member-home-desktop.png)               | Named project request, committee cards, leadership position, account controls, and one guided entry. |
| [04 · Member home, mobile](./join-ux-screenshots/04-member-home-mobile.png)                 | All sections remain distinct; mobile header uses Account for a signed-in person.                     |
| [05 · Interest, desktop](./join-ux-screenshots/05-member-step-1-desktop.png)                | Action-based interest choices.                                                                       |
| [06 · Interest, mobile](./join-ux-screenshots/06-member-step-1-mobile.png)                  | Same choices without demographic labels.                                                             |
| [07 · Time, desktop](./join-ux-screenshots/07-member-step-2-desktop.png)                    | One task, occasional, or ongoing; stated as guidance, not a commitment.                              |
| [08 · Time, mobile](./join-ux-screenshots/08-member-step-2-mobile.png)                      | Time choices on a phone.                                                                             |
| [09 · Suggestion, desktop](./join-ux-screenshots/09-member-step-3-desktop.png)              | One named project and a link to its detail before any response form.                                 |
| [10 · Suggestion, mobile](./join-ux-screenshots/10-member-step-3-mobile.png)                | Suggestion, availability, and detail action on a phone.                                              |
| [19 · Member form, desktop](./join-ux-screenshots/19-member-form-desktop.png)               | Account details with a link in the explanatory note, then the same project response controls.        |
| [20 · Member form, mobile](./join-ux-screenshots/20-member-form-mobile.png)                 | Account details and résumé on a phone.                                                               |
| [21 · Member confirmation](./join-ux-screenshots/21-member-confirmation.png)                | Uses the account email and does not ask the member to join again.                                    |
| [32 · Member confirmation, mobile](./join-ux-screenshots/32-member-confirmation-mobile.png) | The same member follow-up message in a compact mobile dialog.                                        |

The member flag and account details in these captures are a controlled example. Production must
derive membership and contact data from the authenticated server session. The questions should save
member preferences only when that behavior is explicitly designed and explained in the UI; this
prototype currently uses them only to suggest an opportunity.

## Leadership, committees, and teams

| Capture                                                                                             | What to review                                                                   |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [22 · Leadership role, desktop](./join-ux-screenshots/22-role-desktop.png)                          | Complete published posting, volunteer terms, commitment, and application action. |
| [23 · Leadership role, mobile](./join-ux-screenshots/23-role-mobile.png)                            | Full posting and application action on a phone.                                  |
| [35 · Leadership opening, desktop](./join-ux-screenshots/35-role-opening-desktop.png)               | First viewport: purpose, volunteer terms, commitment, and application action.    |
| [36 · Leadership opening, mobile](./join-ux-screenshots/36-role-opening-mobile.png)                 | First viewport of the full posting on a phone.                                   |
| [24 · Leadership application, desktop](./join-ux-screenshots/24-role-application-desktop.png)       | Contact and optional résumé; no project-work question.                           |
| [25 · Leadership application, mobile](./join-ux-screenshots/25-role-application-mobile.png)         | Compact application dialog on a phone.                                           |
| [33 · Leadership confirmation, desktop](./join-ux-screenshots/33-role-confirmation-desktop.png)     | Separate application confirmation, with staff follow-up.                         |
| [34 · Leadership confirmation, mobile](./join-ux-screenshots/34-role-confirmation-mobile.png)       | Compact leadership confirmation on a phone.                                      |
| [26 · Membership Committee, desktop](./join-ux-screenshots/26-membership-committee-desktop.png)     | Ongoing committee work and an inquiry action.                                    |
| [27 · Membership Committee, mobile](./join-ux-screenshots/27-membership-committee-mobile.png)       | Committee description on a phone.                                                |
| [28 · Public Engagement Team, desktop](./join-ux-screenshots/28-public-engagement-team-desktop.png) | Team work and an inquiry action, separate from positions.                        |
| [29 · Committee inquiry](./join-ux-screenshots/29-committee-inquiry.png)                            | A short, committee-specific choice opens an email draft.                         |
| [30 · Team inquiry](./join-ux-screenshots/30-team-inquiry.png)                                      | Team-specific choices open an email draft.                                       |

The committee and team inquiries are deliberately lighter than a leadership application. Their
availability and staff contacts still require confirmation before they are presented as open ways to
join.

## Review decisions before publication

- **Approve actual openings.** For each contributor request, confirm its project, wording, specific
  pieces of work, staff owner, response capacity, and closing rule. Confirm which leadership roles
  and committees are actively accepting people. Remove any unapproved example.
- **Complete the real response path.** Store a durable interest or application record, keep résumés
  private, notify staff with retry visibility, and show confirmation only after the record is saved.
  Public visitors can respond without membership; a later verified account can be linked to their
  prior response. Committee inquiries need a clear staff destination.
- **Verify with people and devices.** Review the 34 captures, then test keyboard use, screen
  readers, and the real authenticated state on a phone. The visible forms and content here are ready
  for visual review, not live intake.

The existing [join experience design record](./join-experience-vision.md) contains Docket ownership
and the underlying project rationale. This screenshot account is the visual publication gate: no
live release until LVBT approves the actual opportunities to contribute.
