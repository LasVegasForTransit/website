# Add an initiative

Initiatives are the chips/tags shown on `/projects`. Each one is a JSON file under `src/content/initiatives/`.

1. Add `src/content/initiatives/<slug>.json`:

   ```json
   {
     "title": "Initiative title",
     "description": "One- or two-sentence description.",
     "color": "accent"
   }
   ```

2. The slug must match exactly how you'll reference it in any project's `initiatives:` array. Once added, the chip appears on `/projects` and the initiative is selectable on project detail pages.
