# Scheduled membership work

The jobs app updates Discord roles and newsletter subscriptions when a member's choices change. It
also removes expired records under the member-data retention rules. Read this page when you change
or test background work.

This app runs as a Cloudflare Worker (a program hosted by Cloudflare). It has no public web API. The
website and staff app call its private endpoints for approved tasks. Production is configured to
wake it once a minute after launch. Preview has no repeating schedule; preview release checks reject
one. Local tests can trigger scheduled work without enabling a preview schedule.

<a id="configuration-and-release"></a>

## Before you start

Complete the [local setup](../../docs/tutorials/start-here.md) from the repository root. You do not
need provider credentials or a Cloudflare login for the tests below. They use separate local
databases and simulated Discord and Beehiiv responses. Beehiiv is the newsletter service.

Do not enable provider synchronization to test a code change. Maintainers use the
[staff setup and release guide](../../docs/reference/staff-portal-operations.md) for credentials,
migrations, approved preview checks and production activation.

<a id="local-verification"></a>

## Run local checks

Run these commands from the repository root:

```sh
pnpm check
pnpm -C apps/jobs test
pnpm -C apps/jobs build
pnpm -C apps/jobs test:maintenance
pnpm -C apps/jobs test:e2e
pnpm -C apps/staff test:discord-observation
```

`build` compiles the jobs Worker locally; it does not deploy it. Build the staff app with
`pnpm -C apps/staff build` before running `test:discord-observation` if it has not been built. The
browser and compiled-Worker tests need the local dependencies installed by project setup.

The task check-in fixtures exercise the compiled site callback and jobs entrypoints with separate
member and guest identities, private cards, signed responses, Notion writeback, and failed or
uncertain operations. Providers are simulated; hosted acceptance is separate.

Use the test that matches your change:

| Command                          | What it checks                                                                |
| -------------------------------- | ----------------------------------------------------------------------------- |
| `test`                           | Scheduler decisions and database-use limits.                                  |
| `test:maintenance`               | Retention cutoffs, exclusions and deletion in the compiled Worker.            |
| `test:e2e`                       | Scheduled Discord changes, newsletter requests, incoming choices and polling. |
| Staff `test:discord-observation` | Confirmed access and removal as the staff app displays them.                  |

These checks prove local behavior. They do not prove that a hosted Worker has enough capacity or
that a live provider accepted a change. See the
[test details](../../docs/reference/background-jobs.md#local-test-coverage).

## Find the code

| Path                                                       | Responsibility                                                |
| ---------------------------------------------------------- | ------------------------------------------------------------- |
| `src/index.ts`                                             | Worker entrypoints and private request routing.               |
| `src/scheduled.ts`                                         | Order and share scheduled work between providers.             |
| `src/scheduled-admission.ts`, `src/scheduled-budget.ts`    | Decide whether work may start and limit each run.             |
| `src/scheduled-maintenance.ts`, `src/scheduled-privacy.ts` | Remove expired records and run daily privacy checks.          |
| `src/scheduled-discord.ts`, `src/newsletter.ts`            | Run provider work and save confirmed results.                 |
| `packages/platform-storage`                                | Save choices, queued work, progress and recovery information. |
| `packages/platform-integrations`                           | Send provider requests and interpret responses.               |

## Rules a change must preserve

A saved membership choice is separate from a provider result. A successful Discord update cannot
complete unfinished newsletter work. The Worker confirms changes with a separate provider read. Old
or interrupted work must never restore access after a member withdraws consent or deletes their
account. Retries must preserve enough information to finish cleanup after profile removal.

<a id="discord-command-registration"></a> <a id="daily-member-privacy-maintenance"></a>
<a id="scheduled-newsletter-requests"></a> <a id="periodic-discord-checks"></a>
<a id="deleted-and-combined-records"></a> <a id="confirmed-discord-access-changes"></a>
<a id="profile-retention-audit-retention-and-expired-claims"></a>

Follow the [background-work reference](../../docs/reference/background-jobs.md) for scheduling and
recovery constraints. Use these operator guides for service-specific rules:

- [Newsletter processing](../../docs/reference/staff-newsletter-operations.md#scheduled-newsletter-processing)
  covers consent conflicts, encrypted addresses and provider setup.
- [Discord setup](../../docs/reference/platform-secrets.md#scheduled-discord-configuration) covers
  separate preview accounts, role permissions and required credentials.
- [Member-data retention](../../docs/guides/operate-member-data-retention.md) covers erasure,
  retention periods and failed cleanup.
- [Database capacity](../../docs/reference/staff-availability.md) covers shared limits and recovery
  after jobs pause to protect member and staff requests.
