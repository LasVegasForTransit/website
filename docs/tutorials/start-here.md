# Start here

New to the project? This page gets you from zero to making your first change. No
prior experience with our specific tools is assumed — if a word is unfamiliar,
check the [glossary](../reference/glossary.md).

This is the **website** for Las Vegans for Better Transit (LVBT), a volunteer
nonprofit. You don't need to be a senior engineer to contribute. If you can edit a
text file and follow a few commands, you can help.

> Just want to add an event or fix some copy and never touch a terminal? Several
> tasks don't require setup at all — see [Common tasks](#common-tasks) below. Some
> live in Google Calendar or Notion, not in this code.

---

## 1. What you need installed

Three things. Install them once:

- **[Node](../reference/glossary.md#node)** version 22.12 or newer — runs the
  project. Get it from [nodejs.org](https://nodejs.org) (the "LTS" version is fine).
- **[pnpm](../reference/glossary.md#pnpm)** — our package manager. After Node is
  installed, run `npm install -g pnpm`.
- **git** — version control, for getting the code and saving changes. Most
  computers have it; `git --version` tells you.

A code editor like [VS Code](https://code.visualstudio.com) makes everything
easier, but any text editor works.

## 2. Get the code running locally

"Locally" means on your own computer, where you can preview changes safely before
anyone else sees them.

```bash
# 1. Download the code (clone the repo)
git clone <the repo URL>
cd website

# 2. Install the project's dependencies
pnpm install

# 3. Start the local preview server
pnpm dev
```

`pnpm dev` prints a URL (usually `http://localhost:4321`). Open it in your browser
— that's the site, running on your machine. Edits you make to files show up there
within a second or two (that live-update is called
[HMR](../reference/glossary.md#hmr)). Press `Ctrl+C` in the terminal to stop it.

Stuck on this step? [local-dev.md](../reference/local-dev.md) covers ports and
common errors. (If you're also setting up deployment and a domain, that's the
longer [first-time setup tutorial](./first-time-setup.md) — most contributors
don't need it.)

## 3. How the repo is laid out

You'll mostly work in a few places:

| Folder           | What's in it                                                                                                                |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `src/pages/`     | The actual web pages (one file ≈ one URL).                                                                                  |
| `src/content/`   | Editable content: events, projects, long-form docs. See [content collections](../reference/glossary.md#content-collection). |
| `src/lib/`       | Shared site config and helpers (org name, links).                                                                           |
| `functions/api/` | Small backends ([Pages Functions](../reference/glossary.md#pages-function)) — form handling, etc.                           |
| `scripts/`       | Setup and maintenance command-line tools.                                                                                   |
| `docs/`          | The documentation you're reading now.                                                                                       |

## 4. Common tasks

Find your task and follow its guide. Each guide lists what you need before you
start:

| I want to…                               | Guide                                                              | Touches code?                |
| ---------------------------------------- | ------------------------------------------------------------------ | ---------------------------- |
| Add an event                             | [add-an-event.md](../guides/add-an-event.md)                       | No — it's in Google Calendar |
| Add a project                            | [add-a-project.md](../guides/add-a-project.md)                     | Yes — a content file         |
| Add an initiative                        | [add-an-initiative.md](../guides/add-an-initiative.md)             | Yes — a content file         |
| Edit a long-form page (vision, mission…) | [edit-a-long-form-doc.md](../guides/edit-a-long-form-doc.md)       | Yes — a content file         |
| Add transit news to Notion               | [add-transit-news.md](../guides/add-transit-news.md)               | Depends on path              |
| Use an AI assistant to help              | [work-with-ai-assistants.md](../guides/work-with-ai-assistants.md) | —                            |

## 5. Saving and sharing your change

When you've edited a file and previewed it locally, you save it with git
("commit") and push it. Our commit messages follow a small set of rules so the
history stays readable — see
[commit-messages.md](../standards/commit-messages.md) and
[git-guidelines.md](../standards/git-guidelines.md). They look strict at first;
the [git hooks](../reference/glossary.md#git-hook) (scripts that run automatically
on commit) check your message and tell you exactly what to fix.

A pushed change to the main branch deploys to the live site automatically (see
[deployment-pipeline.md](../reference/deployment-pipeline.md)). When in doubt, ask
a teammate to look before you push.

## 6. Where to get unstuck

- A word you don't recognize → [glossary](../reference/glossary.md).
- Local server problems → [local-dev.md](../reference/local-dev.md).
- "Which doc explains X?" → the [docs index](../README.md).
- Still stuck → ask in the team's Discord. No question is too basic here.

---

## Related

- [Documentation index](../README.md) — everything, organized.
- [Writing docs](../standards/writing-docs.md) — if you improve these docs, keep
  them this approachable.
