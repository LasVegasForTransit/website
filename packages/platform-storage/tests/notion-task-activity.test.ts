import assert from 'node:assert/strict';
import test from 'node:test';
import { ready, now, operation } from './support/task-checkins';
import { runMaintenance } from '../src/retention';
import { engagementCounts } from '../src/engagement';

void test('recent human task responses survive private-text expiry and subsequent Discord unlink', async () => {
  const { db, s } = await ready();
  try {
    db.raw.exec("UPDATE people SET created_at='2020-01-01T00:00:00.000Z'");
    assert.equal(await s.recordTaskInteraction(db, operation, now), true);
    assert.equal(await s.recordTaskInteraction(db, operation, now), false);
    const afterExpiry = new Date('2026-11-21T16:00:00.000Z');
    await runMaintenance(db, { now: afterExpiry, category: 'records' });
    db.raw.exec("DELETE FROM identities WHERE person_id='member'");
    await runMaintenance(db, { now: afterExpiry, category: 'inactive' });
    assert.equal(
      db.raw.prepare("SELECT erased_at FROM people WHERE id='member'").get()?.erased_at,
      null,
      'a recent volunteer response is activity even after unlink and text cleanup',
    );
    const counts = await engagementCounts(db, 'member', afterExpiry);
    assert.equal(counts.last_engaged_at, now.toISOString());
    assert.equal(counts.attended_total, 0);
    assert.equal(counts.member_since, null);
    const events = db.raw
      .prepare("SELECT * FROM engagement_events WHERE person_id='member' ORDER BY type")
      .all();
    assert.deepEqual(
      events.map((event) => event.type),
      ['task_checkin_preference', 'task_checkin_response'],
    );
    for (const event of events) {
      assert.equal(event.details, null);
      assert.match(String(event.reference), /^[a-f0-9]{32}$/);
    }
    assert.ok(!JSON.stringify(events).includes('Draft ready'));
    assert.ok(!JSON.stringify(events).includes('notion-member'));
    await runMaintenance(db, { now: new Date('2028-06-01T16:00:00.000Z'), category: 'inactive' });
    assert.ok(db.raw.prepare("SELECT erased_at FROM people WHERE id='member'").get()?.erased_at);
    assert.equal(
      db.raw.prepare("SELECT count(*) AS n FROM engagement_events WHERE person_id='member'").get()
        ?.n,
      0,
    );
  } finally {
    db.raw.close();
  }
});

void test('bot deliveries and source maintenance never refresh a person activity date', async () => {
  const { db, s } = await ready();
  try {
    // The fixture has already recorded its own opt-in: compare the event count before bot work.
    const before = db.raw.prepare('SELECT count(*) AS n FROM engagement_events').get()?.n;
    assert.equal(await s.enqueueTaskDelivery(db, { ...operation, id: 'bot' }, now), true);
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM engagement_events').get()?.n, before);
    assert.equal(
      await s.recordTaskInteraction(db, { ...operation, id: 'stale', taskRevision: 'stale' }, now),
      false,
    );
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM engagement_events').get()?.n, before);
  } finally {
    db.raw.close();
  }
});

void test('only applied own preference changes record activity and replay adds no event', async () => {
  const { db, s } = await ready();
  try {
    const choice = {
      sourceId: 'source',
      personId: 'member',
      discordUserId: '111111111111111111',
      interactionId: '100000000000000100',
      state: 'opted_out' as const,
      policyRevision: 1,
    };
    assert.equal(
      await s.setTaskCheckinConsent(db, { ...choice, discordUserId: 'wrong' }, now),
      false,
    );
    assert.equal(await s.setTaskCheckinConsent(db, choice, now), true);
    assert.equal(await s.setTaskCheckinConsent(db, choice, now), false);
    await s.saveTaskCheckinSource(
      db,
      {
        sourceId: 'source',
        workspaceId: 'workspace',
        expectedRevision: 1,
        enabled: false,
        policy: {},
        actorId: 'staff',
      },
      now,
    );
    assert.equal(
      db.raw.prepare("SELECT count(*) AS n FROM engagement_events WHERE person_id='member'").get()
        ?.n,
      2,
    );
  } finally {
    db.raw.close();
  }
});
