# Bootstrap CLI reference

A multi-phase TypeScript CLI that walks the LVBT website from a fresh checkout to a deployed site. Source: `scripts/bootstrap/`.

For the narrative walk-through, see [tutorials/first-time-setup.md](../tutorials/first-time-setup.md).

## Commands

```sh
pnpm bootstrap              # full interactive setup
pnpm preflight              # read-only readiness check (no changes)
pnpm bootstrap --resume     # skip phases that already completed
pnpm bootstrap --local-only # run only install/workspace/env (no GitHub or Cloudflare)
pnpm bootstrap --phase <id> # run a single phase
```

## Phases (in order)

| Phase       | What it does                                                                                        |
| ----------- | --------------------------------------------------------------------------------------------------- |
| `install`   | Verifies Node ≥22, pnpm ≥10, GitHub CLI, Cloudflare Wrangler, dig — offers to install missing tools |
| `auth`      | Confirms `gh auth status` and `wrangler whoami`                                                     |
| `workspace` | Runs `pnpm install --frozen-lockfile` and a `pnpm build` smoke test                                 |
| `env`       | Creates `.env.local` from `.env.example`; prompts for live `PUBLIC_LVBT_*` URLs                     |
| `repo`      | Creates a GitHub repo via `gh repo create` and wires `origin` to the SSH URL                        |
| `deploy`    | Provisions a Cloudflare Pages project and deploys `./dist`                                          |
| `domain`    | Attaches apex + www to the Pages project; auto-creates DNS via the Cloudflare API                   |

## State file

`.lvbt/dev-readiness.json` tracks per-phase status (`complete | partial | failed | skipped`) and per-tool readiness. `--resume` reads this file and skips phases marked `complete`.

`.env.local` doubles as the cross-phase persistence layer for values that need to survive between phases (e.g. `CLOUDFLARE_PAGES_PROJECT`, `CLOUDFLARE_ACCOUNT_ID`). `cold-start.ts` hydrates `process.env` from it at startup.

## Defaults

| Knob                     | Default                                   | Override                                     |
| ------------------------ | ----------------------------------------- | -------------------------------------------- |
| GitHub repo              | `<parent-dir>/<dir>` (filesystem-derived) | Prompt accepts `<owner>/<name>`              |
| GitHub visibility        | public                                    | Prompt                                       |
| Cloudflare Pages project | `lvbt-website`                            | `CLOUDFLARE_PAGES_PROJECT` env var or prompt |
| Production branch        | `main`                                    | `CLOUDFLARE_PAGES_BRANCH` env var or prompt  |
| Apex domain              | `lasvegasfortransit.org`                  | `LVBT_DOMAIN` env var or prompt              |
| Cloudflare account       | auto-selected if only one                 | `CLOUDFLARE_ACCOUNT_ID` env var or prompt    |

## Adding a new phase

1. Create a module at `scripts/bootstrap/phases/<name>.ts` that exports `run<Name>Phase(projectRoot, doctorMode): Promise<PhaseResult>`.
2. Add the id to `PhaseId` in `scripts/bootstrap/lib/types.ts`.
3. Register the phase in `PHASE_ORDER` and `PHASE_INFO` in `scripts/bootstrap/cold-start.ts`, and add a case to `runPhaseById`.
4. Each phase returns `{ success, followUpItems[] }`. Follow-up `kind` is `'local' | 'auth' | 'remote'`.

## Implementation notes

- Output uses `@clack/prompts` for boxed notes/spinners and `picocolors` for highlight color.
- Shared helpers: `lib/shell.ts` (subprocess + shell-escape), `lib/ui.ts` (prompt wrappers + tool tables), `lib/env-file.ts` (`.env` parsing/merge), `lib/validators.ts` (shared `text({ validate })` validators), `lib/cloudflare-api.ts` (REST client + OAuth-token reader).
- We intentionally do **not** scrape English error strings from CLI output. Where we need to detect a specific failure (e.g. "Pages project name taken"), we look for the stable Cloudflare numeric error code (`CF_ERROR.PAGES_PROJECT_NAME_TAKEN = 8000002`).
