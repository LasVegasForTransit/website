import assert from 'node:assert/strict';
import test from 'node:test';
import { taskPolicy } from './support/task-checkins';
import { inspectTaskCheckinPolicy } from '../src/notion-task-policy';
import type { NotionTaskSnapshot } from '../src/notion-task-types';
import type { DiscordTaskComponent } from '../src/notion-task-cards';

function taskCardButtons(message: { components: DiscordTaskComponent[] }): DiscordTaskComponent[] {
  return message.components.flatMap((component) => [
    ...(component.type === 2 ? [component] : []),
    ...(component.accessory?.type === 2 ? [component.accessory] : []),
    ...taskCardButtons({ components: component.components ?? [] }),
  ]);
}

const token = 'a'.repeat(43);
const task: NotionTaskSnapshot = {
  title: 'Prepare @everyone agenda <@123456789012345678>',
  url: 'https://app.notion.com/10000000000040008000000000000002',
  description: null,
  assigneeIds: ['guest'],
  projectIds: [],
  dueDate: '2026-10-23',
  dueTimeZone: null,
  status: 'In progress',
  ineligibleReason: null,
};
async function cards() {
  const module = await import('../src/notion-task-cards').catch(() => null);
  assert.ok(module, 'native Discord task cards must exist');
  return module;
}
void test('private task cards use Components V2, restrained mentions, and actionable controls', async () => {
  const { renderTaskCard } = await cards();
  const policy = inspectTaskCheckinPolicy(taskPolicy).policy;
  assert.ok(policy);
  const message = renderTaskCard({ token, task, active: true, policy });
  assert.equal(message.flags, 32768);
  assert.deepEqual(message.allowed_mentions, { parse: [] });
  const serialized = JSON.stringify(message);
  assert.equal(serialized.includes('@everyone'), false);
  assert.equal('content' in message, false);
  assert.match(serialized, /Open in Notion/);
  assert.deepEqual(
    taskCardButtons(message)
      .filter((b) => b.custom_id)
      .map((b) => b.label),
    ['Add update'],
  );
});
void test('pending, complete, or stale cards cannot promise a saved state or submit task changes', async () => {
  const { renderTaskCard } = await cards();
  const policy = inspectTaskCheckinPolicy(taskPolicy).policy;
  assert.ok(policy);
  const pending = renderTaskCard({ token, task, active: true, policy, state: 'pending' });
  assert.equal(JSON.stringify(pending).includes('was saved in Notion'), false);
  for (const state of ['pending', 'stale'] as const) {
    const message = renderTaskCard({ token, task, active: true, policy, state });
    const actions = taskCardButtons(message).filter(
      (button) => button.custom_id?.endsWith(':preferences') !== true && button.custom_id,
    );
    assert.ok(actions.length > 0);
    assert.ok(actions.every((button) => button.disabled));
  }
  const done = renderTaskCard({ token, task: { ...task, status: 'Done' }, active: false, policy });
  assert.equal(taskCardButtons(done).filter((b) => b.custom_id).length, 0);
  const message = renderTaskCard({ token, task, active: true, policy });
  const status = message.components[0]?.components?.find((row) =>
    row.components?.some((c) => c.custom_id?.endsWith(':status')),
  )?.components?.[0];
  assert.deepEqual(
    status?.options?.map((o) => [o.value, o.default]),
    [
      ['Not started', false],
      ['In progress', true],
      ['Done', false],
    ],
  );
});
void test('setup requires explicit consent and native modals accept only bounded nonempty input', async () => {
  const { renderTaskSetup, renderTaskModal, taskModalText, parseTaskCustomId } = await cards();
  const policy = inspectTaskCheckinPolicy(taskPolicy).policy;
  assert.ok(policy);
  const setup = renderTaskSetup({ sourceId: 'source', revision: 2, policy });
  assert.match(JSON.stringify(setup), /Enable check-ins/);
  assert.match(JSON.stringify(setup), /21:00/);
  const modal = renderTaskModal(token, 'progress');
  assert.equal(modal.type, 9);
  const raw = {
    components: [{ type: 18, component: { type: 4, custom_id: 'note', value: 'Draft ready' } }],
  };
  assert.equal(taskModalText(raw), 'Draft ready');
  assert.equal(
    taskModalText({ components: [{ component: { custom_id: 'note', value: ' '.repeat(10) } }] }),
    null,
  );
  assert.equal(
    taskModalText({ components: [{ component: { custom_id: 'note', value: 'a'.repeat(1801) } }] }),
    null,
  );
  assert.equal(parseTaskCustomId(`tc:${token}:unexpected`), null);
  assert.equal(parseTaskCustomId(`tc:invalid:progress`), null);
});

void test('task updates use one private picker with only permitted actions', async () => {
  const { renderTaskUpdateMenu, taskUpdateAction } = await cards();
  const policy = inspectTaskCheckinPolicy(taskPolicy).policy;
  assert.ok(policy);
  const menu = renderTaskUpdateMenu(token, {
    ...policy,
    actions: { ...policy.actions, blocker: false },
  });
  const picker = menu.components[0]?.components?.find((c) => c.type === 1)?.components?.[0];
  assert.ok(picker);
  assert.equal(picker.type, 3);
  assert.deepEqual(
    picker.options?.map((option) => option.value),
    ['progress', 'extension', 'snooze'],
  );
  assert.equal(taskUpdateAction({ component_type: 3, values: ['blocker'] }), 'blocker');
  assert.equal(taskUpdateAction({ component_type: 3, values: ['confirm'] }), null);
  assert.equal(taskUpdateAction({ component_type: 3, values: ['progress', 'snooze'] }), null);
});

void test('the private update picker opens existing modals and enforces permitted actions', async () => {
  const { fixture, now, sourceId } = await import('./support/task-action-fixture');
  const { handleTaskCardAction } = await import('../src/notion-task-card-actions');
  const { readTaskCheckinSource } =
    await import('@lasvegasfortransit/platform-storage/notion-task-checkins');
  const db = await fixture();
  const source = await readTaskCheckinSource(db, sourceId);
  const policy = inspectTaskCheckinPolicy(taskPolicy).policy;
  assert.ok(source && policy);
  db.raw
    .prepare(
      "UPDATE task_checkin_cards SET channel_id='222222222222222222',message_id='333333333333333333'",
    )
    .run();
  const card = db.raw.prepare('SELECT token FROM task_checkin_cards').get() as { token: string };
  const input = {
    source,
    policy,
    discordUserId: '111111111111111111',
    custom: { kind: 'task' as const, token: card.token, action: 'update' as const },
    interaction: {
      id: '444444444444444444',
      type: 3,
      channel_id: '222222222222222222',
      message: { id: '555555555555555555', flags: 64 },
      data: { component_type: 3, values: ['progress'] },
    },
  };
  const reply = await handleTaskCardAction(db, input, now);
  const modal: unknown = await reply.json();
  assert.ok(modal && typeof modal === 'object' && 'type' in modal);
  assert.equal(modal.type, 9);
  const denied = await handleTaskCardAction(
    db,
    { ...input, policy: { ...policy, actions: { ...policy.actions, progress: false } } },
    now,
  );
  assert.equal(denied.status, 403);
  const malformed = await handleTaskCardAction(
    db,
    {
      ...input,
      interaction: { ...input.interaction, data: { component_type: 3, values: ['confirm'] } },
    },
    now,
  );
  assert.equal(malformed.status, 400);
});

void test('the card status dropdown records only valid authorized status changes', async () => {
  const { fixture, now, sourceId } = await import('./support/task-action-fixture');
  const { handleTaskCardAction } = await import('../src/notion-task-card-actions');
  const { readTaskCheckinSource } =
    await import('@lasvegasfortransit/platform-storage/notion-task-checkins');
  const db = await fixture();
  try {
    const source = await readTaskCheckinSource(db, sourceId);
    const policy = inspectTaskCheckinPolicy(taskPolicy).policy;
    assert.ok(source && policy);
    db.raw
      .prepare(
        "UPDATE task_checkin_cards SET channel_id='222222222222222222',message_id='333333333333333333'",
      )
      .run();
    const card = db.raw.prepare('SELECT token FROM task_checkin_cards').get() as { token: string };
    const input = {
      source,
      policy,
      discordUserId: '111111111111111111',
      custom: { kind: 'task' as const, token: card.token, action: 'status' as const },
      interaction: {
        id: '444444444444444444',
        type: 3,
        channel_id: '222222222222222222',
        message: { id: '333333333333333333' },
        data: { component_type: 3, values: ['In progress'] },
      },
    };
    const denied = await handleTaskCardAction(
      db,
      { ...input, policy: { ...policy, actions: { ...policy.actions, complete: false } } },
      now,
    );
    assert.equal(denied.status, 403);
    const invalid = await handleTaskCardAction(
      db,
      {
        ...input,
        interaction: { ...input.interaction, data: { component_type: 3, values: ['Unexpected'] } },
      },
      now,
    );
    assert.equal(invalid.status, 400);
    assert.equal((await handleTaskCardAction(db, input, now)).status, 200);
    const queued = db.raw
      .prepare(
        "SELECT kind,payload_json FROM task_checkin_operations WHERE id='444444444444444444'",
      )
      .get();
    assert.equal(queued?.kind, 'complete');
    assert.deepEqual(JSON.parse(String(queued.payload_json)), { status: 'In progress' });
  } finally {
    db.raw.close();
  }
});
