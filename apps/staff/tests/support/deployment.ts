import assert from 'node:assert/strict';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';
import { object } from '../../scripts/preflight-api';
import { packageStaffRelease } from '../../scripts/release-artifact';
import { cloudflareFixture } from './preflight';
import { releaseFixture, releaseIdentity } from './release';

export const versions = {
  staff: '11111111-1111-4111-8111-111111111111',
  jobs: '22222222-2222-4222-8222-222222222222',
};
const deployments = {
  staff: '33333333-3333-4333-8333-333333333333',
  jobs: '44444444-4444-4444-8444-444444444444',
};
function versionMetadata(
  body: Record<string, unknown>,
  options: {
    messages: Map<string, string>;
    changedRole: boolean;
    wrongVersion: boolean;
    configurations: Map<string, Record<string, unknown>>;
  },
) {
  const result = object(body.result);
  const id = String(result.id);
  if (!options.messages.has(id)) return;
  result.annotations = {
    'workers/message': options.wrongVersion ? 'other source' : options.messages.get(id),
  };
  const selected = options.configurations.get(id);
  if (selected) {
    const resource = object(result.resources);
    resource.bindings = [
      ...(resource.bindings as Record<string, unknown>[]).filter(
        (binding) =>
          binding.type !== 'plain_text' ||
          !Object.hasOwn(object(selected.vars), String(binding.name)),
      ),
      ...Object.entries(object(selected.vars)).map(([name, text]) => ({
        name,
        text,
        type: 'plain_text',
      })),
    ];
  }
  if (options.changedRole) {
    const bindings = object(result.resources).bindings as Record<string, unknown>[];
    for (const binding of bindings)
      if (binding.name === 'LVBT_DISCORD_MEMBER_ROLE_ID') binding.text = '777777777777777777';
  }
}
function deploymentMetadata(
  app: 'staff' | 'jobs',
  active: Map<string, string>,
  state: {
    wrongReadback: boolean;
    wrongJobsReadback: boolean;
    unexpectedJobsVersion: boolean;
  },
) {
  const previous =
    app === 'staff'
      ? '66666666-6666-4666-8666-666666666666'
      : state.unexpectedJobsVersion
        ? '99999999-9999-4999-8999-999999999999'
        : '77777777-7777-4777-8777-777777777777';
  const id = active.has(app) ? deployments[app] : 'baseline-deployment';
  const selected = active.get(app) ?? previous;
  const versionId =
    active.has(app) && (state.wrongReadback || (app === 'jobs' && state.wrongJobsReadback))
      ? 'other-version'
      : selected;
  return { deployments: [{ id, versions: [{ version_id: versionId, percentage: 100 }] }] };
}
interface FixtureMode {
  production?: boolean;
  disabledBaseline?: boolean;
  unscheduled?: boolean;
  held?: boolean;
  newsletter?: boolean;
  setup?: boolean;
  shutdown?: boolean;
}
export async function deploymentFixture(changedRole = false, mode: FixtureMode = {}) {
  const f = await releaseFixture();
  const remote = cloudflareFixture({
    production: mode.production,
    productionDiscord: mode.production,
    disabled: mode.setup,
  });
  await mkdir(join(f.source, '.lvbt'), { recursive: true });
  await writeFile(
    join(f.source, '.lvbt/tooling.json'),
    JSON.stringify({ release: { previewOnly: mode.held ?? false } }),
  );
  await rm(join(f.source, 'packages/platform-storage/migrations'), { recursive: true });
  await cp(
    join(remote.options.root, 'packages/platform-storage/migrations'),
    join(f.source, 'packages/platform-storage/migrations'),
    { recursive: true },
  );
  await configureSource(f.source, changedRole, mode);
  const release = await packageStaffRelease(f.source, f.destination, releaseIdentity);
  const receiptFile = join(f.root, 'deployment.json');
  const state = initialState(mode);
  const messages = new Map<string, string>();
  const configurations = new Map<string, Record<string, unknown>>();
  const active = new Map<string, string>();
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.pathname.endsWith('/policies') && active.size === 2) {
      state.readinessAfterVersions += 1;
      if (state.readinessAfterVersions === 2 && state.failReadinessBeforeSchedule)
        throw new Error('DO-NOT-PRINT');
      if (state.readinessAfterVersions === 2 && state.changeScheduleDuringReadiness)
        state.schedules = ['0 * * * *'];
    }
    if (url.pathname.endsWith('/schedules')) return scheduleReply(init, state, active, receiptFile);
    const response = await remote.options.fetch(input, init);
    const body = object(await response.json());
    if (url.pathname.includes('/versions/'))
      decorateVersion(
        body,
        url,
        { messages, configurations, changedRole, wrongVersion: state.wrongVersion },
        { mode, state },
      );
    const app = url.pathname.includes('jobs') ? 'jobs' : 'staff';
    if (url.pathname.endsWith('/deployments')) body.result = deploymentMetadata(app, active, state);
    if (state.unsafe && url.pathname.endsWith('/policies')) body.result = [{ decision: 'bypass' }];
    return Response.json(body);
  };
  const run = async (args: string[], output: string) => {
    state.commands.push(args);
    const config = object(JSON.parse(await readFile(args[args.indexOf('--config') + 1], 'utf8')));
    const app = String(config.name).includes('jobs') ? 'jobs' : 'staff';
    const message = args[args.indexOf('--message') + 1];
    if (args[1] === 'upload') {
      if (app === 'jobs' && state.failUploadJobs) throw new Error('DO-NOT-PRINT-PROVIDER-BODY');
      assert.equal(args.includes('--no-bundle'), true);
      const worker = resolve(dirname(args[args.indexOf('--config') + 1]), String(config.main));
      if (app === 'jobs')
        assert.equal(await readFile(worker, 'utf8'), 'export default { scheduled() {} };');
      messages.set(versions[app], message);
      configurations.set(versions[app], config);
      await writeFile(
        output,
        JSON.stringify({
          type: 'version-upload',
          version: 1,
          worker_name: config.name,
          version_id: versions[app],
          preview_url: null,
        }) + '\n',
      );
    } else {
      assert.equal(args[1], 'deploy');
      assert.equal(args[2], `${versions[app]}@100%`);
      await writeActivation(app, config, output, { state, active });
    }
  };
  return {
    ...f,
    release,
    receiptFile,
    state,
    options: {
      ...remote.options,
      root: f.source,
      environment: mode.production ? ('production' as const) : ('preview' as const),
      ...(mode.setup ? { stage: 'setup' as const } : {}),
      ...(mode.shutdown ? { stage: 'shutdown' as const } : {}),
      run,
      fetch: fetcher,
    },
  };
}

async function configureSource(source: string, changedRole: boolean, mode: FixtureMode) {
  for (const app of ['staff', 'jobs']) {
    const filename = join(source, `apps/${app}/wrangler.jsonc`);
    const config = object(
      ts.parseConfigFileTextToJson(filename, await readFile(filename, 'utf8')).config,
    );
    for (const environment of ['preview', 'production']) {
      const selected = environment === 'preview' ? object(object(config.env).preview) : config;
      configureEnvironment(selected, app, environment, { changedRole, mode });
    }
    await writeFile(filename, JSON.stringify(config));
  }
}
function configureNewsletter(
  selected: Record<string, unknown>,
  app: string,
  environment: string,
  mode: FixtureMode,
) {
  if (app !== 'jobs' || !mode.newsletter) return;
  Object.assign(object(selected.vars), {
    LVBT_BEEHIIV_SYNC_ENABLED: 'true',
    LVBT_BEEHIIV_PUBLICATION_ID: environment === 'production' ? 'pub_production' : 'pub_fixture',
    LVBT_BEEHIIV_PRODUCTION_PUBLICATION_ID: 'pub_production',
  });
}

type FixtureState = ReturnType<typeof initialState>;
function initialState(mode: FixtureMode) {
  return {
    failUploadJobs: false,
    failActivateJobs: false,
    unsafe: false,
    wrongVersion: false,
    wrongReadback: false,
    wrongJobsReadback: false,
    serializedMapTraffic: false,
    unexpectedJobsVersion: false,
    schedules: mode.unscheduled || mode.setup ? ([] as string[]) : ['* * * * *'],
    scheduleWrites: 0,
    loseScheduleResponse: false,
    failScheduleWrite: false,
    failScheduleReads: 0,
    failReadsAfterScheduleWrite: 0,
    changeScheduleAfterVersions: false,
    loseActivationResponse: false,
    readinessAfterVersions: 0,
    failReadinessBeforeSchedule: false,
    changeScheduleDuringReadiness: false,
    removeNewsletterSecret: false,
    commands: [] as string[][],
  };
}

async function scheduleReply(
  init: RequestInit | undefined,
  state: FixtureState,
  active: Map<string, string>,
  receiptFile: string,
) {
  if (init?.method === 'PUT') {
    state.scheduleWrites += 1;
    assert.equal(active.size, 2);
    assert.equal(
      (JSON.parse(await readFile(receiptFile, 'utf8')) as { schedule: { state: string } }).schedule
        .state,
      'attempted',
    );
    if (state.failScheduleWrite) throw new Error('DO-NOT-PRINT');
    state.schedules = (
      JSON.parse(
        typeof init.body === 'string' ? init.body : assert.fail('Expected JSON schedule body'),
      ) as { cron: string }[]
    ).map((row) => row.cron);
    state.failScheduleReads = state.failReadsAfterScheduleWrite;
    if (state.loseScheduleResponse) throw new Error('DO-NOT-PRINT');
  } else if (state.failScheduleReads > 0) {
    state.failScheduleReads -= 1;
    throw new Error('Unavailable');
  }
  if (state.changeScheduleAfterVersions && active.size === 2) state.schedules = ['* * * * *'];
  return Response.json({
    success: true,
    result: { schedules: state.schedules.map((cron) => ({ cron })) },
  });
}

function decorateVersion(
  body: Record<string, unknown>,
  url: URL,
  versionOptions: Parameters<typeof versionMetadata>[1],
  context: { mode: FixtureMode; state: FixtureState },
) {
  const { mode, state } = context;
  versionMetadata(body, versionOptions);
  {
    const result = object(body.result);
    const resource = object(result.resources);
    const bindings = resource.bindings as Record<string, unknown>[];
    if (!versionOptions.messages.has(String(result.id)) && mode.disabledBaseline) {
      for (const binding of bindings)
        if (
          binding.name === 'LVBT_DISCORD_SYNC_ENABLED' ||
          binding.name === 'LVBT_BEEHIIV_SYNC_ENABLED'
        )
          binding.text = 'false';
    }
    if (mode.newsletter && !state.removeNewsletterSecret && url.pathname.includes('jobs'))
      bindings.push(
        ...['LVBT_BEEHIIV_API_KEY', 'LVBT_NEWSLETTER_INTENT_KEY'].map((name) => ({
          name,
          type: 'secret_text',
        })),
      );
  }
}

async function writeActivation(
  app: 'staff' | 'jobs',
  config: Record<string, unknown>,
  output: string,
  context: { state: FixtureState; active: Map<string, string> },
) {
  const { state, active } = context;
  if (app === 'jobs' && state.failActivateJobs) throw new Error('DO-NOT-PRINT-PROVIDER-BODY');
  active.set(app, versions[app]);
  if (app === 'jobs' && state.loseActivationResponse) throw new Error('DO-NOT-PRINT');
  await writeFile(
    output,
    JSON.stringify({
      type: 'version-deploy',
      version: 1,
      worker_name: config.name,
      deployment_id: deployments[app],
      version_traffic: state.serializedMapTraffic
        ? new Map([[versions[app], 100]])
        : { [versions[app]]: 100 },
    }) + '\n',
  );
}

function configureEnvironment(
  selected: Record<string, unknown>,
  app: string,
  environment: string,
  context: { changedRole: boolean; mode: FixtureMode },
) {
  const { changedRole, mode } = context;
  selected.vars = {
    ...object(selected.vars),
    LVBT_DEPLOYMENT_ENV: environment,
    LVBT_ACCESS_AUD: 'staff-audience',
    LVBT_ACCESS_TEAM_DOMAIN: 'lvbt.cloudflareaccess.com',
    LVBT_DISCORD_SYNC_ENABLED: 'true',
    LVBT_DISCORD_APPLICATION_ID: '111111111111111111',
    LVBT_DISCORD_GUILD_ID: environment === 'preview' ? '222222222222222222' : '444444444444444444',
    LVBT_DISCORD_PRODUCTION_GUILD_ID: '444444444444444444',
    LVBT_DISCORD_MEMBER_ROLE_ID: changedRole ? '777777777777777777' : '555555555555555555',
  };
  const disabled = mode.setup === true || (mode.shutdown === true && environment === 'preview');
  if (disabled) object(selected.vars).LVBT_DISCORD_SYNC_ENABLED = 'false';
  if (app === 'jobs') selected.triggers = { crons: disabled ? [] : ['* * * * *'] };
  configureNewsletter(selected, app, environment, mode);
}
