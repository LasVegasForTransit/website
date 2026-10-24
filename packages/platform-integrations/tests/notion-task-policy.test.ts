import assert from 'node:assert/strict';
import test from 'node:test';
import { taskPolicy } from './support/task-checkins';

async function policy() {
  const module = await import('../src/notion-task-policy').catch(() => null);
  assert.ok(module, 'check-in policy validation must be available');
  return module;
}
void test('delivery policy requires approved private content, a trial cohort, and explicit actions and timing', async () => {
  const { inspectTaskCheckinPolicy } = await policy();
  const valid = inspectTaskCheckinPolicy(taskPolicy);
  assert.ok(valid.policy);
  assert.deepEqual(valid.gaps, []);
  for (const change of [
    { contentApproved: false },
    { trialApproved: false },
    { cohortPersonIds: [] },
    { timezone: 'Not/AZone' },
    { quietEndMinute: 1440 },
    { actions: {} },
    { delivery: 'public_channel' },
    { cancellationSignal: null },
    { preDeadlineHours: [NaN] },
    { retentionDays: 0 },
    { notificationLimit24h: undefined },
    { notificationLimit24h: 0 },
    { notificationLimit24h: 21 },
    { notificationGapMinutes: 0 },
    { notificationGapMinutes: 1441 },
    { supportPersonIds: [] },
    { escalateBlockers: undefined },
    { escalationContentApproved: false },
    { escalationAfterHours: undefined },
    { escalationAfterHours: 0 },
    { escalationAfterHours: 721 },
    { preDeadlineHours: [], overdueHours: [], followupHours: [], digestHour: null },
  ]) {
    assert.equal(
      inspectTaskCheckinPolicy({ ...taskPolicy, ...change }).policy,
      null,
      JSON.stringify(change),
    );
  }
});
void test('validated policy strips unrelated properties and exposes an understandable consent summary', async () => {
  const { inspectTaskCheckinPolicy, taskCheckinScheduleSummary } = await policy();
  const result = inspectTaskCheckinPolicy({ ...taskPolicy, token: 'DO-NOT-KEEP' });
  assert.ok(result.policy);
  assert.equal(JSON.stringify(result.policy).includes('DO-NOT-KEEP'), false);
  const summary = taskCheckinScheduleSummary(result.policy);
  assert.match(summary, /48/);
  assert.match(summary, /24/);
  assert.match(summary, /21:00/);
  assert.match(summary, /09:00/);
  assert.match(summary, /America\/Los_Angeles/);
  assert.match(summary, /30 days/);
  assert.match(summary, /Notion and Discord/);
});
