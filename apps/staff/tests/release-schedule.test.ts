import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { activateStaffRelease, uploadStaffRelease } from '../scripts/release-deploy';
import { deploymentFixture } from './support/deployment';
import { releaseIdentity } from './support/release';
import { selection } from '../scripts/release-deploy-cli';

void test('saved launch receipt records the previous and desired jobs schedule before activation', async () => {
  const f = await deploymentFixture();
  try {
    await uploadStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options);
    const receipt = JSON.parse(await readFile(f.receiptFile, 'utf8')) as { schedule?: unknown };
    assert.deepEqual(receipt.schedule, {
      previous: ['* * * * *'],
      desired: ['* * * * *'],
      state: 'pending',
    });
    await activateStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options);
    const active = JSON.parse(await readFile(f.receiptFile, 'utf8')) as {
      schedule?: { state: string };
    };
    assert.equal(active.schedule?.state, 'confirmed');
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('production selection is explicit and setup remains preview-only', () => {
  const values = {
    directory: '/tmp/release',
    repository: 'LVBT/website',
    'run-id': '123',
    receipt: '/tmp/receipt',
    target: 'production',
  };
  assert.equal(selection('upload', values).environment, 'production');
  assert.throws(() => selection('activate', { ...values, stage: 'setup' }));
  assert.throws(() => selection('upload', { ...values, target: 'other' }));
});

void test('production hold prevents uploads, activation and schedule writes', async () => {
  const f = await deploymentFixture(false, {
    production: true,
    held: true,
    disabledBaseline: true,
    unscheduled: true,
    newsletter: true,
  });
  try {
    await assert.rejects(
      uploadStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options),
    );
    assert.equal(f.state.commands.length, 0);
    assert.equal(f.state.scheduleWrites, 0);
    await writeFile(
      join(f.source, '.lvbt/tooling.json'),
      JSON.stringify({ release: { previewOnly: false } }),
    );
    await uploadStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options);
    await writeFile(
      join(f.source, '.lvbt/tooling.json'),
      JSON.stringify({ release: { previewOnly: true } }),
    );
    await assert.rejects(
      activateStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options),
    );
    assert.equal(f.state.commands.length, 2);
    assert.equal(f.state.scheduleWrites, 0);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('first production launch verifies the disabled baseline then schedules only the active selected versions', async () => {
  const f = await deploymentFixture(false, {
    production: true,
    disabledBaseline: true,
    unscheduled: true,
    newsletter: true,
  });
  try {
    await uploadStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options);
    assert.equal(f.state.scheduleWrites, 0);
    const result = await activateStaffRelease(
      f.destination,
      releaseIdentity,
      f.receiptFile,
      f.options,
    );
    assert.equal(result.status, 'active');
    assert.equal(result.environment, 'production');
    assert.deepEqual(result.schedule, { previous: [], desired: ['* * * * *'], state: 'confirmed' });
    assert.equal(f.state.scheduleWrites, 1);
    await activateStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options);
    assert.equal(f.state.scheduleWrites, 1);
    assert.equal(f.state.commands.length, 4);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('partial version activation never enables schedules and resume activates only pending work', async () => {
  const f = await deploymentFixture(false, {
    production: true,
    disabledBaseline: true,
    unscheduled: true,
    newsletter: true,
  });
  try {
    await uploadStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options);
    f.state.failActivateJobs = true;
    await assert.rejects(
      activateStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options),
    );
    assert.equal(f.state.scheduleWrites, 0);
    f.state.failActivateJobs = false;
    const result = await activateStaffRelease(
      f.destination,
      releaseIdentity,
      f.receiptFile,
      f.options,
    );
    assert.equal(result.status, 'active');
    assert.equal(f.state.scheduleWrites, 1);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('lost schedule response is resolved by readback without another PUT', async () => {
  const f = await deploymentFixture(false, { unscheduled: true });
  try {
    await uploadStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options);
    f.state.loseScheduleResponse = true;
    const result = await activateStaffRelease(
      f.destination,
      releaseIdentity,
      f.receiptFile,
      f.options,
    );
    assert.equal(result.status, 'active');
    assert.equal(f.state.scheduleWrites, 1);
    await activateStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options);
    assert.equal(f.state.scheduleWrites, 1);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('uncertain schedule failure stays attempted and cannot automatically repeat its write', async () => {
  const f = await deploymentFixture(false, { unscheduled: true });
  try {
    await uploadStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options);
    f.state.failScheduleWrite = true;
    await assert.rejects(
      activateStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options),
    );
    const receipt = JSON.parse(await readFile(f.receiptFile, 'utf8')) as {
      schedule: { state: string };
    };
    assert.equal(receipt.schedule.state, 'attempted');
    f.state.failScheduleWrite = false;
    await assert.rejects(
      activateStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options),
    );
    assert.equal(f.state.scheduleWrites, 1);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('concurrent schedule changes stop activation without overwriting them', async () => {
  const f = await deploymentFixture(false, { unscheduled: true });
  try {
    await uploadStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options);
    f.state.schedules = ['* * * * *'];
    await assert.rejects(
      activateStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options),
    );
    assert.equal(f.state.commands.length, 2);
    assert.equal(f.state.scheduleWrites, 0);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('enabled newsletter candidate without encrypted jobs credentials cannot activate', async () => {
  const f = await deploymentFixture(false, {
    production: true,
    disabledBaseline: true,
    unscheduled: true,
    newsletter: true,
  });
  try {
    f.state.removeNewsletterSecret = true;
    await assert.rejects(
      uploadStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options),
    );
    assert.equal(f.state.commands.length, 2);
    assert.equal(f.state.scheduleWrites, 0);
    assert.ok(f.state.commands.every((args) => args[1] === 'upload'));
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('lost activation response resumes its recorded live version without deploying again', async () => {
  const f = await deploymentFixture(false, { unscheduled: true });
  try {
    await uploadStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options);
    f.state.loseActivationResponse = true;
    await assert.rejects(
      activateStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options),
    );
    assert.equal(f.state.scheduleWrites, 0);
    const result = await activateStaffRelease(
      f.destination,
      releaseIdentity,
      f.receiptFile,
      f.options,
    );
    assert.equal(result.status, 'active');
    assert.equal(f.state.commands.length, 4);
    assert.equal(f.state.scheduleWrites, 1);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('lost schedule response and unavailable readback recover only by reading the saved attempt', async () => {
  const f = await deploymentFixture(false, { unscheduled: true });
  try {
    await uploadStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options);
    f.state.loseScheduleResponse = true;
    f.state.failReadsAfterScheduleWrite = 3;
    await assert.rejects(
      activateStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options),
    );
    assert.equal(f.state.scheduleWrites, 1);
    f.state.failScheduleReads = 0;
    const result = await activateStaffRelease(
      f.destination,
      releaseIdentity,
      f.receiptFile,
      f.options,
    );
    assert.equal(result.schedule?.state, 'confirmed');
    assert.equal(f.state.scheduleWrites, 1);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('schedule conflict after both versions activate still stops before the schedule write', async () => {
  const f = await deploymentFixture(false, { unscheduled: true });
  try {
    await uploadStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options);
    f.state.changeScheduleAfterVersions = true;
    await assert.rejects(
      activateStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options),
    );
    assert.equal(f.state.commands.length, 4);
    assert.equal(f.state.scheduleWrites, 0);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('production workflows are protected, main-only, dispatch-only and use saved releases', async () => {
  for (const name of ['deploy-staff-production', 'recover-staff-production']) {
    const workflow = await readFile(
      new URL(`../../../.github/workflows/${name}.yml`, import.meta.url),
      'utf8',
    );
    assert.match(workflow, /workflow_dispatch:/);
    assert.match(workflow, /if: github.ref == 'refs\/heads\/main'/);
    assert.match(workflow, /environment: staff-production/);
    assert.match(workflow, /group: staff-production-deployment/);
    assert.match(workflow, /--target\s+production/);
    assert.match(workflow, /--source-directory/);
    assert.doesNotMatch(
      workflow,
      /push:|pull_request:|wrangler deploy|pnpm build|stage setup|CLOUDFLARE_STAFF_PREVIEW_API_TOKEN/,
    );
  }
});

void test('setup and legacy preview recovery keep jobs unscheduled and never acquire schedule write permission', async () => {
  const f = await deploymentFixture(false, { setup: true });
  try {
    await uploadStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options);
    const result = await activateStaffRelease(
      f.destination,
      releaseIdentity,
      f.receiptFile,
      f.options,
    );
    assert.deepEqual(result.schedule, { previous: [], desired: [], state: 'confirmed' });
    const legacy = JSON.parse(await readFile(f.receiptFile, 'utf8')) as {
      formatVersion: number;
      schedule?: unknown;
    };
    legacy.formatVersion = 1;
    delete legacy.schedule;
    await writeFile(f.receiptFile, JSON.stringify(legacy));
    await activateStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options);
    assert.equal(f.state.commands.length, 4);
    assert.equal(f.state.scheduleWrites, 0);
    assert.deepEqual(f.state.schedules, []);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('a final readiness failure before PUT keeps the pending schedule safely resumable', async () => {
  const f = await deploymentFixture(false, { unscheduled: true });
  try {
    await uploadStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options);
    f.state.failReadinessBeforeSchedule = true;
    await assert.rejects(
      activateStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options),
    );
    const receipt = JSON.parse(await readFile(f.receiptFile, 'utf8')) as {
      schedule: { state: string };
    };
    assert.equal(f.state.scheduleWrites, 0);
    assert.equal(receipt.schedule.state, 'pending');
    f.state.failReadinessBeforeSchedule = false;
    const result = await activateStaffRelease(
      f.destination,
      releaseIdentity,
      f.receiptFile,
      f.options,
    );
    assert.equal(result.status, 'active');
    assert.equal(f.state.scheduleWrites, 1);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('schedule drift during the final readiness check is not overwritten', async () => {
  const f = await deploymentFixture(false, { unscheduled: true });
  try {
    await uploadStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options);
    f.state.changeScheduleDuringReadiness = true;
    await assert.rejects(
      activateStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options),
    );
    assert.equal(f.state.scheduleWrites, 0);
    assert.deepEqual(f.state.schedules, ['0 * * * *']);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
