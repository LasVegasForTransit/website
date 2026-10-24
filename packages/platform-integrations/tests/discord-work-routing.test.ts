import assert from 'node:assert/strict';
import test from 'node:test';
import { workScope } from './support/discord-work';
void test('multi-project placement is explicit and a project thread never creates a nested thread', async () => {
  const module = await import('../src/discord-work-routing').catch(() => null);
  assert.ok(module, 'placement decisions exist');
  const home = {
    id: 'home',
    scope: workScope,
    projectSourceId: 'projects',
    projectId: 'p1',
    destination: {
      kind: 'thread' as const,
      channelId: '333333333333333333',
      parentId: '444444444444444444',
    },
    taskParent: null,
    audienceFingerprint: 'audience',
    approvedBy: 'admin',
    state: 'active' as const,
    generation: 1,
  };
  const subject = { kind: 'task' as const, sourceId: 'source', pageId: 'page' };
  assert.equal(module.planWorkPlacement(home, subject, ['p1', 'p2']).kind, 'choice_required');
  assert.equal(module.planWorkPlacement(home, subject, ['p1', 'p2'], 'p1').kind, 'card_only');
  assert.equal(
    module.planWorkPlacement(
      { ...home, destination: { ...home.destination, kind: 'forum' } },
      subject,
      ['p1'],
      'p1',
    ).kind,
    'create',
  );
});
