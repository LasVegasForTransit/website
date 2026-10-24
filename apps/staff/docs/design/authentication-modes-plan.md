# Optional staff SSO implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development or
> superpowers:executing-plans to implement these tasks with security tests and a final independent
> review.

**Goal:** Reuse verified SSO without a second Google sign-in, retain direct Google authentication,
and show both finished flows in a screenshot report.

**Architecture:** Explicit deployment configuration selects the authentication adapter.
Provider-scoped links and sessions preserve application membership and role authorization
independently of real Google provisioning identities.

**Tech Stack:** Astro, TypeScript, SQLite/D1, Cloudflare Workers, jose, Node test runner,
Playwright.

**Spec:** [Approved authentication design](authentication-modes.md).

## Global Constraints

- Default to `cloudflare-access`; accept explicit `google`; invalid modes fail closed.
- Never use Access subjects as Google subjects, link by email alone, or fall back on missing Access
  headers.
- Preserve current membership, role, browser-binding, same-origin, privacy, and erasure protections.
- Authentication portability does not imply portability of the entire Workers runtime.
- Do not commit, push, deploy, or change live provider settings.
- Run `pnpm check` after changes; keep earlier uncommitted improvements.

## Review Focus

- A revoked or erased principal cannot renew or enroll again through email confirmation.
- Mode switches reject sessions from the other provider while retaining genuine Google IDs.
- Expired POST requests must not replay a mutation after authentication.
- Sign-out must remain effective while an SSO assertion remains present.
- Merge, undo, and erasure must retain principal ownership and prevent snapshot restoration of
  personal data.

## Task 1: Provider identity storage and lifecycle

**Files:** New `packages/platform-storage/src/staff-sso.ts`, migration `0055_staff_sso.sql`, storage
exports and security tests; existing merge, erasure, staff roles, and permissions modules as
required.

**Interfaces:** Export
`SsoPrincipal { issuer: string; subject: string; email: string; expiresAt: Date }`;
`createSsoSession(env, principal, now?)`, `readSsoSession(env, token, principal, now?)`, and
`SsoLinkService` with `begin(principal, {returnTo, now?})`, `pending(token, now?)`,
`requestCode(token, input)`, `complete(token, input)` mirroring WorkspaceLinkService. Pending
records expose `workspace_email` for shared presentation. Session results use existing
`{token, expiresAt}` and read results include personId and verified principal. Export
principal-bound bootstrap support. Preserve `workspaceLinked` semantics and add a separate
organizational sign-in fact for admission.

- [ ] Write and run failing tests for verified principal linkage, membership confirmation,
      conflicting ownership, expired credentials, revocation, erasure, merge/undo, sessions, and
      initial administrator bootstrap.
- [ ] Implement provider-scoped unique links, pending confirmations and session provenance;
      tombstone revoked links. Keep Google identity records intact.
- [ ] Integrate lifecycle guards and admission without changing provisioning facts.
- [ ] Run storage and core tests, typechecks, and `pnpm check`; inspect failures and repair those
      caused by this task.

## Task 2: Deployment adapters and app flows

**Files:** Staff gateway, middleware, context, initial admin, sign-in routes, membership page
handler, sign-out; Access verifier; Google origin/callback logic; auth tests.

**Interfaces:** `staffAuthMode(env)` returns selected mode or invalid; `staffOriginAllowed` accepts
explicit canonical HTTPS origin and configured approved previews. Access verifier exposes issuer and
credential expiry. App adapter consumes Task 1 exports. Direct Google keeps existing OAuth and
membership-link services.

- [ ] Write and run failing tests for missing/invalid mode, Access verification failures, direct
      Google without Access, provider mismatch, automatic GET continuation, missing-session POST
      rejection, logout marker and explicit same-origin continuation.
- [ ] Implement adapters and shared page routing; block Google endpoints in Access mode. Unknown
      Access principal enters membership confirmation once; known principal enters authorized
      destination.
- [ ] Adapt initial administrator to selected verified principal and approved president email;
      retain single-use and active membership guards.
- [ ] Add signed logout marker and explicit continuation UI, mode-appropriate labels and errors.
- [ ] Run app tests, storage tests, compiled runtime authentication tests and `pnpm check`.

## Task 3: Operator setup and release configuration

**Files:** Staff environment example, wrangler configuration, preflight/release scripts and tests,
operator authentication guide.

**Interfaces:** `LVBT_STAFF_AUTH_MODE`, `LVBT_STAFF_ORIGIN`, `LVBT_STAFF_PREVIEW_ORIGINS`; selected
mode determines required Access or Google credentials. Production and preview remain explicitly
Access.

- [ ] Write and run failing configuration tests for both modes, invalid mode, canonical origin,
      missing selected credentials and absence of unused credentials.
- [ ] Update configuration, preflight and release validation to enforce selected mode and document
      setup, switching, rollback, revocation and logout.
- [ ] Run configuration tests and `pnpm check`.

## Task 4: Rendered acceptance and artifact report

**Files:** Compiled-runtime authentication fixture/tests and a local screenshot flow report outside
repository source.

**Interfaces:** Both runtime modes use deterministic fictional members, stub provider transport,
real compiled app and migrated database. Report embeds actual screenshots and distinguishes local
acceptance from deployed provider acceptance.

- [ ] Exercise both modes through membership email/code, authorized destination, sign-out and
      continuation; exercise denied, expired and configuration failure states.
- [ ] Capture desktop/mobile and light/dark screenshots; inspect complete rendered flows, focus,
      overflow and accessible controls.
- [ ] Produce an HTML or Markdown report with ordered screenshot flows and verification scope.
- [ ] Run final `pnpm check`, independent whole-change review, fix actionable findings with
      regression tests, and verify final artifacts.
