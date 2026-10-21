# Performance monitoring

Contributors use this page to check page speed, download size and memory use before a change ships.
Start with the failed check's report, reproduce the measurement, then decide what to change.
Complete [local setup](../tutorials/first-time-setup.md) before running the commands below.

We use two kinds of measurement:

- **Synthetic monitoring** loads pages with test tools under controlled conditions. Continuous
  integration (CI), the automated checks on GitHub, uses these measurements to catch slowdowns
  before merging.
- **Real-user monitoring (RUM)** measures visits to the live site through Cloudflare Web Analytics.
  Those results include the range of devices, networks and locations visitors use.

## Budgets

A performance budget is a limit that fails a check when a measurement exceeds it. File-size and
memory limits live in [`apps/site/perf-budgets.json`](../../apps/site/perf-budgets.json).
Lighthouse's page-speed limits live separately in
[`apps/site/lighthouserc.cjs`](../../apps/site/lighthouserc.cjs).

The file checks measure **gzipped** size: the number of bytes after gzip compression. This provides
one repeatable measure of download size; a server can use a different compression method. The
scripts label 1,024 bytes as one KB.

| Measurement                               | Current limit                            | Check                                      |
| ----------------------------------------- | ---------------------------------------- | ------------------------------------------ |
| All Cascading Style Sheets (CSS), gzipped | 30 KB                                    | `apps/site/scripts/audit/bundle-size.ts`   |
| All JavaScript (JS), gzipped              | 17 KB                                    | `apps/site/scripts/audit/bundle-size.ts`   |
| CSS and JS combined, gzipped              | 46 KB                                    | `apps/site/scripts/audit/bundle-size.ts`   |
| One gzipped file                          | 14 KB, with exceptions below             | `apps/site/scripts/audit/bundle-size.ts`   |
| PNG/JPG image without a WebP copy         | 20 KB, unless listed in `webpExemptions` | `apps/site/scripts/audit/asset-budget.ts`  |
| Build peak resident set size (RSS)        | Report only (`null`); local measurement  | `apps/site/scripts/audit/build-profile.ts` |
| Browser JavaScript memory per page        | 30 MB                                    | `apps/site/tests/e2e/perf-memory.spec.ts`  |

`perFileExceptions` gives files whose names start with `BaseLayout.` a 21 KB ceiling and files
starting with `app-enhance.` a 3 KB ceiling. These replace the general per-file limit for those
files; the combined limits still apply.

RSS measures memory held by a process. The local build profiler samples the `pnpm build` process and
records its highest observed RSS and elapsed time. It does not measure the entire process tree.
After a successful build, it appends a record to `apps/site/audits/build-stats.jsonl`. JSON Lines
(JSONL) stores one JavaScript Object Notation (JSON) record per line. Compare several runs on the
same machine before treating a memory change as a trend. This measurement is not a CI merge gate.

The browser check samples `performance.memory.usedJSHeapSize`, the memory JavaScript still holds
after the test loads and scrolls a page and asks Chromium to free unused objects. A failed limit
requires investigation; the number alone does not identify a memory leak.

## Synthetic checks (CI)

[The Audit workflow](../../.github/workflows/audit.yml) runs on pull requests and pushes to `main`.
These performance checks must pass:

- **Lighthouse desktop and mobile** load a sample from the built sitemap. The config keeps one
  detail page under each of `/events/`, `/join/` and `/projects/`, plus the other routes. Both
  presets block merging on failure. Mobile uses the Moto G4 and slow-4G test settings.
- **Runtime memory** checks sitemap pages in Chromium. It scrolls the page and requests garbage
  collection, which frees unused objects, before comparing memory with the 30 MB limit.
- **Bundle size** compresses CSS and JS from `dist/_astro` and `dist/scripts`, then checks the
  totals and each file.
- **Image size** checks PNG/JPG files in `public/` for the required WebP copies or listed
  exceptions.

Lighthouse reports page-speed metrics including Largest Contentful Paint (LCP), the time until the
largest visible content appears. LCP is one of the Core Web Vitals (CWV), Google's measures of
loading, responsiveness and layout stability. A score or an LCP value is evidence from that test
run, not a measurement of every visitor.

Run the local baseline audit from the repository root:

```sh
pnpm -C apps/site check:baseline
```

It builds once through the local memory profiler, runs the file checks, then runs browser checks in
sequence. It writes a dated report under `apps/site/audits/`. GitHub runs the corresponding checks
as separate jobs; its build does not use the local memory profiler.

[The scheduled workflow](../../.github/workflows/audit-scheduled.yml) runs each Monday at 14:00 UTC
(Coordinated Universal Time) and can also be started manually. It calls the pinned shared audit
workflow on the default branch. That workflow runs `pnpm run audit --target production`, using
[`.lvbt/tooling.json`](../../.lvbt/tooling.json) to select dependency, live-link and Lighthouse
checks. The configured Lighthouse command sets `LIGHTHOUSE_PRESET=prod` and checks live production
URLs. The shared workflow retains reports, previews the proposed issue actions, then reconciles
verified findings with GitHub issues through `pnpm run audit report`.

The production Lighthouse preset disables only the `robots-txt` audit because Cloudflare's managed
`Content-Signal` line is an intentional crawler policy that Lighthouse does not recognize. The
preset checks the other search-engine requirements separately. Do not remove the crawler policy to
make that one audit pass.

## Real-user monitoring (CWA)

Cloudflare Web Analytics (CWA) collects browser measurements through a small script called a
**beacon**. The shared LVBT analytics package also sends declared interaction events to
`events.lasvegasfortransit.org`. The site's Content Security Policy (CSP), which limits script and
network destinations, permits the beacon at `static.cloudflareinsights.com` and measurements sent to
`cloudflareinsights.com` and the LVBT collector. See the
[security terms](../reference/glossary.md#csp).

Maintainers configure the site's public token as the GitHub Actions variable
`PUBLIC_LVBT_CWA_TOKEN`. This token identifies the analytics site; it is not an account password or
account credential. The release build sets `LVBT_REQUIRE_ANALYTICS=1`, which loads the shared Astro
integration and fails the build if the token is missing. Ordinary local and pull-request builds omit
that flag and the integration. A retained release can contain the analytics code while preview
runtime protections prevent it from reporting production traffic. The release smoke test checks that
preview sends no requests to either collector.

Contributors do not need a token to run local checks. Maintainers use
[bootstrap](../reference/bootstrap.md) for production configuration. If the public token changes,
they update the GitHub Actions variable and build a new reviewed release through the usual release
process. Changing the variable does not modify an already built release.

## Why both?

Lab checks catch slowdowns before merging and provide controlled runs for investigation. Live
measurements show the experience of visitors using different devices and networks. Neither result
explains the other's cause by itself.

For example, a Lighthouse run can reveal a larger image in the proposed build. Live data can show
whether visitors on mobile connections also take longer to see that image. Compare the reports
before attributing a change to code, network conditions or hosting.

## When numbers diverge

First check that the measurements cover the same release, page and time period. Compare device,
network and location groups rather than assuming a whole-site average describes every visitor.

If CI passes but live measurements worsen, inspect the affected pages and visitor groups. Reproduce
those conditions where possible. A cache change, a slower outside service, a different visitor mix
or a code change can each affect the result; the disagreement does not identify one automatically.

If CI worsens but live measurements stay steady, inspect the failed report and repeat the controlled
measurement. Live traffic may not yet include the proposed change or enough affected visits. Keep
the budget in place while investigating. A budget change needs evidence that the added cost is
acceptable; a passing live average alone is not that evidence.
