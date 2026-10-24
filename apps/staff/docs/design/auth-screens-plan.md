# Staff Auth Screens Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Standardize all staff authentication and gate screens around one coherent design.

**Architecture:** One shared self-contained gate stylesheet and identity serve an Astro layout and
standalone response HTML. Authentication handlers retain their current contracts.

**Tech Stack:** Astro, TypeScript, existing brand tokens, native forms, Playwright, Miniflare.

**Spec:** [Staff authentication and gate screens](auth-screens.md).

## Global Constraints

- Preserve authentication, authorization, redirects, cookies, HTTP status codes, form contracts, and
  privacy headers.
- Recovery pages must remain usable without scripts, database access, fonts, or image requests.
- Use ordinary HTML forms and avoid animation or new dependencies.
- Leave changes uncommitted until explicitly authorized.

## Review Focus

- Long email addresses wrap without widening the page.
- Expired or rejected confirmation retains clear recovery and existing HTTP semantics.
- All actions remain reachable with keyboard and JavaScript disabled.
- Dark mode preserves legible text and the correct brand mark.
- Outages retain matching CSP hashes and usable embedded branding.

## Task 1: Shared gate presentation

**Files:** `src/lib/gate-page.ts`, `src/layouts/StaffGateLayout.astro`, `src/lib/message-page.ts`,
`src/layouts/StaffLayout.astro` (relative to apps/staff).

**Interfaces:** Export `gatePageStyles`, `gateIdentity`, and `gateFooter` from gate-page.ts. The
Astro layout accepts a title and default, notice, and help slots. Response HTML uses the same styles
and identity without requesting assets.

- [ ] Implement the common stylesheet, identity, footer, and gate layout.
- [ ] Migrate standalone responses and remove the obsolete signIn branch of StaffLayout.
- [ ] Run existing response/privacy tests and `pnpm check`.

## Task 2: Authentication screens

**Files:** `src/pages/sign-in/index.astro`, `src/pages/sign-in/link-account.astro`,
`src/pages/sign-in/initial-admin.astro`.

**Interfaces:** Consume StaffGateLayout and the existing form actions, fields, and error results.

- [ ] Migrate sign-in, email/code confirmation, and setup screens; retain server contracts.
- [ ] Run `pnpm check` and compiled Google sign-in, initial-admin, and recovery acceptance.
- [ ] Review rendered mobile/desktop and light/dark states, keyboard focus, and long emails.
