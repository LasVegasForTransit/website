# Add an initiative

This guide shows how to add an initiative — a broad theme (like "Public education" or "Legislative advocacy") that groups related projects together. Create one only when a new project doesn't fit any existing theme; most of the time you'll reuse an existing initiative. To see what already exists, list `src/content/initiatives/` or open one of those files to copy its shape.

Initiatives are the chips/tags (the small labeled pills used to filter and group) shown on `/projects`. Each one is a JSON (JavaScript Object Notation, a plain-text data format) file under `src/content/initiatives/`.

1. Add `src/content/initiatives/<slug>.json` (the slug is the URL-safe id — also the filename without `.json`):

   ```json
   {
     "title": "Initiative title",
     "description": "One- or two-sentence description.",
     "color": "accent"
   }
   ```

   `color` controls the chip's color. The valid values are defined in the initiative schema in `src/content.config.ts` (look for the `color:` line) — use one of the values listed there.

2. The slug must match exactly how you'll reference it in any project's `initiatives:` array. Once added, the chip appears on `/projects` and the initiative is selectable on project detail pages.
