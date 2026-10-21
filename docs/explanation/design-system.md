# Design system

Use this page when choosing colors or placing styles in the website. It explains the brand colors
and the rules behind them. For exact color values, named CSS settings (tokens), and shared style
classes, see [Design tokens](../reference/design-tokens.md).

## The palette

The site uses cream backgrounds, near-black text, and transit orange for most colored accents.

| Name  | Token                          | Hex       | Role                            |
| ----- | ------------------------------ | --------- | ------------------------------- |
| Ember | `--color-primary`              | `#e5471a` | Primary fill                    |
| Ink   | `--color-on-primary`           | `#0f1115` | Text / icons on Ember           |
| Peach | `--color-primary-container`    | `#ffe9d6` | Soft primary surface            |
| Ink   | `--color-on-primary-container` | `#0f1115` | Text / icons on Peach           |
| Rust  | `--color-primary-ink`          | `#bf3a10` | Ember as readable text on light |
| Coral | `--color-primary-warm`         | `#ec7049` | Softened Ember                  |
| Cream | `--color-surface`              | `#f7f4ec` | Page background                 |
| Ink   | `--color-on-surface`           | `#0f1115` | Text on the base surface        |
| Stone | `--color-on-surface-variant`   | `#4a4e57` | Secondary text on surface       |

Friendly names are for the brand kit (Canva/Figma swatch names, design conversation). In code, the
named CSS roles define how the colors are used.

## How to use color

These rules are what keep the site from drifting into a generic "colorful" look. They are deliberate
constraints, not defaults.

- **Use color in pairs.** Ember surfaces use Ink through `on-primary`; Peach surfaces use Ink
  through `on-primary-container`.
- **Use mostly the primary color.** Ember is the one color. Reach for it for emphasis and action
  before anything else. The palette is intentionally narrow.
- **Minimize colored surfaces.** Color is for ink-on-cream type, primary marks, and the occasional
  full-width Ember or ink section — not for filling cards and panels. Large areas are cream or ink;
  use color only where it helps people understand or act.
- **Don't introduce new surfaces.** Page backgrounds and emphasis sections alternate between cream
  and ink, expressed in code as the `surface` / `on-surface` / `slab` roles. Resist adding tinted
  "container" fills or extra raised surfaces; they make the page busier. Dark mode adds exactly
  **one** raised tone (a warm charcoal for the slab and cards) — the minimum needed to distinguish
  the sections; do not add more shades for more levels of depth.
- **Sharp corners.** No border radius. Shapes are square.
- **Divide with lines, occasionally.** Separate content with lines and outlines (`outline-variant`,
  `.rule-thick`/`.rule-thin`, semantic borders), used sparingly — not from background blocks. A
  hairline does the job a filled box would do elsewhere.

A rough proportion to aim for: cream and ink dominate, Stone/neutrals support, Ember is the small,
deliberate primary. Never flood a viewport with saturated Ember (e.g. a full-screen orange
background) — it makes long pages harder to read; use it for emphasis.

## Why the primary roles are split

The bright Ember (`#e5471a`) is only ~3.6:1 on Cream. Ember surfaces use Ink as `on-primary` so
small button and status text meets the Web Content Accessibility Guidelines (WCAG) AA contrast
requirement. Primary surfaces should be short action or emphasis moments, not long reading surfaces.
Links and inline primary text on light surfaces use a darkened Rust (`primary-ink`, ~5.0:1).

The split keeps Ember bright as a fill, uses Ink for readable foreground text on Ember, and uses
Rust when orange itself is the text.

## Dark theme

The site ships a device-driven dark theme ("Valley after dark") via
`@media (prefers-color-scheme: dark)` — no manual toggle. It follows Material Design 3's dark-theme
method: warm dark grays rather than pure black, lighter charcoal for raised surfaces rather than
shadows, and a brighter orange for text. Ember backgrounds keep their saturated color.

The cream ↔ ink rhythm is preserved by re-reading it per theme: the base surface goes cream →
near-black, and the emphasis "slab" (the near-black band in light) becomes a _slightly raised_ warm
charcoal in dark — dark in both themes, never inverted to a bright panel. Ember remains the single
accent, used just as sparingly, with a restrained glow on primary action buttons. The exact CSS
settings live in [Design tokens](../reference/design-tokens.md#dark-theme).

## Reserved colors (defined, not yet shipped)

The full brand defines colors that are **not** wired into the site CSS yet. They live here so the
brand kit and future work are consistent, but nothing on the live site uses them today. Adding any
of them to `global.css` is a deliberate decision, not a default.

- **Spruce** `#145848` — a deep green secondary, the environmental note. Reserved for occasional
  small marks and graphics; kept out of the live UI for now to preserve the skew-to-primary,
  minimal-surface look.
- **Transit Blue** (~`#1f6f9c`) — a third color for wayfinding and, with Spruce, the basis of a
  data-visualization palette.
- **Data-viz palette** — for maps and charts (coverage, frequency, ridership): distinct colors based
  on Ember / Spruce / Transit Blue for categories, and light-to-dark shades of one color for maps
  that color areas by a value. To be specified when the first chart or map is built.

## Where a style lives

The site stores styles in four places. Choose the first place below that fits the style:

1. **Tokens** — raw palette values in `:root`, semantic roles and the type scale in `@theme` (both
   in `apps/site/src/styles/global.css`). If a value will be reused or change with the theme, it
   starts here.
2. **`@layer components` in `global.css`** — patterns shared by more than one page or component
   (`.press`, `.lift`, `.prose-doc`, containers). Nothing page-specific.
3. **Scoped `<style>` in the component or page** — rules only that file needs. Prefer utility
   classes in markup first; reach for a scoped block when selectors or at-rules can't be expressed
   as utilities.
4. **Unlayered top level of `global.css`** — only for rules that must outrank Tailwind's layered
   utilities, each with a comment saying why. `apps/site/scripts/audit/brand-tokens.ts` fails the
   build if a top-level block isn't on its allowlist, so additions are a deliberate two-file change.

No new CSS modules — `BrandContents.module.css` predates this rule and stays as the lone exception.
Stylesheet lint runs via stylelint (`apps/site/.stylelintrc.json`) as part of `pnpm lint`, so the
pre-push hook and CI both run it.

## Brand kit notes (Canva / Figma / print)

For graphics made outside the codebase:

- **Use the friendly names** above as swatch names in Canva/Figma brand kits.
- **No pure black or white.** Use Ink `#0f1115` and Cream `#f7f4ec`; Canva defaults to
  `#000`/`#fff`, which read cold against the warm palette.
- **Print values are proof-pending.** Hex values describe screen colors. CMYK (four-color printing)
  and Pantone (standardized ink) equivalents must be confirmed against a physical proof before any
  print run — saturated orange-reds like Ember shift duller and browner in CMYK and cannot be
  eyeballed.
- **Carry the constraints over.** Skew to Ember, minimize colored fills, sharp corners, thin rules
  for structure — the same rules that govern the site govern the graphics.

For the website's automatic paper layouts, see [Print layout](../standards/print-layout.md).
Components use `data-*` properties to tell print CSS which content should become a paper callout,
which actions should disappear, and which links should keep useful destinations.
