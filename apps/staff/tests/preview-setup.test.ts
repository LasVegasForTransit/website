import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { packageStaffRelease } from '../scripts/release-artifact';
import { uploadStaffRelease, activateStaffRelease } from '../scripts/release-deploy';
import { object } from '../scripts/preflight-api';
import { deploymentFixture, versions } from './support/deployment';
import { releaseIdentity } from './support/release';

async function setupFixture(sourceEnabled = false, newsletterSourceEnabled = false) {
  const f = await deploymentFixture();
  for (const app of ['staff', 'jobs']) {
    const filename = join(f.source, `apps/${app}/wrangler.jsonc`);
    const config = object(
      ts.parseConfigFileTextToJson(filename, await readFile(filename, 'utf8')).config,
    );
    const vars = object(object(object(config.env).preview).vars);
    vars.LVBT_DISCORD_SYNC_ENABLED = sourceEnabled ? 'true' : 'false';
    if (app === 'jobs') vars.LVBT_BEEHIIV_SYNC_ENABLED = newsletterSourceEnabled ? 'true' : 'false';
    await writeFile(filename, JSON.stringify(config));
  }
  await rm(f.destination, { recursive: true });
  await packageStaffRelease(f.source, f.destination, releaseIdentity);
  const state = {
    enabled: false,
    newsletterEnabled: false,
    scheduled: false,
    missingAuth: false,
    unavailable: false,
  };
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (state.unavailable && url.pathname.includes('/versions/')) throw new Error('unavailable');
    const response = await f.options.fetch(input, init);
    const body = object(await response.json());
    if (url.pathname.endsWith('/schedules'))
      body.result = { schedules: state.scheduled ? [{ cron: '0 * * * *' }] : [] };
    if (url.pathname.includes('/versions/')) {
      const resources = object(object(body.result).resources);
      resources.bindings = (resources.bindings as Record<string, unknown>[])
        .filter(
          (binding) =>
            binding.name !== 'LVBT_DISCORD_BOT_TOKEN' &&
            binding.name !== 'LVBT_BEEHIIV_SYNC_ENABLED' &&
            !(state.missingAuth && binding.name === 'LVBT_SIGN_IN_SECRET'),
        )
        .map((binding) =>
          binding.name === 'LVBT_DISCORD_SYNC_ENABLED'
            ? { ...binding, text: state.enabled ? 'true' : 'false' }
            : binding,
        );
      (resources.bindings as Record<string, unknown>[]).push({
        type: 'plain_text',
        name: 'LVBT_BEEHIIV_SYNC_ENABLED',
        text: state.newsletterEnabled ? 'true' : 'false',
      });
    }
    return Response.json(body);
  };
  return {
    ...f,
    setupState: state,
    options: { ...f.options, stage: 'setup' as const, fetch: fetcher },
  };
}

void test('preview setup deploys saved applications with Discord disabled and no scheduled jobs', async () => {
  const f = await setupFixture();
  try {
    const uploaded = await uploadStaffRelease(
      f.destination,
      releaseIdentity,
      f.receiptFile,
      f.options,
    );
    assert.equal(object(uploaded).stage, 'setup');
    const active = await activateStaffRelease(
      f.destination,
      releaseIdentity,
      f.receiptFile,
      f.options,
    );
    assert.equal(active.status, 'active');
    assert.equal(f.state.commands.length, 4);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('setup can install the new private binding but rejects a wrong uploaded target before activation', async () => {
  for (const validTarget of [true, false]) {
    const f = await setupFixture();
    try {
      const fetcher: typeof fetch = async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : input);
        const response = await f.options.fetch(input, init),
          body = object(await response.json());
        if (url.pathname.includes('/lvbt-staff-preview/versions/')) {
          const resources = object(object(body.result).resources),
            bindings = resources.bindings as Record<string, unknown>[];
          resources.bindings = url.pathname.endsWith(versions.staff)
            ? bindings.map((b) =>
                b.name === 'LVBT_NEWSLETTER_JOBS' && !validTarget
                  ? { ...b, service: 'lvbt-jobs' }
                  : b,
              )
            : bindings.filter((b) => b.name !== 'LVBT_NEWSLETTER_JOBS');
        }
        return Response.json(body);
      };
      const action = uploadStaffRelease(f.destination, releaseIdentity, f.receiptFile, {
        ...f.options,
        fetch: fetcher,
      });
      if (validTarget) assert.equal((await action).status, 'uploaded');
      else await assert.rejects(action, /staff.version/);
      assert.equal(
        f.state.commands.some((args) => args[1] === 'deploy'),
        false,
      );
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  }
});

void test('setup conditions do not satisfy the default launch gate', async () => {
  const f = await setupFixture();
  try {
    await assert.rejects(
      uploadStaffRelease(f.destination, releaseIdentity, f.receiptFile, {
        ...f.options,
        stage: undefined,
      }),
    );
    assert.equal(f.state.commands.length, 0);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('setup refuses an artifact that would enable Discord even when deployed versions are disabled', async () => {
  const f = await setupFixture(true);
  try {
    await assert.rejects(
      uploadStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options),
    );
    assert.equal(f.state.commands.length, 0);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('setup refuses an artifact that would enable newsletter work even when deployed versions are disabled', async () => {
  const f = await setupFixture(false, true);
  try {
    await assert.rejects(
      uploadStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options),
    );
    assert.equal(f.state.commands.length, 0);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('provider or cron activation after upload blocks setup activation before the first deployment', async () => {
  for (const failure of ['enabled', 'newsletterEnabled', 'scheduled'] as const) {
    const f = await setupFixture();
    try {
      await uploadStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options);
      f.setupState[failure] = true;
      await assert.rejects(
        activateStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options),
      );
      assert.equal(f.state.commands.length, 2);
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  }
});

void test('setup still refuses provider writes, any cron, missing authentication, denied metadata and unsafe Access', async () => {
  for (const failure of [
    'enabled',
    'newsletterEnabled',
    'scheduled',
    'missingAuth',
    'unavailable',
    'unsafe',
  ] as const) {
    const f = await setupFixture();
    try {
      if (failure === 'unsafe') f.state.unsafe = true;
      else f.setupState[failure] = true;
      await assert.rejects(
        uploadStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options),
        failure,
      );
      assert.equal(f.state.commands.length, 0, failure);
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  }
});

void test('setup refuses production and a setup receipt cannot be resumed as launch', async () => {
  const f = await setupFixture();
  try {
    await assert.rejects(
      uploadStaffRelease(f.destination, releaseIdentity, f.receiptFile, {
        ...f.options,
        environment: 'production',
      }),
    );
    assert.equal(f.state.commands.length, 0);
    await uploadStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options);
    await assert.rejects(
      activateStaffRelease(f.destination, releaseIdentity, f.receiptFile, {
        ...f.options,
        stage: undefined,
      }),
    );
    assert.equal(f.state.commands.length, 2);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
