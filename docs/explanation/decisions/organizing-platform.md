# Decision: Organizing platform architecture

This record fixes how the Organizing Platform is built: where its code lives, how its pages render, where its data is kept, how its scheduled jobs run, and which speed budgets every screen must meet. Read it before you pick up any platform task. Dozens of tasks depend on these answers, and they should never have to be worked out twice.

The Organizing Platform is the set of signed-in tools LVBT is adding to this website: joining and managing a membership, one record per supporter, event check-in, Discord roles, volunteer management and a staff console. The work is planned in the Organizing Platform Launch initiative. Each decision below has a short reason and a list of what it rules out.

**Decision:** The platform lives in this repository as three apps and a set of shared packages. It runs on Cloudflare Workers, keeps its data in one Cloudflare D1 database, and runs recurring jobs from one scheduled trigger. Public pages stay prebuilt, and signed-in pages are rendered on request. Everything stays on Cloudflare's free plan.

**Date:** 2026-09-22

## Context

Today this website is a static site (see the [glossary](../../reference/glossary.md#static-site)). Every page is built into HTML ahead of time. It has no database, no sign-in, no sessions and no message catalog. Its only server code is three [Pages Functions](../../reference/glossary.md#pages-function): newsletter subscribe, membership intake from the Google Form, and the transit-news intake from Notion.

The platform needs things a static site cannot do. It has to show a member their own record, remember who is signed in, store people and their consent, and run jobs on a schedule. The choices below add those things while keeping the public site as fast and cheap as it is today.

Two facts shaped the hosting decision:

1. Astro's Cloudflare adapter no longer supports Cloudflare Pages. It deploys only to Cloudflare Workers with static assets. (An adapter is the plug-in that lets Astro run on a particular host.)
2. That move is already under way. The [Workers candidate](../../guides/test-the-workers-candidate.md) runs beside the Pages site today, and it is checked against Pages on every production deploy.

## Terms used in this record

- **Cloudflare Workers:** Cloudflare's service for running small server programs close to visitors. A Worker can also serve a folder of prebuilt files, called static assets. Requests for static assets are free and do not count against the Worker's request limit.
- **Rendering on request:** producing a page's HTML on the server when someone asks for it, instead of once at build time. Astro calls this on-demand rendering. A page that stays the same for everyone is still built ahead of time, which Astro calls prerendering.
- **D1:** Cloudflare's serverless SQL database. It runs next to Workers, and its free plan covers LVBT's needs.
- **Binding:** the name a Worker uses to reach a Cloudflare resource, such as a database. Code asks for `PLATFORM_DB` rather than holding a connection string.
- **Migration:** a numbered SQL file that changes the database's structure one step at a time. Running every migration in order rebuilds the database from nothing.
- **Cron trigger:** a Cloudflare setting that starts a Worker on a timetable, such as every 15 minutes.
- **Cloudflare Access:** a Cloudflare service that asks people to sign in before they can reach a website at all. It is free for up to 50 users.
- **ULID:** a unique identifier that sorts by the time it was created, for example ``.
- **Domain core:** the shared code that holds LVBT's own rules about people, identities, consent, membership and committees.
- **Integration:** shared code that translates between one outside service, such as Beehiiv or Discord, and the domain core.
- **Idempotent:** safe to repeat. Submitting an idempotent form twice gives the same result as submitting it once.

## The decisions

### 1. Code lives in this repository, as three apps and shared packages

The public site, the staff console and the job runner are three apps in this repository. The shared code is split into packages that the apps import:

- one domain core package;
- one storage package;
- one integration package for each outside service: Beehiiv, Notion, Google Workspace, Discord, Givebutter, Resend and the US Census Geocoder.

The job runner is described in decision 7. The layout follows the LVBT repository standard, which uses Turborepo's conventions: apps under `apps/`, shared packages under `packages/`. Shared packages are private to this repository and are never published.

One repository means one pull request can change the database, the site and the console together, and one set of checks covers all of them.

What this rules out:

- a separate repository for the platform or for the console;
- copying shared code between apps instead of importing a package.

### 2. The domain core never talks to the outside world

The domain core never imports an integration and never makes a network request. Integrations depend on the domain core, never the other way round.

This keeps LVBT's rules testable without any service accounts, and it lets another organization reuse the core with different tools. Replacing Beehiiv, for example, means writing a new integration without touching the core.

What this rules out:

- calling Beehiiv, Discord or any other service from inside the domain core;
- an outside service's data shapes, such as a Beehiiv subscriber object, appearing in the core's types.

### 3. Public pages stay prebuilt, and member and staff pages render on request

Public pages are prebuilt exactly as they are today. Member pages render on request inside the website app. These are the join confirmation, sign-in, account and check-in pages. Event pages also render on request, from the calendar feed. The staff console renders every page on request.

To do this, the site uses Astro's Cloudflare adapter (`@astrojs/cloudflare` version 14, which supports Astro 7.2 and later). Astro prebuilds every page by default. A page that must render on request declares `export const prerender = false`. The site sets the adapter's `prerenderEnvironment: 'node'` option, so public pages build in Node exactly as they do now. It also sets `imageService: 'compile'`, so images are still processed at build time and never through Cloudflare's metered image service.

Rendering on the server sends finished HTML in one round trip, with no loading spinners and no extra requests from the browser. That is the fastest and most battery-friendly way to show a page on a phone with a weak connection.

What this rules out:

- a separate API Worker with pages that fetch data in the browser;
- a single-page app, where the browser downloads a framework before it can show anything;
- rendering public pages on request when they are the same for everyone.

### 4. The site moves from Cloudflare Pages to Workers with static assets

Once rendering on request is turned on, the site deploys to Cloudflare Workers with static assets instead of Cloudflare Pages. The adapter requires this. The switch uses the existing [Workers candidate checks](../../guides/test-the-workers-candidate.md), which already prove that the Worker serves the same pages, headers, redirects and API responses as Pages. The move happens in the task that turns on rendering on request, not in this record.

The three existing request handlers keep their URLs and behavior. They become Astro endpoints that render on request. Newsletter subscribe, membership intake and transit-news intake keep working until the tasks that replace them ship. The host routing that serves `lvwwd.org` from this site also keeps working, as Astro middleware.

What this rules out:

- staying on Cloudflare Pages;
- running a Pages site and a platform Worker as two separate deployments.

### 5. One D1 database holds all platform data

The site and the staff console share one D1 database on the free plan. The production database is `lvbt-platform`, and pull-request previews use `lvbt-platform-preview`. Both apps reach it through the binding `PLATFORM_DB`.

Every change to the database's structure is a numbered migration in the storage package. Nobody edits the production database's structure by hand.

Sign-in sessions are stored in D1. The platform does not use Astro's built-in sessions, which need Cloudflare KV. KV's free plan allows only 1,000 writes a day, and a second data store would add a second place for personal data to live.

What this rules out:

- a hosted database outside Cloudflare, such as Postgres on another provider;
- Notion or Google Sheets as the record of people;
- Cloudflare KV for anything that holds personal data.

### 6. Code reaches people through typed functions, and outside tools through one intake interface

Inside this repository, code reads and writes people through typed functions in the domain core and the storage package. Apps do not call each other over HTTP. This internal person service has a version made of two parts: the database's schema version, which is the number of its latest migration, and the storage package's version.

Outside form tools reach the platform only through one documented, versioned HTTP intake interface. The Google Form uses it today. Any other form tool can use it later without code changes.

What this rules out:

- an internal HTTP API between the site and the console;
- form tools writing to the database directly, or each form tool getting its own endpoint.

### 7. One scheduled job runner does all recurring work

One job runner is its own small Worker, and it is the third app in this repository. A cron trigger starts it every 15 minutes. Each job records when it last ran and runs only when it is due: every 15 minutes, hourly or daily. Examples are polling Beehiiv for subscription changes every 15 minutes, checking Discord roles hourly and deleting expired data daily.

The free plan allows five cron triggers per account, shared across every LVBT project, so the platform uses only one. The runner is kept out of the site's Worker so that the code for every outside service is never loaded to serve a page, which keeps the site's Worker small and quick to start. A job that fails or runs long also never touches page serving.

What this rules out:

- one cron trigger per job;
- running jobs inside the site's Worker;
- scheduling jobs in GitHub Actions or on anyone's computer.

### 8. Secrets live in Cloudflare and are never committed

Secrets, such as API keys, are set in Cloudflare with Wrangler (see the [glossary](../../reference/glossary.md#wrangler)) or in the Cloudflare dashboard. They are never committed. Every secret's name and purpose is listed in `.env.example`, the committed template of settings, with no real values.

What this rules out:

- secrets in code, in the Wrangler configuration file;
- sharing secrets in chat instead of setting them in Cloudflare.

### 9. Records use ULIDs, and times are stored in UTC

Every record has a ULID as its identifier. ULIDs sort in the order they were made and do not reveal how many records exist.

Every time is stored in UTC, the world standard time that has no daylight saving. Times are shown in Pacific Time (`America/Los_Angeles`).

What this rules out:

- counting identifiers such as 1, 2, 3, which leak how many members LVBT has;
- storing local times, which break twice a year when the clocks change.

### 10. Transactional email goes through one sending function and Resend's free plan

Transactional email is any email sent to one person because of something they did, such as a sign-in code or an event reminder. All of it goes through one shared sending function using Resend's free plan, which allows 3,000 emails a month and 100 a day. It is sent from a dedicated subdomain, `notify.lasvegasfortransit.org`, so it cannot harm the reputation of LVBT's main address. (`mail.lasvegasfortransit.org` is already the newsletter's web address in Beehiiv.) The newsletter stays in Beehiiv.

If LVBT outgrows the free plan, the next step is Cloudflare Email on Workers Paid at $5 a month, not Resend Pro at $20 a month. Only the sending function changes.

What this rules out:

- sending email from anywhere except the shared sending function;
- sending transactional email from the main domain or through the newsletter platform.

### 11. Every screen meets the "Build for the bus" budgets

The platform is built for someone on a phone on the bus, with limited data, a weak or dropping connection, and a low battery. The public-page budgets in [performance monitoring](../../standards/performance-monitoring.md) stay in force. The platform adds these budgets, and every screen task checks against them.

| Rule                                | Value                                                                                                                       |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| JavaScript, public and member pages | 12 KB gzip in total, the existing budget                                                                                    |
| JavaScript, staff console           | 35 KB gzip per route                                                                                                        |
| CSS                                 | 20 KB gzip, the existing budget                                                                                             |
| First visit to a member page        | at most 100 KB transferred, not counting a member's own images                                                              |
| Repeat visit                        | at most 20 KB transferred                                                                                                   |
| Speed                               | main content visible (Largest Contentful Paint) within 3 seconds on a Samsung Galaxy A15 with Chrome's "Slow 4G" throttling |
| Battery                             | no polling, background timers, autoplay or continuous animation; respect reduced-motion settings                            |
| Data saver                          | when the browser asks to save data, skip non-essential images and prefetching                                               |
| Fonts                               | no new web fonts beyond the site's existing brand fonts                                                                     |

What this rules out:

- client-side frameworks on member pages;
- any screen that keeps the phone busy while it sits open.

### 12. Every flow works without JavaScript

Every flow works with JavaScript turned off. JavaScript can improve a page but never be required. Every form submits in one request and is idempotent, so a member on a dropping connection can press Submit again safely.

What this rules out:

- buttons that only work through JavaScript;
- forms that need several requests to finish.

### 13. Screen text comes from a message catalog, in English only

Every piece of text on member and staff screens comes from a message catalog, a single list of every message keyed by name. That keeps the platform ready for translation. English is the only published language, because nobody on the team can review another language today.

What this rules out:

- text written directly into components;
- publishing machine-translated pages that nobody on the team can check.

## What stays the same

Public pages stay prebuilt, and their budgets, accessibility checks and Lighthouse checks stay in force. The newsletter stays in Beehiiv. The Google Form keeps working through the intake interface. The three existing request handlers keep their URLs and behavior until the tasks that replace them ship.

## Costs and limits

Everything in this record runs on free plans:

- Workers free plan: 100,000 requests a day, not counting requests for static assets. Each request gets 10 milliseconds of CPU time, and each account gets five cron triggers.
- D1 free plan: 5 million rows read and 100,000 rows written a day, and 5 GB of storage.
- Cloudflare Access: free for up to 50 users.
- Resend free plan: 3,000 emails a month, 100 a day.

The limit most likely to matter is 10 milliseconds of CPU time per request. Waiting for the database does not count toward it, but building a large page can. The task that turns on rendering on request adds a check that measures the CPU time of every page rendered on request, and every later page must pass it. If a page goes over, the fix is Workers Paid at $5 a month, which needs the president's approval before anything is changed.

## Confirmed against documentation

These points were checked against current documentation on 2026-09-22:

- The adapter deploys only to Workers with static assets, and Pages support has been removed. See the [Astro Cloudflare adapter guide](https://docs.astro.build/en/guides/integrations-guide/cloudflare/). The npm registry lists `@astrojs/cloudflare` 14.3.3 with a peer requirement of `astro ^7.2.0`, and this site uses Astro 7.2.10.
- Pages prebuild by default, and `export const prerender = false` makes a page render on request. See [Astro on-demand rendering](https://docs.astro.build/en/guides/on-demand-rendering/).
- Bindings are read with `import { env } from 'cloudflare:workers'`. A custom Worker entry file wraps the adapter's handler from `@astrojs/cloudflare/handler`. Both are in the adapter guide.
- The free-plan limits come from [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [KV limits](https://developers.cloudflare.com/kv/platform/limits/) and [cron triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/).
