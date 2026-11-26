# Joining and contributing to LVBT: prototype record

**September 30, 2026.** Coded design prototype at `/prototypes/join/vision/`. It is not a production
change. The contributor and leadership dialogs simulate submission, including résumé selection, and
save, upload, or send nothing; the committee examples still open email drafts. Use
`?presentation=1#join` to hide prototype navigation while reviewing a screen. Use
`?presentation=1#interest` for the public contributor dialog and `?presentation=1&member=1#interest`
to review its signed-in member variant with example account data.

## The design decision

Keep public `/join` short. It introduces free membership and links to the existing form. Below that,
it separates bounded requests for contributors, ongoing leadership positions, and committee/team
membership. The current Technical Lead posting and a drafted request for Transit Accountability
Briefs show the two different kinds of work. An events link remains for visitors who want to meet
LVBT first; an event series is not presented as an opening.

The public membership introduction uses the site's existing 2028 service cuts and 2027 legislative
session examples. They make the reason to join concrete without turning the page into a campaign
landing page. Requests use direct work verbs; role listings identify leadership and commitment;
committee cards name the ongoing work of a group. Each category has its own response path.

A request for contributors is an entry point into a conversation with LVBT staff. The public request
describes where help is useful; the response form does not assign a task or enroll someone on a
team. After someone expresses interest, staff receive a notice and personally reach out to discuss a
specific way to contribute. The same response pattern should work across contributor requests.

Move the guided interest flow to the signed-in member experience. The member home shows named work,
account links, and a single entry into the questions. The questions help members find an
opportunity; they do not determine who counts as a member, assign a team, or ask them to identify
their age, job, or family situation.

## What each screen does

| Screen                 | What a person can see or do                                                                                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public Join            | Join directly, then browse separately organized project requests, leadership positions, and committee/team cards. Events stay a secondary link.                                                                                                   |
| Member home            | See separate project requests, committees/teams, and leadership positions; change interests or reach account controls. Only confirmed openings belong in production.                                                                              |
| Member questions, 1    | Choose one interest: meet people, learn, give public comment, contribute to a project, or help members get involved. These are actions, not demographic labels.                                                                                   |
| Member questions, 2    | Choose one amount of time: one event/task, occasionally, or regularly. This is explicitly not a commitment.                                                                                                                                       |
| Member questions, 3    | See one named LVBT project, its source program and time. Open the detail page before sharing contact details. Back preserves choices.                                                                                                             |
| Contributor request    | See a direct invitation to work on an LVBT brief, three defined assignments and their outputs, and a clear explanation that LVBT staff will confirm the assignment and follow up personally.                                                      |
| Contributor dialog     | See that membership is not required; provide contact details, optionally attach a résumé, pick one area of interest or “not sure yet,” and add brief context if useful. The submit state explains staff follow-up and offers optional membership. |
| Signed-in form         | See name, email, and phone from the LVBT account as fixed values, with an account link in the explanatory note; answer only the request-specific questions.                                                                                       |
| Leadership role        | Read the complete existing Technical Lead posting, including responsibilities, requirements, benefits, and the volunteer commitment, then open its separate application dialog.                                                                   |
| Membership Committee   | See its work on joining, the member portal, and helping members find projects; ask about joining the committee.                                                                                                                                   |
| Public Engagement Team | See its work planning public meetings and helping residents give comment; ask about joining the team.                                                                                                                                             |
| Other interest forms   | Leadership applications use a short contact and résumé dialog; committee examples remain inquiries and open email drafts in this prototype.                                                                                                       |

## Contributor response and staff follow-up

Both responsive dialogs ask for contact details before offering an optional résumé control. The
résumé accepts a PDF or Word document up to 10 MB. For a public visitor, name and email are
required; phone is optional. The form says membership is not required. It gives short field hints,
reports errors beside the relevant fields, and checks email, a broadly formatted phone number, the
selected project interest, and file type and size before the simulated submission. A visitor chooses
one area of interest for that request, including a shared “Not sure yet” option, and can add up to
300 characters of supplemental information. The named choices come from the request's `waysToHelp`
list in `apps/site/src/content/contributor-requests/`; the detail page and response form render from
the same content entry. Editors can copy `_template.md`, link a project, and write one to five
plain-language options in that file. The request content is an Astro collection for this prototype,
not a live Docket feed. Each request gets a statically generated preview URL at
`/prototypes/join/vision/{request-id}/`; the original URL shows the first request. A published
request will need its own confirmed choices and staff owner. These answers help staff prepare a
personal reply. They are not a screening questionnaire or a commitment to an assignment.

A person without an LVBT account follows the same contributor request and opens the same dialog.
They enter contact details, select where they might help, and submit without signing up. In the
prototype, this advances to a confirmation with an optional link to become a member; it does not
create an account or interrupt the offer to help. In production, the interest record should store a
visitor contact snapshot and remain searchable by staff even if that person never joins. If they
become a member later, staff can link the records after matching the verified account email; the
public form must never infer membership from a typed email address. The staff notice and personal
follow-up are the same for members and nonmembers.

The leadership application has its own contact and résumé form. It does not ask for a contributor
task choice. A résumé remains optional there because the current Technical Lead posting invites
people to reach out even without a perfect résumé. Submission creates an application for that role,
not an interest record for a project request or a committee inquiry.

For a signed-in member, the form displays the account's name, email, and phone as fixed values. A
short note links **LVBT account** within the sentence so the member can change those details at
`/account/`. Production must read the person record from the authenticated session on the server; it
must not trust the displayed values, a browser flag, or submitted contact fields as proof of
identity. Missing account values should say “Not provided” and link to the relevant account edit
page. The `member=1` prototype query parameter only switches the visual example.

On a real contributor submission, create a durable interest record tied to the contributor request
and to the signed-in person when there is one. Capture the selected area, optional note, submission
time, and contact details or person reference. A leadership application should instead be tied to
the role posting and routed to its hiring owner. For either form, verify an uploaded file's type and
size on the server, store it privately, and associate its storage reference with the response
record. Staff should open it through an authorized website view; the notification should not attach
the file or expose a public URL. Set a retention period for interest records and uploaded files.
Notify the request's designated LVBT staff owner of the new interest so someone can personally reach
out. The visitor confirmation should appear after the interest is recorded, with notification
failure available for retry; a lost staff notice must not silently discard the person's response. No
work is auto-assigned and no new Docket project is created per respondent. Docket tracks the website
feature and the underlying project work.

## Source and status of the examples

The earlier host-a-meetup example confused an event task with the intended request for contributors.
The revised request uses LVBT's existing
[Transit Accountability Briefs](https://lasvegasfortransit.org/projects/transit-accountability-briefs/)
project. Its site record describes short, sourced briefs and a promise tracker. The first brief has
an overdue July 2026 target and remains marked planned in the local website content. The mockup
shows bounded research, timeline, and editing assignments for that brief. The project lead must
confirm the current staffing need and contact path before this copy is published; neither is
established by the project record alone. These qualifications stay in this design record, not on the
visitor page.

The [Technical Lead](https://lasvegasfortransit.org/join/technical-lead/) is an existing public role
posting. The Membership Committee and Public Engagement team exist in Docket; their member-facing
availability still needs an owner and confirmation. The Public Engagement Series is related program
work, not itself an actionable opening. The public join screen links to the actual website's
membership, events, and project pages.

A published contributor request needs a named project, a defined assignment and output, a staff
owner, a confirmed opening, and a way to close the posting. The personal follow-up establishes any
specific assignment, timing, and place. A working-group page also needs a lead to confirm whether it
can accept a new member. Those checks belong to the content workflow, not to a visitor-facing
questionnaire.

## Docket ownership

Use the existing
[Join and Member Account on lasvegasfortransit.org](https://clearthedocket.com/orgs/01KY1N724K30F3MCPQMRC7GVD3/projects/01M1X0FVPS74BXZ7FJPF5C9R22)
project for public `/join`, membership entry, and existing account functionality. The prototype and
its revision were documented on its existing “Prototype, test and build the join form” task. Build
the reusable contributor interest form, leadership application upload, private file storage, and
staff notice as work in this existing website project; do not create another join or intake project.
The
[LVBT Membership Model Design](https://clearthedocket.com/orgs/01KY1N724K30F3MCPQMRC7GVD3/projects/01M35GSKW8WRYFGZKZJSZ4NR6Y)
project owns the policy definition. The new
[Member Contribution Portal](https://clearthedocket.com/orgs/01KY1N724K30F3MCPQMRC7GVD3/projects/01M3RNN9D1GGB00GP8C184J13Z)
project owns the signed-in questions, preference changes, and mapping those choices to
opportunities, including the account-data reuse in the contributor form. It uses Docket's Product
launch template, belongs to the Supporter and Membership Program and Organizing Platform Launch
initiative, and is filed with the Membership Committee. It does not rebuild the join form, person
record, staff queue, or volunteer onboarding.

## Visual correction

The first mockup used an oversized slogan, a decorative route graphic, colored cards, and
dashboard-like sidebars. The next version still added uppercase, letter-spaced overlines even though
the site's global stylesheet explicitly retires that pattern. It also put source/status notes and
prototype explanations in the visitor experience. A later request page put a long staffing apology
ahead of the opportunity and buried the action. The current request leads with a direct research and
editing invitation, puts the response action near the title, and names three specific pieces of work
without repeating a long project description. The join and member pages use filled rows for project
requests and positions, with small, width-leaning cards for committees and teams. The public page
stays brief; the guided questions begin after sign-in. The request CTA opens a responsive dialog
with a short form. In the latest revision, a solid rule anchors the dialog heading. Contact details
come first, followed by a résumé card based on `/go`, then compact outlined choices and a short
optional context field. The dialog keeps one strong visual mark instead of repeated thin dividers.
The confirmation button says “Done.” A later polish pass narrowed the confirmation dialog to its
content, placed related listings and choices on warm contained surfaces, corrected spacing around
member account details, and replaced the prototype's dark input outlines with softer token-based
fields. Name, email, and phone now have examples and specific hints; optional labels use
parentheses, and the résumé control has a smaller selection button. The mockup uses the site's paper
canvas so the shared header and page text retain their intended contrast. The latest layout pass
uses the site's standard `container-page` width and edge padding for every screen; narrow text
blocks sit inside that shared container. Detail pages now use a full Home / Join / current-page
breadcrumb, matching the site's existing detail-page pattern. The member questions use Home / Member
home / Get a suggestion. Inline arrows have been removed from the prototype's actions, shared
header, and existing Join and role pages.

## Remaining product decisions

- Confirm whether Transit Accountability Briefs needs research, source-checking, or editing help
  now, who responds, and when the request closes. Replace the sample if another project has a more
  urgent confirmed shortage.
- Identify the staff recipient and recovery path for contributor interest notices before making the
  form live.
- Decide how the member home distinguishes open invitations from planned work. A planned project
  must not appear as an application.
- Test the revised flow with people outside the team, including a mobile visitor and an
  assistive-technology user, before using it as the production design.
