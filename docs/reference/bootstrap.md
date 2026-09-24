# Bootstrap CLI reference

`pnpm bootstrap` checks the local toolchain, the website repository, and the production Cloudflare resources in sequence. It provisions missing resources after confirmation and leaves existing deployments alone. The implementation lives in `scripts/bootstrap/`.

For the narrative walk-through, see [tutorials/first-time-setup.md](../tutorials/first-time-setup.md).

## Before you start

The remote phases require access to the LVBT GitHub organization and Cloudflare account. The `install` and `auth` phases check the required tools and sign-ins:

- A **GitHub account** with an [SSH key set up](./glossary.md#ssh) — the `repo`
  phase pushes over SSH.
- Access to the **LVBT Cloudflare account** — the `deploy` and `domain` phases use it.
- [`gh`](./glossary.md#gh) (GitHub's CLI) and [`wrangler`](./glossary.md#wrangler)
  (Cloudflare's CLI), installed and logged in.

Just want to run the site locally? `pnpm bootstrap --local-only` skips everything
above (no GitHub or Cloudflare needed).

## Commands

```sh
pnpm bootstrap                             # full interactive setup
pnpm preflight                             # read-only readiness check (no changes)
pnpm bootstrap --resume                    # skip phases that already completed
pnpm bootstrap --local-only                # run only install/workspace/env (no GitHub or Cloudflare)
pnpm bootstrap --phase <id>                # run a single phase
pnpm bootstrap --phase deploy --redeploy   # build and push the site to production again
pnpm bootstrap --phase secrets --rotate LVBT_SIGN_IN_SECRET   # replace secrets that are already set
```

**`--resume` vs `--phase`:** use `--resume` to continue a setup that stopped partway — it runs every phase _except_ the ones already marked complete in the state file (below). Use `--phase <id>` when you want to re-run exactly one named phase (e.g. `--phase deploy`), regardless of whether it already completed. Plain `pnpm bootstrap` is also fine for continuing: every phase checks first, so the finished ones just report that they are ready.

## Running it again is safe

The bootstrap is [idempotent](./glossary.md#idempotent): each phase reads current state before making a change. On a finished setup, a second run reports every phase as ready. It:

- never asks for, generates or replaces a secret that is already stored;
- never creates a duplicate Worker deployment or domain attachment;
- never pushes the site to production again;
- never rewrites `.env.local` or `wrangler.jsonc` when nothing in them changes.

Here is what each phase checks, and what it does only when something is missing:

| Phase       | Checks first                                              | Changes only when missing                                                  |
| ----------- | --------------------------------------------------------- | -------------------------------------------------------------------------- |
| `install`   | Whether each tool is installed and new enough             | Offers to install the missing tool                                         |
| `auth`      | `gh auth status` and `wrangler whoami`                    | Offers to sign in                                                          |
| `workspace` | Nothing remote                                            | Always runs `pnpm install --frozen-lockfile` and a `pnpm build` smoke test |
| `env`       | Which `.env.local` values are empty or placeholders       | Asks only for those, and writes only the ones you fill in                  |
| `repo`      | Whether `origin` is already set                           | Creates or connects the GitHub repository and pushes                       |
| `deploy`    | Whether `lvbt-website` has a production Worker deployment | Builds and deploys the Worker after confirmation                           |
| `domain`    | Whether apex and `www` route to the production Worker     | Attaches missing Worker custom domains after confirmation                  |
| `secrets`   | Which secrets each target already has                     | Asks for each missing secret once and stores it only where it is missing   |

Replacing something that already exists is always your explicit choice, never a default:

- `--redeploy` builds and deploys this checkout to the production Worker even when it already has a deployment. Routine releases go through the GitHub Actions pipeline instead.
- `--rotate NAME[,NAME]` replaces the named secrets everywhere they are stored. See [replace a secret on purpose](./platform-secrets.md#replace-a-secret-on-purpose).

### Picking up after a partial run

If a run stops partway, run it again. Each phase checks GitHub, Cloudflare, or local state before acting. A failed Worker deployment is retried without reattaching domains; a skipped secret is asked for on the next run.

The summary at the end lists any phase that is not finished as `partial`, with the `pnpm bootstrap --phase <id>` command that finishes it.

## Phases (in order)

The setup runs as a sequence of _phases_ — self-contained steps that each get you closer to a live site, from checking your tools (`install`) through installing dependencies (`workspace`), writing config (`env`), and finally creating the GitHub repo and Cloudflare deployment. They run top to bottom; later phases assume earlier ones succeeded.

| Phase       | What it does                                                                                                                                                                       |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `install`   | Verifies Node ≥24.18.0, pnpm ≥10, [GitHub CLI](./glossary.md#gh), [Cloudflare Wrangler](./glossary.md#wrangler), [`dig`](./glossary.md#dig) — offers to install missing tools      |
| `auth`      | Confirms `gh auth status` and `wrangler whoami`                                                                                                                                    |
| `workspace` | Runs `pnpm install --frozen-lockfile` (installs the exact pinned versions from the [lockfile](./glossary.md#lockfile); fails instead of updating it) and a `pnpm build` smoke test |
| `env`       | Creates `.env.local` from `.env.example`; prompts for values that are still placeholders. These are for your machine only                                                          |
| `repo`      | Creates a GitHub repo via `gh repo create` and wires `origin` to the [SSH URL](./glossary.md#ssh)                                                                                  |
| `deploy`    | Checks for a production `lvbt-website` Worker deployment and builds and deploys one when absent                                                                                    |
| `domain`    | Confirms that the [apex](./glossary.md#apex-domain) and `www` hostnames belong to that Worker; attaches missing custom domains through the Cloudflare API                          |
| `secrets`   | Reports server-side secrets missing from the Worker, Pages fallback and GitHub, asks for each once, and stores it where needed — see [platform secrets](./platform-secrets.md)     |

The `env` phase never touches production. The server-side values in `.env.local` (Beehiiv, Notion, and a random intake secret for testing) are only for `pnpm dev` and local scripts. The live site gets its secrets from the `secrets` phase, and its public `PUBLIC_LVBT_*` values from GitHub Actions variables (the repository's Settings → Secrets and variables → Actions → Variables tab).

### Production domains

The checked-in `scripts/bootstrap/config/production-hosting.json` selects Worker hosting. Bootstrap stops before any phase if this file is missing or invalid. The domain phase checks `lasvegasfortransit.org` and `www.lasvegasfortransit.org` through Cloudflare's Worker-domain API. It leaves a hostname owned by another Worker untouched. Cloudflare creates the DNS record and certificate when a missing custom domain is attached; the phase never writes a Pages CNAME.

The prior Pages deployment remains reachable at its `pages.dev` address for emergency recovery. Restoring its public hostnames is a separate, deliberate [rollback operation](./deployment-pipeline.md#rollback).

## State file

The bootstrap keeps a record of its last run in `.lvbt/dev-readiness.json` (a local, git-ignored file in the `.lvbt/` folder). It holds per-phase status (`complete | partial | failed | skipped`), per-tool readiness, setup steps you confirmed that bootstrap cannot check for itself, such as creating the staff console's Google Group, so it asks about each of those only once, and the last value it stored for each platform secret that is not a credential (an ID, a domain or a public key), so the `secrets` phase can show it back. It never holds a credential. `--resume` reads this file and skips phases marked `complete`. The file is rewritten at the end of every run with fresh timestamps; that is expected, because it is a run record, not configuration.

`.env.local` keeps local values that survive between phases, including the selected `CLOUDFLARE_ACCOUNT_ID`. `run.ts` loads it at startup and writes a value only when it changes. Hosting mode comes from the tracked production-hosting configuration, not from a local environment variable.

## Defaults

| Knob               | Default                                   | Override                                           |
| ------------------ | ----------------------------------------- | -------------------------------------------------- |
| GitHub repo        | `<parent-dir>/<dir>` (filesystem-derived) | Prompt accepts `<owner>/<name>`                    |
| GitHub visibility  | public                                    | Prompt                                             |
| Production Worker  | `lvbt-website`                            | Set in `scripts/bootstrap/lib/defaults.ts`         |
| Production branch  | `main`                                    | GitHub Actions workflow                            |
| Public hostnames   | apex and `www.lasvegasfortransit.org`     | Set in `scripts/bootstrap/phases/worker-domain.ts` |
| Cloudflare account | auto-selected if only one                 | `CLOUDFLARE_ACCOUNT_ID` env var or prompt          |

## Adding a new phase

1. Create a module at `scripts/bootstrap/phases/<name>.ts` that exports `run<Name>Phase(projectRoot, doctorMode): Promise<PhaseResult>`.
2. Add the id to `PhaseId` in `scripts/bootstrap/lib/types.ts`.
3. Register the phase in the `PHASES` list in `scripts/bootstrap/run.ts`, and add a case to `runPhaseById`.
4. Each phase returns `{ success, followUpItems[] }`. Follow-up `kind` is `'local' | 'auth' | 'remote'`. Return `success: true` only when the phase's part of the setup is finished.
5. Check before you act: read the current state first and change only what is missing. Anything that replaces an existing value needs its own opt-in flag.
6. Make every command, API call, prompt and secret write through the helpers in `lib/` (they go through the runtime described below), and teach the fake world in `tests/bootstrap-fake-world.ts` to answer the new calls. The whole-bootstrap test then checks that your phase changes nothing on a second run.

## Writing guided steps

When the bootstrap sends someone to a dashboard, its steps name every button, field and toggle exactly as the service shows them, and say what to type or choose in each. Order the steps so each copied value is pasted where it goes (the bootstrap prompt, a dashboard field, a file or a browser) before anything else is copied; when a value goes to two places, have the person paste it into both first. Anything LVBT owns in another service belongs to an LVBT organization, team or group, never a personal account. The secret guides live in `scripts/bootstrap/config/platform-secrets.ts`.

## Implementation notes

- `cold-start.ts` is the command-line entry point; `run.ts` holds the phase list and the flow as a function, `runBootstrap`.
- Every side effect goes through one replaceable runtime in `lib/runtime.ts`: shell commands, secret writes (value on standard input, never on the command line), Cloudflare API calls, DNS lookups, prompts and the browser opener. Production uses `lib/process-runtime.ts`. `tests/bootstrap-idempotency.test.ts` installs a fake one and runs the whole bootstrap twice, checking that the second run makes no changes, asks for no secret, leaves config files byte-for-byte unchanged, and never prints a secret value.
- Output uses `@clack/prompts` for boxed notes/spinners and `picocolors` for highlight color.
- Shared helpers: `lib/shell.ts` (subprocess + shell-escape), `lib/ui.ts` (prompt wrappers + tool tables), `lib/env-file.ts` (`.env` parsing/merge), `lib/validators.ts` (shared validators), `lib/cloudflare-api.ts` (REST client).
- We intentionally do **not** scrape English error strings from CLI output. Where we need to detect a specific failure (e.g. "Pages project name taken"), we look for the stable Cloudflare numeric error code (`CF_ERROR.PAGES_PROJECT_NAME_TAKEN = 8000002`).
