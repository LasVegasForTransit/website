import { MetadataClient } from './preflight-api';
import { inspectWorker, inspectDiscord, type Bindings } from './preflight-workers';
import { remoteProbes } from './preflight-probes';
import { releaseConfiguration, type Check, type Environment } from './preflight-config';
import { STAFF_WORKER_BINDINGS } from '@lasvegasfortransit/platform-integrations/worker-runtime-config';
interface Options {
  root: string;
  accountId?: string;
  token?: string;
  fetch?: typeof fetch;
}
function unverifiedWorker(kind: 'staff' | 'jobs'): Check[] {
  return [
    'deployment',
    'database',
    'version_configuration',
    ...STAFF_WORKER_BINDINGS[kind].map((name) => `binding.${name}`),
  ].map((suffix) => ({
    id: `${kind}.${suffix}`,
    status: 'unverified',
    detail:
      'Worker metadata unavailable; check the selected account and scoped token read permissions.',
  }));
}
function unverifiedRequirements(): Check[] {
  return [
    ...unverifiedWorker('staff'),
    ...unverifiedWorker('jobs'),
    ...[
      'staff.domain',
      'staff.no_bot_token',
      'jobs.exposure',
      'jobs.schedule',
      'access.application',
      'access.policy',
      'database.migrations',
      'discord.configuration',
    ].map((id): Check => ({
      id,
      status: 'unverified',
      detail: 'Remote configuration has not been inspected.',
    })),
  ];
}
async function inspectRemote(
  client: MetadataClient,
  config: Awaited<ReturnType<typeof releaseConfiguration>>,
) {
  const checks: Check[] = [];
  let staffBindings: Bindings | null = null;
  let jobsBindings: Bindings | null = null;
  for (const [kind, name] of [
    ['staff', config.staffWorker],
    ['jobs', config.jobsWorker],
  ] as const) {
    try {
      const result = await inspectWorker(client, name, kind, config.databaseId);
      checks.push(...result.checks);
      if (kind === 'staff') staffBindings = result.bindings;
      else jobsBindings = result.bindings;
    } catch {
      checks.push(...unverifiedWorker(kind));
    }
  }
  checks.push(
    staffBindings && jobsBindings
      ? inspectDiscord(staffBindings, jobsBindings, config.environment)
      : {
          id: 'discord.configuration',
          status: 'unverified',
          detail: 'Both deployed Worker inventories are required.',
        },
  );
  const probes = remoteProbes(client, config, staffBindings ?? []);
  for (const probe of probes) {
    try {
      checks.push(...(await probe.run()));
    } catch {
      checks.push({
        id: probe.id,
        status: 'unverified',
        detail: 'Metadata unavailable; check account and token read permissions.',
      });
    }
  }
  return checks;
}
export async function preflightStaff(environment: Environment, options: Options) {
  const config = await releaseConfiguration(options.root, environment);
  const checks = [...config.checks];
  if (options.accountId && options.token)
    checks.push(
      ...(await inspectRemote(
        new MetadataClient({
          accountId: options.accountId,
          token: options.token,
          fetch: options.fetch,
        }),
        config,
      )),
    );
  else
    checks.push(...unverifiedRequirements(), {
      id: 'cloudflare.read',
      status: 'unverified',
      detail:
        'Set CLOUDFLARE_ACCOUNT_ID and a scoped CLOUDFLARE_API_TOKEN for read-only inventory.',
    });
  const acceptance: Check[] = [
    'identity-and-admin',
    'lead-and-denied-account',
    'roster-provenance',
    'live-provider-retry-and-revocation',
    'staff-usability',
    'reviewed-release',
    'complete-account-zone-coverage',
  ].map((id) => ({
    id,
    status: 'unverified',
    detail:
      'Requires recorded human or live-provider acceptance; configuration inventory is insufficient.',
  }));
  return { environment, scope: 'configuration', checks, acceptance };
}
