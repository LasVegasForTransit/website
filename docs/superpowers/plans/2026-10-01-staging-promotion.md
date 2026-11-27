# Website Staging and Promotion Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deploy reviewed website releases through protected staging and explicit production
promotion.

**Architecture:** Reuse the existing preview Worker as persistent staging. Store one verified
release artifact per successful main build and deploy its unchanged files with environment-specific
bindings. Actions dispatch selects the originating run rather than the latest staging build.

**Tech Stack:** TypeScript, Node.js, GitHub Actions, Cloudflare Workers, D1, Cloudflare Access.

**Spec:** [Staging and promotion](../specs/2026-10-01-staging-promotion.md).

## Global constraints

- Preserve unrelated work; use an isolated branch; obtain explicit approval before committing.
- Run `pnpm check` for each completed change set.
- Never expose staging before Access is configured.
- Keep secrets out of logs and release artifacts; production and staging data stay separate.
- Reuse reviewed code and assets without rebuilding during promotion.

## Review focus

- Newer staging builds must not change an already selected release.
- Missing, added, changed, or symlinked files must invalidate a release.
- Access credentials must not reach third-party requests or redirected origins.
- Production must exclude preview-only routes and retain production analytics.
- An arbitrary PR run or failed staging run must not be eligible for production promotion.

## Tasks

### Task 1: Immutable releases

- [ ] Add failing tests for artifact verification, source identity, and tampering.
- [ ] Implement `scripts/deploy/release-artifact.ts` and the `worker:release` command.
- [ ] Package assets, compiled Worker, and configuration contract with a verified inventory.
- [ ] Run focused tests and `pnpm check`.

### Task 2: Environment behavior and authenticated verification

- [ ] Add tests for preview response headers and origin-scoped credentials.
- [ ] Add runtime middleware, explicit staging configuration, and an authenticated smoke command.
- [ ] Integrate Access credentials into browser checks without leaking them to other origins.
- [ ] Run focused tests and `pnpm check`.

### Task 3: Staging and promotion workflows

- [ ] Replace automatic production activation with staging deployment and release artifact storage.
- [ ] Add a dispatch workflow validating the selected successful main staging run.
- [ ] Download and verify its saved artifact; upload and test a production candidate; activate its
      ID.
- [ ] Update workflow tests and deployment documentation; run `pnpm check`.

### Task 4: Live provisioning and acceptance

- [ ] Inspect existing Access identities, policies, and credentials; configure the narrow preview
      scope.
- [ ] Attach `preview.lasvegasfortransit.org` to the protected staging Worker.
- [ ] Deploy and verify anonymous denial, authorized page rendering, and release identity.
- [ ] Review the diff and surface the proposed commit for the repository's required approval.

## Execution ledger

- Worktree: `/Users/williecubed/.codex/worktrees/website/staging-promotion`.
- Base: `66c0957`, current `origin/main` when implementation started.
- Ruling: reuse persistent Worker environments for the default staging hostname. Native branch
  Previews can be adopted separately; this work does not require upgrading the shared Wrangler
  catalog.
