# /vision reading affordances — design

**Date:** 2026-05-11
**Scope:** `src/pages/vision.astro`, `src/components/vision/*`, `src/styles/vision.css`, `src/styles/global.css`, `src/layouts/BaseLayout.astro`

## Context

The `/vision` page is 14 named sections plus a Frame hero and a Close — roughly 32,000 px of scroll on desktop. The recent immersive-hero pass made the top of the page work as a destination, but the body still reads as a long undifferentiated scroll. Readers have no sense of position, no way to jump between sections, and no way to share a specific argument with someone else.

This spec adds three coupled affordances that turn the page from a long scroll into a navigable document, without compromising the immersive opening:

1. **Per-section anchor permalinks** — every section is linkable and the heading itself is the link, with a small `§` glyph on hover/focus.
2. **Section enter reveals** — headings and figures fade in on viewport entry, using the existing `.reveal` infrastructure. Substantive prose is not animated.
3. **Sticky progress sub-bar** — a thin row below the main header showing `§ 3 / 14 — Twelve minutes.`, appearing once the hero is scrolled past. The denominator is `14` (the named sections Walk–Riders); the Frame hero and the Close are outside the count.
4. **Side TOC (desktop ≥1024 px)** — a fixed right-side list of all 16 entries (Intro + 14 named sections + Outro), with the current item highlighted via CSS scroll-driven animations. Hidden during the hero and the Close section.

Items 1–3 are the original brainstorm picks. Item 4 was added during design review.

## Non-goals

- Real photography. The page still uses `PhotoPlaceholder.fill`. Image plumbing is a separate spec.
- A printable / one-page summary view.
- Selection-to-share quote affordance.
- Changing the section ordering or copy.
- Any equivalent affordance on pages other than `/vision`. The patterns are designed to generalize but only `/vision` carries enough section count to justify the cost.

## Architecture overview

```
vision.astro
├── BaseLayout (canvas="dark")
│   ├── Header (sticky, transparent over hero)
│   ├── SectionProgressBar  ← NEW, fixed sub-bar
│   ├── article.vision-page
│   │   ├── Frame              ← view-timeline: --hero-view
│   │   ├── Walk, Bike, …      ← each a data-vision-section, view-timeline-name per slug
│   │   └── Close              ← view-timeline: --close-view
│   └── Footer
└── VisionToc                ← NEW, fixed sidebar, desktop only
└── <style is:inline>         ← NEW, generated from SECTIONS registry
```

The `SECTIONS` registry is a small const array in `vision.astro` declaring `{ slug, short }` for each of the 16 entries in render order. Entry 0 is the Frame hero (`short: 'Intro'`), entries 1–14 are the named sections (`'Walk'`, `'Bike'`, …, `'Riders'`), entry 15 is the Close (`short: 'Outro'`). The registry is the single source of truth for:

- The TOC list (all 16 entries)
- The inline `<style>` block that wires per-section view-timelines to TOC items
- The TOC's visibility animations (which key off the first and last entries' timelines)

Each section's `id` in the DOM equals its slug, derived by `SectionHead` from the heading text. The registry's slug values must equal those derived slugs — that contract is checked at runtime by a small dev-mode assertion in the progress bar's IO setup.

Two markup-level distinctions matter:

- **All 16 sections carry an `id` (their slug).** That's enough for the TOC.
- **Only the 14 named sections (Walk–Riders) carry `data-vision-section`.** The progress sub-bar's IO observes exactly that set; Frame and Close are deliberately outside the count.

## Component changes

### `SectionHead.astro`

- Add a `slugify(heading: string) → string` helper that:
  - Decodes HTML entities (`&nbsp;` → space)
  - Lowercases, replaces non-`[a-z0-9]+` with `-`, trims leading/trailing `-`
- Compute `slug = slugify(heading)` once.
- Add `id={slug}` to the wrapping `<div class="container-narrow">`.
- Add `data-vision-section-title={heading}` (entity-decoded) to the same wrapper, so the progress bar can read it without DOM scraping.
- Replace the bare `<Tag class={headingClass} set:html={heading} />` with:
  ```astro
  <Tag class={headingClass}>
    <a href={`#${slug}`} class="section-anchor" data-copy-anchor>
      <span class="section-anchor__text" set:html={heading} />
      <span class="section-anchor__glyph" aria-hidden="true">§</span>
    </a>
  </Tag>
  ```
- The `set:html` containment moves inside the inner span, so the HTML-entity allowance is unchanged from current behavior.

### `vision.astro`

- Declare `SECTIONS: ReadonlyArray<{ slug: string; short: string }>` — 16 entries, render order. Slugs match what `SectionHead` produces from each section's heading. The first and last entries are Intro (Frame) and Outro (Close); the middle 14 are the named sections.
- Mount `<SectionProgressBar total={14} />` once, above `<article>`.
- Mount `<VisionToc sections={SECTIONS} />` once, after `</article>`.
- Emit one inline `<style>` block right after the imports that loops `SECTIONS` and outputs per-section view-timeline + TOC-item highlight rules. The same block emits the TOC's visibility animations, keyed off `SECTIONS[0]` (Intro) and `SECTIONS[15]` (Outro) timelines — no separate `--hero-view` / `--close-view` aliases.

### `SectionProgressBar.astro` (new)

Server-rendered shell + a small inline `<script>`:

```astro
---
interface Props {
  total: number;
}
const { total } = Astro.props;
---

<div data-section-progress hidden class="section-progress" aria-hidden="true">
  <div class="section-progress__inner container-page">
    <span class="section-progress__num">§ <span data-progress-index>1</span> / {total}</span>
    <span class="section-progress__sep">—</span>
    <a class="section-progress__title" data-progress-link href="#">…</a>
  </div>
</div>
<script is:inline>
  (() => {
    const bar = document.querySelector('[data-section-progress]');
    if (!bar) return;
    const idx = bar.querySelector('[data-progress-index]');
    const link = bar.querySelector('[data-progress-link]');
    const sections = Array.from(document.querySelectorAll('[data-vision-section]'));
    if (sections.length === 0) return;

    let current = -1;
    const io = new IntersectionObserver(
      () => {
        // Pick the section whose top is closest-to-zero from above the viewport
        // (the one the user is currently reading).
        let best = -1;
        let bestTop = -Infinity;
        sections.forEach((el, i) => {
          const top = el.getBoundingClientRect().top;
          if (top <= 1 && top > bestTop) {
            best = i;
            bestTop = top;
          }
        });
        if (best === current) return;
        current = best;
        // Index 0 = hero (Frame). Hide the bar on the hero; show otherwise.
        if (current <= 0) {
          bar.setAttribute('hidden', '');
          return;
        }
        bar.removeAttribute('hidden');
        idx.textContent = String(current + 1);
        const el = sections[current];
        const title = el.dataset.visionSectionTitle || el.querySelector('h2')?.textContent || '';
        const slug = el.id;
        link.textContent = title;
        link.setAttribute('href', `#${slug}`);
      },
      { rootMargin: '0px 0px -50% 0px', threshold: [0, 1] },
    );
    sections.forEach((el) => io.observe(el));
  })();
</script>
```

The observer's `rootMargin: '0px 0px -50% 0px'` means a section is considered the current one once its top crosses the top half of the viewport — matches the reader's natural "I am reading this" intuition.

### `VisionToc.astro` (new)

```astro
---
interface Props {
  sections: ReadonlyArray<{ slug: string; short: string }>;
}
const { sections } = Astro.props;
---

<nav class="vision-toc" aria-label="Sections">
  <ol>
    {
      sections.map(({ slug, short }) => (
        <li>
          <a href={`#${slug}`}>{short}</a>
        </li>
      ))
    }
  </ol>
</nav>
```

No JS. All visibility and highlighting is CSS-driven.

### Section components (`Walk.astro` … `Riders.astro`)

Each of the 14 named sections' outer `<section>` gets `data-vision-section`. `Frame.astro` and `Close.astro` do not — they're outside the progress count.

Reveal markup additions (apply to all 16 sections):

- `SectionHead` already wraps in `container-narrow`. Add `class="reveal"` to that wrapper inside `SectionHead.astro` — propagates to every caller.
- `PhotoPlaceholder` and `VisionFigure`: add `class="reveal"` to their root element in the component files, not at the callsites.
- `vision-prose` and `vision-tail` are intentionally not revealed — substantive text shouldn't be conditional on scroll observation.

Hero exclusion: `Frame.astro`'s `frame-hero` is _not_ wrapped in `.reveal`. The hero is the first-paint surface; no animation needed.

## CSS

### Generated per-section block (inline in `vision.astro`)

A single inline `<style>` driven by the registry:

```js
const tlSafe = (s) => s.replace(/[^a-z0-9]/g, '-');
const itemRules = SECTIONS.map(
  ({ slug }) => `
  #${slug} {
    view-timeline-name: --tl-${tlSafe(slug)};
    view-timeline-axis: block;
  }
  .vision-toc a[href="#${slug}"] {
    animation: vision-toc-active linear both;
    animation-timeline: --tl-${tlSafe(slug)};
    animation-range: contain 0% cover 100%;
  }
`,
).join('');

const introTl = `--tl-${tlSafe(SECTIONS[0].slug)}`;
const outroTl = `--tl-${tlSafe(SECTIONS[SECTIONS.length - 1].slug)}`;
const tocVisibility = `
  @media (min-width: 1024px) {
    .vision-toc {
      animation:
        vision-toc-show-after-hero linear both,
        vision-toc-hide-before-close linear both;
      animation-timeline: ${introTl}, ${outroTl};
      animation-range: cover 95% cover 100%, cover 0% cover 5%;
    }
  }
`;
```

No special `--hero-view` / `--close-view` aliases — the Intro and Outro view-timelines are reused for both highlighting (TOC item active when entry/exit visible) and visibility (TOC fades in as Intro exits, fades out as Outro enters).

### `vision.css` additions

```css
/* ===== Section anchor + glyph ===== */
.vision-page .section-anchor {
  color: inherit;
  text-decoration: none;
}
.vision-page .section-anchor__glyph {
  margin-inline-start: 0.4em;
  font-weight: 700;
  color: var(--vp-text-subtle);
  opacity: 0;
  transition: opacity 150ms ease;
}
.vision-page .section-anchor:hover .section-anchor__glyph,
.vision-page .section-anchor:focus-visible .section-anchor__glyph {
  opacity: 1;
}
.vision-page .section-anchor[data-copied] .section-anchor__glyph::after {
  content: ' copied';
  color: var(--color-primary);
  font-size: 0.7em;
}

/* ===== Section progress sub-bar ===== */
.section-progress {
  position: fixed;
  top: var(--lvbt-header-h, 4.5rem);
  inset-inline: 0;
  z-index: 40;
  background: color-mix(in srgb, var(--color-paper) 80%, transparent);
  backdrop-filter: blur(8px) saturate(150%);
  border-bottom: 1px solid color-mix(in srgb, var(--color-rule) 15%, transparent);
  transition:
    opacity 200ms ease,
    transform 200ms ease;
}
.section-progress[hidden] {
  display: block; /* override [hidden] default */
  opacity: 0;
  transform: translateY(-100%);
  pointer-events: none;
}
.section-progress__inner {
  padding-block: 0.625rem;
  display: flex;
  gap: 0.75rem;
  align-items: baseline;
  font-size: 0.85rem;
}
.section-progress__num {
  font-weight: 700;
  letter-spacing: 0.02em;
}
.section-progress__sep {
  color: var(--color-on-surface-variant);
}
.section-progress__title {
  color: inherit;
  text-decoration: none;
}
.section-progress__title:hover {
  color: var(--color-primary);
}

/* ===== Side TOC (desktop only) ===== */
.vision-toc {
  display: none;
}

@media (min-width: 1024px) {
  .vision-toc {
    display: block;
    position: fixed;
    right: clamp(1.5rem, 2.5vw, 2.5rem);
    top: 50%;
    transform: translateY(-50%);
    z-index: 30;
    width: 13rem;
    opacity: 0; /* hidden by default; the inline-generated visibility rule (driven by Intro + Outro view-timelines) fades it in/out */
    pointer-events: none;
  }
  /* the animation declarations live in the inline <style> generated from the
     SECTIONS registry, not here, because they reference per-section timeline
     names that the registry owns */
  .vision-toc ol {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .vision-toc a {
    display: block;
    color: var(--color-ink);
    opacity: 0.55;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    text-decoration: none;
    transition:
      opacity 120ms ease,
      color 120ms ease;
  }
  .vision-toc a:hover {
    opacity: 1;
    color: var(--color-primary);
  }
}

@keyframes vision-toc-show-after-hero {
  to {
    opacity: 1;
    pointer-events: auto;
  }
}
@keyframes vision-toc-hide-before-close {
  to {
    opacity: 0;
    pointer-events: none;
  }
}

@keyframes vision-toc-active {
  50% {
    color: var(--color-primary);
    opacity: 1;
    font-weight: 700;
    text-transform: none;
    letter-spacing: 0;
  }
}

/* Reduced-motion: skip all the fade transitions but keep the scroll-driven
   state changes (they convey information, not motion). */
@media (prefers-reduced-motion: reduce) {
  .section-progress {
    transition: none;
  }
  .vision-toc,
  .vision-toc a {
    transition: none;
  }
}

/* Browser-support fallback: TOC visible all the time, no highlighting. */
@supports not (animation-timeline: view()) {
  @media (min-width: 1024px) {
    .vision-toc {
      opacity: 1;
      pointer-events: auto;
      animation: none;
    }
  }
}
```

The `--lvbt-header-h` variable is used only as a fallback default for the sub-bar's `top`. The real header height drifts at most ±10 px across breakpoints; `4.5rem` is generous enough that the sub-bar always sits flush under the header without any JS measurement.

## Inline anchor copy script

Tiny inline script in `BaseLayout` (or in `vision.astro` to keep it scoped):

```js
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-copy-anchor]');
  if (!a) return;
  e.preventDefault();
  const url = new URL(a.getAttribute('href'), location.href).toString();
  navigator.clipboard?.writeText(url);
  history.replaceState(null, '', a.getAttribute('href'));
  a.setAttribute('data-copied', '');
  setTimeout(() => a.removeAttribute('data-copied'), 1400);
});
```

`history.replaceState` updates the URL without scrolling (the browser would otherwise jump to the anchor since the heading already has the `id`). The page does not re-scroll because the heading is exactly where the reader already is.

## Accessibility

- Every `SectionHead` heading-anchor is in the tab order and gets the same hover-glyph affordance on `:focus-visible`.
- The progress sub-bar is `aria-hidden="true"`. It's a visual orientation aid; screen readers get the same information from the section headings themselves.
- The TOC is a `<nav aria-label="Sections">` with an ordered list. Screen reader users get the navigable list of sections regardless of viewport width — but on small viewports the visual style is `display: none`, which also hides it from assistive tech. Adjust to `position: absolute; left: -9999px` if we want it screen-reader-visible site-wide; flagged for future review.
- `prefers-reduced-motion`: existing `.reveal` styles already short-circuit. The TOC visibility fades become instant transitions. The scroll-driven CSS state changes are kept — they're informational, not motion.
- Color contrast: TOC default opacity `0.55` against cream gives ~3.3:1 contrast for the small label text. Active state at `1.0` is ~10:1. Hover state at `primary` color on cream is ~5.6:1. All meet WCAG AA for non-text and large-text categories; the small inactive type may not meet AA for body text — kept as a deliberate design choice for ambient navigation, with the rationale that this is supplementary wayfinding, not the primary reading surface.

## Browser support

- `view-timeline-name` / `animation-timeline`: Chrome 115+, Firefox 137+, Safari 26. All current as of 2026-05-11.
- `:has()`: not used (the design avoids it deliberately).
- `clamp()`, `color-mix()`, `backdrop-filter`: already in use across the project.
- Fallback for missing scroll-driven animations: `@supports not (animation-timeline: view())` rule keeps the TOC visible at all times with no active-item highlighting. Users on older browsers still get a navigable jump menu.

## File-level change list

| File                                                | Change                                                                                                                     |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `src/components/vision/SectionHead.astro`           | Add slugify helper, `id` + `data-vision-section-title` on wrapper, heading-anchor + glyph                                  |
| `src/components/vision/PhotoPlaceholder.astro`      | Add `class="reveal"` to root                                                                                               |
| `src/components/vision/VisionFigure.astro`          | Add `class="reveal"` to root                                                                                               |
| `src/components/vision/sections/*.astro` (16 files) | Add `data-vision-section` to outer `<section>`                                                                             |
| `src/components/vision/sections/Frame.astro`        | Apply `view-timeline: --hero-view block` to `.frame-hero` via vision.css; no markup change                                 |
| `src/components/vision/sections/Close.astro`        | The `.band-primary.section` rule already targets it via vision.css; no markup change                                       |
| `src/pages/vision.astro`                            | Add `SECTIONS` registry, mount `SectionProgressBar` and `VisionToc`, emit inline `<style>` block, mount anchor-copy script |
| `src/components/site/SectionProgressBar.astro`      | **NEW**                                                                                                                    |
| `src/components/vision/VisionToc.astro`             | **NEW**                                                                                                                    |
| `src/styles/vision.css`                             | Add the rules in the CSS section above                                                                                     |

## Verification

End-to-end pass with `pnpm screenshot`:

1. `pnpm screenshot /vision` — hero state. TOC absent, sub-bar absent. (Verifies the hide-on-hero rules.)
2. `pnpm screenshot /vision --scrolled 1200` — first content section. Sub-bar visible (`§ 2 / 16 — Walk to milk.`), TOC visible with `Walk` highlighted.
3. `pnpm screenshot /vision --scrolled 16000` — mid-page. TOC visible with the appropriate middle item highlighted; sub-bar shows that section's title.
4. `pnpm screenshot /vision --scrolled 31000` — entering Close. TOC fading out, sub-bar fading out.
5. `pnpm screenshot /vision --w 390 --h 844 --scrolled 1200` — mobile. Sub-bar visible, TOC absent.
6. Click any heading on the rendered page — URL updates to `/vision#<slug>`, glyph flashes "copied", clipboard contains the full URL.
7. Open `/vision#bowl-country` in a fresh tab — page loads, scrolls to Bowl, sub-bar shows the correct index/title.
8. In Chromium devtools, toggle `prefers-reduced-motion`. Reveals snap instead of fading. Scroll-driven state changes still apply.

## Risks and open questions

- **Registry drift.** The `SECTIONS` registry's slugs must equal `SectionHead`'s computed slugs. A heading change will invalidate the registry entry. The dev-mode console error from the progress bar's IO setup catches this on first scroll, but a build-time check would be stronger. Open: should we run a build-time validation pass?
- **Inline `<style>` block in `vision.astro`.** 16 sections × 2 rules each = 32 generated rules. Astro will inline this in the HTML head; ~3 kB. Acceptable.
- **Scroll-driven animation reflow cost.** Each view-timeline triggers per-frame style recalc on the items watching it. With 16 timelines, this is meaningful but well-bounded. Real-device profiling on the slowest target machine should confirm before ship.
- **Sub-bar on desktop redundancy.** The current design keeps both sub-bar and TOC visible on desktop. If this reads as too much chrome, flag for a follow-up to hide the sub-bar above `1024px`.
