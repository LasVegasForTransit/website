import assert from 'node:assert/strict';
import test from 'node:test';
import { accessFixture } from './support/access-fixture';

void test('an expired matching confirmation is display history, never current access', async () => {
  const f = await accessFixture();
  try {
    assert.equal(await f.recordAccessObservation(f.db, f.observation), true);
    const now = new Date(Date.parse(f.observation.observedAt) + 301_000);
    const read = async () => {
      const row = (
        await f.listAccess(f.db, f.actor, {
          personId: f.survivor.id,
          configuration: f.configuration,
          now,
        })
      ).items.find((row) => row.targetId === 'events');
      assert.ok(row);
      return row.discord;
    };
    const expired = await read();
    assert.equal(expired.state, 'unknown');
    assert.equal(expired.reason, 'stale');
    assert.equal(expired.lastConfirmedState, 'granted');
    await f.committees.endAssignment(f.assigned.id, 'stepped_back', f.admin.id, 'end-history');
    assert.equal(
      (await read()).lastConfirmedState,
      undefined,
      'an old grant cannot describe a new assignment generation',
    );
  } finally {
    f.db.raw.close();
  }
});

void test('display history never survives a changed resource or a newer failed read', async () => {
  const f = await accessFixture();
  try {
    assert.equal(await f.recordAccessObservation(f.db, f.observation), true);
    const now = new Date(Date.parse(f.observation.observedAt) + 301_000);
    const read = async (configuration = f.configuration) => {
      const row = (
        await f.listAccess(f.db, f.actor, { personId: f.survivor.id, configuration, now })
      ).items.find((row) => row.targetId === 'events');
      assert.ok(row);
      return row.discord;
    };
    assert.equal((await read()).lastConfirmedState, 'granted');
    assert.equal(
      (await read({ discord: { ...f.configuration.discord, contextId: 'other' } }))
        .lastConfirmedState,
      undefined,
    );
    f.db.raw.prepare("UPDATE committees SET discord_role_id='other' WHERE id='events'").run();
    assert.equal((await read()).lastConfirmedState, undefined);
    f.db.raw.prepare("UPDATE committees SET discord_role_id='456' WHERE id='events'").run();
    const failedAt = new Date(Date.parse(f.observation.observedAt) + 1000);
    assert.equal(
      await f.recordAccessObservation(
        f.db,
        {
          ...f.observation,
          state: 'unknown',
          failure: 'provider_unavailable',
          observedAt: failedAt.toISOString(),
          expiresAt: new Date(failedAt.getTime() + 300_000).toISOString(),
        },
        failedAt,
      ),
      true,
    );
    assert.equal((await read()).lastConfirmedState, undefined);
  } finally {
    f.db.raw.close();
  }
});
