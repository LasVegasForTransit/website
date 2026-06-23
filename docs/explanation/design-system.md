# Design system

The brand color system and the rules behind it. For the token look-up table — hex
values, utilities, the canvas/band machinery — see
[Design tokens](../reference/design-tokens.md).

## The palette

A warm, editorial palette: cream paper, near-black ink, and a saturated transit
orange that carries almost all of the color in the interface.

| Name  | Token                 | Hex       | Role                                 |
| ----- | --------------------- | --------- | ------------------------------------ |
| Ember | `--color-accent`      | `#e5471a` | The primary accent — the brand color |
| Coral | `--color-accent-warm` | `#ec7049` | Softened Ember                       |
| Peach | `--color-accent-soft` | `#ffe9d6` | Pale Ember, for dark surfaces        |
| Rust  | `--color-accent-ink`  | `#bf3a10` | Ember as readable text on light      |
| Cream | `--color-paper`       | `#f7f4ec` | Page background / light foreground   |
| Ink   | `--color-ink`         | `#0f1115` | Text / dark surfaces                 |
| Stone | `--color-mute`        | `#4a4e57` | Secondary text                       |

Friendly names are for the brand kit (Canva/Figma swatch names, design conversation).
In code, the semantic token names are the source of truth.

## How to use color

These rules are what keep the site from drifting into a generic "colorful" look. They
are deliberate constraints, not defaults.

- **Skew heavily to the primary.** Ember is the one color. Reach for it for emphasis,
  action, and accent before anything else. The palette is intentionally narrow.
- **Minimize colored surfaces.** Color is for ink-on-cream type, accents, and the
  occasional full-bleed Ember or ink band — not for filling cards and panels. Large
  areas are cream or ink; color earns its place.
- **Don't introduce new surfaces.** The surface model is cream ↔ ink (the canvas/band
  system). Resist adding tinted "container" fills or elevation layers; they read as a
  different, busier design language.
- **Sharp corners.** No border radius. Shapes are square.
- **Divide with lines, occasionally.** Structure comes from rules and outlines
  (`--color-rule`, `.rule-thick`/`.rule-thin`, `border-ink`), used sparingly — not from
  background blocks. A hairline does the job a filled box would do elsewhere.

A rough proportion to aim for: cream and ink dominate, Stone/neutrals support, Ember is
the small, deliberate accent. Never flood a viewport with saturated Ember (e.g. a
full-screen orange background) — it vibrates and cheapens; use it as the highlight.

## Why `accent-ink` exists

The bright Ember (`#e5471a`) is only ~3.5:1 on cream — below WCAG AA for body-size
text. Links and inline accent text on light surfaces therefore use a darkened Rust
(`#bf3a10`, ~4.9:1), while fills, buttons, large display type, and accent-on-dark keep
the bright Ember.

**Why it's deliberate:** the alternative — one accent value everywhere — either fails
contrast on small text or forces the whole brand darker. Splitting "accent as fill"
from "accent as text" keeps the bright brand color intact where it's safe and only
darkens it where the type would otherwise be unreadable. The split is wired through the
content-link variables and the vision cream band, so it applies automatically; you
rarely set it by hand. See the contrast notes in `vision.css` for the band math.

## Reserved colors (defined, not yet shipped)

The full brand defines colors that are **not** wired into the site CSS yet. They live
here so the brand kit and future work are consistent, but nothing on the live site uses
them today. Adding any of them to `global.css` is a deliberate decision, not a default.

- **Spruce** `#145848` — a deep green secondary, the environmental note. Reserved for
  occasional small accents and graphics; kept out of the live UI for now to preserve
  the skew-to-primary, minimal-surface look.
- **Transit Blue** (~`#1f6f9c`) — a third accent for wayfinding and, with Spruce,
  the basis of a data-visualization palette.
- **Data-viz palette** — for maps and charts (coverage, frequency, ridership): a
  categorical set anchored by Ember / Spruce / Transit Blue plus distinct supporting
  hues, and a single-hue sequential ramp for choropleths. To be specified when the first
  chart or map is built.

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
