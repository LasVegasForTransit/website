# Start here

New to the project? This page gets you from zero to making your first change. No prior experience
with our specific tools is assumed — if a word is unfamiliar, check the
[glossary](../reference/glossary.md).

This is the **website** for Las Vegans for Better Transit (LVBT), a volunteer nonprofit. You don't
need to be a senior engineer to contribute. If you can edit a text file and follow a few commands,
you can help.

> Just want to add an event or fix some copy and never touch a terminal? Several tasks don't require
> setup at all — see [Common tasks](#4-common-tasks) below. Some live in Google Calendar or Notion,
> not in this code.

---

## 1. What you need installed

Install these three tools once:

- **[Node](../reference/glossary.md#node)** version 24.20.0 or newer in the 24.x line — runs the
  project. Get the 24.x version from [nodejs.org](https://nodejs.org). `pnpm preflight` tells you if
  the version you have is too old.
- **[pnpm](../reference/glossary.md#pnpm)** — our package manager. After Node is installed, run
  `npm install -g pnpm@11.25.0`.
- **git** — version control, for getting the code and saving changes. Most computers have it;
  `git --version` tells you.

A code editor like [VS Code](https://code.visualstudio.com) makes everything easier, but any text
editor works.

## 2. Get the code running locally

"Locally" means on your own computer, where you can preview changes safely before anyone else sees
them.

```bash
# 1. Download the code (clone the repo)
GIT_LFS_SKIP_SMUDGE=1 git clone git@github.com:LasVegasForTransit/website.git
cd website

# 2. Set up dependencies, git hooks, and local settings
pnpm bootstrap

# 3. Start the local preview server
pnpm dev
```

The clone skips screenshot files to save LVBT's shared download allowance. Local development does
not need them. For visual comparisons, follow the
[screenshot setup](../../apps/site/tests/README.md#first-time-setup).

`pnpm dev` prints `https://lvbt.localhost`. Open it in your browser — that's the site, running on
your machine. Edits you make to files show up there within a second or two (the development server
reloads the page for you). Press `Ctrl+C` in the terminal to stop it.

Warnings about empty Beehiiv or Notion settings are expected. You can edit pages and content without
signing in to either service. Those integrations are optional locally; their features remain
unavailable until you configure a test integration. Bootstrap preserves any existing local settings
file.

Stuck on this step? [local-dev.md](../reference/local-dev.md) covers ports and common errors. The
[first-time setup tutorial](./first-time-setup.md) also explains package-access errors and the
separate setup maintainers use for production.

## 3. How the repo is laid out

You'll mostly work in a few places:

| Folder                     | What's in it                                                                                                                |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `apps/site/src/pages/`     | The actual web pages (one file ≈ one URL).                                                                                  |
| `apps/site/src/content/`   | Editable content: events, projects, long-form docs. See [content collections](../reference/glossary.md#content-collection). |
| `apps/site/src/lib/`       | Shared site config and helpers (org name, links).                                                                           |
| `apps/site/functions/api/` | Server-side request handlers for forms and other actions. They run in the website Worker.                                   |
| `apps/site/scripts/`       | Setup and maintenance command-line tools.                                                                                   |
| `docs/`                    | The documentation you're reading now.                                                                                       |

## 4. Common tasks

Find your task and follow its guide. Each guide lists what you need before you start:

| I want to…                               | Guide                                                                      | Touches code?                |
| ---------------------------------------- | -------------------------------------------------------------------------- | ---------------------------- |
| Add an event                             | [add-an-event.md](../guides/add-an-event.md)                               | No — it's in Google Calendar |
| Add a project                            | [add-a-project.md](../guides/add-a-project.md)                             | Yes — a content file         |
| Add an initiative                        | [add-an-initiative.md](../guides/add-an-initiative.md)                     | Yes — a content file         |
| Edit a long-form page (vision, mission…) | [edit-a-long-form-doc.md](../guides/edit-a-long-form-doc.md)               | Yes — a content file         |
| Add transit news to Notion               | [add-transit-news.md](../guides/add-transit-news.md)                       | Depends on path              |
| Connect the membership form to intake    | [connect-the-membership-form.md](../guides/connect-the-membership-form.md) | No — it's in Apps Script     |
| Use an AI assistant to help              | [work-with-ai-assistants.md](../guides/work-with-ai-assistants.md)         | —                            |

## 5. Saving and sharing your change

Create a branch for your change before editing, for example `git switch -c your-name/fix-copy`. When
you've edited a file and previewed it locally, run `pnpm check`, fix anything it reports, save it
with git ("commit"), and push your branch. Our commit messages follow a small set of rules so the
history stays readable — see [commit-messages.md](../standards/commit-messages.md) and
[git-guidelines.md](../standards/git-guidelines.md). They look strict at first; the
[git hooks](../reference/glossary.md#git-hook) (scripts that run automatically on commit) check your
message and tell you exactly what to fix.

Open a pull request using the repository template and ask a teammate to review it. When the reviewed
change merges into `main`, GitHub Actions updates staging, the private review site at
`preview.lasvegasfortransit.org` and saves the release. A maintainer reviews that staging release
and explicitly promotes it to the live site with `pnpm promote`; merging alone does not publish. See
[deployment-pipeline.md](../reference/deployment-pipeline.md).

## 6. Where to get unstuck

- A word you don't recognize → [glossary](../reference/glossary.md).
- Local server problems → [local-dev.md](../reference/local-dev.md).
- "Which doc explains X?" → the [docs index](../README.md).
- Still stuck → ask in the team's Discord. No question is too basic here.

---

## Related

- [Documentation index](../README.md) — everything, organized.
- [Writing docs](../standards/writing-docs.md) — if you improve these docs, keep them this
  approachable.
