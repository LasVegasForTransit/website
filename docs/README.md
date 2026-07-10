# LVBT documentation

**New here? Start with [Start here](./tutorials/start-here.md)**, and keep the
[glossary](./reference/glossary.md) open for any unfamiliar tool or acronym.

Docs are sorted by what you need — whether you're learning or doing, and whether
you want practical steps or the reasoning behind them (a documentation system
called [Diátaxis](https://diataxis.fr/)):

|                 | Learning                      | Doing                     |
| --------------- | ----------------------------- | ------------------------- |
| **Practical**   | [Tutorials](./tutorials/)     | [Guides](./guides/)       |
| **Theoretical** | [Explanation](./explanation/) | [Reference](./reference/) |

## Tutorials

Learning-oriented, hold-your-hand walk-throughs.

- [Start here](./tutorials/start-here.md) — the new-contributor on-ramp: install, run locally, make a first change
- [First-time setup](./tutorials/first-time-setup.md) — the longer path: clone to deployed site with your own domain

## Guides

Task-oriented recipes for things you'll do repeatedly. (Diátaxis calls these "how-to guides"; we just say guides.)

- [Add an event](./guides/add-an-event.md)
- [Add a project](./guides/add-a-project.md)
- [Add an initiative](./guides/add-an-initiative.md)
- [Add transit news](./guides/add-transit-news.md) — three ways to push articles into the Notion database
- [Edit a long-form doc](./guides/edit-a-long-form-doc.md)
- [Work with an AI assistant](./guides/work-with-ai-assistants.md)

## Reference

Information you look up, not read.

- [Glossary](./reference/glossary.md) — plain-English definitions of every tool and acronym in these docs
- [Local development](./reference/local-dev.md) — dev server ports, troubleshooting
- [Content collections](./reference/content-collections.md) — schemas, folder layout, Zod
- [Bootstrap CLI](./reference/bootstrap.md) — phases, flags, state file
- [Deployment pipeline](./reference/deployment-pipeline.md) — how code gets from `git push` to lasvegasfortransit.org
- [Key facts](./reference/key-facts.md) — verified numbers used across copy
- [Design tokens](./reference/design-tokens.md) — color + type tokens, canvas/band system
- [Newsletter signup & verification](./reference/newsletter-signup.md) — the on-site subscribe form, Beehiiv config, double opt-in
- [Membership intake automation](./reference/membership-intake.md) — Google Forms to Beehiiv and Notion
- [Transit news pipeline](./reference/transit-news-pipeline.md) — schema, extraction logic, and the Cloudflare enrichment function
- [Newsletter operations](./reference/newsletter-ops.md) — Ghost(Pro) workflow, deliverability, send checklist

## Standards

How we write code, commits, and docs. Skim before contributing.

- [Writing docs](./standards/writing-docs.md) — keep docs accessible to students and junior devs
- [Commit messages](./standards/commit-messages.md) — what goes in a message, what to leave out
- [Commit scopes](./standards/commit-scopes.md) — the four allowed scopes and why
- [Git guidelines](./standards/git-guidelines.md) — staging discipline and the atomic commit pattern
- [Performance monitoring](./standards/performance-monitoring.md) — budgets, Lighthouse, real-user metrics
- [Print layout](./standards/print-layout.md) — data attributes that make pages work on paper

## Explanation

The why behind decisions and conventions.

- [Voice and tone](./explanation/voice-and-tone.md) — editorial north star
- [Comms strategy](./explanation/comms-strategy.md) — surfaces, audiences, ladder of engagement, innovation pillars
- [Events pipeline](./explanation/events-pipeline.md) — how events flow from Google Calendar to the site
- [Membership program](./explanation/membership-program.md) — the program design (a plan, not yet a built system)
- [Innovation ideas registry](./explanation/innovation-ideas.md) — running list of tools, content formats, and media to consider
- [Design decisions](./explanation/design-decisions.md) — load-bearing choices that look weird at first
- [Design system](./explanation/design-system.md) — brand palette, color-usage rules, reserved colors, brand-kit notes

### Decision records

Why we picked what we picked, and the alternatives considered.

- [Newsletter platform](./explanation/decisions/newsletter-platform.md) — Ghost(Pro) over Substack/Beehiiv/email-only ESPs
- [Staff publishing](./explanation/decisions/staff-publishing.md) — CMS deferred until 2nd contributor; criteria when the time comes
