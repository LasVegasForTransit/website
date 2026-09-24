# Bootstrap CLI reference

The bootstrap CLI is the one command that sets up the whole project for you. It exists so a new contributor doesn't have to run a dozen manual steps (install tools, create accounts, wire up GitHub and Cloudflare) by hand and in the right order — it does them in sequence and checks what's already done. It's a multi-phase CLI (command-line tool, run in your terminal) written in TypeScript (JavaScript with type labels — see [glossary](./glossary.md#typescript)) that walks the LVBT website from a fresh checkout to a deployed site. Source: `scripts/bootstrap/`.

For the narrative walk-through, see [tutorials/first-time-setup.md](../tutorials/first-time-setup.md).

## Before you start

The full setup (through the `deploy` and `domain` phases) needs a few accounts and
tools. The `install` and `auth` phases check these for you, but it's smoother to
have them ready:

- A **GitHub account** with an [SSH key set up](./glossary.md#ssh) — the `repo`
  phase pushes over SSH.
- A **Cloudflare account** — the `deploy` and `domain` phases use it.
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

The bootstrap is [idempotent](./glossary.md#idempotent): every step checks what already exists, then does only what is missing. You can run it on a finished setup at any time. It changes nothing and reports every phase as ready. In particular, a re-run:

- never asks for, generates or replaces a secret that is already stored;
- never creates a second Pages project, domain attachment or DNS record;
- never pushes the site to production again;
- never rewrites `.env.local` or `wrangler.jsonc` when nothing in them changes.

Here is what each phase checks, and what it does only when something is missing:

| Phase       | Checks first                                                                  | Changes only when missing                                                  |
| ----------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `install`   | Whether each tool is installed and new enough                                 | Offers to install the missing tool                                         |
| `auth`      | `gh auth status` and `wrangler whoami`                                        | Offers to sign in                                                          |
| `workspace` | Nothing remote                                                                | Always runs `pnpm install --frozen-lockfile` and a `pnpm build` smoke test |
| `env`       | Which `.env.local` values are still empty or placeholders                     | Asks only for those, and writes only the ones you fill in                  |
| `repo`      | Whether `origin` is already set                                               | Creates or connects the GitHub repository and pushes                       |
| `deploy`    | Whether the Pages project exists and has a production deployment              | Creates the project and pushes `./dist` as its first deployment            |
| `domain`    | Which hosts are attached to the Pages project, and which CNAMEs already exist | Attaches only unattached hosts and writes only missing CNAMEs              |
| `secrets`   | Which secrets each target already has                                         | Asks for each missing secret once and stores it only where it is missing   |

Replacing something that already exists is always your explicit choice, never a default:

- `--redeploy` builds the site and pushes `./dist` to the Pages production branch even though a production deployment exists. Day to day you don't need it: every push to `main` deploys through the "Deploy production" GitHub Actions workflow.
- `--rotate NAME[,NAME]` replaces the named secrets everywhere they are stored. See [replace a secret on purpose](./platform-secrets.md#replace-a-secret-on-purpose).

### Picking up after a partial run

If a run stops partway, because you pressed Ctrl+C, skipped a secret, or a command failed, run it again. Each phase checks the real state of GitHub, Cloudflare and your files, not a record of what it meant to do, so the next run does exactly the work that is left. For example, if the deploy failed after the project was created, the next run sees the project, does not create it again, and only pushes the deployment. If you skipped one secret, the next run asks for that secret alone.

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
| `deploy`    | Creates the Cloudflare Pages project and its first production deployment, if they don't exist                                                                                      |
| `domain`    | Attaches the [apex](./glossary.md#apex-domain) domain and any extra hosts to the Pages project; creates missing [DNS](./glossary.md#dns) records via the Cloudflare API            |
| `secrets`   | Reports every server-side secret missing from the Worker, Pages and GitHub, asks for each once, and stores it everywhere — see [platform secrets](./platform-secrets.md)           |

The `env` phase never touches production. The server-side values in `.env.local` (Beehiiv, Notion, and a random intake secret for testing) are only for `pnpm dev` and local scripts. The live site gets its secrets from the `secrets` phase, and its public `PUBLIC_LVBT_*` values from GitHub Actions variables (the repository's Settings → Secrets and variables → Actions → Variables tab).

### The DNS token the domain phase may ask for

Wrangler's sign-in cannot write DNS records. Only when a CNAME record is missing, the domain phase asks for a Cloudflare API token that can:

1. Open `https://dash.cloudflare.com/<account-id>/api-tokens` (Manage Account → API Tokens for the LVBT account, "Las Vegans for Better Transit"). The phase opens it for you.
2. Click **Create Token**. Next to **Edit zone DNS**, click **Use template**.
3. Name it `lasvegasfortransit.org DNS (bootstrap)`.
4. Keep the one permission row the template adds: **Zone · DNS · Edit**.
5. Under Zone Resources, choose **Include · Specific zone · lasvegasfortransit.org**.
6. Click **Continue to summary**, then **Create Token**, and copy the token. Cloudflare shows it only once.
7. Paste it at the prompt. It is saved as `CLOUDFLARE_API_TOKEN` in `.env.local` on your machine (readable only by you, never committed), so later runs reuse it. It is not the deploy token GitHub Actions uses, and bootstrap never passes it to wrangler.

## State file

The bootstrap keeps a record of its last run in `.lvbt/dev-readiness.json` (a local, git-ignored file in the `.lvbt/` folder). It holds per-phase status (`complete | partial | failed | skipped`), per-tool readiness, and setup steps you confirmed that bootstrap cannot check for itself, such as creating the staff console's Google Group, so it asks about each of those only once. `--resume` reads this file and skips phases marked `complete`. The file is rewritten at the end of every run with fresh timestamps; that is expected, because it is a run record, not configuration.

`.env.local` doubles as the cross-phase persistence layer for values that need to survive between phases (e.g. `CLOUDFLARE_PAGES_PROJECT`, `CLOUDFLARE_ACCOUNT_ID`). `run.ts` hydrates `process.env` from it at startup, and the bootstrap writes to it only when a value actually changes.

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
