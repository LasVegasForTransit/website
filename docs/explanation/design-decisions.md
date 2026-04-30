# Design decisions

Choices that look weird at first but are deliberate. Documented here so future contributors know they're load-bearing, not oversights.

## Cross-phase coupling via `.env.local`

The bootstrap CLI's `domain` phase reads `process.env.CLOUDFLARE_PAGES_PROJECT` to recover values that the `deploy` phase set. This looks like sloppy global state.

**Why it's deliberate:** `.env.local` is the explicit persistence layer between phases. `cold-start.ts` hydrates `process.env` from it at startup, so individual phases stay decoupled — they don't need to know which earlier phase wrote a value, or to be invoked through a typed state container.

The alternative (passing a typed state object through the orchestrator into every phase) was considered. For a 7-phase one-shot CLI it's over-engineered. If the bootstrap grows another five phases or starts running concurrently, revisit.

Inline reminder: top of `runDomainPhase` in `scripts/bootstrap/phases/domain.ts`.

## Synchronous `spawnSync` in `runDigCheck`

`runDigCheck` makes three sequential `spawnSync` calls (`command -v dig` + two `dig +short` lookups) inside what is otherwise an async/await flow.

**Why it's deliberate:** This is a one-shot CLI on a finished spinner. Three blocking calls total a few hundred milliseconds — the user's eye can't tell the difference between async and sync at that scale, and the simpler control flow is worth keeping. If we ever need to run the bootstrap as a long-lived service or under heavy concurrent load, revisit.

Inline reminder: top of `runDigCheck` in `scripts/bootstrap/phases/domain.ts`.

## Don't scrape English error messages

When detecting specific failures from `gh`, `wrangler`, or any external CLI, we never match on English error text. Two reasons:

1. Locale-dependent — `LANG=de_DE` breaks our detection.
2. Unstable — vendors rephrase error messages between minor versions without warning.

What we use instead, in priority order:

1. **Exit codes.** Treat non-zero as "couldn't do the thing." Surface raw stderr to the user verbatim.
2. **Numeric error codes** from API responses (e.g. Cloudflare's `8000002` = "Pages project name taken"). These are stable contracts. We export them as `CF_ERROR.*` constants in `lib/cloudflare-api.ts`.
3. **Structured JSON output** from CLIs that support `--json`. Parse, branch on shape.

The deploy phase's "already exists" branch is one place where we still match a numeric code inside wrangler's text stderr — that's a regrettable necessity (wrangler doesn't expose a JSON error path for `pages project create`), but the matched substring is a stable Cloudflare error code, not English prose.

## SSH origin URLs by default

`gh repo create` is invoked without `--source/--remote/--push` so the bootstrap can wire `origin` to the SSH URL (`git@github.com:owner/repo.git`) ourselves. For existing repos, we use `gh repo view --json sshUrl` and add the SSH URL as `origin`.

**Why:** This matches the user's GitHub auth pattern (SSH key, not HTTPS token). HTTPS would either prompt for credentials or rely on `gh`'s token, neither of which fits a pushed-from-CLI workflow. If SSH push fails (no key on GitHub), the raw error gets surfaced — we don't silently fall back to HTTPS.

Also documented at the user-global level in `~/.claude/CLAUDE.md` under "Git remotes."
