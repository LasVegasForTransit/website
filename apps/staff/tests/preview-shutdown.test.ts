import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { activateStaffRelease, uploadStaffRelease } from '../scripts/release-deploy';
import { selection } from '../scripts/release-deploy-cli';
import { packageStaffRelease } from '../scripts/release-artifact';
import { newReceipt, parseReceipt } from '../scripts/release-receipt';
import { verifySavedSchedule } from '../scripts/release-schedule';
import { object } from '../scripts/preflight-api';
import { deploymentFixture } from './support/deployment';
import { releaseIdentity } from './support/release';

void test('shutdown disables the selected preview versions before removing its saved minute schedule', async () => {
  const f = await deploymentFixture(false, { shutdown: true, held: true });
  try {
    const uploaded = await uploadStaffRelease(
      f.destination,
      releaseIdentity,
      f.receiptFile,
      f.options,
    );
    assert.equal(uploaded.stage, 'shutdown');
    assert.deepEqual(uploaded.schedule, { previous: ['* * * * *'], desired: [], state: 'pending' });
    assert.equal(f.state.scheduleWrites, 0);
    const result = await activateStaffRelease(
      f.destination,
      releaseIdentity,
      f.receiptFile,
      f.options,
    );
    assert.equal(result.status, 'active');
    assert.deepEqual(result.schedule, { previous: ['* * * * *'], desired: [], state: 'confirmed' });
    assert.deepEqual(f.state.schedules, []);
    assert.equal(f.state.scheduleWrites, 1);
    await activateStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options);
    assert.equal(f.state.commands.length, 4);
    assert.equal(f.state.scheduleWrites, 1);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('shutdown remains preview-only and cannot reuse a setup, launch or legacy receipt', async () => {
  const values = {
    directory: '/tmp/release',
    repository: 'LVBT/website',
    'run-id': '123',
    receipt: '/tmp/receipt',
    target: 'preview',
    stage: 'shutdown',
  };
  assert.equal(selection('upload', values).stage, 'shutdown');
  assert.throws(() => selection('upload', { ...values, target: 'production' }));
  const f = await deploymentFixture(false, { shutdown: true });
  try {
    await assert.rejects(
      uploadStaffRelease(f.destination, releaseIdentity, f.receiptFile, {
        ...f.options,
        environment: 'production',
      }),
    );
    assert.equal(f.state.commands.length, 0);
    await uploadStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options);
    for (const stage of ['setup', 'launch'] as const)
      await assert.rejects(
        activateStaffRelease(f.destination, releaseIdentity, f.receiptFile, {
          ...f.options,
          stage,
        }),
      );
    const receipt = JSON.parse(await readFile(f.receiptFile, 'utf8')) as Record<string, unknown>;
    receipt.formatVersion = 1;
    delete receipt.schedule;
    assert.throws(() =>
      parseReceipt(receipt, newReceipt(f.release, f.options.accountId, 'preview', 'shutdown')),
    );
    assert.equal(f.state.commands.length, 2);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('shutdown receipt and saved-schedule guards independently reject production and a nonempty desired schedule', async () => {
  const f = await deploymentFixture(false, { shutdown: true });
  try {
    const receipt = await uploadStaffRelease(
      f.destination,
      releaseIdentity,
      f.receiptFile,
      f.options,
    );
    const expected = newReceipt(f.release, f.options.accountId, 'preview', 'shutdown');
    assert.throws(() =>
      parseReceipt(
        { ...receipt, schedule: { ...receipt.schedule, desired: ['* * * * *'] } },
        expected,
      ),
    );
    assert.throws(() =>
      parseReceipt(
        { ...receipt, environment: 'production' },
        { ...expected, environment: 'production' },
      ),
    );
    await assert.rejects(
      verifySavedSchedule(f.destination, { ...receipt, environment: 'production' }),
    );
    await assert.rejects(
      verifySavedSchedule(f.destination, {
        ...receipt,
        schedule: { previous: ['* * * * *'], desired: ['* * * * *'], state: 'pending' },
      }),
    );
    await verifySavedSchedule(f.destination, receipt);
    assert.equal(f.state.scheduleWrites, 0);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('shutdown rejects an unknown current Discord target or active newsletter work before upload', async () => {
  for (const invalid of ['guild', 'newsletter'] as const) {
    const f = await deploymentFixture(false, { shutdown: true });
    try {
      const fetcher: typeof fetch = async (input, init) => {
        const response = await f.options.fetch(input, init);
        const body = object(await response.json());
        const url = new URL(input instanceof Request ? input.url : input);
        if (url.pathname.includes('/versions/')) {
          for (const binding of object(object(body.result).resources).bindings as Record<
            string,
            unknown
          >[]) {
            if (invalid === 'guild' && binding.name === 'LVBT_DISCORD_GUILD_ID')
              binding.text = '888888888888888888';
            if (invalid === 'newsletter' && binding.name === 'LVBT_BEEHIIV_SYNC_ENABLED')
              binding.text = 'true';
          }
        }
        return Response.json(body);
      };
      await assert.rejects(
        uploadStaffRelease(f.destination, releaseIdentity, f.receiptFile, {
          ...f.options,
          fetch: fetcher,
        }),
        invalid,
      );
      assert.equal(f.state.commands.length, 0);
      assert.equal(f.state.scheduleWrites, 0);
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  }
});

void test('a partial shutdown upload cannot activate workers or clear the schedule', async () => {
  const f = await deploymentFixture(false, { shutdown: true });
  try {
    f.state.failUploadJobs = true;
    await assert.rejects(
      uploadStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options),
    );
    await assert.rejects(
      activateStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options),
    );
    assert.equal(f.state.commands.length, 2);
    assert.equal(f.state.scheduleWrites, 0);
    assert.deepEqual(f.state.schedules, ['* * * * *']);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('protected preview workflows offer shutdown and require its final read-only check', async () => {
  const deploy = await readFile(
    new URL('../../../.github/workflows/deploy-staff-preview.yml', import.meta.url),
    'utf8',
  );
  const recovery = await readFile(
    new URL('../../../.github/workflows/recover-staff-preview.yml', import.meta.url),
    'utf8',
  );
  for (const workflow of [deploy, recovery]) {
    assert.match(workflow, /options: \[(?:launch, setup|setup, launch), shutdown\]/);
    assert.match(workflow, /environment: staff-preview/);
    assert.match(workflow, /group: staff-preview-deployment/);
    assert.match(workflow, /if: github.ref == 'refs\/heads\/main'/);
    assert.doesNotMatch(workflow, /target production|staff-production/);
  }
  assert.match(deploy, /pnpm staff:preflight --preview --shutdown --json/);
  assert.match(recovery, /--stage "\$DEPLOYMENT_STAGE"/);
});

void test('shutdown rejects enabled Discord, enabled newsletter, scheduled or changed-target source before uploads', async () => {
  for (const invalid of ['discord', 'newsletter', 'cron', 'guild'] as const) {
    const f = await deploymentFixture(false, { shutdown: true });
    try {
      const filename = join(f.source, 'apps/jobs/wrangler.jsonc');
      const config = object(
        ts.parseConfigFileTextToJson(filename, await readFile(filename, 'utf8')).config,
      );
      const preview = object(object(config.env).preview),
        vars = object(preview.vars);
      if (invalid === 'discord') vars.LVBT_DISCORD_SYNC_ENABLED = 'true';
      if (invalid === 'newsletter') vars.LVBT_BEEHIIV_SYNC_ENABLED = 'true';
      if (invalid === 'cron') preview.triggers = { crons: ['* * * * *'] };
      if (invalid === 'guild') vars.LVBT_DISCORD_GUILD_ID = vars.LVBT_DISCORD_PRODUCTION_GUILD_ID;
      await writeFile(filename, JSON.stringify(config));
      await rm(f.destination, { recursive: true });
      await packageStaffRelease(f.source, f.destination, releaseIdentity);
      await assert.rejects(
        uploadStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options),
        invalid,
      );
      assert.equal(f.state.commands.length, 0, invalid);
      assert.equal(f.state.scheduleWrites, 0, invalid);
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  }
});

void test('shutdown preserves the schedule after partial activation and resumes only the pending Worker', async () => {
  const f = await deploymentFixture(false, { shutdown: true });
  try {
    await uploadStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options);
    f.state.failActivateJobs = true;
    await assert.rejects(
      activateStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options),
    );
    assert.deepEqual(f.state.schedules, ['* * * * *']);
    assert.equal(f.state.scheduleWrites, 0);
    f.state.failActivateJobs = false;
    const active = await activateStaffRelease(
      f.destination,
      releaseIdentity,
      f.receiptFile,
      f.options,
    );
    assert.equal(active.status, 'active');
    assert.equal(f.state.commands.length, 5);
    assert.equal(f.state.scheduleWrites, 1);
    assert.deepEqual(f.state.schedules, []);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('shutdown resolves lost schedule and activation responses without repeating successful writes', async () => {
  for (const lost of ['loseScheduleResponse', 'loseActivationResponse'] as const) {
    const f = await deploymentFixture(false, { shutdown: true });
    try {
      await uploadStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options);
      f.state[lost] = true;
      if (lost === 'loseActivationResponse')
        await assert.rejects(
          activateStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options),
        );
      const active = await activateStaffRelease(
        f.destination,
        releaseIdentity,
        f.receiptFile,
        f.options,
      );
      assert.equal(active.status, 'active');
      assert.equal(f.state.commands.length, 4);
      assert.equal(f.state.scheduleWrites, 1);
      assert.deepEqual(f.state.schedules, []);
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  }
});

void test('shutdown never retries an uncertain schedule write and can later confirm a lost readback', async () => {
  for (const applied of [true, false]) {
    const f = await deploymentFixture(false, { shutdown: true });
    try {
      await uploadStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options);
      f.state.failScheduleWrite = !applied;
      f.state.loseScheduleResponse = applied;
      f.state.failReadsAfterScheduleWrite = 10;
      await assert.rejects(
        activateStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options),
      );
      assert.equal(f.state.scheduleWrites, 1);
      f.state.failScheduleReads = 0;
      const resume = activateStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options);
      if (applied) assert.equal((await resume).status, 'active');
      else await assert.rejects(resume);
      assert.equal(f.state.scheduleWrites, 1);
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  }
});

void test('shutdown refuses schedule, traffic and Access drift before activation', async () => {
  for (const drift of ['schedule', 'traffic', 'access'] as const) {
    const f = await deploymentFixture(false, { shutdown: true });
    try {
      await uploadStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options);
      if (drift === 'schedule') f.state.schedules = [];
      if (drift === 'traffic') f.state.unexpectedJobsVersion = true;
      if (drift === 'access') f.state.unsafe = true;
      await assert.rejects(
        activateStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options),
        drift,
      );
      assert.equal(f.state.commands.length, 2, drift);
      assert.equal(f.state.scheduleWrites, 0, drift);
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  }
});

void test('shutdown still checks final readiness and preserves a concurrent schedule change before PUT', async () => {
  for (const fault of ['failReadinessBeforeSchedule', 'changeScheduleDuringReadiness'] as const) {
    const f = await deploymentFixture(false, { shutdown: true });
    try {
      await uploadStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options);
      f.state[fault] = true;
      await assert.rejects(
        activateStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options),
      );
      assert.equal(f.state.scheduleWrites, 0);
      const receipt = JSON.parse(await readFile(f.receiptFile, 'utf8')) as {
        schedule: { state: string };
      };
      assert.equal(receipt.schedule.state, 'pending');
      if (fault === 'changeScheduleDuringReadiness')
        assert.deepEqual(f.state.schedules, ['0 * * * *']);
      else {
        f.state[fault] = false;
        assert.equal(
          (await activateStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options))
            .status,
          'active',
        );
      }
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  }
});
