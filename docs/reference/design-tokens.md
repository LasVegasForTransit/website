# Design tokens reference

The look-up table for the site's color and type tokens. For the _why_ — brand
philosophy, usage rules, the colors we've reserved but not shipped — see
[Design system](../explanation/design-system.md).

All tokens are defined as CSS custom properties in the Tailwind v4 `@theme` block
in [`src/styles/global.css`](../../src/styles/global.css). Tailwind auto-generates
utilities from them (`--color-accent` → `bg-accent`, `text-accent`, `border-accent`).

**The contract:** components reference colors through the semantic utilities
(`bg-ink`, `text-accent`, `border-rule`) or the `--color-*` variables — never raw
hex. Swapping a brand value means editing one line in `@theme`; every consumer
follows. Keep the semantic names stable; that's the interface between CSS and the
~80 components that depend on it.

## Color tokens

| Token                 | Hex       | Name  | Use                                                                                               |
| --------------------- | --------- | ----- | ------------------------------------------------------------------------------------------------- |
| `--color-ink`         | `#0f1115` | Ink   | Primary text on light; dark canvas/surface background                                             |
| `--color-paper`       | `#f7f4ec` | Cream | Default page background; text/foreground on dark surfaces                                         |
| `--color-accent`      | `#e5471a` | Ember | The primary accent — **fills**, buttons, active states, large display accent, accent text on dark |
| `--color-accent-warm` | `#ec7049` | Coral | Softened accent — featured-card titles on dark, gradient mid-stop                                 |
| `--color-accent-soft` | `#ffe9d6` | Peach | Pale accent — eyebrows/labels on dark, soft affordances                                           |
| `--color-accent-ink`  | `#bf3a10` | Rust  | Accent **as text** on light surfaces — links, inline accent text (see note)                       |
| `--color-mute`        | `#4a4e57` | Stone | Secondary text, eyebrows, muted labels (lifts to `#a8acb4` on dark)                               |
| `--color-rule`        | `#1f232b` | —     | Hairlines, dividers, subtle borders                                                               |

**`accent` vs `accent-ink`.** The bright Ember is ~3.5:1 on cream — below WCAG AA
for body-size text. So accent-as-text on light surfaces uses `accent-ink` (~4.9:1);
fills, buttons, large display, and accent-on-dark keep the bright Ember. In practice
this is wired through the content-link variables (below), not applied per element.

## Context-aware overrides

- **`--color-mute`** lifts to `#a8acb4` under `body[data-canvas='dark']`, `.bg-ink`,
  and `.on-dark-surface` for contrast, and flips to `var(--color-ink)` on `.bg-accent`.
- **Content links** are driven by `--content-link-color` / `--content-link-hover` /
  `--content-link-decoration`, set per surface on `.lede` and `.prose-doc`. Light
  surfaces resolve hover/decoration to `accent-ink`; `.text-paper` (dark) surfaces use
  `accent-soft`. The link styling itself lives on `.body-link`, `.lede a`, `.prose-doc a`.

## Canvas system

Pages opt into a background via the `canvas` prop on
[`BaseLayout.astro`](../../src/layouts/BaseLayout.astro), which sets
`data-canvas` on `<body>`:

| `canvas`          | Background            | Used by            |
| ----------------- | --------------------- | ------------------ |
| `paper` (default) | Cream `--color-paper` | All standard pages |
| `dark`            | Ink `--color-ink`     | `/vision`          |

## Vision band system

`/vision` alternates section backgrounds with `.band-cream`, `.band-ink`,
`.band-accent` (in [`src/styles/vision.css`](../../src/styles/vision.css)). Each band
sets a local `--vp-*` palette (`--vp-text`, `--vp-eyebrow`, `--vp-prose`, `--vp-link`,
`--vp-rule`, …) so section components stay band-agnostic. The cream band's `--vp-link`
resolves to `accent-ink`; the ink band uses `accent-soft`; the accent band flips to
ink-derived tones (cream text bottoms out at 3.64:1 on Ember).

## Type tokens

An MD3-style scale, defined in the same `@theme` block, exposed as `text-*` utilities.
Sizes use `clamp()` for fluid scaling; display sizes are bumped above MD3 defaults for
an editorial feel.

| Family   | Utilities                                                  |
| -------- | ---------------------------------------------------------- |
| Display  | `text-display-lg`, `text-display-md`, `text-display-sm`    |
| Headline | `text-headline-lg`, `text-headline-md`, `text-headline-sm` |
| Title    | `text-title-lg`, `text-title-md`, `text-title-sm`          |
| Body     | `text-body-lg`, `text-body-md`, `text-body-sm`             |
| Label    | `text-label-lg`, `text-label-md`, `text-label-sm`          |

Each carries paired `--line-height`, `--letter-spacing`, and `--font-weight`. The
`.eyebrow` helper bundles `text-label-md` + `--color-mute`. Font: `Public Sans Variable`
via `--font-sans`.
