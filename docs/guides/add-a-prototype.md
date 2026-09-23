# Add a prototype

This guide shows how to put a clickable prototype of a new flow on a real address that testers can open on their own phone. Every screen in the Organizing Platform is prototyped and [tested with real people](./run-a-usability-test.md) before it is built, and the finished feature starts from the prototype's pages rather than redrawing them.

A **prototype** is a coded version of one flow, built from the app patterns (see the pattern gallery at `/patterns/` on any preview), using made-up data. It saves nothing and calls no outside service. Prototypes live under `/prototypes/`, which exists only on pull request previews and in local development: the production build deletes the folder, and the production deploy fails if it is ever there. Every prototype page shows a banner saying it is a test version and tells search engines not to index it.

> **Before you start.** You need the website running locally (see [local development](../reference/local-dev.md)) and the plan the prototype belongs to.

## 1. Describe the prototype

Add a file to `src/prototypes/` named after the flow, for example `src/prototypes/sign-in.json`:

```json
{
  "name": "Sign in",
  "status": "draft",
  "task": "",
  "taskTitle": "Prototype, test and build the member sign-in pages",
  "updated": "2026-10-05",
  "path": "/prototypes/sign-in/"
}
```

`task` is the plan's ID. `status` is one of `draft`, `testing`, `tested` or `built`. The prototype index at `/prototypes/` reads these files, so you never edit the index by hand.

## 2. Build the pages

Make a folder under `src/pages/prototypes/` with the same name, and build each screen from the patterns in `src/components/app/`, wrapped in `PrototypeLayout`:

```astro
---
import PrototypeLayout from '../../../components/app/PrototypeLayout.astro';
import TextField from '../../../components/app/TextField.astro';
import Button from '../../../components/app/Button.astro';
---

<PrototypeLayout title="Sign in">
  <section class="container-page pt-12 pb-16">
    <h1 class="text-headline-lg">Sign in to LVBT</h1>
    <form method="get" action="/prototypes/sign-in/code/" data-enhance class="mt-8 space-y-6">
      <TextField name="email" label="Email address" type="email" autocomplete="email" />
      <Button busyLabel="Sending…">Send my code</Button>
    </form>
  </section>
</PrototypeLayout>
```

Use made-up data such as "Ana" and `ana@example.org`, never real people. Write every text to the [copy standard](../explanation/app-copy.md) and run its checklist.

A form can simply move to the next page with `method="get"`, as above. When testers need to see error messages, give the prototype a small handler in `functions/prototypes/<name>/` that checks the fields with the same rules the real feature will use and shows the next screen, as `functions/prototypes/join/index.ts` does. A handler never saves anything or calls Beehiiv, Resend, Discord or Google. If the real flow emails a code, show the code on the screen instead, labeled as what the email would contain.

## 3. Check it and share the link

Run `pnpm dev` and open `/prototypes/`. Your prototype is listed; click through it on a phone-sized window, with the keyboard only, and with JavaScript turned off.

Push your branch and open a pull request. The preview deployment's address appears in the pull request, and your prototype is at that address plus `/prototypes/<name>/`. The CI checks run the same accessibility and reflow checks on every prototype page as on the pattern gallery.

## 4. Move it through its statuses

Change `status` and `updated` in its metadata file as it moves along:

- **draft** while you build it;
- **testing** when you share the link with testers;
- **tested** once the findings are posted on its task and the blocking problems are fixed;
- **built** when the real feature ships, starting from these pages.
