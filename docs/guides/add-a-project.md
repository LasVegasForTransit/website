# Add a project

This guide shows how to add a project page (one of LVBT's ongoing efforts, shown on `/projects`). Use it when you're starting a new project and want it on the site.

## Before you start

- A local copy of the repo you can edit and commit to.
- Know which initiative(s) the project belongs under (see step 2 for how to find them).

Steps:

1. Copy `src/content/projects/_template.mdx`.
2. Slug = filename. The slug is the URL-safe id for the project, taken from the file's name (so `maryland-brt.mdx` has the slug `maryland-brt`). Initiatives must reference existing JSON (JavaScript Object Notation, a plain-text data format) files in `src/content/initiatives/` — list the existing ones with `ls src/content/initiatives/`, and use a filename without its `.json` extension as the slug. See [add-an-initiative.md](./add-an-initiative.md) if you need a new one.
3. Required frontmatter (the settings block fenced by `---` lines at the top of the file — see [glossary](../reference/glossary.md#frontmatter)):

   ```yaml
   ---
   title: 'Project title'
   status: planned # the project's lifecycle stage — one of: active | planned | complete | paused
   initiatives: ['public-education'] # one or more initiative slugs (filenames from src/content/initiatives/, without .json)
   tldr: 'One-sentence summary, under 25 words.' # tldr = "too long; didn't read" — a plain, jargon-free hook a visitor reads first, e.g. "Pushing the RTC to add bus shelters at the 100 hottest stops."
   contacts:
     - name: 'Lead name'
       role: 'Project lead'
   startDate: 2026-01-01
   order: 99 # optional sort order across the projects list; lower numbers sort earlier
   goals:
     - text: 'Concrete goal one'
       status: planned # planned | in-progress | done
       target: 2026-12-31 # optional — when we expect to hit it
     - text: 'Concrete goal two'
       status: planned
   ---
   ```

4. **Body order is loosely standard.** "Loosely" means this is the usual shape, not a rule the build enforces — follow it so pages feel consistent, but it's fine to deviate when a project genuinely needs it (e.g. rename or add a context section, as shown in step 2 below). Every project page reads:
   1. **`## Why this project`** — motivation. What problem this addresses, why it matters, why now. Two to four paragraphs. Lead with the reader's stake, not internal jargon.
   2. **`## Approach`** (or a project-specific context section like `## Priority partners`, `## Where we're starting`, `## Key dates`, `## What's in the report`, `## Target departments`) — context for the specific project: how it runs, who it touches, what it produces.
   3. **`## Updates`** — reverse-chronological progress entries, added as the work happens. Use `### YYYY-MM-DD — short label` for each entry.

5. **Goals render automatically** at the end of the page from the frontmatter `goals:` array via `src/components/ProjectGoals.astro`. Do **not** add a `## Goals` section in the body — it would duplicate the auto-render.
6. **Three statuses, kept simple.** `planned` (committed but not started), `in-progress` (working on it), `done` (achieved). If a goal genuinely changes scope, edit the text or remove it. Misses and scope changes go in `## Updates`, not in new status types.
7. Commit. Push to `main`. Cloudflare Pages deploys in ~60 seconds.
