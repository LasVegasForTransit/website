# Design tokens reference

The look-up table for the site's color and type tokens. For the _why_ — brand
philosophy, usage rules, the colors we've reserved but not shipped — see
[Design system](../explanation/design-system.md).

The color system has **two tiers**, both in
[`src/styles/global.css`](../../src/styles/global.css):

1. **Brand primitives** — raw hex (`--ink`, `--paper`, `--ember`, the warm-charcoal
   ramp, …) in a plain `:root`. They generate **no** utilities; they are the palette
   that the roles below reference. Non-flipping: the same value in light and dark.
2. **Semantic role tokens** — MD3-style roles (`--color-surface`, `--color-on-surface`,
   `--color-primary`, …) in the Tailwind v4 `@theme` block. Tailwind auto-generates
   utilities from them (`--color-surface` → `bg-surface`; `--color-on-surface` →
   `text-on-surface`, `border-on-surface`). These are **re-pointed under
   `@media (prefers-color-scheme: dark)`**, so overriding a role once flips every
   consumer. See [Dark theme](#dark-theme).

**The contract:** components reference colors through the semantic utilities
(`bg-surface`, `text-primary`, `border-outline`) or the `--color-*` variables — never
raw hex, and never the primitives directly (except a handful of always-dark immersive
surfaces: the QR deck and the vision photo-hero scrim). Swapping a brand value means
editing one primitive; every consumer follows.

## Color roles

Light and dark values. "→ primitive" shows what each role resolves to.

| Role token                     | Light           | Dark            | Job                                                         |
| ------------------------------ | --------------- | --------------- | ----------------------------------------------------------- |
| `--color-surface`              | Cream `#f7f4ec` | Ink `#0f1115`   | Page background                                             |
| `--color-on-surface`           | Ink `#0f1115`   | Cream `#f7f4ec` | Body text; also the neutral high-contrast button fill       |
| `--color-on-surface-variant`   | Stone `#4a4e57` | Warm `#b0a99c`  | Muted/secondary text and quiet borders                      |
| `--color-surface-container`    | Cream `#f7f4ec` | `#1a1713`       | The one elevation level: cards/panels (flush in light)      |
| `--color-slab`                 | Ink `#0f1115`   | `#24201a`       | The "punctuation slab" — see below. **Dark in both themes** |
| `--color-on-slab`              | Cream `#f7f4ec` | Cream `#f7f4ec` | Text on the slab (cream in both)                            |
| `--color-on-slab-variant`      | `#a8acb4`       | Warm `#b0a99c`  | Muted text on the slab                                      |
| `--color-outline`              | Ink `#0f1115`   | `#524a3f`       | Strong solid line (card/button outlines)                    |
| `--color-outline-variant`      | Ink `#0f1115`   | Cream `#f7f4ec` | Faint hairline base for `/alpha` (tracks on-surface)        |
| `--color-primary`              | Ember `#e5471a` | Ember `#e5471a` | Primary **fill**: buttons, active states, badges            |
| `--color-on-primary`           | Cream `#f7f4ec` | Cream `#f7f4ec` | Text/icon on `primary`                                      |
| `--color-primary-container`    | Peach `#ffe9d6` | `#47210f`       | Soft primary surface (dark ember-brown in dark)             |
| `--color-on-primary-container` | Ink `#0f1115`   | `#ffd9c7`       | Text on `primary-container`                                 |
| `--color-primary-ink`          | Rust `#bf3a10`  | `#ff8a5c`       | Primary **as text** — brightens in dark (MD3 tone lift)     |
| `--color-primary-warm`         | Coral `#ec7049` | Coral `#ec7049` | Softened primary                                            |
| `--color-primary-soft`         | Peach `#ffe9d6` | Peach `#ffe9d6` | Soft accent for links/labels on the slab (light both)       |
| `--color-link`                 | = `primary-ink` | = `primary-ink` | Inline-link accent (remapped to `primary-soft` on the slab) |

**Retired aliases:** older Paper/Ink/Rule utility names are no longer part of the
authoring API. Use `surface` / `on-surface`, `slab` / `on-slab`, and
`outline-variant` instead. Secondary text should use the MD3 role directly:
`text-on-surface-variant` on normal surfaces, `text-on-slab-variant` on the slab, and
`text-on-primary` on primary surfaces.

### The slab

Light mode expresses emphasis by **inversion** (a near-black band on cream); dark mode
by **elevation** (a slightly raised warm charcoal on the near-black page). Both are one
visual element — the "punctuation slab" (the home Cliff band, the footer, featured
cards, the vision `band-ink`). `--color-slab` is therefore Ink in light and warm
charcoal `#24201a` in dark — **dark in both themes, never a bright surface** — while its
text role `--color-on-slab` is cream in both. Author it with `bg-slab text-on-slab`.
(This is deliberately _not_ named `inverse-surface`: MD3's inverse-surface is a _bright_
surface in dark, which would turn the footer into a glare.)

**`primary`, `on-primary`, and `primary-ink`.** Ember is ~3.6:1 on Cream, and LVBT uses
Cream as `on-primary` for brand-forward primary moments. Treat primary surfaces as
short action or emphasis surfaces, not long-reading containers. When orange itself is
the text color, use `primary-ink` — Rust on light (~5:1), brightened to `#ff8a5c` on
dark. Do not use `primary-ink` as the foreground on `primary`.

## Dark theme

Device-driven only, via `@media (prefers-color-scheme: dark)` — **no manual toggle, no
JS, no `localStorage`**. The media block re-points the role tokens (and sets
`color-scheme: dark`). Character is "Valley after dark": a warm near-black canvas, MD3
tonal elevation (lighter warm-charcoal containers, not drop shadows), and Ember reading
like a light in the dark — including an opt-in `.glow-ember` / `.press.bg-primary` glow
applied only in dark. Neutral/content role pairs are held ≥4.5:1, rules ≥3:1, and the
primary/on-primary brand pair ≥3:1 by
[`tests/color-contracts.spec.ts`](../../tests/color-contracts.spec.ts), which runs in
both schemes.

## Context-aware overrides

- **Secondary text** uses the appropriate role for its surface: `text-on-surface-variant`
  on normal surfaces, `text-on-slab-variant` on the slab, and `text-on-primary` on
  primary. Interactive surfaces that invert to `bg-on-surface` remap
  `on-surface-variant` for that active state so secondary text remains readable.
- **Content links** are driven by `--content-link-color` / `--content-link-hover` /
  `--content-link-decoration` on `.lede` / `.prose-doc`. Base surfaces resolve
  hover/decoration to `primary-ink`; slab surfaces (`.bg-slab` / `.band-ink`) rest at
  `on-slab` and hover to `primary-soft`.

## Canvas system

Pages opt into an **immersive dark hero** via the `canvas` prop on
[`BaseLayout.astro`](../../src/layouts/BaseLayout.astro) (sets `data-canvas` on `<body>`).
This is orthogonal to the theme — it forces an always-dark rooted hero (transparent
header) in _both_ schemes, using fixed primitives.

| `canvas`          | Background        | Used by                 |
| ----------------- | ----------------- | ----------------------- |
| `paper` (default) | `--color-surface` | All standard pages      |
| `dark`            | `--ink` (fixed)   | `/vision`, `/qr` (deck) |

## Vision band system

`/vision` alternates section backgrounds with `.band-cream`, `.band-ink`,
`.band-primary` (in [`src/styles/vision.css`](../../src/styles/vision.css)). Each band
sets a local `--vp-*` palette so section components stay band-agnostic. The bands now map
to the site roles: `band-cream` → `surface` (base), `band-ink` → `slab`,
`band-primary` → `primary`. So the vision page inherits the dark theme for free.

## Print layout hooks

The color utilities above are for screens first. Printed pages use the same
semantic roles, then layer on a small data-attribute system documented in
[Print layout](../standards/print-layout.md). Those properties, such as
`data-screen-action`, `data-print-url`, and `data-print-callout`, tell the print
stylesheet which screen elements are useful on paper and which are only web
controls.

## Type tokens

An MD3-style scale, defined in the same `@theme` block, exposed as `text-*` utilities.
Sizes use `clamp()` for fluid scaling; display sizes are bumped above MD3 defaults for
an editorial feel. Values are in `rem`, not `px`, so the scale follows a user's browser
font-size setting.

| Family   | Utilities                                                  |
| -------- | ---------------------------------------------------------- |
| Display  | `text-display-lg`, `text-display-md`, `text-display-sm`    |
| Headline | `text-headline-lg`, `text-headline-md`, `text-headline-sm` |
| Title    | `text-title-lg`, `text-title-md`, `text-title-sm`          |
| Body     | `text-body-lg`, `text-body-md`, `text-body-sm`             |
| Label    | `text-label-lg`, `text-label-md`, `text-label-sm`          |

Each carries paired `--line-height`, `--letter-spacing`, and `--font-weight`. Font:
`Public Sans Variable` via `--font-sans`.

### Body type roles

| Utility        | Use for                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------- |
| `text-body-lg` | Ledes, section intros, prominent summaries, and short explanatory copy that introduces work |
| `text-body-md` | Default paragraphs, card descriptions, prose blocks, and standard explanatory copy          |
| `text-body-sm` | Metadata, captions, helper text, secondary notes, dates, status text, and compact support   |

Rule of thumb: Body large introduces, Body medium explains, and Body small supports. The
`.lede` component uses body large; `.prose-doc` defaults to body medium.
