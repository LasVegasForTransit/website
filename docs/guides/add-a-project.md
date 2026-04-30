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
   ---
   ```

4. Body uses `## Why this project`, `## Goals`, `## Approach`, `## Updates` — keep this structure for consistency across the projects index.
5. Commit. Push to `main`. Cloudflare Pages deploys in ~60 seconds.
