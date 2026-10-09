# Bootstrap and preflight reference

Run these commands from the repository root. They come from the shared `@lasvegasfortransit/cli`
package, pinned by the repository standard. Website-specific requirements are data in
[`.lvbt/tooling.json`](../../.lvbt/tooling.json) and
[`apps/site/platform.json`](../../apps/site/platform.json).

## Local setup

```sh
pnpm bootstrap
pnpm preflight
pnpm dev
```

`pnpm bootstrap` installs the pinned dependencies, wires the git hooks, and creates
`apps/site/.env.local` from `apps/site/.env.example` when the local file is missing. An existing
local file is preserved. It finishes with a readiness report.

`pnpm preflight` only reads the checkout and reports missing tools, dependencies, and configuration.
It does not install packages, write files, sign in, or change GitHub or Cloudflare. Local
development needs no Cloudflare or GitHub provider login. Installing an organization package may
require an existing GitHub Packages read credential; see the
[first-time setup tutorial](../tutorials/first-time-setup.md).

All third-party integrations are optional for local page and content work. An empty integration
setting produces a warning that says which feature is unavailable. Ask a maintainer for a test
integration only when your task needs that feature. Do not copy production credentials into your
checkout.

## Production readiness

```sh
pnpm preflight --production
```

This reads the production platform manifest and checks the existing Worker, D1 database and
migrations, public-domain ownership, sending-domain DNS, declared credentials, and GitHub
environments and public build variables. Missing provider access produces an explicit unknown
status; it is not proof that a resource is absent.

A maintainer can run:

```sh
pnpm bootstrap --production
pnpm bootstrap --production --rotate LVBT_SIGN_IN_SECRET
```

Production bootstrap presents missing actions and asks before applying them. It preserves existing
credentials. `--rotate NAME` explicitly replaces the named credential, so read its consequences in
[platform secrets](./platform-secrets.md#replace-a-secret-on-purpose) first. A maintainer must
authorize the account, scopes, and destination before credential setup or rotation. An agent can
perform an authorized setup on their behalf. Ordinary publication uses the credentials already
installed in GitHub Actions and does not require local Cloudflare sign-in.

Production setup is separate from publication. Merging a reviewed pull request updates protected
staging. A team member with the required repository and Actions access can review that saved release
and run `pnpm promote`, or ask an agent to run it on their behalf. See the
[deployment pipeline](./deployment-pipeline.md). Bootstrap does not publish the website.

## Requirements and implementation

- `.lvbt/tooling.json` names the local environment example, destination, and optional integrations.
- `apps/site/platform.json` lists production resources, required and future credentials, how to find
  each value, and settings forbidden in production.
- `apps/deploy/cloudflare.config.ts` is the canonical Cloudflare project configuration. The
  `apps/site/wrangler.jsonc` mirror supports the local runtime and explicit recovery fallback.
  Regenerate it through the shared adapter with `pnpm -C apps/deploy compat:generate`; do not edit
  its bindings or routes separately.
- Reusable setup behavior belongs in `LasVegasForTransit/repository-tooling`, rather than another
  website setup engine. Update the standard through its normal release workflow.

The retired website flags `--phase`, `--resume`, `--local-only`, and `--redeploy` are no longer part
of setup. Use plain `pnpm bootstrap` for local work, `--production` for maintainers' platform setup,
and `pnpm promote` for an explicitly selected release.

## Related

- [Start here](../tutorials/start-here.md)
- [First-time setup](../tutorials/first-time-setup.md)
- [Local development](./local-dev.md)
- [Platform secrets](./platform-secrets.md)
