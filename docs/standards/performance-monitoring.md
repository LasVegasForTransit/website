# Performance monitoring

The site has two complementary signals: **synthetic** runs in CI against
a build artifact, and **real-user** measurement (RUM) from visitors via
Cloudflare Web Analytics. Synthetic gives a controlled, repeatable
number that catches regressions before merge. RUM gives the only number
that matters in the end — what visitors actually experience.

## Budgets

All numeric ceilings live in [`perf-budgets.json`](../../perf-budgets.json) at the
repo root:

| Bucket                                           | Budget             | Enforced by                      |
| ------------------------------------------------ | ------------------ | -------------------------------- |
| Gzipped CSS (total)                              | 20 KB              | `scripts/audit/bundle-size.ts`   |
| Gzipped JS (total)                               | 4 KB               | `scripts/audit/bundle-size.ts`   |
| Gzipped combined                                 | 24 KB              | `scripts/audit/bundle-size.ts`   |
| Any single gzipped file                          | 14 KB              | `scripts/audit/bundle-size.ts`   |
| Raster image (PNG/JPG) without `.webp` companion | 20 KB              | `scripts/audit/asset-budget.ts`  |
| Build peak RSS                                   | report-only (null) | `scripts/audit/build-profile.ts` |
| Runtime usedJsHeapSize per page                  | 30 MB              | `tests/perf-memory.spec.ts`      |

Trend data lands in `audits/build-stats.jsonl` (one row per successful
audit run) so memory and wall-clock drift is visible without git
archaeology.

## Synthetic checks (CI)

[`.github/workflows/audit.yml`](../../.github/workflows/audit.yml) runs on every
PR and push to `main`. The performance-relevant jobs:

- **Lighthouse (desktop)** — `lighthouserc.cjs` default preset; CWV
  thresholds tuned for the build artifact. Hard gate.
- **Lighthouse (mobile)** — same config, `LIGHTHOUSE_PRESET=mobile`;
  Moto G4 on slow 4G. Soft-fail at first; promoted once one clean run
  is in.
- **Runtime memory** — Playwright Chromium project; navigates every
  sitemap URL, scrolls bottom-to-top, triggers a CDP GC, asserts
  `performance.memory.usedJSHeapSize` under the budget. Hard gate.
- **Bundle size budget** — gzips `dist/_astro` and `dist/scripts`
  assets, checks each bucket. Hard gate.
- **Image asset budget** — walks `public/**/*.{png,jpg,jpeg}` and
  requires a sibling `.webp` for anything over the raster ceiling.
  Hard gate.

The orchestrator is `pnpm check:baseline` (locally) or the
[`audit.yml`](../../.github/workflows/audit.yml) workflow (CI). The build
itself runs through [`scripts/audit/build-profile.ts`](../../scripts/audit/build-profile.ts)
so memory + wall-clock land in the trend file with no extra build cost.

[`.github/workflows/audit-scheduled.yml`](../../.github/workflows/audit-scheduled.yml)
runs weekly with `LIGHTHOUSE_PRESET=prod` against the live production
URLs (no `staticDistDir`). Regressions trigger
`notify-on-failure`, which opens a GitHub issue labelled `audit, maintenance`.

## Real-user monitoring (CWA)

Cloudflare Web Analytics — a privacy-respecting RUM beacon (no cookies,
no fingerprinting). The site ships `beacon.min.js` from
`static.cloudflareinsights.com` and POSTs CWV samples to
`cloudflareinsights.com`. Both origins are allow-listed in
[`public/_headers`](../../public/_headers) under `script-src` and
`connect-src` respectively.

Activation:

- Get the site token from the Cloudflare dashboard (Analytics → Web
  Analytics → your site → "Token").
- Add it as `PUBLIC_CWA_TOKEN` in Cloudflare Pages env vars (production
  _and_ preview).
- For local dev, `pnpm bootstrap --phase env` prompts for the value and
  writes it to `.env.local`.

[`src/layouts/BaseLayout.astro`](../../src/layouts/BaseLayout.astro) gates the
`<script>` tag on `import.meta.env.PUBLIC_CWA_TOKEN`. No token, no
beacon — the strict default CSP holds.

Token rotation: rotate yearly or sooner if a leak is suspected. Generate
a new token in the dashboard, swap the Pages env var, redeploy; old
beacons stop reporting within minutes. The token is not a credential,
so a leak is low-impact, but visible inflated traffic is worth catching.

## Why both?

Synthetic alone misses:

- Real network variance (a CI runner on a fast wired link is not a
  visitor on Cox cable mid-storm).
- Long-tail device performance (Lighthouse mobile preset is one fixed
  Moto G4 profile; real visitors land on Pixels, iPhones, four-year-old
  Galaxies).
- Geographic latency (LCP looks great from us-east-1; what about a
  visitor in Henderson on a coffee-shop Wi-Fi?).

RUM alone misses:

- Pre-merge regressions. By the time RUM shows it, every visitor has
  already paid the cost.
- Controlled-environment debugging. RUM tells you that the median LCP
  jumped 400 ms; Lighthouse on a reproducible artifact tells you which
  asset caused it.

Together: CI catches what visitors would feel, RUM confirms what they
actually felt.

## When numbers diverge

If synthetic stays green but RUM regresses, the cause is usually
infrastructure — Cloudflare edge cache, image-format negotiation, a
plugin on the dashboard mis-set. Check the CWA dashboard's "by country"
and "by browser" splits first; a single country/browser bar climbing is
often a cache or A/B-test artifact, not a code regression.

If synthetic regresses but RUM stays green, the budget is too tight for
the real-world variance — adjust [`perf-budgets.json`](../../perf-budgets.json)
upward only after confirming the synthetic number reflects a real
visitor experience and not a Lighthouse quirk.
