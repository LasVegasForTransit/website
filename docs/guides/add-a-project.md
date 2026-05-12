# Add a project

1. Copy `src/content/projects/_template.mdx`.
2. Slug = filename. Initiatives must reference existing JSON files in `src/content/initiatives/` (see [add-an-initiative.md](./add-an-initiative.md) if you need a new one).
3. Required frontmatter:

   ```yaml
   ---
   title: 'Project title'
   status: planned # active | planned | complete | paused
   initiatives: ['public-education'] # one or more slugs
   tldr: 'One-sentence summary, under 25 words.'
   contacts:
     - name: 'Lead name'
       role: 'Project lead'
   startDate: 2026-01-01
   order: 99 # optional sort order; lower = earlier
   goals:
     - text: 'Concrete goal one'
       status: planned # planned | in-progress | done
       target: 2026-12-31 # optional — when we expect to hit it
     - text: 'Concrete goal two'
       status: planned
   ---
   ```

4. **Body order is loosely standard.** Every project page reads:
   1. **`## Why this project`** — motivation. What problem this addresses, why it matters, why now. Two to four paragraphs. Lead with the reader's stake, not internal jargon.
   2. **`## Approach`** (or a project-specific context section like `## Priority partners`, `## Where we're starting`, `## Key dates`, `## What's in the report`, `## Target departments`) — context for the specific project: how it runs, who it touches, what it produces.
   3. **`## Updates`** — reverse-chronological progress entries, added as the work happens. Use `### YYYY-MM-DD — short label` for each entry.

5. **Goals render automatically** at the end of the page from the frontmatter `goals:` array via `src/components/ProjectGoals.astro`. Do **not** add a `## Goals` section in the body — it would duplicate the auto-render.
6. **Three statuses, kept simple.** `planned` (committed but not started), `in-progress` (working on it), `done` (achieved). If a goal genuinely changes scope, edit the text or remove it. Misses and scope changes go in `## Updates`, not in new status types.
7. Commit. Push to `main`. Cloudflare Pages deploys in ~60 seconds.
