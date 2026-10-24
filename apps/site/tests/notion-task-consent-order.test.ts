import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture, sourceId, guildId, userId } from './support/task-checkin-interaction-fixture';

void test('an earlier signed choice delivered late cannot overwrite a newer acknowledged stop', async () => {
  const f = await fixture();
  try {
    const choose = (id: string, state: string) =>
      f.send({
        type: 3,
        id,
        guild_id: guildId,
        member: { user: { id: userId } },
        data: { custom_id: `tcs:${sourceId}:1:${state}` },
      });
    assert.equal((await choose('900000000000000002', 'opted_out')).status, 200);
    assert.equal((await choose('900000000000000001', 'active')).status, 200);
    assert.equal(
      f.db.raw.prepare('SELECT state FROM task_checkin_consents').get()?.state,
      'opted_out',
    );
    assert.equal(
      f.db.raw
        .prepare("SELECT applied FROM task_checkin_consent_receipts WHERE id='900000000000000001'")
        .get()?.applied,
      0,
    );
    assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM engagement_events').get()?.n, 1);
    await choose('900000000000000001', 'active');
    assert.equal(
      f.db.raw.prepare('SELECT state FROM task_checkin_consents').get()?.state,
      'opted_out',
    );
    await choose('900000000000000003', 'active');
    await choose('900000000000000000', 'paused');
    assert.equal(
      f.db.raw.prepare('SELECT state FROM task_checkin_consents').get()?.state,
      'active',
    );
    assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM engagement_events').get()?.n, 2);
  } finally {
    f.db.raw.close();
  }
});
