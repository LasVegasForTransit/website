import assert from 'node:assert/strict';
import test from 'node:test';
import type { DiscordTaskComponent } from '../src/notion-task-cards';
import { workScope, sourceId, taskId, projectId } from './support/discord-work';
function flatten(parts: DiscordTaskComponent[]): DiscordTaskComponent[] {
  return parts.flatMap((p) => [
    p,
    ...flatten(p.components ?? []),
    ...(p.accessory ? [p.accessory] : []),
  ]);
}
void test('shared cards expose a status dropdown and Add update, with no recipient credential', async () => {
  const module = await import('../src/discord-work-cards').catch(() => null);
  assert.ok(module, 'shared native cards exist');
  const conversation = {
    id: 'conversation',
    scope: workScope,
    subject: { kind: 'task' as const, sourceId, pageId: taskId },
    homeId: 'home',
    placementProjectId: projectId,
    threadId: '555555555555555555',
    starterMessageId: '555555555555555555',
    mode: 'automatic' as const,
    state: 'active' as const,
    generation: 2,
    activationId: '555555555555555555',
    cursorId: '555555555555555555',
    windowUpperId: null,
    windowBeforeId: null,
    footerBlockIds: [],
  };
  const task = {
    title: 'Prepare agenda',
    url: `https://www.notion.so/${taskId}`,
    description: null,
    assigneeIds: [],
    projectIds: [projectId],
    status: 'Not started',
    dueDate: null,
    dueTimeZone: null,
    ineligibleReason: null,
  };
  const card = module.sharedTaskCard(conversation, task, 'active');
  const controls = flatten(card.components);
  assert.equal(controls.filter((p) => p.type === 3).length, 1);
  assert.equal(controls.filter((p) => p.label === 'Add update').length, 1);
  assert.deepEqual(
    controls.filter((p) => p.type === 10).map((p) => p.content),
    ['### Prepare agenda', 'No deadline'],
  );
  assert.ok(controls.some((p) => p.custom_id === 'work:conversation:2:status'));
  const done = flatten(
    module.sharedTaskCard(conversation, { ...task, status: 'Done' }, 'active').components,
  );
  assert.equal(done.find((p) => p.type === 3)?.disabled, true);
  assert.equal(
    done.some((p) => p.label === 'Add update'),
    false,
  );
  assert.equal(
    flatten(module.sharedTaskCard(conversation, task, 'paused').components).find(
      (p) => p.type === 3,
    )?.disabled,
    true,
  );
});
