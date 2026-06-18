# Glossary

Plain-English definitions of the tools, acronyms, and jargon used across this
repo's docs. New to the project? Skim this once, then keep it open in a tab —
other docs link here the first time they use a term.

If you hit a word in any doc that isn't explained and isn't here, that's a doc
bug — please add it (see [writing-docs.md](../standards/writing-docs.md)).

---

## Our stack (what the site is built with)

- **Astro** <a id="astro"></a> — the framework that builds the website. It turns
  the files in `src/` into plain HTML pages. We use it because the result is a
  fast, mostly-static site.
- **static site** <a id="static-site"></a> — a website that's pre-built into
  HTML/CSS/JS files ahead of time, rather than generated fresh on every visit.
  Faster and cheaper to host. Most of this site is static.
- **MDX** <a id="mdx"></a> — Markdown (the simple `# heading` / `**bold**` text
  format) with the ability to drop in interactive components. Our long-form pages
  are written in `.mdx` files.
- **content collection** <a id="content-collection"></a> — Astro's name for a
  folder of content files (under `src/content/`) that all share the same shape,
  e.g. all events or all projects. See [content-collections.md](./content-collections.md).
- **frontmatter** <a id="frontmatter"></a> — the block of settings at the very top
  of a Markdown/MDX file, fenced by `---` lines (title, date, etc.). It's
  structured data about the page.
- **Zod** <a id="zod"></a> — a tool that checks data matches an expected shape. We
  use it to validate frontmatter, so a typo in a content file fails the build with
  a clear message instead of shipping broken.
- **Tailwind** <a id="tailwind"></a> — a CSS framework where you style elements
  with utility classes (e.g. `class="text-lg font-bold"`) instead of writing
  separate CSS files.

## Running & shipping (the developer tools)

- **Node** <a id="node"></a> — the program that runs JavaScript/TypeScript outside
  a browser. You need it installed to run anything here (version 22.12+).
- **pnpm** <a id="pnpm"></a> — the package manager we use (an alternative to npm).
  It installs dependencies and runs project commands like `pnpm dev`. If you know
  npm, it's the same idea.
- **`pnpm dev`** <a id="pnpm-dev"></a> — starts the site on your own computer so you
  can preview changes live. See [local-dev.md](./local-dev.md).
- **HMR (Hot Module Replacement)** <a id="hmr"></a> — when the dev server updates
  the page in your browser instantly as you edit, without a full reload.
- **TypeScript** <a id="typescript"></a> — JavaScript with type labels that catch
  mistakes before the code runs. Files end in `.ts`.
- **environment variable (env var)** <a id="env-var"></a> — a named setting kept
  outside the code (like an API key or a URL), so secrets aren't committed and
  config can differ between your laptop and production.
- **`.env.local` vs `.env.example`** <a id="env-files"></a> — `.env.example` is a
  committed template listing which env vars exist (no real secret values).
  `.env.local` is your private copy with the real values; it's git-ignored and
  never committed.
- **CI / CI-CD** <a id="ci"></a> — "Continuous Integration / Delivery": automation
  that runs on GitHub every time you push, to build the site and run checks (and,
  for us, deploy it). Lives in `.github/workflows/`.
- **lockfile** <a id="lockfile"></a> — `pnpm-lock.yaml`, which pins the exact
  version of every dependency so everyone gets an identical install.
- **git hook** <a id="git-hook"></a> — a script Git runs automatically at a certain
  moment (e.g. on every commit). Ours check your commit message and docs before a
  commit is accepted, and tell you what to fix if something's off.
- **gh** <a id="gh"></a> — the GitHub command-line tool. The setup script uses it to
  create the repo and sign in to GitHub.
- **dig** <a id="dig"></a> — a command-line tool that looks up DNS records, used to
  check that a domain points where it should.
- **SSH key / SSH URL** <a id="ssh"></a> — SSH keys are a passwordless way to prove
  who you are to GitHub. An "SSH URL" (`git@github.com:org/repo.git`) is the address
  Git pushes to using that key — so you need an SSH key set up with GitHub first.

## Hosting & DNS (how the site gets online)

- **Cloudflare Pages** <a id="cloudflare-pages"></a> — the service that hosts our
  website and serves it to visitors. It also runs our small backend functions.
- **Pages Function** <a id="pages-function"></a> — a small backend script that runs
  on Cloudflare (in `functions/api/`). It handles things a static page can't, like
  receiving a form submission. Think "one API endpoint = one file."
- **Wrangler** <a id="wrangler"></a> — Cloudflare's command-line tool, used to run
  the functions locally and to deploy. `pnpm dev` runs it for you.
- **DNS** <a id="dns"></a> — the system that maps a domain name
  (`lasvegasfortransit.org`) to a server. The "phone book" of the internet.
- **CNAME** <a id="cname"></a> — a type of DNS record that points one domain name at
  another (e.g. our domain → Cloudflare's servers).
- **apex domain** <a id="apex-domain"></a> — the bare domain with no subdomain
  (`lasvegasfortransit.org`, not `www.` or `journal.`).
- **zone** <a id="zone"></a> — Cloudflare's term for a domain it manages, plus all
  that domain's DNS records.

## Notion (where staff data lives)

- **Notion** <a id="notion"></a> — the app the team uses for databases and notes
  (like a shared spreadsheet-meets-wiki). The site reads from and writes to it.
- **Notion integration** <a id="notion-integration"></a> — a mini-app you create in
  Notion so our code can access a database. It produces an **API key**.
- **API key / token** <a id="api-key"></a> — a secret password-like string that lets
  code call a service (Notion, Beehiiv, etc.) on our behalf. Kept in env vars,
  never committed.
- **database vs data source** <a id="data-source"></a> — in Notion's current API, a
  _database_ can hold one or more _data sources_ (the actual tables of rows). Newer
  API calls target the data source ID, which you look up from the database ID.
- **webhook** <a id="webhook"></a> — an automated HTTP message one service sends
  another when something happens ("a form was submitted") — so we react to events
  instead of constantly polling. The receiver is usually a [Pages Function](#pages-function).
- **Notion automation** <a id="notion-automation"></a> — a rule inside Notion ("when
  a row is added, send a webhook") configured in the database's ••• menu.

## Security & HTTP (how requests are checked)

- **HTTP status code** <a id="status-code"></a> — the 3-digit result of a web
  request: `200` = OK, `400` = bad request, `401` = unauthorized, `404` = not
  found, `5xx` = server error.
- **bearer token** <a id="bearer-token"></a> — a secret sent in a request's
  `Authorization: Bearer <token>` header to prove the caller is allowed. If it
  doesn't match, the function returns `401`.
- **timing-safe comparison** <a id="timing-safe"></a> — comparing two secrets in a
  way that always takes the same amount of time, so an attacker can't guess the
  secret character-by-character by measuring how fast it's rejected.
- **idempotent** <a id="idempotent"></a> — an operation you can safely run more than
  once with the same result (e.g. "add this article" skips if it already exists,
  so re-running never creates duplicates).
- **CSP (Content Security Policy)** <a id="csp"></a> — a security rule, sent as an
  HTTP header, that lists which sources a page may load scripts/images/etc. from.
  Blocks injected/malicious code.

## Email & newsletter

- **Beehiiv** <a id="beehiiv"></a> — the newsletter platform we currently send email
  through (via its API).
- **Ghost(Pro)** <a id="ghost"></a> — the hosted publishing/newsletter platform
  chosen for the long-form journal. See the [decision record](../explanation/decisions/newsletter-platform.md).
- **double opt-in** <a id="double-opt-in"></a> — requiring a new subscriber to click
  a confirmation link in an email before they're fully subscribed. Confirms the
  address is real and consenting.
- **SPF / DKIM / DMARC** <a id="email-auth"></a> — three DNS records that prove your
  email is really from your domain, so it lands in inboxes instead of spam. SPF
  lists allowed senders; DKIM signs messages; DMARC tells inboxes what to do if a
  message fails the first two.

## Transit & advocacy acronyms

- **RTC** <a id="rtc"></a> — Regional Transportation Commission of Southern Nevada,
  the agency that runs Las Vegas's buses.
- **BRT** <a id="brt"></a> — Bus Rapid Transit: faster bus service with dedicated
  lanes, fewer stops, and level boarding (more like light rail).
- **LRT** <a id="lrt"></a> — Light Rail Transit: electric trains on tracks, usually
  in their own lane — think a modern streetcar/tram scaled up.
- **FTA** <a id="fta"></a> — Federal Transit Administration, the U.S. agency that
  funds transit projects.
- **APTA** <a id="apta"></a> — American Public Transportation Association, an
  industry group that publishes ridership rankings.
- **TOD** <a id="tod"></a> — Transit-Oriented Development: building homes and shops
  densely around transit stops so people can live car-light.
- **VMT** <a id="vmt"></a> — Vehicle Miles Traveled: total miles driven, a measure
  of car dependence that good transit aims to reduce.
- **GTFS** <a id="gtfs"></a> — General Transit Feed Specification: the standard data
  format agencies publish routes and schedules in.

---

## Related

- [Start here](../tutorials/start-here.md) — the new-contributor on-ramp.
- [Writing docs](../standards/writing-docs.md) — how we keep docs this readable.
