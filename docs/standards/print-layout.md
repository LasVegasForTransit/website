# Print layout

The website is meant to work as a website and as a printed handout. This doc is
the authoring contract for that behavior. Use it when adding a page, component,
or link that might appear on paper.

Print layout is automatic because components expose small `data-*` properties.
A `data-*` property is a normal HTML attribute that carries metadata for CSS and
tests. In this site, print CSS reads those properties to decide what becomes a
paper callout, what disappears, what keeps a useful destination, and what becomes
the final directory page.

The print rules live in [`src/styles/global.css`](../../src/styles/global.css)
inside `@media print`. The coverage for the main contract lives in
[`tests/print-layout.spec.ts`](../../tests/print-layout.spec.ts).

## The rule

Printed pages should read like edited handouts, not screenshots of the web
interface.

- Keep explanatory content.
- Remove controls that only make sense on a screen.
- Keep useful destinations when the printed reader can act on them.
- Turn large color bands into paper-safe callouts.
- End with the separable site directory page.

## What is automatic

Common screen controls already have print defaults:

- Real buttons, elements with `role="button"`, share controls, and anything with
  `data-screen-action` disappear in print.
- Button-like links that use `.press`, `bg-primary`, `bg-on-surface`, or
  `border-2` disappear in print unless they also have `data-print-url` or
  `data-print-plain-link`.
- Top-level color bands using `bg-slab`, `band-ink`, `bg-primary`,
  `band-primary`, or `bg-primary-container` print as inset bordered callouts.
- Card-like links with `data-print-card` print as compact paper entries. Direct
  bold `p` or `span` trailers disappear automatically, so a card can say "Read
  brief" or "Read on Beehiiv" on screen without carrying that prompt onto paper.
- The site header and footer are replaced by print-specific chrome: the
  logomark-only top bar and the final directory page.

That means common cases should be simple:

- Use normal button styling for screen buttons. If the button is only a web
  action, print removes it.
- Use `data-print-card` on card-like links. The card prints as an entry, and the
  trailing action prompt disappears.
- Add `data-print-url` only when the printed reader needs the destination.

Normal text links are not hidden automatically. A browser cannot know whether a
link is a citation, source, email address, registration form, or just a "keep
reading" prompt. Use `data-print-url` when the destination should survive on
paper, and `data-screen-action` when the link is only web navigation.

## Properties

| Property                | Put it on                                                                            | What print does                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `data-screen-action`    | An unusual control that is not covered by the automatic button or project-card rules | Hides it in print. Use this for odd controls, carousel controls, share buttons, and similar web-only UI.                       |
| `data-print-url`        | A link whose destination is useful on paper                                          | Marks the destination as print-relevant. Print CSS strips button styling so the link reads like text instead of a web control. |
| `data-print-link`       | A child span inside a `data-print-url` link                                          | Shows a compact printed destination beside the link text. Use this when the visible label is not already the destination.      |
| `data-print-link-path`  | A child span inside `data-print-link`                                                | Lets a path such as `/join` use accent color while the domain stays neutral.                                                   |
| `data-print-plain-link` | A link that already includes the useful destination in its visible text              | Keeps the link inline and avoids adding duplicate URL text.                                                                    |
| `data-print-callout`    | A section that should be kept but should not print as a screen-style band            | Prints the section as an inset bordered paper callout with padding.                                                            |
| `data-print-topbar`     | The print-only page header in `BaseLayout.astro`                                     | Shows only the logomark at the top of printed pages.                                                                           |
| `data-print-link-sheet` | The print-only directory section in `Footer.astro`                                   | Forces a separate final page with human-readable site links.                                                                   |
| `data-print-card`       | A card-like link or entry                                                            | Prints the card as a compact paper entry and hides direct bold action trailers.                                                |
| `data-brand-print-only` | Brand-guide content that exists only for paper                                       | Shows the content in print and keeps it hidden on screen.                                                                      |
| `data-brand-print-hide` | Brand-guide controls or decoration that should not print                             | Hides the element in print.                                                                                                    |

## How decisions are made

Think about the printed reader, not the browser user.

- If an element tells the reader something useful, keep it.
- If an element only tells the browser what to do next, first check whether an
  automatic rule already covers it. Button-like links and project-card trailing
  actions are automatic.
- If a link destination matters after printing, add `data-print-url`.
- If a link is only a navigation prompt and is not covered by an automatic rule,
  use `data-screen-action`.
- If a section uses `bg-slab`, `band-ink`, `bg-primary`, `band-primary`, or
  `bg-primary-container` as a full-width screen band, print CSS turns it into an
  inset paper callout automatically. Add `data-print-callout` when a component
  should get that treatment even if it does not use those classes.

This is the "data system" for print. Components provide intent through
properties; CSS turns that intent into the paper layout.

## Examples

Make a project-card link:

```astro
<a href="/projects/bus-stop-shade" data-print-card data-print-url="/projects/bus-stop-shade">
  <div>
    <h3>Bus stop shade</h3>
    <p>Organizing for basic comfort at bus stops.</p>
  </div>
  <span>Read brief</span>
</a>
```

In print, the card becomes a compact paper entry and the trailing `Read brief`
span disappears automatically.

Keep a useful email link:

```astro
<a href="mailto:hello@lasvegasfortransit.org" data-print-url="hello@lasvegasfortransit.org">
  hello@lasvegasfortransit.org
</a>
```

Keep a button-shaped link on screen, but print it as plain text:

```astro
<a href="/join" data-print-url="lasvegasfortransit.org/join" class="press bg-on-surface">
  Become a member
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

In print, that section becomes an inset bordered callout, and the `.press` action
link disappears unless it also has `data-print-url`.

## Component checklist

When adding or editing a component, ask:

1. Does it use a full-width color background?
   The common band classes are automatic. Add `data-print-callout` only if the
   component needs the same paper-callout treatment without using those classes.
2. Is it a card-like link?
   Add `data-print-card`. The trailing action prompt will disappear
   automatically.
3. Does it include a normal button-like link?
   Use normal button styling. It will disappear automatically unless it also has
   `data-print-url`.
4. Does it link to a form, email address, event registration, source record, or
   external page that a printed reader may need?
   Add `data-print-url`.
5. Does it depend on animation, sticky positioning, a carousel, tabs, or a modal?
   Add a print state that shows the useful content without the control.
6. Would the element look strange if someone tore the final directory page away
   from the rest of the handout?
   Keep page content self-contained and let the footer directory carry sitewide
   links.

## What not to do

- Do not rely on hover text, icons, or arrows to carry meaning in print.
- Do not print giant screen buttons unless the destination is useful on paper.
- Do not use the sitewide background color to frame printed pages. Print uses a
  white page; component-level backgrounds are allowed only when they still read
  well on paper.
- Do not add one-off print CSS in a component until you have checked whether one
  of the properties above already expresses the intent.
