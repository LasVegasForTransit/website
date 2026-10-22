import assert from 'node:assert/strict';
import test from 'node:test';
import {
  workFixture,
  workScope,
  sourceId,
  taskId,
  discordUserId,
  workNow,
} from './support/discord-work';
void test('a verified Notion guest can update assigned shared work without DM consent; revoked assignments fail closed', async () => {
  const module = await import('../src/discord-work-authority').catch(() => null);
  assert.ok(module, 'shared authority checks exist');
  const { db, notion, task } = workFixture();
  const providers = { notion, discord: { membership: () => Promise.resolve(true) } };
  const input = {
    scope: workScope,
    subject: { kind: 'task' as const, sourceId, pageId: taskId },
    discordUserId,
    action: 'comment' as const,
  };
  try {
    assert.equal((await module.authorizeWork(db, providers, input, workNow))?.personId, 'guest');
    assert.equal(
      await module.authorizeWork(db, providers, { ...input, action: 'manage_home' }, workNow),
      null,
    );
    assert.equal(
      await module.authorizeWork(
        db,
        providers,
        { ...input, scope: { ...workScope, workspaceId: 'other' } },
        workNow,
      ),
      null,
    );
    task.properties.Assignee.people = [];
    assert.equal(await module.authorizeWork(db, providers, input, workNow), null);
    task.properties.Assignee.people = [{ id: 'notion-guest' }];
    db.raw.prepare("UPDATE identities SET link_method='created_by_platform'").run();
    assert.equal(await module.authorizeWork(db, providers, input, workNow), null);
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM task_checkin_consents').get()?.n, 0);
  } finally {
    db.raw.close();
  }
});
