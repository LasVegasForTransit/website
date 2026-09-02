# LVBT website documentation

**New here? Start with [Start here](./development/tutorials/start-here.md)**, and keep the
[glossary](./development/reference/glossary.md) open for any unfamiliar tool or acronym.

Documentation follows [Diátaxis](https://diataxis.fr/) under domain directories: tutorials teach,
how-to guides complete one task, reference records facts, and explanation gives the why. Domains are
`development` (working on the code), `operations` (running the site and its pipelines), and
`product` (the site's content and design). Every document is listed here so it can be found.

## Development

- [Start here](./development/tutorials/start-here.md) — from a fresh clone to a passing check and a
  first commit
- [First-time setup](./development/tutorials/first-time-setup.md) — the longer path: clone to
  deployed site with your own domain
- [Work with an AI assistant](./development/how-to/work-with-ai-assistants.md)
- [Glossary](./development/reference/glossary.md) — plain-English definitions of every tool and
  acronym
- [Local development](./development/reference/local-dev.md) — dev server ports, troubleshooting
- [Writing docs](./development/reference/writing-docs.md) — keep docs accessible to students and
  junior devs
- [Commit messages](./development/reference/commit-messages.md) — what goes in a message, what to
  leave out
- [Commit scopes](./development/reference/commit-scopes.md) — the allowed scopes and why
- [Git guidelines](./development/reference/git-guidelines.md) — staging discipline and the atomic
  commit pattern

## Operations

- [Bootstrap CLI](./operations/reference/bootstrap.md) — provisioning phases, flags, state file
- [Deployment pipeline](./operations/reference/deployment-pipeline.md) — how code gets from
  `git push` to lasvegasfortransit.org
- [Performance monitoring](./operations/reference/performance-monitoring.md) — budgets, Lighthouse,
  real-user metrics
- [Membership intake automation](./operations/reference/membership-intake.md) — Google Forms to
  Beehiiv and Notion
- [Transit news pipeline](./operations/reference/transit-news-pipeline.md) — schema, extraction
  logic, and the Cloudflare enrichment function
- [Newsletter operations](./operations/reference/newsletter-ops.md) — workflow, deliverability, send
  checklist

## Product

### How-to guides

- [Add an event](./product/how-to/add-an-event.md)
- [Add a project](./product/how-to/add-a-project.md)
- [Add an initiative](./product/how-to/add-an-initiative.md)
- [Add transit news](./product/how-to/add-transit-news.md) — three ways to push articles into the
  Notion database
- [Edit a long-form doc](./product/how-to/edit-a-long-form-doc.md)

### Reference

- [Content collections](./product/reference/content-collections.md) — schemas, folder layout, Zod
- [Key facts](./product/reference/key-facts.md) — verified numbers used across copy
- [Transit objection rebuttals](./product/reference/transit-objection-rebuttals.md)
- [Design tokens](./product/reference/design-tokens.md) — color and type tokens, canvas/band system
- [Newsletter signup and verification](./product/reference/newsletter-signup.md) — the on-site
  subscribe form, double opt-in
- [Print layout](./product/reference/print-layout.md) — data attributes that make pages work on
  paper

### Explanation

- [Design system](./product/explanation/design-system.md)
- [Design decisions](./product/explanation/design-decisions.md)
- [Voice and tone](./product/explanation/voice-and-tone.md)
- [Communications strategy](./product/explanation/comms-strategy.md)
- [Events pipeline](./product/explanation/events-pipeline.md)
- [Membership program](./product/explanation/membership-program.md)
- [Innovation ideas](./product/explanation/innovation-ideas.md)
- Decisions: [newsletter platform](./product/explanation/decisions/newsletter-platform.md),
  [staff publishing](./product/explanation/decisions/staff-publishing.md)
