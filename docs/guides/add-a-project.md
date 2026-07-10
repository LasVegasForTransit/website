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

4. **Use the standard body order.** Every project page is a public brief, not an internal project plan. Use these sections:
   1. **`## Overview`** — what the project is, who it involves, and what people will see.
   2. **`## Motivation`** — the public need, who feels it, why LVBT is acting, and why the work matters now. This section carries the nonprofit-reporting logic, but write it like a person.
   3. **`## Approach`** — how the work runs: main activities, partners or audiences, cadence, and coordination with related LVBT projects.
   4. **`## What people will see`** — the concrete things the page will eventually point to: events held, people reached, reports published, testimony, dashboards, briefs, chapters, coalitions, campaign materials, relationships, or other recorded results.
   5. **`## Updates`** — reverse-chronological progress entries, added only as the work happens. Use `### YYYY-MM-DD — short label` for each entry.

5. **Goals render automatically** at the end of the page from the frontmatter `goals:` array via `src/components/ProjectGoals.astro`. Do **not** add a `## Goals` section in the body — it would duplicate the auto-render.
6. **Three statuses, kept simple.** `planned` (committed but not started), `in-progress` (working on it), `done` (achieved). If a goal genuinely changes scope, edit the text or remove it. Misses and scope changes go in `## Updates`, not in new status types.
7. Commit. Push to `main`. Cloudflare Pages deploys in ~60 seconds.
