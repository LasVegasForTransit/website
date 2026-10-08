# First-time setup

This tutorial gets a fresh website checkout ready for local work. Production maintenance is a
separate step for maintainers with provider access. You can edit pages and content without signing
in to Cloudflare or configuring the live site's integrations.

## Before you start

Install git, Node 24.20.0 or newer in the 24.x line, and pnpm 11.25.0. The exact supported versions
are recorded in the root `package.json`; `pnpm preflight` reports a mismatch.

You also need an editor and a terminal. For unfamiliar words, keep the
[glossary](../reference/glossary.md) open.

## Clone and bootstrap

```sh
git clone https://github.com/LasVegasForTransit/website.git
cd website
pnpm bootstrap
pnpm dev
```

Bootstrap installs the pinned packages, enables the commit hooks, and creates `apps/site/.env.local`
from its example. It preserves a local file you already have. Open `https://lvbt.localhost` after
the development server starts, then edit a page and watch it update. Press `Ctrl+C` to stop the
server.

If package installation reports a GitHub Packages authentication error, ask a maintainer for the
organization's package-read setup. The registry setting is already in `.npmrc`; keep credentials in
your personal package-manager configuration, never in this repository. A package-read credential is
separate from Cloudflare deployment access.

Bootstrap warnings about Beehiiv or Notion are expected on a new checkout. The page shell and
content preview work without those integrations. Membership submissions, the live press archive, and
transit news intake need test integration values only if you are working on those features. See
[local development](../reference/local-dev.md) for that setup.

## Check and share a change

Create a branch before editing:

```sh
git switch -c your-name/describe-the-change
```

Preview your change, run `pnpm check`, and fix anything it reports. Save the change with the
[atomic staging and commit workflow](../standards/git-guidelines.md), push your branch, and open a
pull request using the repository template. Ask a teammate to review it. See
[Start here](./start-here.md#5-saving-and-sharing-your-change) for the full contributor path.

A reviewed pull request merges into `main`. The staging workflow then saves a release and updates
`preview.lasvegasfortransit.org` behind Cloudflare Access. It does not publish to the public site. A
maintainer reviews that staging release and explicitly promotes it through `pnpm promote`.

## Maintainer production setup

Read existing readiness first:

```sh
pnpm preflight --production
```

The report checks [the platform manifest](../../apps/site/platform.json). Missing credentials or
provider access are named separately from missing resources. A maintainer can then run
`pnpm bootstrap --production` to work through missing platform configuration. This is not required
for contributing or running the local site. Agents do not create or change production credentials.

Routine publication uses the [deployment pipeline](../reference/deployment-pipeline.md); production
bootstrap does not deploy a new release. The [bootstrap reference](../reference/bootstrap.md)
explains setup and rotation, and [platform secrets](../reference/platform-secrets.md) explains what
each integration needs.
