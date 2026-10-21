# lasvegasfortransit.org

This repository contains the website and membership tools for **Las Vegans for Better Transit**. Use
it to edit public pages, improve the member and staff tools, or help with tests and documentation.

<a id="getting-started"></a>

## Start here

Read [Start here](./docs/tutorials/start-here.md) if this is your first contribution. The
[first-time setup guide](./docs/tutorials/first-time-setup.md) covers the tools you need before
running these commands from the repository root:

```sh
pnpm bootstrap # install dependencies and prepare local settings
pnpm dev       # open the local site at https://lvbt.localhost
```

You can edit pages and content without signing in to Cloudflare, Beehiiv, or Notion. Some features
that use those services need separate setup. Local setup preserves settings you already have.

Before submitting a change, run:

```sh
pnpm check
```

This runs the checks used by GitHub, including formatting, documentation links, code checks, tests,
and the build. Use `pnpm check:fix` for automatic formatting and lint fixes. If setup fails, run
`pnpm preflight` to find missing requirements.

<a id="editing-content"></a>

<a id="adding-an-event"></a>

## Choose a task

| You want to…                     | Start with…                                                                                                                 |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Edit a public page or article    | [Edit a long-form page](./docs/guides/edit-a-long-form-doc.md) and [content files](./docs/reference/content-collections.md) |
| Add an event                     | [Add an event](./docs/guides/add-an-event.md). Events start in Google Calendar.                                             |
| Add a project                    | [Add a project](./docs/guides/add-a-project.md)                                                                             |
| Change member or staff features  | [Platform design](./docs/explanation/decisions/organizing-platform.md)                                                      |
| Change scheduled background work | [Jobs README](./apps/jobs/README.md)                                                                                        |
| Run browser or screenshot tests  | [Test guide](./apps/site/tests/README.md)                                                                                   |
| Publish or recover a release     | [Deployment reference](./docs/reference/deployment-pipeline.md)                                                             |

The [docs index](./docs/README.md) lists the full set of guides. The
[glossary](./docs/reference/glossary.md) explains unfamiliar terms. You do not need to read every
operator reference before making a small contribution.

<a id="project-structure"></a>

<a id="stack"></a>

## Find the code

The repository has three applications and shared code:

```text
apps/site/                  Public website and member pages
  src/content/              Editable Markdown, MDX, and JSON content
  src/pages/                Page routes
  src/components/           Reusable page elements
  functions/                Server routes for forms, sign-in, and other requests
  public/                   Images, fonts, and other public files
apps/staff/                 Private staff tools
apps/jobs/                  Scheduled membership and cleanup work
packages/platform-core/     Membership rules and shared messages
packages/platform-storage/  Database queries and numbered schema changes
packages/platform-integrations/  Connections to outside services
docs/                       Contributor guides and operator references
.lvbt/                      Shared repository tools; do not edit the vendored standard
```

[Astro](./docs/reference/glossary.md#astro) builds the pages. Markdown and
[MDX](./docs/reference/glossary.md#mdx) hold most editable content.
[Tailwind](./docs/reference/glossary.md#tailwind) supplies styling classes. Cloudflare Workers
serves the applications. See the [design system](./docs/explanation/design-system.md) before
changing colors, typography, or shared styles.

<a id="day-to-day-commands"></a>

## Useful commands

Run these from the repository root:

| Command          | What it does                                       |
| ---------------- | -------------------------------------------------- |
| `pnpm dev`       | Start the site locally at <https://lvbt.localhost> |
| `pnpm build`     | Build the applications and their server code       |
| `pnpm preview`   | Build and serve a local preview                    |
| `pnpm check`     | Run the required repository checks                 |
| `pnpm test`      | Run unit tests                                     |
| `pnpm test:e2e`  | Run browser tests, including screenshots           |
| `pnpm preflight` | Check local setup without changing it              |

For a command belonging to one application, use `pnpm -C apps/site <command>`, or replace
`apps/site` with the application you are working on. Its `package.json` lists its commands.

<a id="deployment"></a>

<a id="cicd"></a>

## Submit and publish changes

Work on a branch and open a pull request. Follow the [Git guide](./docs/standards/git-guidelines.md)
and [commit message rules](./docs/standards/commit-messages.md). GitHub checks the change before it
can merge.

An explicit or scheduled **Deploy staging** run updates `preview.lasvegasfortransit.org`. Merging
alone does not deploy. A maintainer separately selects a saved, checked release to publish at
`lasvegasfortransit.org`. A build or merge alone does not publish the public website. Pull requests
from this repository receive their own protected previews. See the
[deployment reference](./docs/reference/deployment-pipeline.md) for credentials, verification, and
recovery.

<a id="setup-and-production-readiness"></a>

Production setup is also separate from publishing. `pnpm preflight --production` checks readiness;
an authorized maintainer uses `pnpm bootstrap --production` to configure missing requirements.
Neither command replaces the release workflow. See the
[setup reference](./docs/reference/bootstrap.md).

## License

Site code uses the MIT license. Editorial content, including LVBT's vision and strategy, remains all
rights reserved by Las Vegans for Better Transit.
