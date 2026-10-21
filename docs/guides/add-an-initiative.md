# Add an initiative

This guide shows how to add an initiative — a broad theme (like "Public education" or "Legislative
advocacy") that groups related projects together. Create one only when a new project doesn't fit any
existing theme; most of the time you'll reuse an existing initiative. To see what already exists,
list `apps/site/src/content/initiatives/` or open one of those files to copy its shape.

Initiatives appear as small labeled filters on `/projects`. Each one is a JSON (JavaScript Object
Notation, a plain-text data format) file under `apps/site/src/content/initiatives/`.

## Before you start

Complete [local setup](../tutorials/first-time-setup.md) and create a branch. Check the existing
initiatives before adding another.

1. Add `apps/site/src/content/initiatives/<slug>.json` (the slug is the URL-safe id — also the
   filename without `.json`):

   ```json
   {
     "title": "Initiative title",
     "description": "One- or two-sentence description.",
     "color": "primary"
   }
   ```

   `color` controls the filter's color. Choose `primary`, `ink`, or `mute`. The
   [content rules](../../apps/site/src/content.config.ts) define these allowed values.

2. The slug must match exactly how you'll reference it in any project's `initiatives:` array. Once
   added, the filter appears on `/projects` and the initiative appears on linked project pages.
3. Run `pnpm dev` and check `/projects` and a project that uses the initiative. Run `pnpm check`; if
   it reports an unknown initiative, check that the project's value matches the filename exactly.
   Share the change through a pull request as described in
   [Start here](../tutorials/start-here.md#5-saving-and-sharing-your-change).
