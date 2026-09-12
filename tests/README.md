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
  - `mobile-portrait` — iPhone 14, viewport 390×664, rendered in Chromium — below `md:`
  - `mobile-landscape` — iPhone 14 rotated, viewport 750×340, rendered in Chromium — also below `md:`, since 750 < 768
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

The suite covers 19 representative routes × 6 viewports × 2 captures = **228
baseline PNGs**.

## First-time setup

The baseline PNGs are stored in **Git LFS** (`tests/snapshots/**/*.png`) so they
stay out of the git pack. Install git-lfs before the baselines will materialize —
without it a clone gets pointer files instead of images and `pnpm test` can't
compare. `pnpm bootstrap` installs it; manually:

```sh
brew install git-lfs && git lfs install   # macOS (apt-get install git-lfs on Linux)
git lfs pull                              # materialize the baseline images
pnpm install                              # picks up @playwright/test
pnpm test:install                         # downloads chromium (~150 MB, one-time)
```

## Day-to-day

```sh
pnpm exec playwright test tests/screenshots.spec.ts
pnpm exec playwright test tests/screenshots.spec.ts --update-snapshots
pnpm exec playwright show-report   # open the HTML report (diffs included)
```

## CI status

`snapshotPathTemplate` includes `{platform}`, so each OS keeps its own
committed baselines under `tests/snapshots/<platform>/`. The macOS (`darwin/`)
and CI (`linux/`) sets are committed. The `visual-regression` job in
`.github/workflows/audit.yml` runs every viewport as a merge gate.

### Seeding linux baselines

Run the **Seed baselines** workflow from the Actions tab against your
branch, download the `baselines-<sha>` artifact it uploads, and commit the
images under `tests/snapshots/linux/` with the change that required them.
The run writes every project, so review the diff before committing.

Do this in CI rather than locally. The images have to come from the same
operating system, CPU architecture and Chromium build as the
`visual-regression` job: a Playwright container on an Apple Silicon
machine renders on aarch64 while the runners are amd64, and the two
rasterize text differently, so images seeded on a laptop fail as soon as
they reach CI. The workflow also builds with the same `PUBLIC_LVBT_*`
variables the audit uses, which a local build would otherwise omit.

The Playwright config (`../playwright.config.ts`) starts `pnpm preview`
on port 4321 automatically. If you already have it running locally it
will be reused; in CI it always starts fresh.

## Baseline workflow

1. Make an intentional UI change.
2. Run `pnpm exec playwright test tests/screenshots.spec.ts`. Failing tests indicate the diffs.
3. Review the failures via `pnpm exec playwright show-report` — each
   failed test shows expected / actual / diff side-by-side.
4. If the new output is correct, rerun the screenshot test with
   `--update-snapshots`. Commit the regenerated baselines under `tests/snapshots/`.
5. If the diff is unintentional, fix the code instead.

## Folder layout

```
tests/
├── README.md                 # this file
├── screenshots.spec.ts       # the test (one test per sitemap URL)
└── snapshots/
    ├── darwin/               # macOS baselines (current dev machine)
    │   ├── mobile-portrait/  # two PNGs per route: -viewport and -full
    │   │   ├── root-viewport.png
    │   │   ├── root-full.png
    │   │   ├── about-viewport.png
    │   │   ├── about-full.png
    │   │   └── ...
    │   ├── mobile-landscape/
    │   ├── tablet-portrait/
    │   ├── tablet-landscape/
    │   ├── desktop/
    │   └── desktop-xl/
    └── linux/                # seeded by the Seed baselines workflow; see
                              # "Seeding linux baselines" above
```

`{platform}` in `snapshotPathTemplate` (see `../playwright.config.ts`)
expands to `darwin` on macOS and `linux` on the CI runner — so a
`pnpm test` on either platform reads and writes the right tree without
extra flags.

## Why baseline comparison

Baseline comparison exposes an unintentional visual change during review. The
test fails and attaches expected, actual, and diff images without relying on a
reviewer's memory of the previous page.
