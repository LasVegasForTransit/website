# Design system

The brand color system and the rules behind it. For the token look-up table — hex
values, utilities, the canvas/band machinery — see
[Design tokens](../reference/design-tokens.md).

## The palette

A warm, editorial palette: cream paper, near-black ink, and a saturated transit
orange that carries almost all of the color in the interface.

| Name  | Token                          | Hex       | Role                            |
| ----- | ------------------------------ | --------- | ------------------------------- |
| Ember | `--color-primary`              | `#e5471a` | Primary fill                    |
| Cream | `--color-on-primary`           | `#f7f4ec` | Text / icons on Ember           |
| Peach | `--color-primary-container`    | `#ffe9d6` | Soft primary surface            |
| Ink   | `--color-on-primary-container` | `#0f1115` | Text / icons on Peach           |
| Rust  | `--color-primary-ink`          | `#bf3a10` | Ember as readable text on light |
| Coral | `--color-primary-warm`         | `#ec7049` | Softened Ember                  |
| Cream | `--color-surface`              | `#f7f4ec` | Page background                 |
| Ink   | `--color-on-surface`           | `#0f1115` | Text on the base surface        |
| Stone | `--color-on-surface-variant`   | `#4a4e57` | Secondary text on surface       |

Friendly names are for the brand kit (Canva/Figma swatch names, design conversation).
In code, the semantic token names are the source of truth.

## How to use color

These rules are what keep the site from drifting into a generic "colorful" look. They
are deliberate constraints, not defaults.

- **Use color in pairs.** Ember surfaces use Cream through `on-primary`; Peach surfaces
  use Ink through `on-primary-container`.
- **Skew heavily to the primary.** Ember is the one color. Reach for it for emphasis
  and action before anything else. The palette is intentionally narrow.
- **Minimize colored surfaces.** Color is for ink-on-cream type, primary marks, and the
  occasional full-bleed Ember or ink band — not for filling cards and panels. Large
  areas are cream or ink; color earns its place.
- **Don't introduce new surfaces.** The surface model is cream ↔ ink (the canvas/band
  system), expressed in code as the `surface` / `on-surface` / `slab` roles. Resist
  adding tinted "container" fills or extra elevation layers; they read as a different,
  busier design language. Dark mode adds exactly **one** raised tone (a warm charcoal for
  the slab and cards) — the minimum needed to keep the section rhythm; it is not a licence
  for a multi-step elevation ladder.
- **Sharp corners.** No border radius. Shapes are square.
- **Divide with lines, occasionally.** Structure comes from rules and outlines
  (`outline-variant`, `.rule-thick`/`.rule-thin`, semantic borders), used sparingly — not from
  background blocks. A hairline does the job a filled box would do elsewhere.

A rough proportion to aim for: cream and ink dominate, Stone/neutrals support, Ember is
the small, deliberate primary. Never flood a viewport with saturated Ember (e.g. a
full-screen orange background) — it vibrates and cheapens; use it as the highlight.

## Why the primary roles are split

The bright Ember (`#e5471a`) is only ~3.6:1 on Cream, and Cream text on Ember is also
~3.6:1. LVBT intentionally keeps Cream as `on-primary` because it reads as the brand
voice on Ember. Primary surfaces should be short action or emphasis moments, not long
reading surfaces. Links and inline primary text on light surfaces use a darkened Rust
(`primary-ink`, ~5.0:1).

**Why it's deliberate:** one primary value everywhere either fails contrast or forces
the whole brand darker. The split keeps Ember bright as a fill, uses Cream for the
brand-forward foreground on Ember, and uses Rust only when orange itself is the text.

## Dark theme

The site ships a device-driven dark theme ("Valley after dark") via
`@media (prefers-color-scheme: dark)` — no manual toggle. It follows MD3's dark-theme
method rather than a bespoke scheme: warm low-tone neutrals (never pure black, matching
the brand rule), elevation expressed by progressively lighter warm-charcoal surfaces
rather than drop shadows, and the primary tone lightening for text (Rust → a brighter
Ember) while the Ember fill stays saturated.

The cream ↔ ink rhythm is preserved by re-reading it per theme: the base surface goes
cream → near-black, and the emphasis "slab" (the near-black band in light) becomes a
_slightly raised_ warm charcoal in dark — dark in both themes, never inverted to a bright
panel. Ember remains the single accent, used just as sparingly, with a restrained glow on
primary CTAs standing in for the "light in the dark." Token values and the machinery live
in [Design tokens](../reference/design-tokens.md#dark-theme).

## Reserved colors (defined, not yet shipped)

The full brand defines colors that are **not** wired into the site CSS yet. They live
here so the brand kit and future work are consistent, but nothing on the live site uses
them today. Adding any of them to `global.css` is a deliberate decision, not a default.

- **Spruce** `#145848` — a deep green secondary, the environmental note. Reserved for
  occasional small marks and graphics; kept out of the live UI for now to preserve
  the skew-to-primary, minimal-surface look.
- **Transit Blue** (~`#1f6f9c`) — a third color for wayfinding and, with Spruce,
  the basis of a data-visualization palette.
- **Data-viz palette** — for maps and charts (coverage, frequency, ridership): a
  categorical set anchored by Ember / Spruce / Transit Blue plus distinct supporting
  hues, and a single-hue sequential ramp for choropleths. To be specified when the first
  chart or map is built.

## Where a style lives

Four styling mechanisms coexist in the codebase. A style goes in the first bucket it
qualifies for, top to bottom:

1. **Tokens** — raw palette values in `:root`, semantic roles and the type scale in
   `@theme` (both in `src/styles/global.css`). If a value will ever be reused or
   theme-flipped, it starts here.
2. **`@layer components` in `global.css`** — patterns shared by more than one page or
   component (`.press`, `.lift`, `.prose-doc`, containers). Nothing page-specific.
3. **Scoped `<style>` in the component or page** — rules only that file needs. Prefer
   utility classes in markup first; reach for a scoped block when selectors or
   at-rules can't be expressed as utilities.
4. **Unlayered top level of `global.css`** — only for rules that must outrank
   Tailwind's layered utilities, each with a comment saying why.
   `scripts/audit/brand-tokens.ts` fails the build if a top-level block isn't on its
   allowlist, so additions are a deliberate two-file change.

No new CSS modules — `BrandContents.module.css` predates this rule and stays as the
lone exception. Stylesheet lint runs via stylelint (`.stylelintrc.json`) in the
pre-commit hook and CI.

## Brand kit notes (Canva / Figma / print)

For graphics made outside the codebase:

- **Use the friendly names** above as swatch names in Canva/Figma brand kits.
- **No pure black or white.** Use Ink `#0f1115` and Cream `#f7f4ec`; Canva defaults to
  `#000`/`#fff`, which read cold against the warm palette.
- **Print values are proof-pending.** Hex is screen-only. CMYK and Pantone equivalents
  must be confirmed against a physical proof before any print run — saturated
  orange-reds like Ember shift duller and browner in CMYK and cannot be eyeballed.
- **Carry the constraints over.** Skew to Ember, minimize colored fills, sharp corners,
  thin rules for structure — the same rules that govern the site govern the graphics.

For the website's automatic paper layouts, see
[Print layout](../standards/print-layout.md). Components use `data-*`
properties to tell print CSS which content should become a paper callout, which
actions should disappear, and which links should keep useful destinations.
