# Visual-regression screenshots

The screenshot tests compare the website with saved reference images, called baselines. Run them
when you change a page's appearance. Review each difference before accepting a new baseline. The
tests use Playwright, a tool that controls a browser.

## What it covers

The suite reads routes from the built `dist/sitemap-0.xml`. It keeps one example per detail-page
family, such as project pages. It excludes `/events` and `/newsletter` because their outside sources
and dates can change without a code change. The number of screenshots changes with the sitemap.

Each route gets an initial-screen image (`*-viewport.png`) and a whole-page image (`*-full.png`).
All six device configurations use Chromium. These tests do not check other browser engines. The
tests wait for fonts and disable animations to reduce unrelated differences.

| Playwright project | Width × height in pixels | Layout tested                                       |
| ------------------ | ------------------------ | --------------------------------------------------- |
| `mobile-portrait`  | 390 × 664                | Below the 768-pixel `md:` breakpoint.               |
| `mobile-landscape` | 750 × 340                | Also below `md:`.                                   |
| `tablet-portrait`  | 820 × 1180               | Between `md:` and the 1,024-pixel `lg:` breakpoint. |
| `tablet-landscape` | 1180 × 820               | Above `lg:`.                                        |
| `desktop`          | 1280 × 720               | Desktop.                                            |
| `desktop-xl`       | 1920 × 1080              | Wide desktop.                                       |

A breakpoint is a screen width at which the site's layout rules change. A Playwright project is a
named browser configuration; it is not another application in this repository.

## First-time setup

The baseline PNGs use Git LFS, which stores large files separately from source code. Every image
download uses LVBT's shared bandwidth allowance. Fetch only the images for your operating system; an
unrestricted `git lfs pull` downloads both sets. Local previews and `pnpm check` need neither set.

Install Git LFS only when you need screenshot comparisons. Run these setup commands from the
**repository root**. On macOS, install Git LFS and fetch the Mac images:

```sh
brew install git-lfs
git lfs pull --include="apps/site/tests/snapshots/darwin/**" --exclude=""
```

On Linux, install your distribution's `git-lfs` package and fetch the Linux images instead:

```sh
git lfs pull --include="apps/site/tests/snapshots/linux/**" --exclude=""
```

Then install the browser used by the screenshot tests:

```sh
pnpm --dir apps/site test:install
```

If GitHub reports exhausted LFS bandwidth, stop repeated pulls and ask a maintainer to check the
allowance.

Run the remaining commands on this page from `apps/site`. The
[repository hooks](../../../docs/standards/git-guidelines.md#pre-push) already handle LFS uploads.

## Day-to-day

Run these commands from `apps/site`:

```sh
pnpm test:e2e tests/e2e/screenshots.spec.ts --workers=2
pnpm exec playwright show-report
```

Playwright normally builds and starts the local preview on port 4321. It can reuse a server already
running on that port, so stop another checkout's server first. To use a different port, run
`AUDIT_PORT=4322 pnpm test:e2e tests/e2e/screenshots.spec.ts --workers=2`.

The report shows the expected, actual and difference images for each failure. Fix an unintended
change in the page code. If the new appearance is correct, update your operating system's baselines:

```sh
pnpm test:e2e tests/e2e/screenshots.spec.ts --workers=2 --update-snapshots
```

Review every changed image before including it with the page change. A passing comparison alone does
not show that the page is understandable or usable.

## CI status

Continuous integration (CI) runs automated checks on GitHub. The `visual-regression` job in
`.github/workflows/audit.yml` checks every screenshot viewport before merging.

macOS and Linux need separate baselines because their text rendering differs. The
`snapshotPathTemplate` setting in `../playwright.config.ts` puts images under
`tests/snapshots/<platform>/<project>/`. macOS uses `darwin`; the CI runner uses `linux`. Screenshot
tests read and update the matching directory automatically.

The visual job and **Seed baselines** cache only Linux LFS objects. On an empty cache, they can
reuse images from a saved baseline run. Each image must match the current Git pointer's size and
SHA-256 hash before entering the cache. Git LFS downloads only objects still missing afterward.
General build and release jobs do not need these screenshot files.

### Seeding linux baselines

Run the **Seed baselines** workflow in GitHub Actions against your branch. Download its
`baselines-<sha>` artifact and copy the images into `tests/snapshots/linux/`. Review the images and
include them with the change that requires them. The workflow writes every project, so inspect the
whole difference before committing.

Use the workflow for Linux images. Its operating system, processor architecture, Chromium version
and `PUBLIC_LVBT_*` build values match the screenshot check. A Linux container on an Apple Silicon
laptop uses a different processor architecture and can produce different text pixels.

## Folder layout

| Path under `tests/`       | Contents                                    |
| ------------------------- | ------------------------------------------- |
| `*.test.ts`               | Unit tests run by `pnpm test`.              |
| `e2e/`                    | Browser tests run by `pnpm test:e2e`.       |
| `e2e/screenshots.spec.ts` | Route selection and screenshot comparisons. |
| `support/`                | Shared test helpers.                        |
| `snapshots/darwin/`       | macOS baseline images, grouped by project.  |
| `snapshots/linux/`        | Linux baseline images from the workflow.    |

## Baseline workflow

Build, run the screenshot test, inspect failures, and update only images that you have reviewed. See
[Day-to-day](#day-to-day) for the commands.

## Why baseline comparison

Saved images let reviewers inspect an unintended visual change without remembering every page's
previous appearance. The report provides the previous image, the new image and their differences.
