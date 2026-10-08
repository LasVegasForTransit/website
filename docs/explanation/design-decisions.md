# Design decisions

Reusable repository behavior belongs in the shared LVBT repository standard. The website declares
local environment requirements in `.lvbt/tooling.json` and production requirements in
`apps/site/platform.json`; it does not maintain a separate setup engine. See the
[bootstrap reference](../reference/bootstrap.md).

## Local setup and production maintenance are separate

A contributor should be able to clone the website, run `pnpm bootstrap`, and edit a page without
Cloudflare permissions or credentials for every integration. Bootstrap installs dependencies,
enables git hooks, and seeds a missing local environment file. It preserves an existing file.
Preflight reads readiness and changes nothing. Production setup is an explicit maintainer operation
with `--production`; publishing a reviewed release uses explicit promotion.

The former website CLI's cross-phase environment persistence, synchronous DNS probes, repository
creation, and implicit first deployment were retired with that engine. Existing repository remotes
and private local settings are left in their owner's control.

## Prefer structured provider results

For reusable provider checks, compare structured API responses, stable error codes, and explicit CLI
exit statuses. English error messages can change with a release or locale. Put provider logic in
`LasVegasForTransit/repository-tooling` so every adopting repository gets the same correction.
Missing access must be reported as unknown rather than treated as a missing resource.

## Declare production requirements once

The platform manifest gives every runtime credential a purpose, its intended targets, and steps for
finding its value. Live requirements block readiness when absent; future requirements remain
separate. The unused Google service-account credentials are listed without setup or rotation
actions. Local sign-in code logging is forbidden in production.

The canonical Cloudflare project configuration is `apps/deploy/cloudflare.config.ts`. The Wrangler
mirror supports local development and explicit recovery. A Pages fallback is a deliberate recovery
operation, rather than an extra mandatory production secret target.
