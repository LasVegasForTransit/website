# Mobile navigation overlay

**Date:** 2026-06-11
**Status:** Approved — ready for implementation

## Problem

The mobile header shows only the wordmark and a "Join →" CTA button. The four remaining primary nav items — About, Projects, Events, Contact — are completely unreachable on mobile. There is no hamburger menu or equivalent.

## Design

### Header: two states

**Closed (default)**

```
| Las Vegans          Join →  ☰ |
| for Better Transit            |
```

- Right side: "Join →" button (existing `bg-ink` style) + hamburger icon button to its right
- Hamburger is a simple three-line icon (`aria-label="Open menu"`, `aria-expanded="false"`)

**Open (overlay visible)**

```
| Las Vegans                  ✕ |
| for Better Transit            |
```

- Right side: close button only (`aria-label="Close menu"`, or toggle `aria-expanded` on the same button)
- "Join →" button is hidden (`display: none` or `hidden` class toggled via JS)
- The hamburger morphs to ✕ — implemented as two inline SVGs in the same button element, toggled visible/hidden via CSS on `[aria-expanded]`. No icon library dependency; the shapes are simple enough to inline.

### Overlay

Full-screen cream panel (`bg-paper`) that sits beneath the sticky header and covers the page content. It is not a separate layer above the header — the header stays on top at all times.

**Content (top to bottom):**

1. Nav list — About, Projects, Events, Contact (`navMain` minus Join, which is already the dedicated header CTA). Large bold text (`text-2xl font-bold`), vertically stacked, separated by a hairline rule (`border-b border-rule/15`). Same active-state treatment as the desktop nav (`aria-current="page"`).
2. "Get involved →" CTA — full-width `bg-ink text-paper` button at the bottom, links to `/go`. Same `.press` style as the desktop CTA.

Join is intentionally absent from the overlay nav list: it is the persistent header action in the closed state and does not need to be duplicated. The overlay surfaces the four items that have no other mobile entry point.

**No** social links, submenus, or decorative content — keep it as spare as the desktop nav.

### Behaviour

| Action                                    | Result                                                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Tap ☰                                    | Overlay opens; Join button hides; ☰ becomes ✕; `aria-expanded="true"`                                  |
| Tap ✕                                     | Overlay closes; Join button reappears; `aria-expanded="false"`                                          |
| Tap a nav link                            | Navigate; overlay closes                                                                                |
| Press Escape                              | Overlay closes                                                                                          |
| Focus leaves overlay (Tab past last item) | Trap focus back to first item while open                                                                |
| Scroll with overlay open                  | Overlay scrolls independently if content overflows; page scroll locked (`overflow: hidden` on `<body>`) |

### Animation

Fade in/out only (`opacity 0 → 1`, ~150ms ease-out). No slide — the overlay fills below the fixed header so a vertical translate would look odd. CSS handles the transition; JS only toggles a `data-open` attribute on the header element.

### Dark-canvas compatibility

The header already has a `body[data-canvas='dark'] [data-site-header]:not([data-stuck])` block that makes the header transparent over dark hero sections. When the overlay opens on a dark-canvas page, the header background should snap to `bg-paper` (opaque) so the overlay reads as a single connected panel. Implemented by adding `data-nav-open` to the header and overriding the transparent rule when that attribute is present.

## Files to change

| File                               | Change                                                                                        |
| ---------------------------------- | --------------------------------------------------------------------------------------------- |
| `src/components/site/Header.astro` | Add hamburger button; restructure mobile right-side controls; add overlay markup and nav list |
| `public/scripts/mobile-nav.js`     | New file — toggle logic, focus trap, Escape handler, body scroll lock                         |
| `src/styles/global.css`            | Overlay animation CSS; `data-nav-open` dark-canvas override                                   |

## Constraints

- **CSP:** `script-src 'self'` — all JS in `public/scripts/`, loaded via `<script is:inline src="…" defer>`. No inline scripts.
- **No framework reactivity** — Astro static site; state is entirely attribute/class toggling.
- **View transitions** — the header carries `[view-transition-name:site-header]`. The overlay should not carry its own view-transition name; doing so would cause it to persist across navigations.
- **Desktop unchanged** — all changes are gated behind `md:hidden` / media queries. The desktop layout (`hidden md:block` nav + "Get involved" CTA) is untouched.
