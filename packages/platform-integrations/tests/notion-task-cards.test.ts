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
  for (const action of ['progress', 'blocker', 'complete', 'snooze', 'extension', 'preferences']) {
    assert.ok(serialized.includes(`tc:${token}:${action}`), action);
  }
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
  assert.ok(
    taskCardButtons(done)
      .filter((b) => b.custom_id?.endsWith(':complete'))
      .every((b) => b.disabled),
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
