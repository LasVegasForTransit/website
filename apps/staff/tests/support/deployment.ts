import assert from 'node:assert/strict';
import { cp, readFile, rm, writeFile } from 'node:fs/promises';
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
  },
) {
  const result = object(body.result);
  const id = String(result.id);
  if (!options.messages.has(id)) return;
  result.annotations = {
    'workers/message': options.wrongVersion ? 'other source' : options.messages.get(id),
  };
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
export async function deploymentFixture(changedRole = false) {
  const f = await releaseFixture();
  const remote = cloudflareFixture();
  await rm(join(f.source, 'packages/platform-storage/migrations'), { recursive: true });
  await cp(
    join(remote.options.root, 'packages/platform-storage/migrations'),
    join(f.source, 'packages/platform-storage/migrations'),
    { recursive: true },
  );
  for (const app of ['staff', 'jobs']) {
    const filename = join(f.source, `apps/${app}/wrangler.jsonc`);
    const config = object(
      ts.parseConfigFileTextToJson(filename, await readFile(filename, 'utf8')).config,
    );
    for (const environment of ['preview', 'production']) {
      const selected = environment === 'preview' ? object(object(config.env).preview) : config;
      selected.vars = {
        ...object(selected.vars),
        LVBT_DEPLOYMENT_ENV: environment,
        LVBT_ACCESS_AUD: 'staff-audience',
        LVBT_ACCESS_TEAM_DOMAIN: 'lvbt.cloudflareaccess.com',
        LVBT_DISCORD_SYNC_ENABLED: 'true',
        LVBT_DISCORD_APPLICATION_ID: '111111111111111111',
        LVBT_DISCORD_GUILD_ID:
          environment === 'preview' ? '222222222222222222' : '444444444444444444',
        LVBT_DISCORD_PRODUCTION_GUILD_ID: '444444444444444444',
        LVBT_DISCORD_MEMBER_ROLE_ID: changedRole ? '777777777777777777' : '555555555555555555',
      };
    }
    await writeFile(filename, JSON.stringify(config));
  }
  const release = await packageStaffRelease(f.source, f.destination, releaseIdentity);
  const receiptFile = join(f.root, 'deployment.json');
  const state = {
    failUploadJobs: false,
    failActivateJobs: false,
    unsafe: false,
    wrongVersion: false,
    wrongReadback: false,
    wrongJobsReadback: false,
    serializedMapTraffic: false,
    unexpectedJobsVersion: false,
    commands: [] as string[][],
  };
  const messages = new Map<string, string>();
  const active = new Map<string, string>();
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const response = await remote.options.fetch(input, init);
    const body = object(await response.json());
    if (url.pathname.includes('/versions/'))
      versionMetadata(body, { messages, changedRole, wrongVersion: state.wrongVersion });
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
      if (app === 'jobs' && state.failActivateJobs) throw new Error('DO-NOT-PRINT-PROVIDER-BODY');
      active.set(app, versions[app]);
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
  };
  return {
    ...f,
    release,
    receiptFile,
    state,
    options: {
      ...remote.options,
      root: f.source,
      environment: 'preview' as const,
      run,
      fetch: fetcher,
    },
  };
}
