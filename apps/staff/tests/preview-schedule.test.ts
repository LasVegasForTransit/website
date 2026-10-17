import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { activateStaffRelease, uploadStaffRelease } from '../scripts/release-deploy';
import { newReceipt } from '../scripts/release-receipt';
import { captureSchedule, verifySavedSchedule } from '../scripts/release-schedule';
import { deploymentFixture } from './support/deployment';
import { releaseIdentity } from './support/release';

void test('ordinary preview deployment keeps an idle preview unscheduled', async () => {
  const f = await deploymentFixture(false, { unscheduled: true });
  try {
    await uploadStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options);
    const result = await activateStaffRelease(
      f.destination,
      releaseIdentity,
      f.receiptFile,
      f.options,
    );
    assert.deepEqual(result.schedule, { previous: [], desired: [], state: 'confirmed' });
    assert.deepEqual(f.state.schedules, []);
    assert.equal(f.state.scheduleWrites, 0);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('preview launch rejects a saved minute cron before any schedule write', async () => {
  const f = await deploymentFixture(false, { unscheduled: true });
  try {
    const filename = join(f.destination, 'jobs/wrangler.preview.json');
    const config = JSON.parse(await readFile(filename, 'utf8')) as {
      triggers: { crons: string[] };
    };
    config.triggers.crons = ['* * * * *'];
    await writeFile(filename, JSON.stringify(config));
    await assert.rejects(captureSchedule(f.destination, f.options), /jobs.schedule/);
    assert.equal(f.state.scheduleWrites, 0);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('preview resume refuses an older saved receipt that would restore the minute cron', async () => {
  const f = await deploymentFixture(false, { unscheduled: true });
  try {
    const filename = join(f.destination, 'jobs/wrangler.preview.json');
    const config = JSON.parse(await readFile(filename, 'utf8')) as {
      triggers: { crons: string[] };
    };
    config.triggers.crons = ['* * * * *'];
    await writeFile(filename, JSON.stringify(config));
    const receipt = newReceipt(f.release, f.options.accountId, 'preview');
    receipt.schedule = { previous: [], desired: ['* * * * *'], state: 'pending' };
    await assert.rejects(verifySavedSchedule(f.destination, receipt), /jobs.schedule/);
    assert.equal(f.state.scheduleWrites, 0);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
