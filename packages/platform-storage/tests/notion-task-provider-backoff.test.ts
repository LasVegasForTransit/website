import assert from 'node:assert/strict';
import test from 'node:test';
import { ready, now } from './support/task-checkins';
import { deferTaskProvider, taskProviderCoolingDown } from '../src/notion-task-provider-backoff';
void test('provider waits persist across workers and cannot be shortened by another retry or review cleanup', async () => {
  const { db } = await ready();
  try {
    assert.equal(await taskProviderCoolingDown(db, 'source', now), false);
    await deferTaskProvider(db, 'source', 300000, now);
    await deferTaskProvider(db, 'source', 60000, now);
    db.raw.prepare('DELETE FROM task_checkin_escalations').run();
    assert.equal(
      await taskProviderCoolingDown(db, 'source', new Date(now.getTime() + 299000)),
      true,
    );
    assert.equal(
      await taskProviderCoolingDown(db, 'source', new Date(now.getTime() + 300000)),
      false,
    );
    await deferTaskProvider(db, 'source', 600000, now);
    assert.equal(
      await taskProviderCoolingDown(db, 'source', new Date(now.getTime() + 300000)),
      true,
    );
    db.raw.prepare('DELETE FROM task_checkin_sources').run();
    assert.equal(await taskProviderCoolingDown(db, 'source', now), false);
  } finally {
    db.raw.close();
  }
});
