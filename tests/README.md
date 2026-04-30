# Visual-regression screenshots

Playwright harness that screenshots every page in the site and compares
against committed baselines. A diff means the visual output of a page
changed — either intentionally (in which case you refresh the baseline)
or unintentionally (in which case you have a regression to fix).

## What it covers

- Every URL emitted in `dist/sitemap-0.xml` (so dynamic project routes
  stay in sync automatically — no hand-maintained list)
- Six viewports, parameterized as Playwright **projects** — one per
  device band × orientation the site is designed to look good on.
  Widths align to the Tailwind breakpoints actually used in the
  codebase (`md:` 768, `lg:` 1024), so each viewport lands in a
  distinct layout band:
  - `mobile-portrait` — iPhone 14, 390×844 (DPR 3) — below `md:`
  - `mobile-landscape` — iPhone 14, 844×390 (DPR 3) — between `md:` and `lg:` (rotated)
  - `tablet-portrait` — iPad Air portrait, 820×1180 — between `md:` and `lg:`
  - `tablet-landscape` — iPad Air landscape, 1180×820 — above `lg:`
  - `desktop` — Desktop Chrome, 1280×720 — above `lg:`
  - `desktop-xl` — Full-HD external display, 1920×1080 — wide monitors
- **Two captures per route** in each viewport:
  - `*-viewport.png` — initial load, no scroll (above the fold only)
  - `*-full.png` — entire scroll length (full-page screenshot)
- Chromium only (this is a screenshot harness, not a cross-browser
  conformance suite)
- Animations disabled, fonts awaited

At the time of writing: 16 routes × 6 viewports × 2 captures = **192
baseline PNGs**.

## First-time setup

```sh
pnpm install         # picks up @playwright/test
pnpm test:install    # downloads chromium (~150 MB, one-time)
```

## Day-to-day

```sh
pnpm test                          # build → preview → run all 32 comparisons
pnpm test:update                   # refresh baselines after intentional UI changes
pnpm exec playwright show-report   # open the HTML report (diffs included)
```

## CI status

**Currently not run in CI.** Baselines are committed for darwin (the maintainer's
machine); ubuntu runners would mass-fail on rendering deltas. To enable later,
either commit per-OS baselines via `snapshotPathTemplate` and add a workflow
under `.github/workflows/`, or run on `macos-latest` (~10× the GitHub Actions
minutes cost). Tracked alongside the other deferred CI items in the project
plan.

The Playwright config (`../playwright.config.ts`) starts `pnpm preview`
on port 4321 automatically. If you already have it running locally it
will be reused; in CI it always starts fresh.

## Baseline workflow

1. Make an intentional UI change.
2. Run `pnpm test`. Failing tests indicate the diffs.
3. Review the failures via `pnpm exec playwright show-report` — each
   failed test shows expected / actual / diff side-by-side.
4. If the new output is correct, run `pnpm test:update` to
   accept it. Commit the regenerated baselines under `tests/snapshots/`.
5. If the diff is unintentional, fix the code instead.

## Folder layout

```
tests/
├── README.md                 # this file
├── screenshots.spec.ts       # the test (one test per sitemap URL)
└── snapshots/
    ├── mobile-portrait/      # two PNGs per route: -viewport and -full
    │   ├── root-viewport.png
    │   ├── root-full.png
    │   ├── about-viewport.png
    │   ├── about-full.png
    │   └── ...
    ├── mobile-landscape/
    ├── tablet-portrait/
    ├── tablet-landscape/
    ├── desktop/
    └── desktop-xl/
```

The path layout is set by `snapshotPathTemplate` in
`../playwright.config.ts`.

## Cross-platform caveat (read this before adding CI)

Pixel-perfect baselines differ between macOS, Linux, and Windows because
of font hinting and sub-pixel rendering. Baselines committed from a
macOS dev machine **will diff in a Linux CI runner**, even with no code
change. When wiring this into CI, pick one:

- **Easiest:** run the suite inside `mcr.microsoft.com/playwright`
  (the official image) both locally and in CI. Same OS, same
  baselines.
- **More flexible:** add `{platform}` to `snapshotPathTemplate` in
  `playwright.config.ts` so each OS keeps its own set of baselines,
  then update them on each platform you support.

For local-only use right now, the `darwin` baselines are committed
as-is.

## Why visual regression and not just "produce screenshots"?

We picked baseline-comparison mode (over emit-fresh-PNGs-each-run) so
that opening a PR makes any unintentional visual change loud and
visible — the test fails, the diff is in the report, the reviewer
sees it. Fresh PNGs would only help an attentive human reviewer who
remembers what the page looked like yesterday.
