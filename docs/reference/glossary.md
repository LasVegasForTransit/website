# Glossary

Contributors use this page to look up an unfamiliar term while following a guide. Each definition
explains the term in the context of this repository.

If you hit a word in any doc that isn't explained and isn't here, that's a doc bug — please add it
(see [writing-docs.md](../standards/writing-docs.md)).

---

## Our stack (what the site is built with)

- **Astro** <a id="astro"></a> — the framework that builds the website. It turns the files in
  `apps/site/src/` into plain HTML pages. We use it because the result is a fast, mostly-static
  site.
- **static site** <a id="static-site"></a> — a website that's pre-built into HTML/CSS/JS files ahead
  of time, rather than generated fresh on every visit. Faster and cheaper to host. Most of this site
  is static.
- **MDX** <a id="mdx"></a> — Markdown (the simple `# heading` / `**bold**` text format) with the
  ability to drop in interactive components. Our long-form pages are written in `.mdx` files.
- **content collection** <a id="content-collection"></a> — Astro's name for a folder of content
  files (under `apps/site/src/content/`) that all share the same shape, e.g. all events or all
  projects. See [content-collections.md](./content-collections.md).
- **frontmatter** <a id="frontmatter"></a> — the block of settings at the very top of a Markdown/MDX
  file, fenced by `---` lines (title, date, etc.). It's structured data about the page.
- **Zod** <a id="zod"></a> — a tool that checks data matches an expected shape. We use it to
  validate frontmatter, so a typo in a content file fails the build with a clear message instead of
  shipping broken.
- **Tailwind** <a id="tailwind"></a> — a CSS framework where you style elements with utility classes
  (e.g. `class="text-lg font-bold"`) instead of writing separate CSS files.
- **`data-*` attribute** <a id="data-attribute"></a> — a normal HTML attribute used to store small
  bits of metadata on an element. For example, `data-screen-action` tells the print stylesheet that
  an element is only useful on screen and should disappear on paper.
- **print stylesheet** <a id="print-stylesheet"></a> — CSS rules that apply only when a page is
  printed or exported to PDF. In this repo they live in `apps/site/src/styles/global.css` under
  `@media print`.

## Running & shipping (the developer tools)

- **Node** <a id="node"></a> — the program that runs JavaScript/TypeScript outside a browser. You
  need it installed to run anything here (version 24.20 or newer in the 24.x line).
- **pnpm** <a id="pnpm"></a> — the package manager we use (an alternative to npm). It installs
  dependencies and runs project commands like `pnpm dev`. If you know npm, it's the same idea.
- **`pnpm dev`** <a id="pnpm-dev"></a> — starts the site on your own computer so you can preview
  changes live. See [local-dev.md](./local-dev.md).
- **Portless** <a id="portless"></a> — a local development proxy that gives the site a stable
  browser URL (`https://lvbt.localhost`) instead of making you remember a port number.
- **HMR (Hot Module Replacement)** <a id="hmr"></a> — when the dev server updates the page in your
  browser instantly as you edit, without a full reload.
- **TypeScript** <a id="typescript"></a> — JavaScript with type labels that catch mistakes before
  the code runs. Files end in `.ts`.
- **environment variable (env var)** <a id="env-var"></a> — a named setting kept outside the code
  (like an API key or a URL), so secrets aren't committed and config can differ between your laptop
  and production.
- **`apps/site/.env.local` vs `apps/site/.env.example`** <a id="env-files"></a> —
  `apps/site/.env.example` is a committed template listing which env vars exist (no real secret
  values). `apps/site/.env.local` is your private copy with the real values; it's git-ignored and
  never committed.
- **CI / CI-CD** <a id="ci"></a> — "Continuous Integration / Delivery": automation in
  `.github/workflows/` that builds and checks changes on GitHub. Staging and production publication
  require explicit workflow dispatches.
- **lockfile** <a id="lockfile"></a> — `pnpm-lock.yaml`, which pins the exact version of every
  dependency so everyone gets an identical install.
- **git hook** <a id="git-hook"></a> — a script Git runs automatically at a certain moment (e.g. on
  every commit). Ours check your commit message and docs before a commit is accepted, and tell you
  what to fix if something's off.
- **gh** <a id="gh"></a> — the GitHub command-line tool. Maintainers use it to inspect workflow runs
  and other repository state. Agents must use the approved helper when creating issues or pull
  requests.
- **dig** <a id="dig"></a> — a command-line tool that looks up DNS records, used to check that a
  domain points where it should.
- **SSH key / SSH URL** <a id="ssh"></a> — SSH keys are a passwordless way to prove who you are to
  GitHub. An "SSH URL" (`git@github.com:org/repo.git`) is the address Git pushes to using that key —
  so you need an SSH key set up with GitHub first.

## Hosting & DNS (how the site gets online)

- **Cloudflare Pages** <a id="cloudflare-pages"></a> — the former website host. Do not assume its
  older `pages.dev` deployment is a verified recovery option. Follow the saved-release recovery
  procedure.
- **Pages Function** <a id="pages-function"></a> — a backend script in `apps/site/functions/api/`.
  Wrangler compiles these scripts into the production Worker; each handles a request that static
  HTML cannot, such as a form submission.
- **Wrangler** <a id="wrangler"></a> — Cloudflare's Worker development tool. This repository still
  uses it for local runtime and build work. Use the shared release commands for publication.
- **Cloudflare CLI (`cf`)** <a id="cf"></a> — the newer Cloudflare command-line tool used for
  provider operations. A signed-in profile identifies the account the command may inspect or change.
- **Cloudflare Workers** <a id="cloudflare-workers"></a> — Cloudflare's runtime for the production
  website. The `lvbt-website` Worker serves prebuilt pages and runs the compiled API functions.
- **rendering on request** <a id="rendering-on-request"></a> — building a page's HTML on the server
  when someone asks for it, instead of once at build time. Astro calls it on-demand rendering; the
  opposite is prerendering.
- **D1** <a id="d1"></a> — Cloudflare's serverless SQL database, used by the Organizing Platform to
  store people and their consent.
- **binding** <a id="binding"></a> — the name a Worker uses to reach a Cloudflare resource, such as
  `PLATFORM_DB` for the platform database.
- **migration** <a id="migration"></a> — a numbered SQL file that changes the database's structure
  one step at a time.
- **cron trigger** <a id="cron-trigger"></a> — a Cloudflare setting that starts a Worker on a
  timetable, such as every 15 minutes.
- **Cloudflare Access** <a id="cloudflare-access"></a> — a Cloudflare service that makes people sign
  in before they can reach a protected website. It also supports service credentials for CI. It
  guards the staff console and protected staging hosts.
- **ULID** <a id="ulid"></a> — a unique identifier that sorts by the time it was created.
- **DNS** <a id="dns"></a> — the system that maps a domain name (`lasvegasfortransit.org`) to a
  server.
- **CNAME** <a id="cname"></a> — a type of DNS record that points one domain name at another (e.g.
  our domain → Cloudflare's servers).
- **apex domain** <a id="apex-domain"></a> — the bare domain with no subdomain
  (`lasvegasfortransit.org`, not `www.` or `journal.`).
- **zone** <a id="zone"></a> — Cloudflare's term for a domain it manages, plus all that domain's DNS
  records.

## Database and background work

- **person record** <a id="person-record"></a> — the membership database record for one person. A
  sign-in account, a membership choice, newsletter consent, and a staff role are separate facts.
- **query** <a id="query"></a> — one request to the database. One query may inspect thousands of
  rows. Counting queries alone does not measure D1 cost.
- **rows read** <a id="rows-read"></a> — database rows examined while running a query. A query can
  read more rows than it returns. An index can reduce the number examined.
- **transaction** <a id="transaction"></a> — a group of database changes that either all succeed or
  all fail. This prevents a partially applied change.
- **trigger** <a id="database-trigger"></a> — SQL the database runs in response to a specified
  operation, either before or after it. Check triggers when a write has effects beyond its immediate
  table.
- **background job** <a id="background-job"></a> — saved work that a Worker performs after the
  original request, such as sending a newsletter preference to Beehiiv.
- **generation** <a id="generation"></a> — a job's version number. A newer version prevents older
  work from replacing a more recent choice.
- **lease** <a id="lease"></a> — a temporary claim on work. Another worker may claim it after the
  lease expires. The old worker must prove it still owns the claim before saving its result.
- **receipt** <a id="receipt"></a> — saved evidence that an operation completed, such as a provider
  response identifier. A receipt does not replace checks of current provider state.
- **reconciliation** <a id="reconciliation"></a> — comparing the requested state with the current
  state and applying the changes still needed. For example, a job checks a person's Discord role
  before deciding whether to add or remove it.
- **release artifact** <a id="artifact"></a> — the saved output of a build. Promotion publishes that
  saved build instead of rebuilding newer source code.
- **release marker** <a id="release-marker"></a> — a deployed value that identifies the release
  serving a request. Release checks compare it with the selected build.

<a id="notion-where-staff-data-lives"></a>

## Notion (editorial databases and notes)

- **Notion** <a id="notion"></a> — the app the team uses for editorial databases and notes,
  including transit news and press coverage. Membership records live in D1.
- **Notion integration** <a id="notion-integration"></a> — a connection you configure in Notion so
  our code can access an explicitly shared database. It produces an **API key**.
- **API key / token** <a id="api-key"></a> — a secret password-like string that lets code call a
  service (Notion, Beehiiv, etc.) on our behalf. Kept in env vars, never committed.
- **rotate (a secret)** <a id="rotate"></a> — replace a secret with a new value everywhere it is
  stored, so the old one stops working. You rotate after a leak, or after resetting the value in the
  service that issued it.
- **database vs data source** <a id="data-source"></a> — in Notion's current API, a _database_ can
  hold one or more _data sources_ (the actual tables of rows). Newer API calls target the data
  source ID, which you look up from the database ID.
- **webhook** <a id="webhook"></a> — an automated HTTP message one service sends another when
  something happens ("a form was submitted") — so we react to events instead of constantly polling.
  The receiver is usually a [Pages Function](#pages-function).
- **Notion automation** <a id="notion-automation"></a> — a rule inside Notion ("when a row is added,
  send a webhook") configured in the database's ••• menu.

## Security & HTTP (how requests are checked)

- **HTTP status code** <a id="status-code"></a> — the 3-digit result of a web request: `200` = OK,
  `400` = bad request, `401` = unauthorized, `404` = not found, `5xx` = server error.
- **bearer token** <a id="bearer-token"></a> — a secret sent in a request's
  `Authorization: Bearer <token>` header to prove the caller is allowed. If it doesn't match, the
  function returns `401`.
- **timing-safe comparison** <a id="timing-safe"></a> — comparing secret values without revealing
  how many characters match through the comparison time. Callers must also handle unequal lengths
  safely.
- **idempotent** <a id="idempotent"></a> — an operation designed so repeating the same request does
  not apply its effect twice. Check the operation's documented retry rules. A partially saved news
  article can still need inspection before retrying.
- **CSP (Content Security Policy)** <a id="csp"></a> — a security rule, sent as an HTTP header, that
  lists which sources a page may load scripts/images/etc. from. Blocks injected/malicious code.

## Email & newsletter

- **Beehiiv** <a id="beehiiv"></a> — the newsletter platform we currently send email through (via
  its API).
- **Ghost(Pro)** <a id="ghost"></a> — the hosted publishing/newsletter platform proposed for the
  long-form journal. That proposal does not describe the current Beehiiv setup. See the
  [decision record](../explanation/decisions/newsletter-platform.md).
- **RSS** <a id="rss"></a> — "Really Simple Syndication": a standard XML feed a site or newsletter
  publishes to list its recent posts. We read Beehiiv's RSS feed at build time to list recent issues
  on `/newsletter`.
- **double opt-in** <a id="double-opt-in"></a> — requiring a new subscriber to click a confirmation
  link in an email before they're fully subscribed. Confirms the address is real and consenting.
- **SPF / DKIM / DMARC** <a id="email-auth"></a> — email authentication settings published through
  DNS. SPF lists allowed senders. DKIM lets recipients verify a message signature. DMARC declares
  how recipients should handle failed domain authentication. These settings do not guarantee inbox
  delivery.
- **Apps Script** <a id="apps-script"></a> — Google's built-in JavaScript automation for Forms,
  Sheets, and Docs. A script attached to a form can run on every submission (a _trigger_) and call
  outside services; that is how the membership form reaches our intake endpoint. Open it via
  **Extensions → Apps Script** on the form — see
  [connect-the-membership-form.md](../guides/connect-the-membership-form.md).

## Transit & advocacy acronyms

- **RTC** <a id="rtc"></a> — Regional Transportation Commission of Southern Nevada, the agency that
  runs Las Vegas's buses.
- **BRT** <a id="brt"></a> — Bus Rapid Transit: faster bus service with dedicated lanes, fewer
  stops, and level boarding (more like light rail).
- **LRT** <a id="lrt"></a> — Light Rail Transit: electric trains on tracks, usually in their own
  lane — think a modern streetcar/tram scaled up.
- **FTA** <a id="fta"></a> — Federal Transit Administration, the U.S. agency that funds transit
  projects.
- **APTA** <a id="apta"></a> — American Public Transportation Association, an industry group that
  publishes ridership rankings.
- **TOD** <a id="tod"></a> — Transit-Oriented Development: building homes and shops densely around
  transit stops so people can live car-light.
- **VMT** <a id="vmt"></a> — Vehicle Miles Traveled: total miles driven, a measure of car dependence
  that good transit aims to reduce.
- **GTFS** <a id="gtfs"></a> — General Transit Feed Specification: the standard data format agencies
  publish routes and schedules in.

---

## Related

- [Start here](../tutorials/start-here.md) — the new-contributor on-ramp.
- [Writing docs](../standards/writing-docs.md) — how we keep docs this readable.
