import assert from 'node:assert/strict';
import test from 'node:test';
import { taskPolicy } from './support/task-checkins';
import { inspectTaskCheckinPolicy } from '../src/notion-task-policy';
import type { NotionTaskSnapshot } from '../src/notion-task-types';
const policy = inspectTaskCheckinPolicy(taskPolicy).policy;
assert.ok(policy);
const task: NotionTaskSnapshot = {
  title: 'Prepare agenda',
  url: 'https://www.notion.so/task',
  description: null,
  assigneeIds: ['notion-member'],
  projectIds: [],
  dueDate: '2026-10-23',
  dueTimeZone: null,
  status: 'In progress',
  ineligibleReason: null,
};
async function reminders() {
  const module = await import('../src/notion-task-reminders').catch(() => null);
  assert.ok(module, 'timezone-aware reminder selection must exist');
  return module;
}
void test('date-only deadlines last through the configured local day across DST transitions', async () => {
  const { taskDeadline } = await reminders();
  assert.equal(taskDeadline(task, policy.timezone)?.toISOString(), '2026-10-24T06:59:59.999Z');
  assert.equal(
    taskDeadline({ ...task, dueDate: '2026-11-01' }, policy.timezone)?.toISOString(),
    '2026-11-02T07:59:59.999Z',
  );
  assert.equal(
    taskDeadline({ ...task, dueDate: '2026-03-08' }, policy.timezone)?.toISOString(),
    '2026-03-09T06:59:59.999Z',
  );
  assert.equal(taskDeadline(task, ''), null);
  assert.equal(taskDeadline({ ...task, dueDate: '2026-02-30' }, policy.timezone), null);
});
void test('date-time deadlines respect instants and resolve local times without inventing nonexistent DST times', async () => {
  const { taskDeadline } = await reminders();
  assert.equal(
    taskDeadline({ ...task, dueDate: '2026-10-23T17:00:00-07:00' }, policy.timezone)?.toISOString(),
    '2026-10-24T00:00:00.000Z',
  );
  assert.equal(
    taskDeadline(
      { ...task, dueDate: '2026-10-23T17:00:00', dueTimeZone: policy.timezone },
      policy.timezone,
    )?.toISOString(),
    '2026-10-24T00:00:00.000Z',
  );
  assert.equal(
    taskDeadline(
      { ...task, dueDate: '2026-03-08T02:30:00', dueTimeZone: policy.timezone },
      policy.timezone,
    ),
    null,
  );
  assert.equal(
    taskDeadline(
      { ...task, dueDate: '2026-11-01T01:30:00', dueTimeZone: policy.timezone },
      policy.timezone,
    )?.toISOString(),
    '2026-11-01T09:30:00.000Z',
  );
});
void test('selects only the latest relevant deadline prompt and suppresses quiet, snoozed, finished or invalid work', async () => {
  const { selectTaskReminder } = await reminders();
  const now = new Date('2026-10-23T18:00:00Z');
  assert.deepEqual(selectTaskReminder({ task, policy, now }), {
    kind: 'pre_deadline',
    slot: 'pre:24',
    scheduledAt: '2026-10-23T06:59:59.999Z',
  });
  assert.equal(selectTaskReminder({ task, policy, now: new Date('2026-10-23T07:00:00Z') }), null);
  assert.equal(
    selectTaskReminder({ task, policy, now, snoozedUntil: '2026-10-24T18:00:00Z' }),
    null,
  );
  assert.equal(selectTaskReminder({ task: { ...task, status: 'Done' }, policy, now }), null);
  assert.equal(
    selectTaskReminder({ task: { ...task, ineligibleReason: 'unassigned' }, policy, now }),
    null,
  );
  assert.equal(
    selectTaskReminder({ task, policy, now: new Date('2026-10-24T18:00:00Z') }),
    null,
    'old pre-deadline prompts must not arrive after the deadline',
  );
  assert.equal(
    selectTaskReminder({ task, policy, now: new Date('2026-10-27T18:00:00Z') })?.slot,
    'overdue:72',
  );
});
void test('unanswered follow-ups anchor to a real check-in and stop when the volunteer responds', async () => {
  const { selectTaskReminder } = await reminders();
  const now = new Date('2026-10-26T19:00:00Z');
  const lastDelivery = {
    id: 'checkin',
    at: '2026-10-25T18:00:00Z',
    scheduledAt: '2026-10-25T06:59:59.999Z',
  };
  assert.equal(
    selectTaskReminder({ task, policy, now, lastDelivery })?.slot,
    'followup:checkin:24',
  );
  assert.equal(
    selectTaskReminder({ task, policy, now, lastDelivery, lastResponseAt: '2026-10-26T18:00:00Z' })
      ?.kind,
    'overdue',
  );
  assert.equal(
    selectTaskReminder({
      task,
      policy,
      now,
      lastDelivery: { ...lastDelivery, at: '2026-10-26T18:00:00Z' },
    })?.kind,
    'overdue',
  );
});
void test('daily digest uses a local calendar day and honors quiet hours and snooze', async () => {
  const { taskDigestDay } = await reminders();
  assert.equal(taskDigestDay(policy, new Date('2026-11-01T17:00:00Z')), '2026-11-01');
  assert.equal(taskDigestDay(policy, new Date('2026-11-01T16:00:00Z')), null);
  assert.equal(
    taskDigestDay({ ...policy, digestHour: null }, new Date('2026-11-01T17:00:00Z')),
    null,
  );
  assert.equal(taskDigestDay(policy, new Date('2026-11-02T06:00:00Z')), null);
});
