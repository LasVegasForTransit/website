# Print layout

Contributors use this page to make website content work as a printed handout. Read it when you add a
page, component or link that someone may print.

Components mark print behavior with `data-*` attributes, named labels in Hypertext Markup Language
(HTML). The Cascading Style Sheets (CSS) print rules use these labels to keep explanations, hide
screen controls and show useful link destinations. Use the existing labels before adding a separate
print rule.

The sitewide rules live in [`apps/site/src/styles/print.css`](../../apps/site/src/styles/print.css),
loaded after the screen styles by `BaseLayout.astro`. The brand guide, QR page and project pages
also have page-specific print rules. The browser checks live in
[`apps/site/tests/e2e/print-layout.spec.ts`](../../apps/site/tests/e2e/print-layout.spec.ts).

Complete [local setup](../tutorials/first-time-setup.md), then use your browser's print preview to
inspect the page. For the existing automated checks, run these commands from the repository root:

```sh
pnpm -C apps/site build
pnpm -C apps/site test:e2e tests/e2e/print-layout.spec.ts --project=ui-contracts --workers=2
```

## The rule

Printed pages must keep the information a reader can use on paper.

- Keep explanatory content.
- Remove controls that only make sense on a screen.
- Keep useful destinations when the printed reader can act on them.
- Turn large color bands into paper-safe callouts.
- End with the separable site directory page.

## What is automatic

Common screen controls already have print defaults:

- Real buttons, elements with `role="button"`, share controls, and anything with
  `data-screen-action` disappear in print.
- Button-like links that use `.press`, `bg-primary`, `bg-on-surface`, or `border-2` disappear in
  print unless they also have `data-print-url` or `data-print-plain-link`. Explicit callouts have
  the additional `.press` rule explained in [Examples](#examples).
- Color bands that are direct children of `main` and use `bg-slab`, `band-ink`, `bg-primary`,
  `band-primary`, or `bg-primary-container` print as inset bordered callouts.
- Card-like links with `data-print-card` print as compact paper entries. A direct child `p` or
  `span` with the `font-bold` class disappears automatically unless it has `data-print-link`, so a
  card can say "Read brief" or "Read on Beehiiv" on screen without carrying that prompt onto paper.
- The site header and footer are replaced by a print header showing only the logo symbol and a final
  directory page.

That means common cases should be simple:

- Use normal button styling for screen buttons. If the button is only a web action, print removes
  it.
- Use `data-print-card` on card-like links. The card prints as an entry, and a direct child action
  prompt with `font-bold` disappears.
- Add `data-print-url` only when the printed reader needs the destination.

Normal text links stay visible unless you mark them for removal. Choose whether the printed reader
needs the destination or only the explanation. Use `data-print-url` when the destination should
survive on paper, and `data-screen-action` when the link is only web navigation.

## Properties

The attributes keep their `data-*` names in markup. Add them to the element described below. The
site's `print-links.js` script adds a `data-print-link` span to a `data-print-url` link if one is
missing. Supply that span in the markup when its destination must also appear without JavaScript. A
`data-print-url` value alone does not print text through CSS.

| Property                | Put it on                                                                 | What print does                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `data-screen-action`    | A screen-only element not already hidden by the button or card rules      | Hides it in print. Use for controls that operate only on screen.                                                               |
| `data-print-url`        | A link whose destination is useful on paper                               | Marks the destination as print-relevant. Print CSS strips button styling so the link reads like text instead of a web control. |
| `data-print-link`       | A child span inside a `data-print-url` link                               | Shows a compact printed destination beside the link text. Use this when the visible label is not already the destination.      |
| `data-print-card-url`   | A destination paragraph inside a project card                             | Shows the card's destination as a separate printed line.                                                                       |
| `data-print-link-path`  | A child span inside `data-print-link`                                     | Lets a path such as `/join` use accent color while the domain stays neutral.                                                   |
| `data-print-plain-link` | A link that already includes the useful destination in its visible text   | Keeps the link inline and avoids adding duplicate URL text.                                                                    |
| `data-print-callout`    | A section that should be kept but should not print as a screen-style band | Prints the section as an inset bordered paper callout with padding.                                                            |
| `data-print-topbar`     | The print-only page header in `BaseLayout.astro`                          | Shows only the logo symbol at the top of printed pages.                                                                        |
| `data-print-link-sheet` | The print-only directory section in `Footer.astro`                        | Forces a separate final page with human-readable site links.                                                                   |
| `data-print-card`       | A card-like link or entry                                                 | Prints a compact entry. Hides direct child `p` or `span` action labels with `font-bold`, except `data-print-link`.             |
| `data-brand-print-only` | Brand-guide content that exists only for paper                            | Shows the content in print and keeps it hidden on screen.                                                                      |
| `data-brand-print-hide` | Brand-guide controls or decoration that should not print                  | Hides the element in print.                                                                                                    |

## How decisions are made

Think about the printed reader, not the browser user.

- If an element tells the reader something useful, keep it.
- If an element only tells the browser what to do next, first check whether an automatic rule
  already covers it. Button-like links and project-card trailing actions are automatic.
- If a link destination matters after printing, add `data-print-url`.
- If a link is only a navigation prompt and is not covered by an automatic rule, use
  `data-screen-action`.
- If a section uses `bg-slab`, `band-ink`, `bg-primary`, `band-primary`, or `bg-primary-container`
  as a direct child of `main`, print CSS turns it into an inset paper callout automatically. Add
  `data-print-callout` when a component should get that treatment even if it does not use those
  classes.

The component author chooses what belongs on paper. The stylesheet applies that choice to the
printed layout.

## Examples

Make a project-card link:

```astro
<a href="/projects/bus-buddies" data-print-card data-print-url="/projects/bus-buddies">
  <div>
    <h3>Bus Buddies</h3>
    <p>Conversations with people who ride Las Vegas transit.</p>
  </div>
  <span class="font-bold">Read brief</span>
  <span data-print-link>lasvegasfortransit.org/projects/bus-buddies</span>
</a>
```

In print, the card becomes a compact paper entry and the trailing `Read brief` span disappears
because it is a direct child with `font-bold`. A plain span would stay visible.

Keep a useful email link whose visible text already gives the address:

```astro
<a href="mailto:hello@lasvegasfortransit.org" data-print-plain-link>
  hello@lasvegasfortransit.org
</a>
```

Keep a button-shaped link on screen, but print it as plain text:

```astro
<a href="/join" data-print-url="lasvegasfortransit.org/join" class="press bg-on-surface">
  Become a member
  <span data-print-link>lasvegasfortransit.org/join</span>
</a>
```

Keep explanatory content while removing the action button:

```astro
<section data-print-callout class="bg-primary text-on-primary">
  <div class="container-page">
    <h2>Membership</h2>
    <p>Membership is free and takes a minute.</p>
    <a href="/join" class="press">Become a member</a>
  </div>
</section>
```

In print, that section becomes an inset bordered callout, and the `.press` action link disappears
inside this explicitly marked callout. The `[data-print-callout] a.press` rule hides it even if it
has `data-print-url`. Keep a needed destination as a normal text link inside the callout instead.

## Component checklist

When adding or editing a component, ask:

1. Does it use a full-width color background? The common band classes are automatic. Add
   `data-print-callout` only if the component needs the same paper-callout treatment without using
   those classes.
2. Is it a card-like link? Add `data-print-card`. Mark a direct child action prompt with `font-bold`
   if it should disappear. Keep explanatory text outside that action label.
3. Does it include a normal button-like link? Use normal button styling. It will disappear
   automatically unless it also has `data-print-url` or `data-print-plain-link`. Check the
   explicit-callout exception above.
4. Does it link to a form, email address, event registration, source record, or external page that a
   printed reader may need? Add `data-print-url`.
5. Does it depend on animation, sticky positioning, a carousel, tabs, or a modal? Add a print state
   that shows the useful content without the control.
6. Can someone understand the page without the final directory sheet? Keep page content
   self-contained and let the footer directory carry sitewide links.

## What not to do

- Do not rely on hover text, icons, or arrows to carry meaning in print.
- Do not print large screen buttons unless the destination is useful on paper.
- Do not use the sitewide background color to frame printed pages. Print uses a white page;
  component-level backgrounds are allowed only when they still read well on paper.
- Do not add one-off print CSS in a component until you have checked whether one of the properties
  above already expresses the intent.
