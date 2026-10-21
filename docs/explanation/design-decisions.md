# Design decisions

Contributors who change setup or deployment should keep shared behavior in the LVBT repository
standard. This page explains which setup rules belong there and which settings belong to this site.
The website declares local environment requirements in `.lvbt/tooling.json` and production
requirements in `apps/site/platform.json`; it does not maintain a separate setup engine. See the
[bootstrap reference](../reference/bootstrap.md).

## Local setup and production maintenance are separate

A contributor should be able to clone the website, run `pnpm bootstrap`, and edit a page without
Cloudflare permissions or credentials for every integration. Bootstrap installs required packages,
enables automatic commit checks, and creates a missing local settings file. It preserves an existing
file. Preflight checks setup and changes nothing. Production setup is an explicit maintainer
operation with `--production`; publishing a reviewed release uses explicit promotion.

The retired website setup tool used to carry settings between setup stages, check domain names,
create repositories, and deploy automatically. The shared tool does not retain those behaviors.
Existing repository remotes and private local settings are left in their owner's control.

## Prefer structured provider results

When checking an outside service, read its structured response fields, error codes, and the
command's success or failure status. English error messages can change with a release or locale. Put
provider logic in `LasVegasForTransit/repository-tooling` so every adopting repository gets the same
correction. Missing access must be reported as unknown rather than treated as a missing resource.

## Declare production requirements once

`apps/site/platform.json`, the platform manifest, names each credential the running application
needs, where to store it, and how to find its value. Live requirements block readiness when absent;
future requirements remain separate. The unused Google service-account credentials are listed
without setup or rotation actions. Local sign-in code logging is forbidden in production.

The main Cloudflare project configuration is `apps/deploy/cloudflare.config.ts`. The Wrangler copy
supports local development and explicit recovery. A Pages fallback is a deliberate recovery
operation, rather than an extra mandatory production secret target.
