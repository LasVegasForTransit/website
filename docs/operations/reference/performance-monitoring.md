# Performance monitoring

This page explains how we measure whether the site is fast — what we track, where the limits live,
and how the automated checks enforce them. It matters because a slow site loses visitors, and a
college-student volunteer team can't eyeball speed by hand; the numbers have to be measured and
guarded automatically.

We watch speed two complementary ways:

- **Synthetic monitoring** — speed measured in a controlled lab: a test tool loads the site in a
  fixed, repeatable environment and times it. We run this in CI (Continuous Integration — automation
  that runs on every push, see [glossary](../../development/reference/glossary.md#ci)) against a
  build artifact (the finished site files produced by a build). It gives a stable number that
  catches regressions (speed getting worse) before they merge.
- **Real-user monitoring (RUM)** — speed measured from actual visitors' browsers as they use the
  live site, via Cloudflare Web Analytics. It's noisier (every visitor's device and network differ)
  but it's the only number that matters in the end — what visitors actually experience.

## Budgets

A "budget" here is a hard upper limit on some performance number — exceed it and a check fails. They
keep the site from slowly getting heavier over time. All numeric ceilings live in
[`perf-budgets.json`](../../../perf-budgets.json) at the repo root.

A few terms used in the table below:

- **Gzipped** — the file size after compression. Servers send files compressed (gzip is the common
  method) and browsers unzip them, so the gzipped size is what visitors actually download. It's
  smaller than the raw file on disk.
- **Build peak RSS** — RSS (Resident Set Size) is how much memory a program is using; "peak" is the
  most it used at any moment. Here it's the high-water memory mark while building the site.
  Report-only means we record it but don't fail on it.
- **usedJsHeapSize** — how much memory the page's JavaScript is holding in the browser while the
  page is open. A runaway number means a memory leak that can make the page sluggish.

| Bucket                                           | Budget             | Enforced by                      |
| ------------------------------------------------ | ------------------ | -------------------------------- |
| Gzipped CSS (total)                              | 20 KB              | `scripts/audit/bundle-size.ts`   |
| Gzipped JS (total)                               | 12 KB              | `scripts/audit/bundle-size.ts`   |
| Gzipped combined                                 | 24 KB              | `scripts/audit/bundle-size.ts`   |
| Any single gzipped file                          | 14 KB              | `scripts/audit/bundle-size.ts`   |
| Raster image (PNG/JPG) without `.webp` companion | 20 KB              | `scripts/audit/asset-budget.ts`  |
| Build peak RSS                                   | report-only (null) | `scripts/audit/build-profile.ts` |
| Runtime usedJsHeapSize per page                  | 30 MB              | `tests/perf-memory.spec.ts`      |

Trend data lands in `audits/build-stats.jsonl` (one row per successful audit run) so memory and
wall-clock (real elapsed time) drift is visible without git archaeology. JSONL = "JSON Lines": a
plain-text file with one self-contained JSON record per line, easy to append to and scan.

## Synthetic checks (CI)

This is the lab side: automated speed and size checks that run on every code change, before it
ships. **Lighthouse** is Google's open-source tool that loads a page and scores its performance;
**Core Web Vitals (CWV)** are Google's headline speed metrics — most notably **LCP (Largest
Contentful Paint)**, the time until the biggest piece of content (usually the hero image or heading)
appears on screen. Lower LCP = the page feels like it loaded sooner.

A "hard gate" below means the check must pass or the build fails; a "soft-fail" reports problems
without blocking.

[`.github/workflows/audit.yml`](../../../.github/workflows/audit.yml) runs on every PR (pull request
— a proposed change opened on GitHub) and push to `main`. The performance-relevant jobs:

- **Lighthouse (desktop)** — `lighthouserc.cjs` default preset; CWV thresholds tuned for the build
  artifact. The URL list is derived from the built sitemap (every static route plus one
  representative detail page per collection), so new pages are covered without editing the config.
  Hard gate.
- **Lighthouse (mobile)** — same config, `LIGHTHOUSE_PRESET=mobile`; Moto G4 on slow 4G. Soft-fail
  at first; promoted once one clean run is in.
- **Runtime memory** — Playwright Chromium project; navigates every sitemap URL, scrolls
  bottom-to-top, triggers a CDP GC (forces the browser to garbage-collect — free unused memory — via
  the Chrome DevTools Protocol, the API for controlling Chrome), then asserts
  `performance.memory.usedJSHeapSize` under the budget. Hard gate.
- **Bundle size budget** — gzips `dist/_astro` and `dist/scripts` assets, checks each bucket. Hard
  gate.
- **Image asset budget** — walks `public/**/*.{png,jpg,jpeg}` and requires a sibling `.webp` for
  anything over the raster ceiling. Hard gate.

The orchestrator is `pnpm check:baseline` (locally) or the
[`audit.yml`](../../../.github/workflows/audit.yml) workflow (CI). The build itself runs through
[`scripts/audit/build-profile.ts`](../../../scripts/audit/build-profile.ts) so memory + wall-clock
land in the trend file with no extra build cost.

[`.github/workflows/audit-scheduled.yml`](../../../.github/workflows/audit-scheduled.yml) runs
weekly with `LIGHTHOUSE_PRESET=prod` against the live production URLs (no `staticDistDir`).
Regressions trigger `notify-on-failure`, which opens a GitHub issue labelled `audit, maintenance`.

The production preset treats Lighthouse's `robots-txt` audit as a known exception only because
Cloudflare may inject a managed `Content-Signal` line into the live `robots.txt` response. That line
is intentional policy for AI crawler use, but Lighthouse currently reports it as an unknown robots
directive. The config still checks the other production SEO audits directly.

## Real-user monitoring (CWA)

This is the field side: speed measured from real visitors. CWA = Cloudflare Web Analytics, a
privacy-respecting RUM tool (no cookies, no fingerprinting — it doesn't track individuals). It works
via a **beacon**: a tiny script that quietly sends measurements back to a server. The site ships
`beacon.min.js` from `static.cloudflareinsights.com` and POSTs (sends) CWV samples to
`cloudflareinsights.com`. Both origins are **allow-listed** (explicitly permitted) in
[`public/_headers`](../../../apps/site/public/_headers) under our CSP (Content Security Policy — a
security header that whitelists which outside servers the page may talk to, see
[glossary](../../development/reference/glossary.md#csp)): `script-src` lists where scripts may load
from, `connect-src` lists where the page may send data. Without these two entries, the browser would
block the beacon.

Activation:

- Get the site token from the Cloudflare dashboard (Analytics → Web Analytics → your site →
  "Token").
- Add it as `PUBLIC_CWA_TOKEN` in Cloudflare Pages env vars (environment variables — named settings
  kept outside the code, see [glossary](../../development/reference/glossary.md#env-var)), for
  production _and_ preview.
- For local dev, `pnpm bootstrap --phase env` prompts for the value and writes it to `.env.local`.

[`src/layouts/BaseLayout.astro`](../../../apps/site/src/layouts/BaseLayout.astro) gates the
`<script>` tag on `import.meta.env.PUBLIC_CWA_TOKEN`. No token, no beacon — the strict default CSP
holds.

Token rotation (replacing the secret token with a fresh one and retiring the old): rotate yearly or
sooner if a leak is suspected. Generate a new token in the dashboard, swap the Pages env var,
redeploy; old beacons stop reporting within minutes. The token is not a credential, so a leak is
low-impact, but visible inflated traffic is worth catching.

## Why both?

Neither signal alone is enough — each is blind to things the other catches, so we run both and
cross-check them.

Synthetic alone misses:

- Real network variance (a CI runner on a fast wired link is not a visitor on Cox cable mid-storm).
- Long-tail device performance (Lighthouse mobile preset is one fixed Moto G4 profile; real visitors
  land on Pixels, iPhones, four-year-old Galaxies).
- Geographic latency (LCP looks great from us-east-1; what about a visitor in Henderson on a
  coffee-shop Wi-Fi?).

RUM alone misses:

- Pre-merge regressions. By the time RUM shows it, every visitor has already paid the cost.
- Controlled-environment debugging. RUM tells you that the median LCP jumped 400 ms; Lighthouse on a
  reproducible artifact tells you which asset caused it.

Together: CI catches what visitors would feel, RUM confirms what they actually felt.

## When numbers diverge

When the lab (synthetic) and the field (RUM) disagree, this section is how to read which one to
trust and where to look first.

If synthetic stays green but RUM regresses, the cause is usually infrastructure — Cloudflare edge
cache, image-format negotiation, a plugin on the dashboard mis-set. Check the CWA dashboard's "by
country" and "by browser" splits first; a single country/browser bar climbing is often a cache or
A/B-test artifact, not a code regression.

If synthetic regresses but RUM stays green, the budget is too tight for the real-world variance —
adjust [`perf-budgets.json`](../../../perf-budgets.json) upward only after confirming the synthetic
number reflects a real visitor experience and not a Lighthouse quirk.
