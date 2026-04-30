# Add an event

1. Open `src/content/events/_template.mdx` for the canonical shape.
2. Create `src/content/events/<slug>.mdx`. Slug is the URL fragment — kebab-case, no spaces.
3. Fill in the frontmatter:

   ```yaml
   ---
   title: 'Event title'
   date: 2026-05-15T18:00:00-07:00 # ISO 8601 with -07:00 (PDT) or -08:00 (PST)
   endDate: 2026-05-15T20:00:00-07:00 # optional
   location: 'Venue name, neighborhood'
   featured: true # optional, defaults false. Sets the hero slot on /events
   rsvpUrl: 'https://lu.ma/example' # optional
   summary: 'One- or two-sentence event summary.'
   ---
   ```

4. Body of the MDX file is the long-form description.
5. Commit. Push to `main`. Cloudflare Pages deploys in ~60 seconds.

The schema is enforced by Zod in `src/content.config.ts` — fields that don't match the shape will fail the build.
