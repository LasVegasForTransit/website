# LVBT documentation

Contributors use this index to find the next task. Start with
[Start here](./tutorials/start-here.md) for local setup and a first change. Use the
[glossary](./reference/glossary.md) when a term is unfamiliar.

| Your task                                 | Start here                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------ |
| Run the site locally.                     | [Local development](./reference/local-dev.md)                                  |
| Edit a page, event, or project.           | [Content collections](./reference/content-collections.md) and the guides below |
| Work on scheduled jobs.                   | [Jobs contributor README](../apps/jobs/README.md)                              |
| Investigate a staff error.                | [Investigate a staff failure](./guides/investigate-staff-failures.md)          |
| Publish or recover a release.             | [Deployment pipeline](./reference/deployment-pipeline.md)                      |
| Change membership or newsletter behavior. | [Membership intake](./reference/membership-intake.md)                          |

Tutorials teach a first task. Guides give steps for a specific task. References describe settings
and behavior. Explanations record reasons and design choices.

## Tutorials

Choose **Start here** for your first contribution. Use **First-time setup** when you only need
installation and setup checks.

- [Start here](./tutorials/start-here.md) — the first contributor task: install, run locally, make a
  first change
- [First-time setup](./tutorials/first-time-setup.md) — local setup and checks, with separate
  instructions for maintainer production setup

## Guides

Choose the guide for the task you need to complete.

- [Connect a form tool](./guides/connect-a-form-tool.md) — send sign-ups from any outside form to
  LVBT's member list
- [Investigate a staff failure](./guides/investigate-staff-failures.md) — look up outage references,
  interpret private diagnostics and verify a repair
- [Set up the protected staff preview](./guides/set-up-staff-preview.md) — prepare access, sign-in,
  the preview database, a saved deployment, and the first administrator
- [Test Discord in the isolated preview](./guides/test-discord-preview.md) — verify linking,
  committee roles and removal with approved test accounts.
- [Retire Notion membership intake](./guides/retire-notion-membership-intake.md) — move follow-up to
  the Welcome queue and preserve historical records during the one-time cutover.
- [Export a member record](./guides/export-a-member-record.md) — download one person's complete
  record for a privacy request.
- [Export all member records](./guides/export-member-records.md) — move LVBT's records to a
  spreadsheet or contact-management system while preserving permission evidence.
- [Import existing member records](./guides/import-existing-members.md) — preserve original sources,
  review a database-aware preview, and safely bring in the current roster.
- [Combine duplicate member records](./guides/combine-member-records.md) — confirm a match, combine
  safely, and undo a mistaken combination without losing history
- [Enter paper signups](./guides/enter-paper-signups.md) — print a sheet, record attendance and
  membership choices, and check the saved result.
- [Welcome a new member](./guides/welcome-a-new-member.md) — claim an introduction, contact the
  person, and record their welcome.
- [Manage member committees](./guides/manage-member-committees.md) — record committee participation
- [Manage member roles](./guides/manage-member-roles.md) — grant, end, and review role assignments
- [Manage staff administrators](./guides/manage-staff-administrators.md) — add or remove
  administrator access through the portal and verify the Google sign-in prerequisites.
- [Operate member data retention](./guides/operate-member-data-retention.md) — review deletion,
  daily retention, and Google accounts that need attention.
- [Automate member database backups](./guides/member-database-backups.md) — operate daily private
  backups and quarterly restore tests
- [Back up the membership database](./guides/back-up-membership-database.md) — export privately and
  verify an isolated restore before a migration
- [Recover a linked preview test membership](./guides/recover-a-preview-test-membership.md) — repair
  an invalid test identifier while preserving sign-in, consent, and administrator history
- [Add a prototype](./guides/add-a-prototype.md) — publish a clickable test version of a new flow on
  a preview
- [Add an account section](./guides/add-an-account-section.md) — extend the member's account page
  with matching navigation
- [Run a usability test](./guides/run-a-usability-test.md) — recruit testers, run a session, and
  record findings for a prototype
- [Add an event](./guides/add-an-event.md)
- [Add a project](./guides/add-a-project.md)
- [Add an initiative](./guides/add-an-initiative.md)
- [Add press coverage](./guides/add-press-coverage.md) — add stories to `/press` from Notion
- [Add transit news](./guides/add-transit-news.md) — three ways to push articles into the Notion
  database
- [Connect the membership form](./guides/connect-the-membership-form.md) — wire the Google Form's
  Apps Script to the intake endpoint
- [Edit a long-form doc](./guides/edit-a-long-form-doc.md)
- [Work with an AI assistant](./guides/work-with-ai-assistants.md)
- [Test the Workers candidate](./guides/test-the-workers-candidate.md)
- [Update the repository standard](./guides/update-the-repository-standard.md)

## Reference

Look up command behavior, configuration, limits, and recovery rules here.

- [Platform secrets](./reference/platform-secrets.md) — every server-side secret, what it is for,
  and how `pnpm bootstrap --production` sets it
- [Glossary](./reference/glossary.md) — plain-English definitions of every tool and acronym in these
  docs
- [Local development](./reference/local-dev.md) — dev server ports, troubleshooting
- [Content collections](./reference/content-collections.md) — schemas, folder layout, Zod
- [Bootstrap and preflight](./reference/bootstrap.md) — local setup and production readiness
- [Deployment pipeline](./reference/deployment-pipeline.md) — how code gets from `git push` to
  lasvegasfortransit.org
- [Staff portal operations](./reference/staff-portal-operations.md) — configuration checks, saved
  releases, provider boundaries, and recovery
- [Staff background work](./reference/staff-background-work.md) — database limits, scheduled work,
  and wake requests
- [Staff newsletter operations](./reference/staff-newsletter-operations.md) — delivery, preference
  review, and deletion cleanup
- [Staff release operations](./reference/staff-release-operations.md) — saved builds, publication,
  activation, and recovery
- [Staff account integrations](./reference/staff-account-integrations.md) — Discord, Google groups,
  roles, and access review
- [Staff availability](./reference/staff-availability.md) — unavailable states, retry behavior, and
  recovery signals
- [Background jobs](./reference/background-jobs.md) — scheduling rules and tests for contributors
  changing the job runner
- [Staff portal acceptance](./reference/staff-portal-acceptance.md) — verify permissions, provider
  behavior, accessibility, and readiness with real users
- [Key facts](./reference/key-facts.md) — figures used in copy and what must be checked before reuse
- [Transit objection rebuttals](./reference/transit-objection-rebuttals.md) — writing reference that
  requires source checks before reuse
- [Design tokens](./reference/design-tokens.md) — color + type tokens, canvas/band system
- [Joining LVBT on the website](./reference/newsletter-signup.md) — the join form and newsletter
  box, what they store, and how to verify them
- [Membership intake automation](./reference/membership-intake.md) — supported forms, D1 person
  records, and queued Beehiiv delivery
- [The Week Without Driving campaign host](./reference/week-without-driving-site.md) — lvwwd.org is
  its own repo and Worker; what this site still redirects to it
- [Transit news pipeline](./reference/transit-news-pipeline.md) — schema, extraction logic, and the
  Cloudflare enrichment function
- [Newsletter publishing](./reference/newsletter-ops.md) — Beehiiv issue publishing, delivery checks
  and the pre-send checklist

## Standards

How we write code, commits, and docs. Skim before contributing.

- [Writing docs](./standards/writing-docs.md) — keep docs accessible to students and junior devs
- [Commit messages](./standards/commit-messages.md) — what goes in a message, what to leave out
- [Commit scopes](./standards/commit-scopes.md) — the five allowed scopes and why
- [Git guidelines](./standards/git-guidelines.md) — explicit staging, hooks, and safe undo commands
- [Performance monitoring](./standards/performance-monitoring.md) — budgets, Lighthouse, real-user
  metrics
- [Print layout](./standards/print-layout.md) — data attributes that make pages work on paper

## Explanation

The why behind decisions and conventions.

- [Voice and tone](./explanation/voice-and-tone.md) — writing rules and examples
- [Copy for app screens](./explanation/app-copy.md) — buttons, errors, hints, dates and the
  pre-testing checklist for app screens
- [Comms strategy](./explanation/comms-strategy.md) — audiences, publishing channels, and ways to
  participate
- [Events pipeline](./explanation/events-pipeline.md) — how events flow from Google Calendar to the
  site
- [Membership program](./explanation/membership-program.md) — proposed participation levels and
  their relationship to implemented membership tools
- [Innovation ideas registry](./explanation/innovation-ideas.md) — running list of tools, content
  formats, and media to consider
- [Design decisions](./explanation/design-decisions.md) — reasons for choices that need explanation
- [Design system](./explanation/design-system.md) — brand palette, color-usage rules, reserved
  colors, brand-kit notes

- [Visual baseline review](./explanation/visual-baseline-review.md) — a dated review record, not
  current release acceptance

### Decision records

Why we picked what we picked, and the alternatives considered.

- [Newsletter platform](./explanation/decisions/newsletter-platform.md) — the dated Ghost proposal
  and alternatives considered
- [Staff publishing](./explanation/decisions/staff-publishing.md) — CMS deferred until 2nd
  contributor; criteria when the time comes
- [Organizing platform](./explanation/decisions/organizing-platform.md) — code ownership, rendering
  on request, the shared database, and resource limits
